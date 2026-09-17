// The review screen's unit: ONE SPEC, not one proposal.
//
// ============================================================================
// Asked for on 2026-09-17, on first sight of a real email against real data:
// "I don't think we need to be going through each spec change like this."
//
// Two things made the old screen a wall. The email states seven specs and the
// screen rendered seven cards, each with the model's own paragraph of
// reasoning, two dropdowns and a value box — before any of them had resolved.
// And once the run fan-out lands, the SAME seven specs resolve to twenty-one
// proposals, because `S-201` is on three runs. Rendering a proposal per row
// would have made the fix look like a regression.
//
// So the row is the OBSERVATION — what the document said about one attribute —
// and the runs it writes to are a column on it. `sourceOrdinal` is the key,
// which is exactly what it means: which observation this came from. The
// fan-out members share it by construction (see `resolveProposals`).
//
// This is the chase screen's rule in a second place: the unit on screen is the
// thing a person thinks about, and the rows underneath it are a detail.
//
// PURE. No React, no database, no clock — so the grouping is provable against
// a fixture and the component tier only has to test what a click does.
// ============================================================================
import { describeChange, type ChangeDescription } from "@/lib/spec-change";
import { proposalBlockers, type Blocker, type Proposal } from "@/lib/spec-document";

export type SpecRowRun = {
  proposalId: string;
  runId: string | null;
  runName: string | null;
  /** The record this member writes to, once it has one. */
  recordId: string | null;
  recordLabel: string | null;
  /** The slot, when this member is a dimension. */
  dimension: { slot: string; figure: string | null; unit: string | null } | null;
  change: ChangeDescription;
  blockers: Blocker[];
};

export type SpecRow = {
  key: string;
  sourceOrdinal: number;
  attributeRaw: string | null;
  valueRaw: string | null;
  quotedText: string | null;
  note: string | null;
  /** The configuration the wording names, if any. A reading, never a target. */
  configurationLabel: string | null;
  /** One entry per MEMBER — a dimension has one per (run × slot). */
  runs: SpecRowRun[];
  /**
   * The distinct runs this row writes to.
   *
   * NOT `runs.length`: an "Overall" line is three slots on each of three runs,
   * which is nine members and three runs. Counting members would have told a
   * reviewer the email applied to nine runs of a project that has three.
   */
  distinctRuns: { runId: string | null; runName: string | null }[];
  /** The dimension slots this row writes, in stated order. Empty if none. */
  slots: string[];
  /** The verb the row leads with: the most consequential of its members'. */
  summary: ChangeDescription;
  /**
   * Whether the members disagree about what is happening — the main run holds
   * a value and the VE run does not, say. NEVER averaged and never hidden: it
   * is the case where one row genuinely is several decisions.
   */
  varies: boolean;
  placedCount: number;
  unplacedCount: number;
  blockers: Blocker[];
};

// Most consequential first. A row summarised by its calmest member is a row
// that hides the overwrite sitting inside it.
const SEVERITY: ChangeDescription["kind"][] = [
  "unplaced",
  "changes",
  "withdraws",
  "not_applicable",
  "confirms",
  "provides",
  "repeats",
];

function rank(kind: ChangeDescription["kind"]): number {
  const index = SEVERITY.indexOf(kind);
  return index === -1 ? SEVERITY.length : index;
}

/**
 * One row per observation, in document order.
 *
 * `all` is the whole staged set, not just the rows being grouped: blockers are
 * computed against it, because a duplicate-target clash is a fact about two
 * proposals and cannot be seen from one.
 */
export function groupIntoSpecRows(proposals: Proposal[], all: Proposal[]): SpecRow[] {
  const byObservation = new Map<number, Proposal[]>();
  for (const proposal of proposals) {
    const existing = byObservation.get(proposal.sourceOrdinal);
    if (existing) existing.push(proposal);
    else byObservation.set(proposal.sourceOrdinal, [proposal]);
  }

  const rows: SpecRow[] = [];
  for (const [sourceOrdinal, members] of byObservation) {
    const first = members[0];
    if (!first) continue;

    const runs: SpecRowRun[] = members.map((member) => ({
      proposalId: member.id,
      runId: member.runId ?? null,
      runName: member.runName ?? null,
      recordId: member.recordId,
      recordLabel: member.target?.recordLabel ?? member.recordLabel ?? null,
      dimension: member.dimension
        ? { slot: member.dimension.slot, figure: member.dimension.figure, unit: member.dimension.unit }
        : null,
      change: describeChange(member),
      blockers: proposalBlockers(member, all),
    }));
    // Run name, so the column reads in the same order on every row. A member
    // with no run sorts last: it is the one still asking a question.
    runs.sort((a, b) => (a.runName ?? "￿").localeCompare(b.runName ?? "￿"));

    const seenRuns = new Map<string, { runId: string | null; runName: string | null }>();
    for (const member of members) {
      const key = member.runId ?? "__none";
      if (!seenRuns.has(key)) seenRuns.set(key, { runId: member.runId ?? null, runName: member.runName ?? null });
    }
    // The BWS destinations this row writes: dimension slots, or the field a
    // finish takes. Both say the same useful thing — where the value lands.
    const slots: string[] = [];
    for (const member of members) {
      const label = member.dimension?.slot ?? member.finish?.specFieldName ?? null;
      if (label && !slots.includes(label)) slots.push(label);
    }

    const kinds = new Set(runs.map((run) => run.change.kind));
    const summary =
      [...runs].sort((a, b) => rank(a.change.kind) - rank(b.change.kind))[0]?.change ??
      describeChange(first);

    rows.push({
      key: String(sourceOrdinal),
      sourceOrdinal,
      attributeRaw: first.raw.attributeRaw,
      valueRaw: first.raw.valueRaw,
      quotedText: first.raw.quotedText ?? null,
      note: first.raw.note,
      configurationLabel: first.configurationLabel ?? null,
      runs,
      distinctRuns: [...seenRuns.values()],
      slots,
      summary,
      varies: kinds.size > 1,
      // Counted over distinct RUNS, for the reason above.
      placedCount: [...seenRuns.values()].filter((run) =>
        members.some((member) => (member.runId ?? null) === run.runId && member.recordId),
      ).length,
      unplacedCount: [...seenRuns.values()].filter((run) =>
        members.some((member) => (member.runId ?? null) === run.runId && !member.recordId),
      ).length,
      blockers: runs.flatMap((run) => run.blockers),
    });
  }

  return rows.sort((a, b) => a.sourceOrdinal - b.sourceOrdinal);
}

/**
 * The records a "confirm everything" would write to, each with the proposals
 * that belong to it.
 *
 * THE RECORD IS STILL THE UNIT OF COMMIT. The confirm route takes one record
 * and ALL of its pending proposals, and refuses if the live set differs — so
 * the table's single button issues one request per record rather than one big
 * one, exactly as the configuration card issues one per letter. Grouping here
 * is what makes those requests whole cards instead of a selection.
 */
export function commitGroups(proposals: Proposal[]): { recordId: string; recordLabel: string; proposals: Proposal[] }[] {
  const groups = new Map<string, { recordId: string; recordLabel: string; proposals: Proposal[] }>();
  for (const proposal of proposals) {
    if (proposal.reviewStatus !== "pending" || !proposal.recordId) continue;
    // A dimension proposal carries no target — it writes an attribute, not an
    // answer — so its label comes off the proposal itself.
    const label = proposal.target?.recordLabel ?? proposal.recordLabel ?? null;
    if (!label) continue;
    const existing = groups.get(proposal.recordId);
    if (existing) existing.proposals.push(proposal);
    else groups.set(proposal.recordId, { recordId: proposal.recordId, recordLabel: label, proposals: [proposal] });
  }
  return [...groups.values()].sort((a, b) => a.recordLabel.localeCompare(b.recordLabel));
}
