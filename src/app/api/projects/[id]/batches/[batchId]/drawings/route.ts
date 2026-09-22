// Every drawing document in one intake pack, resolved together.
//
// WHY THIS EXISTS. A drawing set used to be one PDF. The real Panther pack is
// eleven: one combined shop-drawing set plus ten per-item specification sheets.
// Reviewed one run at a time that is eleven screens and eleven Extract buttons
// for one delivery, and — worse — nothing can see across them, so the two
// failures that only appear at pack level (below) are invisible.
//
// IT IS A VIEW, NOT A NEW WRITE BOUNDARY. Every card still confirms against its
// OWN run, through POST /api/imports/[runId]/confirm, with that run's item
// versions. Inventing a batch-level confirm would replace the single atomic
// boundary confirm-drawings.ts exists to be, and a half-applied pack is a far
// worse failure than a half-applied card.
//
// The two pack-level diagnostics, both computed here and stored nowhere:
//
//   DUPLICATE TARGETS. Two documents describing S-100 both write dimensions to
//   the same record, and the unique field-slot index deliberately exempts
//   dimensions, so nothing stops them. Reported, never auto-resolved: the
//   documents may disagree, and the specification sheets themselves say the
//   signed shop drawings take precedence.
//
//   REPEATED OBSERVATIONS. Ten sheets carrying one fourteen-bullet REMARKS
//   block is ~140 identical notes to review individually.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadBatchDrawings } from "@/lib/drawing-resolution";
import { duplicateTargets, repeatedObservations, type PackCard } from "@/lib/drawing-document";
import { loadPalettes, withPalettes } from "@/lib/palette-load";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; batchId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id, batchId } = await context.params;

  // Scoped from the batch's own row, never from the path alone: a batch id from
  // another project must 404 rather than leak that project's drawings.
  const batch = await sql`
    select id, label from intake_batches where id = ${batchId} and project_id = ${id}
  `;
  if (!batch[0]) return json({ ok: false, error: "No such pack." }, 404);

  const { runs, records } = await loadBatchDrawings(id, batchId);

  // The cards, flattened, so the pack-level functions can see across documents.
  // Only cards with something still to review: a duplicate between two already
  // applied cards is history, and warning about it now would be advice about a
  // decision somebody already made.
  const cards: PackCard[] = runs.flatMap((run) =>
    (run.staged?.items ?? [])
      .filter((item) => item.observations.some((observation) => observation.reviewStatus === "pending"))
      .map((item) => ({
        importId: run.importId,
        filename: run.filename,
        item,
        targets: run.items.find((resolved) => resolved.id === item.id)?.targets ?? [],
      })),
  );

  // Labels for the duplicate warning, so it can name the record a person knows
  // rather than a uuid.
  const duplicates = duplicateTargets(cards);
  const labels = new Map<string, string>();
  if (duplicates.length > 0) {
    const rows = await sql`
      select id, record_no, item_description
      from spec_records
      where id = any(${duplicates.map((entry) => entry.recordId)}::uuid[])
    `;
    const project = await sql`select bws_project_number from projects where id = ${id}`;
    const prefix = String(project[0]?.bws_project_number ?? "");
    for (const row of rows) {
      labels.set(
        String(row.id),
        `${prefix}-${String(row.record_no).padStart(3, "0")} · ${String(row.item_description)}`,
      );
    }
  }

  // The field register, with each field's palette attached. Read at READ time
  // from the register, exactly as the single-document screen does it and for
  // the same reason: a pack already read gains the list with no second model
  // call. See src/lib/palette-load.ts.
  const fieldRows = await sql`select id, json_id, name, field_category from spec_fields order by sort_order`;
  const fields = withPalettes(fieldRows, await loadPalettes(sql));

  return json({
    ok: true,
    batch: batch[0],
    runs,
    records,
    specFields: fields,
    duplicates: duplicates.map((entry) => ({ ...entry, recordLabel: labels.get(entry.recordId) ?? null })),
    repeated: repeatedObservations(cards),
  });
}
