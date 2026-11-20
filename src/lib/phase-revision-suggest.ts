// IS THIS TAB A PHASE THE PROJECT ALREADY HAS? (prod-ready RV0, 2026-11-20)
//
// ============================================================================
// THE DEFECT. A revised bill's sheet named `Guest Rooms`, uploaded to a
// project whose active phase `Guest Rooms` held the same codes, defaulted to
// "This sheet is: a new phase". One press of the bill's primary Confirm made a
// SECOND "Guest Rooms" phase with every record twice, and nothing on the screen
// had said the tab looked like one the project already had.
//
// THE RULE. A sheet whose name is an active phase's name or source sheet, or
// most of whose codes are on one active phase, is SUGGESTED as a revision of
// that phase, with its evidence — and the bill's Confirm waits until a person
// has said which it is: a revision of a phase, or a new phase. "A new phase"
// is therefore a STORED choice (`newPhaseChosen`) distinct from "not decided".
// A sheet that looks like no phase stays "a new phase" by default, exactly as
// before: nothing is asked of a first bill.
//
// A SUGGESTION IS NOT A DECISION (bills.md, "A SUGGESTION IS NOT A PAIRING").
// Nothing here chooses a phase, and the confirm never writes from it: it
// REFUSES while a suggested sheet is undecided, and writes what was stored.
// Computed on read and again inside the confirm from live rows, never stored,
// because the phases it compares with move.
//
// Pure, apart from `loadPhasesForSuggestion`, so the screen's suggestion and
// the confirm's refusal come from one function.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";
import { normaliseRef } from "@/lib/record-refs";

/** An active phase, with what a sheet is compared on. */
export type PhaseForSuggestion = {
  id: string;
  name: string;
  /** The bill sheet the phase was read from, where it was. */
  sourceSheet: string | null;
  /** Its active bill lines' codes, normalised (`normaliseRef`). */
  codes: readonly string[];
};

/** A phase a sheet looks like, and why. */
export type PhaseSuggestion = {
  runId: string;
  runName: string;
  /** The sheet's name is the phase's name or the sheet it was read from. */
  sameName: boolean;
  /** How many of the sheet's codes are on the phase. */
  codesOnPhase: number;
  /** How many distinct codes the sheet's live item lines carry. */
  codesOnSheet: number;
};

/** The parts of a staged sheet this reads. */
export type SheetForSuggestion = {
  sheetName: string;
  proposedRunName?: string | null;
  ignored?: boolean;
  replacesRunId?: string | null;
  newPhaseChosen?: boolean;
  lines: readonly { code: string | null; ignored?: boolean; rowKind?: string | null }[];
};

function foldName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The phases a sheet looks like, best first; empty where it looks like none.
 *
 * A NAME MATCH IS THE STRONGER EVIDENCE and, where there is one, the only
 * kind offered: a revised `Guest Rooms` also has most of its codes on a
 * mock-up phase quoting the same items, and offering that second phase beside
 * the one it is named for is noise. Otherwise every phase holding MORE THAN
 * HALF of the sheet's codes is offered — two where MUR and MAIN RUN quote the
 * same codes, because which one a tab revises is not something the codes can
 * tell, and choosing between them is the person's.
 */
export function suggestPhaseRevision(
  sheet: SheetForSuggestion,
  phases: readonly PhaseForSuggestion[],
): PhaseSuggestion[] {
  const names = new Set([foldName(sheet.sheetName), foldName(sheet.proposedRunName)].filter((name) => name !== ""));
  const codes = new Set(
    sheet.lines
      .filter((line) => !line.ignored && line.rowKind !== "finish_for" && line.code && line.code.trim() !== "")
      .map((line) => normaliseRef(line.code as string))
      .filter((code) => code !== ""),
  );
  const all = phases.map((phase) => {
    const held = new Set(phase.codes);
    return {
      runId: phase.id,
      runName: phase.name,
      sameName: names.has(foldName(phase.name)) || (phase.sourceSheet !== null && names.has(foldName(phase.sourceSheet))),
      codesOnPhase: [...codes].filter((code) => held.has(code)).length,
      codesOnSheet: codes.size,
    };
  });
  const byEvidence = (a: PhaseSuggestion, b: PhaseSuggestion) =>
    b.codesOnPhase - a.codesOnPhase || a.runName.localeCompare(b.runName);
  const named = all.filter((entry) => entry.sameName);
  if (named.length > 0) return named.sort(byEvidence);
  return all.filter((entry) => entry.codesOnSheet > 0 && entry.codesOnPhase * 2 > entry.codesOnSheet).sort(byEvidence);
}

/** Whether a live sheet that looks like a phase still waits on a person saying which it is. */
export function phaseUndecided(sheet: SheetForSuggestion, suggestions: readonly PhaseSuggestion[]): boolean {
  if (sheet.ignored) return false;
  if (sheet.replacesRunId) return false;
  if (sheet.newPhaseChosen === true) return false;
  return suggestions.length > 0;
}

/** The evidence beside a suggestion, in words: "same sheet name · 12 of 14 codes are on it". */
export function phaseSuggestionEvidence(suggestion: PhaseSuggestion): string {
  const parts: string[] = [];
  if (suggestion.sameName) parts.push("same sheet name");
  if (suggestion.codesOnSheet > 0) {
    parts.push(
      `${suggestion.codesOnPhase} of ${suggestion.codesOnSheet} ${suggestion.codesOnSheet === 1 ? "code is" : "codes are"} on it`,
    );
  }
  return parts.join(" · ");
}

/**
 * The project's active phases with their bill lines' codes — what a sheet is
 * compared with. Bill lines only (`parent_id is null`): a configuration
 * carries no bill code.
 */
export async function loadPhasesForSuggestion(exec: SqlLike, projectId: string): Promise<PhaseForSuggestion[]> {
  const rows = await exec`
    select r.id, r.name, r.source_sheet,
           coalesce((select array_agg(distinct x.ref_value_norm)
                       from spec_records s
                       join spec_record_refs x on x.record_id = s.id and x.ref_system = 'boq_code'
                      where s.run_id = r.id and s.status = 'active' and s.parent_id is null), '{}') as codes
    from spec_runs r
    where r.project_id = ${projectId} and r.status = 'active'
    order by r.sort_order, r.created_at
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sourceSheet: row.source_sheet === null || row.source_sheet === undefined ? null : String(row.source_sheet),
    codes: ((row.codes as unknown[] | null) ?? []).map((code) => normaliseRef(String(code))),
  }));
}
