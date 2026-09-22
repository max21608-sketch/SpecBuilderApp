// Which finish rows are offered a swatch crop (4a.2).
//
// ============================================================================
// WHAT THIS PROVES
//
// The S-203 sheet prints its woven chip directly under *Fabric reference: a
// supplier, a product name* — and no code. `project_finishes` is keyed on the
// client's code, so the row had no finish to hang a picture on and the whole
// `SwatchPicker` was gated on `observation.materialCodeRaw`. The one page in
// the pilot pack that most obviously prints a swatch was the one page with no
// control to take it. Max, 2026-09-22: *"in the intake, I still don't think
// we're taking in a crop of the fabric or metal spec as an image."*
//
// 4a.1 gives an uncoded finish somewhere to live, so the gate becomes "this row
// resolves to a finish". That is one sentence and four states, and only
// rendering the card can say which state shows which control:
//
//   * a client code           → offered, as before
//   * filed under one of ours → offered, though the code does not exist yet
//   * an exact wording link   → offered, naming the row it joined
//   * nothing filed / apart   → NOT offered, and the row says why
//
// The last is the one worth a test of its own. `readUncodedFinish` files
// nothing there, so the confirm's `finishIdByObservation` lands `null` and a
// crop would be REFUSED by name. That refusal is right and it is not a
// substitute for the screen knowing — a control offered there is a promise the
// card had no business making.
//
// The component tier runs without a database and is scoped by PATH in
// vitest.config.ts, so there is no `@vitest-environment` docblock here.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, callout, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingObservation } from "@/lib/drawing-document";
import type { FinishFilingView } from "@/lib/drawing-resolution";

const AISSA = "Aissa Dione, ref. Losange raphia beige et écru";

const NOTHING_FILED: FinishFilingView = {
  outcome: "none",
  finishId: null,
  code: null,
  why: null,
  suggestion: null,
};

function renderCard(observations: DrawingObservation[], finishFilings: Record<string, FinishFilingView>) {
  const spies = callbacks();
  render(
    <ItemCard
      item={item({ observations })}
      importId="import-1"
      resolution={resolution({ finishFilings })}
      specFields={specFields}
      records={records}
      drafts={{}}
      setDrafts={() => undefined}
      busy={false}
      onSaveObservation={spies.onSaveObservation}
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

/** The table row a value is printed on, so two finish rows can be told apart. */
function rowFor(value: string): HTMLElement {
  const box = screen.getByDisplayValue(value);
  const row = box.closest("tr");
  if (!row) throw new Error(`No row carries ${value}`);
  return row as HTMLElement;
}

const cropButton = (value: string) => within(rowFor(value)).queryByRole("button", { name: /Crop the swatch/ });

describe("the swatch control, on a finish row", () => {
  it("is offered on a finish filed under a code of ours, though the code does not exist yet", () => {
    // The mint happens at confirm, under the project row lock. A picture has
    // somewhere to go — `finishIdByObservation` is set in the same transaction,
    // before the swatch loop reads it — and no number can honestly be printed
    // beside it, so the panel names the finish without naming a code.
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "material" })];
    renderCard(rows, {
      [rows[0]!.id]: { ...NOTHING_FILED, outcome: "mint", why: "The client gave no code" },
    });
    expect(cropButton(AISSA)).toBeTruthy();
  });

  it("is offered on a finish that joined an existing row of ours", () => {
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "material" })];
    renderCard(rows, {
      [rows[0]!.id]: {
        outcome: "link",
        finishId: "fin-1",
        code: "BW-F-001",
        why: "Same wording as BW-F-001",
        suggestion: null,
      },
    });
    expect(cropButton(AISSA)).toBeTruthy();
  });

  it("is still offered where the client issued a code — that is the key and stays it", () => {
    resetIds();
    const rows = [callout("UPHOLSTERY", "Yarn Tessarae YC04158", "UPH-07")];
    renderCard(rows, {});
    expect(cropButton("Yarn Tessarae YC04158")).toBeTruthy();
  });

  it("is offered on a timber row as well as a fabric one", () => {
    // `classifyCallout` has already decided which a row is — a fabric files as
    // `material` and a timber or metal as `finish` — so nothing here decides a
    // kind, and neither group is the one that gets a swatch.
    resetIds();
    const fabric = callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "material" });
    const timber = callout("TIMBER", "Dark tinted oak, satin lacquer", null, { attrGroup: "finish" });
    const filed: FinishFilingView = { ...NOTHING_FILED, outcome: "mint", why: "The client gave no code" };
    renderCard([fabric, timber], { [fabric.id]: filed, [timber.id]: filed });
    expect(cropButton(AISSA)).toBeTruthy();
    expect(cropButton("Dark tinted oak, satin lacquer")).toBeTruthy();
  });

  it("is NOT offered on a finish nobody has filed, and the row says what to do", () => {
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "material" })];
    renderCard(rows, { [rows[0]!.id]: NOTHING_FILED });
    expect(cropButton(AISSA)).toBeNull();
    expect(
      within(rowFor(AISSA)).getByText(/file this finish above and the crop control appears/),
    ).toBeTruthy();
  });

  it("is NOT offered on a finish the reviewer kept apart from the library", () => {
    // `readUncodedFinish` answers `none` for `apart`, so there is nothing to
    // attach — the same state as unfiled, reached deliberately.
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "material" })];
    renderCard(rows, { [rows[0]!.id]: { ...NOTHING_FILED, why: "Kept apart from the library, by you" } });
    expect(cropButton(AISSA)).toBeNull();
  });

  it("is not offered on a row that is not a finish at all, and says nothing there", () => {
    resetIds();
    const note = callout("REMARKS", "Submit shop drawings for review", null, { attrGroup: "note" });
    renderCard([note], {});
    expect(cropButton("Submit shop drawings for review")).toBeNull();
    expect(within(rowFor("Submit shop drawings for review")).queryByText(/crop control appears/)).toBeNull();
  });

  it("says nothing on a finish row that states no value, because there is nothing to file", async () => {
    // `finishFilingsFor` skips a row with no value, so there is no filing
    // control above — and "file this finish above" would point at a control
    // that is not there. `PIPING / TBC` is the real shape.
    resetIds();
    const rows = [callout("PIPING", "TBC", null, { attrGroup: "material" })];
    renderCard(rows, {});
    expect(cropButton("TBC")).toBeNull();
    expect(within(rowFor("TBC")).queryByText(/crop control appears/)).toBeNull();
  });

  it("withdraws a held crop when the filing that gave it a home is undone", async () => {
    // The crops live in a ref on the review screen, keyed by observation. Left
    // behind, one would have no control, no preview and no way back — and would
    // then refuse the whole card at confirm with `swatch_has_no_finish`, over a
    // picture nobody could see. It goes at the same press, which is a person's
    // own act on the same row, and nothing was ever uploaded.
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "material" })];
    const spies = renderCard(rows, {
      [rows[0]!.id]: { ...NOTHING_FILED, outcome: "mint", why: "The client gave no code" },
    });
    await userEvent.click(within(rowFor(AISSA)).getByRole("button", { name: "Undo" }));
    expect(spies.of("onSwatch").map((call) => call.args)).toEqual([[rows[0]!.id, null, null]]);
  });
});
