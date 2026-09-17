// One row per SPEC, with its runs beside it — not one row per proposal.
import { describe, expect, it } from "vitest";
import { groupIntoSpecRows, commitGroups } from "@/lib/spec-review-rows";
import type { Proposal, TargetSnapshot } from "@/lib/spec-document";
import type { AnswerState } from "@/lib/spec-vocab";

function member(
  overrides: Partial<Proposal> & { recordId?: string | null; runName?: string | null },
): Proposal {
  const recordId = overrides.recordId === undefined ? "rec-1" : overrides.recordId;
  const target: TargetSnapshot | null = recordId
    ? {
        recordId,
        recordLabel: `label-${recordId}`,
        recordVersion: 1,
        requirementId: "req-1",
        requirementPrompt: "Seat height",
        requirementKind: "spec_field",
        answerExists: true,
        answerId: `ans-${recordId}`,
        answerVersion: 1,
        answerState: "missing" as AnswerState,
        answerValue: null,
      }
    : null;
  return {
    id: "p1",
    sourceOrdinal: 0,
    runId: "run-1",
    runName: "MAIN RUN",
    configurationLabel: null,
    version: 1,
    raw: { refRaw: "S-201", attributeRaw: "Seat height", valueRaw: "445mm" } as Proposal["raw"],
    recordCandidates: [],
    requirementCandidates: [],
    recordId,
    requirementId: recordId ? "req-1" : null,
    target,
    proposedValue: "445mm",
    proposedState: "confirmed",
    stateReason: null,
    overwriteAcknowledged: false,
    reviewStatus: "pending",
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
    ...overrides,
  } as Proposal;
}

describe("groupIntoSpecRows", () => {
  it("shows one row for a spec that fans out to three runs", () => {
    // The whole point. Seven specs across three runs is seven rows, not
    // twenty-one.
    const proposals = [
      member({ id: "a", recordId: "rec-mur", runId: "r1", runName: "MUR" }),
      member({ id: "b", recordId: "rec-main", runId: "r2", runName: "MAIN RUN" }),
      member({ id: "c", recordId: "rec-ve", runId: "r3", runName: "VE" }),
    ];
    const rows = groupIntoSpecRows(proposals, proposals);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.attributeRaw).toBe("Seat height");
    expect(rows[0]?.runs).toHaveLength(3);
    expect(rows[0]?.placedCount).toBe(3);
    // Sorted by run name, so the column reads the same way on every row.
    expect(rows[0]?.runs.map((run) => run.runName)).toEqual(["MAIN RUN", "MUR", "VE"]);
    expect(rows[0]?.varies).toBe(false);
  });

  it("keeps two different specs as two rows", () => {
    const proposals = [
      member({ id: "a", sourceOrdinal: 0 }),
      member({ id: "b", sourceOrdinal: 1, raw: { attributeRaw: "Arm height", valueRaw: "520mm" } as Proposal["raw"] }),
    ];
    expect(groupIntoSpecRows(proposals, proposals)).toHaveLength(2);
  });

  it("leads with the most consequential of its members, never the calmest", () => {
    // The VE run already holds a different seat height. A row summarised by
    // the two clean runs would hide the overwrite sitting inside it.
    const settled = member({ id: "c", recordId: "rec-ve", runId: "r3", runName: "VE" });
    settled.target = { ...(settled.target as TargetSnapshot), answerState: "confirmed", answerValue: "440mm" };
    const proposals = [
      member({ id: "a", recordId: "rec-mur", runId: "r1", runName: "MUR" }),
      member({ id: "b", recordId: "rec-main", runId: "r2", runName: "MAIN RUN" }),
      settled,
    ];
    const rows = groupIntoSpecRows(proposals, proposals);

    expect(rows[0]?.summary.kind).toBe("changes");
    expect(rows[0]?.summary.was).toBe("440mm");
    // ...and it says the runs disagree, rather than presenting one verdict.
    expect(rows[0]?.varies).toBe(true);
  });

  it("counts a member that never placed, instead of dropping it", () => {
    const proposals = [
      member({ id: "a", recordId: "rec-main", runId: "r2", runName: "MAIN RUN" }),
      member({ id: "b", recordId: null, runId: "r3", runName: "VE" }),
    ];
    const rows = groupIntoSpecRows(proposals, proposals);
    expect(rows[0]?.placedCount).toBe(1);
    expect(rows[0]?.unplacedCount).toBe(1);
    expect(rows[0]?.summary.kind).toBe("unplaced");
  });

  it("carries the configuration a label names, without resolving it", () => {
    const rows = groupIntoSpecRows(
      [member({ configurationLabel: "A", raw: { attributeRaw: "Fabric (A configuration)" } as Proposal["raw"] })],
      [],
    );
    expect(rows[0]?.configurationLabel).toBe("A");
  });

  it("carries a duplicate-target blocker, which cannot be seen from one proposal", () => {
    // Two observations aimed at one question on one record. The blocker is a
    // fact about the pair, which is why the whole staged set is passed in.
    const a = member({ id: "a", sourceOrdinal: 0 });
    const b = member({ id: "b", sourceOrdinal: 1 });
    const rows = groupIntoSpecRows([a, b], [a, b]);
    expect(rows[0]?.blockers.some((blocker) => blocker.code === "duplicate_target")).toBe(true);
  });
});

describe("commitGroups", () => {
  it("groups by RECORD, because the record is still the unit of commit", () => {
    const proposals = [
      member({ id: "a", sourceOrdinal: 0, recordId: "rec-main" }),
      member({ id: "b", sourceOrdinal: 1, recordId: "rec-main" }),
      member({ id: "c", sourceOrdinal: 0, recordId: "rec-ve" }),
    ];
    const groups = commitGroups(proposals);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.recordId === "rec-main")?.proposals).toHaveLength(2);
  });

  it("leaves out anything unplaced or already reviewed", () => {
    const proposals = [
      member({ id: "a", recordId: null }),
      member({ id: "b", reviewStatus: "ignored" }),
      member({ id: "c", reviewStatus: "applied" }),
    ];
    expect(commitGroups(proposals)).toHaveLength(0);
  });
});
