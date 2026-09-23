// npm run spec:gap -- <intake run id> [--top 25]
//
// ============================================================================
// READ ONLY. WHAT A STAGED SPECIFICATION READ PLACED, AS A NUMBER.
//
// Plan any-bill, Step 8. "The model read the lines right; the app placed
// almost none" was an impression until it was counted. For one staged
// specification-document run this prints every proposal by OUTCOME:
//
//   placed        a record, and a question, a dimension slot or a BWS field;
//   kept          a record and a finish row that fills no field (a stone code,
//                 "Fabric: COM", or every slot of its kind already full);
//   record only   a record, and nothing it answers;
//   ambiguous     no record, candidates offered;
//   nothing       no record and no candidate;
//
// then the observation labels most often left unplaced — the next thing to
// look at. It prints the table TWICE: as staged, and as the run would stand if
// re-matched NOW (`rematchProposals`, in memory, with the same registers the
// re-match route loads — a bill's own read gets its row → record map). The
// second table is what `POST /api/imports/[id]/rematch` would write, and this
// writes NOTHING, anywhere: it reads the run and the registers and prints.
//
// Run against the LOCAL stack only. It loads the app's registers through the
// app's own driver, so it needs the stack server a `dev:local` or a db-test
// runner has up.
// ============================================================================
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { loadExtractionRegisters } from "@/lib/spec-document-registers";
import { rematchProposals, type Proposal, type StagedSpecDocument } from "@/lib/spec-document";

type Outcome = "placed" | "kept" | "record only" | "ambiguous" | "nothing";
const OUTCOMES: Outcome[] = ["placed", "kept", "record only", "ambiguous", "nothing"];

function outcomeOf(proposal: Proposal): Outcome {
  if (proposal.recordId) {
    if (proposal.dimension || proposal.requirementId) return "placed";
    if (proposal.finish) return proposal.finish.specFieldId ? "placed" : "kept";
    return "record only";
  }
  return proposal.recordCandidates.length > 1 ? "ambiguous" : "nothing";
}

function table(title: string, lines: Proposal[], top: number): void {
  const counts = new Map<Outcome, number>(OUTCOMES.map((outcome) => [outcome, 0]));
  const byRow = new Map<string, number>();
  const unplaced = new Map<string, number>();
  for (const line of lines) {
    const outcome = outcomeOf(line);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    if (line.rowMatch) byRow.set("row", (byRow.get("row") ?? 0) + 1);
    if (outcome !== "placed" && outcome !== "kept") {
      const label = (line.raw.attributeRaw ?? "(no label)").trim();
      unplaced.set(label, (unplaced.get(label) ?? 0) + 1);
    }
  }
  const observations = new Set(lines.map((line) => line.sourceOrdinal)).size;
  console.log(`\n${title}: ${lines.length} proposals from ${observations} observations`);
  for (const outcome of OUTCOMES) {
    const n = counts.get(outcome) ?? 0;
    console.log(`  ${outcome.padEnd(12)} ${String(n).padStart(5)}  ${((100 * n) / Math.max(1, lines.length)).toFixed(1)}%`);
  }
  console.log(`  placed by its bill row: ${byRow.get("row") ?? 0}`);
  const slots = lines.filter((line) => line.recordId && line.dimension).length;
  const fields = lines.filter((line) => line.recordId && line.finish?.specFieldId).length;
  const questions = lines.filter((line) => line.recordId && line.requirementId).length;
  console.log(`  of placed: ${slots} dimension slots, ${fields} BWS fields, ${questions} checklist questions`);
  console.log(`  top unplaced labels:`);
  for (const [label, n] of [...unplaced.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)) {
    console.log(`    ${String(n).padStart(4)}  ${label}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runId = args.find((arg) => !arg.startsWith("--"));
  const topAt = args.indexOf("--top");
  const top = topAt >= 0 ? Number(args[topAt + 1]) || 25 : 25;
  if (!runId) {
    console.error("usage: npm run spec:gap -- <intake run id> [--top 25]");
    process.exit(2);
  }
  console.log(`database host: ${new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname}`);

  const rows = await sql`
    select id, project_id, source_kind, document_kind, status, registration_request_id, parsed
    from intake_runs where id = ${runId}
  `;
  const run = rows[0];
  if (!run) throw new Error(`No intake run ${runId}.`);
  if (run.source_kind !== "spec_document") throw new Error(`Run ${runId} is ${String(run.source_kind)}, not a specification document.`);
  const staged = run.parsed as StagedSpecDocument | null;
  if (!staged || !Array.isArray(staged.lines)) throw new Error(`Run ${runId} has nothing staged.`);
  console.log(`run ${runId} · ${String(run.document_kind)} · ${String(run.status)} · registered as ${String(run.registration_request_id ?? "—")}`);

  table("AS STAGED", staged.lines, top);

  const registers = await loadExtractionRegisters(String(run.project_id), { intakeRunId: runId });
  console.log(
    `\nregisters: ${registers.records.length} records` +
      (registers.billRows
        ? `; bill ${registers.billRows.billRunId}, ${registers.billRows.sheets.reduce((n, sheet) => n + sheet.rows.size, 0)} rows mapped to records`
        : "; not a bill's own read"),
  );
  const { lines, rematched, added } = rematchProposals(staged, registers, () => randomUUID());
  table(`IF RE-MATCHED NOW (in memory; ${rematched} observations re-resolved, ${added >= 0 ? "+" : ""}${added} proposals)`, lines, top);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
