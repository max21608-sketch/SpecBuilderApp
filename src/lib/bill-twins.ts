// A bill's twin suggestions, accepted on the review and linked at confirm (0060).
//
// ============================================================================
// A SUGGESTION IS A QUESTION; ONLY A CLICK STAGES AN ANSWER.
//
// `suggestTwins` reads a sheet for one code under two zones (GR-FUR-13 and
// PL-FUR-13) or one code on two lines, and the review prints each as a
// `SuggestButton` with that evidence. Accepting stages `twinOf` on the line,
// here, and the bill confirm links the two records those lines become in the
// confirm's own change set. Nothing else writes a link from a bill: a guess
// nobody accepted is never a twin, which is the level and category rule.
//
// THE SERVER ONLY ACCEPTS WHAT IT WOULD HAVE SUGGESTED. The screen sends a
// row and the row it is a twin of; the sheet is re-read under the run's lock
// and `suggestTwins` must still say exactly that, with the same evidence the
// line stores. So a request cannot make two lines twins that the rules do not
// connect, and a re-read of the columns since (which re-stages the lines)
// refuses a stale accept instead of applying it to different rows.
//
// Each line carries its own lock, `twinOfVersion`, for `slotOverridesVersion`'s
// reason: the run's version moves on every autosave on every row, and two
// people on two lines must not conflict for nothing.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { assertBoqDocument, type StagedBoqLine } from "@/lib/boq-import";
import { linkTwins } from "@/lib/record-twins";
import { acceptedTwinPairs, suggestTwins, twinPartnerMissing, type TwinStagedLine } from "@/lib/twin-suggest";

export type TwinAccept = { index: number; version: number };

export type { TwinStagedLine } from "@/lib/twin-suggest";

/**
 * Accepts (or takes back) twin suggestions on one sheet of a staged bill.
 * `accept` stages each line's live suggestion; `clear` takes an accepted one
 * back. Both are checked against each line's own version.
 */
export async function stageBillTwins(
  txn: TxnSql,
  input: { runId: string; sheetIndex: number; accept: readonly TwinAccept[]; clear: readonly TwinAccept[]; actor: string },
): Promise<{ version: number; accepted: number; cleared: number }> {
  const rows = await txn`select parsed, status, source_kind from intake_runs where id = ${input.runId} for update`;
  if (!rows[0]) throw new DomainConflictError("gone", "No such import.", { status: 404 });
  if (rows[0].source_kind !== "boq_xlsx") {
    throw new DomainConflictError("not_a_bill", "Twins are suggested on a bill of quantities only.", { status: 400 });
  }
  if (rows[0].status !== "parsed") throw new DomainConflictError("confirmed", "This import is already confirmed.");
  const doc = assertBoqDocument(rows[0].parsed);
  const sheet = doc.sheets[input.sheetIndex];
  if (!sheet) throw new DomainConflictError("gone", "That tab is no longer in this import. Reload.");
  const lines = sheet.lines as StagedBoqLine[];
  const suggestions = suggestTwins(lines);

  const touched = new Set<number>();
  const patch = (entry: TwinAccept): StagedBoqLine => {
    const line = lines[entry.index];
    if (!line) throw new DomainConflictError("gone", "That line is no longer in this import. Reload.");
    if (touched.has(entry.index)) {
      throw new DomainConflictError("twin_twice", `Row ${line.lineNo} was sent twice. Reload.`, { status: 400 });
    }
    touched.add(entry.index);
    if ((line.twinOfVersion ?? 0) !== entry.version) {
      throw new DomainConflictError(
        "twin_stale",
        `Row ${line.lineNo}'s twin changed since this screen loaded. Reload and look at it again.`,
      );
    }
    return line;
  };

  let accepted = 0;
  for (const entry of input.accept) {
    const line = patch(entry);
    const suggestion = suggestions.get(line.lineNo);
    if (!suggestion) {
      throw new DomainConflictError(
        "twin_not_suggested",
        `Row ${line.lineNo} is no longer suggested as a twin. Reload to see what the bill says now.`,
      );
    }
    line.twinOf = { row: suggestion.twinOf, evidence: suggestion.evidence };
    line.twinOfVersion = entry.version + 1;
    accepted += 1;
  }
  let cleared = 0;
  for (const entry of input.clear) {
    const line = patch(entry);
    if (!line.twinOf) continue;
    line.twinOf = null;
    line.twinOfVersion = entry.version + 1;
    cleared += 1;
  }

  const written = await txn`
    update intake_runs
       set parsed = jsonb_set(parsed, array['sheets', ${String(input.sheetIndex)}, 'lines'], ${JSON.stringify(lines)}::jsonb),
           updated_by = ${input.actor}
     where id = ${input.runId} and status = 'parsed'
     returning version
  `;
  if (!written[0]) throw new DomainConflictError("gone", "That import is no longer open. Reload.");
  return { version: Number(written[0].version), accepted, cleared };
}

/**
 * The row pairs a sheet's ACCEPTED twins link, for the confirm. A line whose
 * twin is no longer imported as an item (ignored since, or made a finish line)
 * links nothing: the review says so on the row ("row 2 is not being
 * imported: nothing is linked"), so the confirm is not refused for a decision
 * the person took after accepting, and nothing is linked to a record that
 * does not exist.
 */
export function billTwinPairs(lines: readonly TwinStagedLine[]): [number, number][] {
  const accepted: { lineNo: number; twinOf: number }[] = [];
  for (const line of lines) {
    if (!line.twinOf || twinPartnerMissing(lines, line)) continue;
    accepted.push({ lineNo: line.lineNo, twinOf: line.twinOf.row });
  }
  return acceptedTwinPairs(accepted);
}

/**
 * Links the records two accepted lines became, in the bill confirm's change
 * set. A pair already linked (a revision carrying both records forward) is
 * left as it is.
 */
export async function linkBillTwins(
  txn: TxnSql,
  input: {
    pairs: readonly [number, number][];
    recordOf: (row: number) => string | null;
    lines: readonly TwinStagedLine[];
    changeSetId: string;
    actor: string;
  },
): Promise<number> {
  let linked = 0;
  for (const [a, b] of input.pairs) {
    const recordA = input.recordOf(a);
    const recordB = input.recordOf(b);
    if (!recordA || !recordB) {
      throw new DomainConflictError("twin_not_imported", `Rows ${a} and ${b} were accepted as twins and one of them did not import. Reload the review.`);
    }
    if (recordA === recordB) continue;
    const live = await txn`
      select 1 from spec_record_twins
       where status = 'active'
         and least(record_a, record_b) = least(${recordA}::uuid, ${recordB}::uuid)
         and greatest(record_a, record_b) = greatest(${recordA}::uuid, ${recordB}::uuid)
    `;
    if (live[0]) continue;
    const accepted = input.lines.find((line) => (line.lineNo === b || line.lineNo === a) && line.twinOf)?.twinOf;
    await linkTwins(txn, {
      recordId: recordA,
      otherId: recordB,
      // The evidence the person accepted, so the link says why on its own.
      reason: `Accepted on the bill review, rows ${a} and ${b}${accepted ? `: ${accepted.evidence}` : "."}`,
      actor: input.actor,
      changeSetId: input.changeSetId,
    });
    linked += 1;
  }
  return linked;
}
