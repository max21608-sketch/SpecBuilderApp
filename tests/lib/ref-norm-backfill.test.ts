// The re-fold of spec_record_refs.ref_value_norm (audit 5.4 A3): plan only,
// never a merge.
import { describe, expect, it } from "vitest";
import { planRefNormBackfill } from "@/lib/ref-norm-backfill";

const row = (id: string, recordId: string, value: string, norm: string, system = "boq_code") => ({
  id,
  recordId,
  refSystem: system,
  refValue: value,
  refValueNorm: norm,
});

describe("planRefNormBackfill", () => {
  it("re-folds a row written by the old fold, and leaves one already right alone", () => {
    const plan = planRefNormBackfill([row("1", "r1", "S.201", "S.201"), row("2", "r2", "FU06C - CG27.2", "FU06C-CG27.2"), row("3", "r3", "S201", "S201")]);
    expect(plan.updates).toEqual([
      { id: "1", from: "S.201", to: "S201" },
      { id: "2", from: "FU06C-CG27.2", to: "FU06CCG272" },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.collisions).toEqual([]);
  });

  it("reports two refs on one record that now fold together, and writes neither", () => {
    const plan = planRefNormBackfill([row("1", "r1", "CH-01.1", "CH-01.1"), row("2", "r1", "CH-01-1", "CH-01-1"), row("3", "r2", "CH-01-1", "CH-01-1")]);
    expect(plan.updates).toEqual([{ id: "3", from: "CH-01-1", to: "CH011" }]);
    expect(plan.collisions).toEqual([{ recordId: "r1", refSystem: "boq_code", norm: "CH011", values: ["CH-01.1", "CH-01-1"] }]);
  });

  it("is per ref SYSTEM: a boq code and a design code may fold alike", () => {
    const plan = planRefNormBackfill([row("1", "r1", "S.201", "S.201"), row("2", "r1", "S-201", "S-201", "design_code")]);
    expect(plan.collisions).toEqual([]);
    expect(plan.updates).toHaveLength(2);
  });
});
