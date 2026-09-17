// The item card, rendered.
//
// ============================================================================
// WHY THIS TIER EXISTS
//
// Everything this card decides -- which rows fold, which are yellow, whether
// Confirm is enabled, what the dimension line says -- was reachable only by a
// person opening the app and looking. The pure tier covers the functions the
// card CALLS and the route tier covers what the confirm route WRITES, and
// between them sat nine hundred lines of rendering that nothing could see. The
// symptoms Max kept reporting all lived in that gap: the rows were right in
// the staged JSON and wrong on the screen.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, callout, figure, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingObservation } from "@/lib/drawing-document";

function renderCard(observations: DrawingObservation[], over: Parameters<typeof resolution>[0] = {}) {
  const spies = callbacks();
  const staged = item({ observations });
  render(
    <ItemCard
      item={staged}
      importId="import-1"
      resolution={resolution(over)}
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
    />,
  );
  return spies;
}

/** The rows of the observation table, by the label cell a reviewer reads. */
function rowLabels(): string[] {
  return screen
    .getAllByRole("row")
    .map((row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "")
    .filter(Boolean);
}

/** The table row whose value box holds this figure. */
function rowFor(value: string): HTMLElement {
  const found = screen
    .getAllByRole("row")
    .find((row) => within(row).queryByDisplayValue(value) !== null);
  if (!found) throw new Error(`No row holds the value ${value}`);
  return found;
}

describe("the item card's dimension rows", () => {
  const s201 = () => {
    resetIds();
    return [
      figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", slotSuggested: true, unit: "mm", unitSuggested: true, unitSource: "figures" }),
      figure("SIDE", "685", { attrGroup: "dimension", dimensionSlot: "D", slotSuggested: true, unit: "mm", unitSuggested: true, unitSource: "figures" }),
      figure("FRONT", "680", { attrGroup: "dimension", dimensionSlot: "H", slotSuggested: true, unit: "mm", unitSuggested: true, unitSource: "figures" }),
      figure("SIDE", "445", { attrGroup: "dimension", dimensionSlot: "SH", slotSuggested: true, unit: "mm", unitSuggested: true, unitSource: "figures" }),
      figure("FRONT", "42"),
      figure("FRONT", "27"),
      figure("SIDE", "50"),
      callout("ARMCHAIR", "Woven raffia", "UPH-07"),
    ];
  };

  it("shows the four placed slots and folds the rest away", async () => {
    renderCard(s201());
    // The fold names how many it is hiding, so the card never implies the page
    // says less than it does.
    expect(screen.getByText(/Other dimensions \(3\)/)).toBeInTheDocument();
    // Two FRONT rows on screen: the placed width and the placed height. The
    // front elevation's 42 and 27 are folded away with the side's 50.
    expect(rowLabels().filter((label) => label === "FRONT")).toHaveLength(2);
    expect(screen.queryByDisplayValue("42")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(rowLabels().filter((label) => label === "FRONT")).toHaveLength(4);
    expect(screen.getByDisplayValue("42")).toBeInTheDocument();
  });

  it("composes the BWS cell from the placed slots", () => {
    renderCard(s201());
    expect(screen.getByText("W640 x D685 x H680 x SH445mm")).toBeInTheDocument();
  });

  it("folds nothing when nothing was placed — there is no 'rest' to bury", () => {
    // The fold puts the four that matter first and the rest out of the way.
    // With no four that matter, folding every figure leaves a card showing a
    // toggle and nothing else, which reads as a page that measures nothing.
    resetIds();
    renderCard([figure("FRONT", "640"), figure("SIDE", "685")]);
    expect(screen.queryByText(/Other dimensions/)).toBeNull();
    expect(screen.getByDisplayValue("640")).toBeInTheDocument();
    expect(screen.getByDisplayValue("685")).toBeInTheDocument();
  });

  it("says so in words when nothing is placed, rather than showing no line", () => {
    // It used to render the line only once something had been placed, so two
    // cards of one code differed on screen by whether the guess had found
    // anything -- and a card with no line reads as one with nothing to say
    // about its size.
    resetIds();
    renderCard([figure("FRONT", "640"), figure("SIDE", "685")]);
    expect(screen.getByText(/BWS Dimensions/i)).toBeInTheDocument();
    expect(screen.getByText(/No width, depth or height placed yet/i)).toBeInTheDocument();
  });

  it("marks a guessed row yellow, and keeps the yellow when it is also blocked", () => {
    // Yellow is "this is a guess, confirm it"; amber is "this cannot commit".
    // Amber used to replace the yellow, so a guessed row lost the only marker
    // saying it was guessed at the moment it most needed checking.
    resetIds();
    const rows = [
      figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", slotSuggested: true, unit: "mm" }),
      figure("SIDE", "685", { attrGroup: "dimension", dimensionSlot: "D", slotSuggested: true, unit: null }),
    ];
    renderCard(rows, {
      blockers: [{ code: "unit_missing", message: "Choose millimetres or centimetres.", observationId: rows[1]!.id }],
    });
    const tableRows = screen.getAllByRole("row");
    const guessed = tableRows.filter((row) => row.className.includes("bg-yellow-100/70"));
    expect(guessed).toHaveLength(2);
    expect(guessed[1]!.className).toContain("border-l-amber-400");
  });
});

describe("the unit control", () => {
  it("offers a unit on a measured note, so a unitless page can be answered", () => {
    // The select used to render only for a dimension, or a note that ALREADY
    // had a unit -- so the one page that needed it, the one whose unit could
    // not be inferred, was the one page that could not be given one.
    resetIds();
    renderCard([figure("FRONT", "640")]);
    const units = within(rowFor("640")).getAllByRole("combobox");
    expect(units.some((box) => within(box).queryByRole("option", { name: "mm" }) !== null)).toBe(true);
  });

  it("does not offer one on a note that is not a measurement", () => {
    // Fifteen REMARKS rows with an empty select each read as fifteen
    // unanswered questions where there are none.
    resetIds();
    renderCard([observationNote()]);
    const row = rowFor("SUBMIT SHOP DRAWINGS FOR REVIEW");
    expect(within(row).queryByRole("option", { name: "mm" })).toBeNull();
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("offers the bulk mm/cm control whenever the page holds a measurement", () => {
    // Gated on `attrGroup === "dimension"`, it was hidden from exactly the
    // pages whose figures were all still notes.
    resetIds();
    renderCard([figure("FRONT", "640")]);
    expect(screen.getByText(/All dimensions:/)).toBeInTheDocument();
  });
});

function observationNote() {
  return figure("REMARKS", "SUBMIT SHOP DRAWINGS FOR REVIEW", { attrGroup: "note" });
}

describe("confirming", () => {
  it("is refused while a blocker stands, and says how many specs it would write", () => {
    resetIds();
    const rows = [figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", slotSuggested: true, unit: null })];
    renderCard(rows, {
      blockers: [{ code: "unit_missing", message: "Choose millimetres or centimetres.", observationId: rows[0]!.id }],
    });
    expect(screen.getByRole("button", { name: /Confirm 1 spec/ })).toBeDisabled();
    expect(screen.getByText(/Choose millimetres or centimetres/)).toBeInTheDocument();
  });

  it("is offered when nothing blocks it", () => {
    resetIds();
    renderCard([figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm" })]);
    expect(screen.getByRole("button", { name: /Confirm 1 spec/ })).toBeEnabled();
  });
});

describe("a page with no code on it", () => {
  it("opens collapsed, with one button that ignores the whole page", () => {
    resetIds();
    const spies = callbacks();
    render(
      <ItemCard
        item={item({ itemCodeRaw: null, itemNameRaw: null, observations: [figure("FRONT", "640"), figure("SIDE", "685")] })}
        importId="import-1"
        resolution={resolution({ targets: [], blockers: [{ code: "no_targets", message: "This page carries no item code." }] })}
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
      />,
    );
    expect(screen.getByText(/No item code on this page/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: /Ignore this page/ })).toBeInTheDocument();
  });
});

describe("a callout the app had to guess at", () => {
  it("says what it read, and marks the line as a guess", () => {
    // The last-resort reading: a caption naming the item itself, with a cloth
    // in the value and no word on any list. Right often enough to fill in,
    // never certain enough to slip past unread — so it is yellow, like a
    // guessed dimension slot, and it prints its reason.
    renderCard([
      callout("SOFA", "Tessarae YC04158 - 01", null, {
        attrGroup: "material",
        specFieldId: "field-com1",
        groupSuggested: true,
        groupReason: "the caption pairs the item itself with a material",
      }),
    ]);
    expect(screen.getByText(/the caption pairs the item itself with a material/)).toBeTruthy();
    const row = screen.getByText("SOFA").closest("tr");
    expect(row?.className).toContain("bg-yellow");
  });

  it("leaves a callout the words settled looking settled", () => {
    renderCard([callout("SOFA FEET", "Dark tinted wood", "WD-01", { specFieldId: "field-timber" })]);
    const row = screen.getByText("SOFA FEET").closest("tr");
    expect(row?.className).not.toContain("bg-yellow");
  });
});
