// The gates tab: three boards, five outcomes, and a chain.
//
// The one that matters most is the last: the pill used to fold "nowhere to
// record it" into "outstanding", so a reviewer looking for two questions to
// answer found one (docs/plans/found-in-use.md, 2026-09-18).
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePanel, { type MatrixFieldRow } from "@/components/records/GatePanel";
import { chainGates, type GateField, type GateFieldStatus, type GateFieldsStatus, type Gate } from "@/lib/gates";

const field = (over: Partial<GateField> & { matrixRow: number; gate: Gate }): GateField => ({
  capture: "question",
  fieldName: "A field",
  specFieldJsonId: null,
  localKey: null,
  dimensionSlot: null,
  valueType: "free_text",
  paletteKey: null,
  paletteRaw: null,
  conditionalOnKey: null,
  conditionalOnValue: null,
  notes: null,
  ...over,
});

const row = (f: GateField, outcome: GateFieldStatus["outcome"]): GateFieldStatus => ({
  field: f,
  outcome,
  reason: "because",
  value: null,
  state: null,
});

function statuses(fieldsByGate: Record<Gate, GateFieldStatus[]>) {
  const own = {} as Record<Gate, GateFieldsStatus>;
  for (const gate of ["TGQ", "TG0", "TG1"] as Gate[]) {
    const fields = fieldsByGate[gate];
    const counts = { satisfied: 0, blocking: 0, not_applicable: 0, unknown: 0, unanswerable: 0 };
    for (const entry of fields) counts[entry.outcome] += 1;
    own[gate] = {
      gate,
      ownSatisfied:
        fields.length > 0 && counts.blocking === 0 && counts.unknown === 0 && counts.unanswerable === 0,
      fields,
      counts,
    };
  }
  return chainGates(own);
}

const SPEC_NOTES = field({ matrixRow: 1, gate: "TGQ", fieldName: "Spec notes", specFieldJsonId: 24 });
const PRODUCT_CODE = field({ matrixRow: 2, gate: "TGQ", fieldName: "Product code" });
const SWIVEL = field({ matrixRow: 3, gate: "TGQ", fieldName: "Swivel mechanism", specFieldJsonId: 50 });
const DIMS_TG1 = field({ matrixRow: 4, gate: "TG1", fieldName: "Dimensions", specFieldJsonId: 3 });
const DIMS_TGQ = field({ matrixRow: 5, gate: "TGQ", fieldName: "Dimensions", specFieldJsonId: 3 });

const GATES_FIXTURE = statuses({
  TGQ: [
    row(SPEC_NOTES, "blocking"),
    row(PRODUCT_CODE, "unanswerable"),
    row(SWIVEL, "not_applicable"),
    row(DIMS_TGQ, "satisfied"),
  ],
  TG0: [row(field({ matrixRow: 6, gate: "TG0", fieldName: "Main timber finish", specFieldJsonId: 4 }), "satisfied")],
  TG1: [row(DIMS_TG1, "satisfied")],
});

const MATRIX: MatrixFieldRow[] = [SPEC_NOTES, PRODUCT_CODE, SWIVEL, DIMS_TGQ, DIMS_TG1].map((f) => ({
  matrixRow: f.matrixRow,
  gate: f.gate,
  capture: f.capture,
  fieldName: f.fieldName,
  jsonId: f.specFieldJsonId,
  localKey: f.localKey,
  dimensionSlot: f.dimensionSlot,
  valueType: f.valueType,
  paletteKey: f.paletteKey,
  paletteRaw: f.paletteRaw,
  conditionalOnKey: f.conditionalOnKey,
  conditionalOnValue: f.conditionalOnValue,
  notes: f.notes,
}));

const ANSWERS = [
  { requirement_id: "r-notes", prompt: "Spec notes", json_id: 24, local_key: null, state: "missing" as const },
  { requirement_id: "r-dims", prompt: "Dimensions?", json_id: 3, local_key: null, state: "confirmed" as const },
];

const renderPanel = (over: Partial<Parameters<typeof GatePanel>[0]> = {}) =>
  render(
    <GatePanel
      gates={GATES_FIXTURE}
      matrixFields={MATRIX}
      answers={ANSWERS}
      palettes={[]}
      categoryName="Armchairs / benches / stools / sofas"
      chaseHref="/dashboard/drafts?projectId=p1"
      {...over}
    />,
  );

describe("the gate panel", () => {
  it("never folds 'nowhere to record it' into the number a person can act on", () => {
    // TGQ holds one blocking row and one unanswerable one. `2 outstanding`
    // sends a reviewer looking for two questions and they find one.
    renderPanel();
    expect(screen.getByText("1 to answer")).toBeInTheDocument();
    expect(screen.getByText("1 nowhere to record")).toBeInTheDocument();
    expect(screen.queryByText("2 outstanding")).not.toBeInTheDocument();
  });

  it("chases only what somebody can answer", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "Chase the 1" })).toHaveAttribute(
      "href",
      "/dashboard/drafts?projectId=p1",
    );
  });

  it("paints a gate whose predecessor is unmet slate, never green, and names the one to do first", () => {
    // TG0 and TG1 have nothing of their own outstanding. Neither is met,
    // because TGQ is not: a record cannot be at production lock over a price
    // nobody could quote.
    renderPanel();
    expect(screen.getAllByText("TGQ first")).toHaveLength(2);
    expect(screen.queryByText("Settled")).not.toBeInTheDocument();
  });

  it("keeps the five outcomes apart and says whose problem each is", () => {
    renderPanel();
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
    expect(screen.getByText("Nowhere to record it")).toBeInTheDocument();
    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.getByText(/A seed, not a question for you/)).toBeInTheDocument();
  });

  it("hides the settled rows until asked, and then shows all of them", async () => {
    renderPanel();
    const tgq = screen.getByText("TGQ").closest("section")!;
    expect(within(tgq).queryByText("Settled")).not.toBeInTheDocument();
    await userEvent.click(within(tgq).getByRole("button", { name: "Show all 4" }));
    expect(within(tgq).getByText("Settled")).toBeInTheDocument();
  });

  it("links a field to the checklist question it is answered through", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "Spec notes" })).toHaveAttribute("href", "?tab=checklist#q-r-notes");
  });

  it("works out the two-gate fields from the matrix rather than naming them in a sentence", () => {
    renderPanel();
    expect(screen.getByText(/is at TGQ and TG1/)).toBeInTheDocument();
  });

  it("says in words that an unmapped category has no gates, and shows no boards", () => {
    // An empty gate computes as "nothing outstanding" and would report a
    // cabinetry item ready against rules nobody has written.
    renderPanel({ gates: null });
    expect(screen.getByText("No gate view")).toBeInTheDocument();
    expect(screen.queryByText("TG1")).not.toBeInTheDocument();
  });

  it("keeps the matrix collapsed, and carries the standing-in-for-Matthew warning", async () => {
    renderPanel();
    expect(screen.getByText(/These answers are Max standing in for Matthew/)).toBeInTheDocument();
    expect(screen.queryByText("How it arrives")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Why these questions/ }));
    expect(screen.getByText("How it arrives")).toBeInTheDocument();
    // An id-less row of his matrix has no home in this app, and says so.
    expect(screen.getByText("No home")).toBeInTheDocument();
  });

  // FIU 9: `1 · COM 1` and a bare `3 ·` cost Matthew ninety seconds and a
  // wrong guess. The ordinal is the export's key, not a label.
  it("prints no bare BWS ordinal in the matrix table, and keeps it on the field's title", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Why these questions/ }));
    expect(screen.queryByText("BWS id")).not.toBeInTheDocument();
    // Dimensions is row 3 of the matrix and there is no cell reading "3".
    for (const id of ["3", "24", "50"]) expect(screen.queryByText(id)).not.toBeInTheDocument();
    // Still reachable: the name carries it for an editor chasing an export cell.
    expect(screen.getAllByTitle("BWS field 3").length).toBeGreaterThan(0);
    // An id-less row carries no title at all — never "BWS field —".
    expect(screen.queryByTitle(/BWS field (—|null|undefined)/)).not.toBeInTheDocument();
  });
});
