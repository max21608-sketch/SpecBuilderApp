// "Use this drawing's values over the bill's" on the item card (brief G).
//
// The card names every value of the bill's it would replace BEFORE the press,
// sends exactly those acknowledgements in one batched save, and is absent
// where no occupant came from the bill — a value a person typed keeps the
// per-row tick and nothing else.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import type { BillReplacement } from "@/lib/bill-over-drawing";
import type { DrawingObservation } from "@/lib/drawing-document";
import { callbacks, callout, figure, item, records, resetIds, resolution, specFields } from "./fixtures";

const BUTTON = /Use this drawing.s values over the bill.s/;

function stool() {
  resetIds();
  return [
    figure("OVERALL", `1'-6"`, { attrGroup: "dimension", dimensionSlot: "DIA", unit: "in" }),
    figure("OVERALL", `1'-4 3/4"`, { attrGroup: "dimension", dimensionSlot: "H", unit: "in" }),
    callout("SEAT", "Example oak", "GR TIM 10", { specFieldId: "field-timber" }),
  ];
}

const occupant = (attributeId: string, value: string, unit: string | null, materialCode: string | null = null) => ({
  attributeId,
  attributeVersion: 4,
  label: "Size",
  value,
  unit,
  materialCode,
});

function entries(rows: DrawingObservation[]): BillReplacement[] {
  const [dia, height, timber] = rows;
  return [
    { observationId: dia!.id, recordId: "rec-main", kind: "retire_square", slot: "D", fieldId: null, occupant: occupant("att-d", "460", "mm"), acknowledged: false },
    { observationId: height!.id, recordId: "rec-main", kind: "replace", slot: "H", fieldId: null, occupant: occupant("att-h", "450", "mm"), acknowledged: false },
    {
      observationId: timber!.id,
      recordId: "rec-main",
      kind: "replace",
      slot: null,
      fieldId: "field-timber",
      occupant: occupant("att-t", "Example walnut", null, "TIM-01"),
      acknowledged: false,
    },
  ];
}

function renderCard(
  rows: DrawingObservation[],
  billReplacements: BillReplacement[] | undefined,
  over: Parameters<typeof resolution>[0] = {},
) {
  const spies = callbacks();
  render(
    <ItemCard
      item={item({ observations: rows })}
      importId="import-1"
      resolution={resolution({ billReplacements, targets: ["rec-main"], ...over })}
      specFields={specFields}
      records={records}
      drafts={{}}
      setDrafts={() => undefined}
      busy={false}
      onSaveObservation={spies.onSaveObservation}
      onSaveObservations={spies.onSaveObservations}
      onSaveTargets={spies.onSaveTargets}
      onSetBulkUnit={spies.onSetBulkUnit}
      onReview={spies.onReview}
      onImage={spies.onImage}
      onSwatch={spies.onSwatch}
      onSetLevel={spies.onSetLevel}
    />,
  );
  return spies;
}

describe("the bill's values, one press per card", () => {
  it("lists what it replaces before the press, one line per row", () => {
    const rows = stool();
    renderCard(rows, entries(rows));
    expect(screen.getByRole("button", { name: BUTTON }).textContent).toMatch(/\(3\)$/);
    expect(screen.getByText(`D 460mm → Dia 1'-6"`)).toBeTruthy();
    expect(screen.getByText(`H 450mm → 1'-4 3/4"`)).toBeTruthy();
    expect(screen.getByText("Main timber finish TIM-01 → GR TIM 10")).toBeTruthy();
  });

  it("sends exactly those acknowledgements, at the version shown, in ONE batched save", async () => {
    const rows = stool();
    const spies = renderCard(rows, entries(rows));
    await userEvent.click(screen.getByRole("button", { name: BUTTON }));
    expect(spies.of("onSaveObservation")).toHaveLength(0);
    const batches = spies.of("onSaveObservations");
    expect(batches).toHaveLength(1);
    const edits = batches[0]!.args[0] as { observation: DrawingObservation; changes: { replaces: unknown } }[];
    expect(edits.map((edit) => [edit.observation.id, edit.changes.replaces])).toEqual([
      [rows[0]!.id, [{ recordId: "rec-main", attributeId: "att-d", attributeVersion: 4, retiresSlot: "D" }]],
      [rows[1]!.id, [{ recordId: "rec-main", attributeId: "att-h", attributeVersion: 4 }]],
      [rows[2]!.id, [{ recordId: "rec-main", attributeId: "att-t", attributeVersion: 4 }]],
    ]);
  });

  it("once pressed, says what confirming replaces and offers the bill's values back", async () => {
    const rows = stool();
    const spies = renderCard(rows, entries(rows).map((entry) => ({ ...entry, acknowledged: true })));
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    expect(screen.getByText(`H 450mm → 1'-4 3/4"`)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Keep the bill.s values/ }));
    const edits = spies.of("onSaveObservations")[0]!.args[0] as { changes: { replaces: unknown[] } }[];
    expect(edits.map((edit) => edit.changes.replaces)).toEqual([[], [], []]);
  });

  it("is absent where no occupant came from the bill — a typed value keeps its own tick", () => {
    const rows = stool();
    const typed = { ...occupant("att-h", "450", "mm"), sourceFilename: null, sourcePage: null };
    renderCard(rows, undefined, { occupants: { [rows[1]!.id]: [{ recordId: "rec-main", occupant: typed }] } });
    expect(screen.queryByRole("button", { name: BUTTON })).toBeNull();
    expect(screen.getByText(/Tick to replace it/)).toBeTruthy();
    expect(screen.queryByText(/The bill already gave this item/)).toBeNull();
  });
});
