// The drawings review, brief F: point at a figure, say what a unit control does.
//
// ============================================================================
// WHAT THIS PROVES
//
// The 2026-10-01 catch-up corrected a card by scrolling fifty-seven folded
// figures to find SECTION B and giving it the depth (Sebastian, 42:10: "you
// might as well use that full list … you're telling it, that's the
// measurement I want you to look at"), and was surprised that the unit select
// relabels rather than converts (Matthew, 45:03). So:
//
//   * every measured row, FOLDED ONES INCLUDED, carries "Use as W · D · H · SH
//     · Dia", and a click sends ONE swap naming every row the card shows
//     holding that slot, at the version shown;
//   * a slot's rival figure offers "Use this instead", the same swap on the
//     row that IS that figure;
//   * the unit select says "printed in", the card-wide control says "Every
//     figure on this card is printed in: mm · cm · in";
//   * "Show in mm" prints each figure converted, and writes nothing;
//   * a specification sheet's other statements fold under their own heading;
//   * a doubt the read raised about an overall slot offers "Checked".
//
// The component tier runs without a database and is scoped by PATH in
// vitest.config.ts, so there is no `@vitest-environment` docblock here.
// ============================================================================
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import { orderRows } from "@/components/imports/ObservationRows";
import { callbacks, callout, figure, item, observation, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

function renderCard(staged: DrawingItem, over: Parameters<typeof resolution>[0] = {}) {
  const spies = { ...callbacks(), onSaveItem: vi.fn(async () => undefined) };
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
      onSetLevel={spies.onSetLevel}
      onSaveItem={spies.onSaveItem}
    />,
  );
  return spies;
}

/** The table row whose value box holds this figure. */
function rowFor(value: string): HTMLElement {
  const found = screen.getAllByRole("row").find((row) => within(row).queryByDisplayValue(value) !== null);
  if (!found) throw new Error(`No row holds the value ${value}`);
  return found;
}

/** A shop drawing: W/D/H placed off the elevations, SECTION B and an arm height folded. */
function sectionB() {
  resetIds();
  const width = figure("Width", "2100", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", isOverall: true, page: 1, view: "ELEVATION 1" });
  const depth = figure("Depth", "640", { attrGroup: "dimension", dimensionSlot: "D", unit: "mm", isOverall: true, page: 1, view: "PLAN" });
  const height = figure("Height", "760", { attrGroup: "dimension", dimensionSlot: "H", unit: "mm", isOverall: true, page: 1, view: "SECTION A" });
  const section = figure("SECTION B", "880", { unit: "mm", isOverall: false, page: 1, view: "SECTION B" });
  const arm = figure("ARM HEIGHT", "620", { unit: "mm", isOverall: false, page: 1 });
  return { width, depth, height, section, arm, staged: item({ observations: [width, depth, height, section, arm], pages: [1] }) };
}

describe("Use as W · D · H · SH · Dia", () => {
  it("is on every measured row, the folded ones included", async () => {
    const { staged } = sectionB();
    renderCard(staged);
    // Three placed slots inline, each with the five buttons.
    expect(screen.getAllByRole("group", { name: "Use as" })).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: /Other dimensions \(2\)/ }));
    expect(screen.getAllByRole("group", { name: "Use as" })).toHaveLength(5);
    const row = rowFor("880");
    for (const name of ["width", "depth", "height", "seat height", "diameter"]) {
      expect(within(row).getByRole("button", { name: `Use as ${name}` })).toBeEnabled();
    }
  });

  it("sends ONE swap naming the row that holds the slot, at the version shown", async () => {
    const { staged, depth, section } = sectionB();
    const spies = renderCard(staged);
    await userEvent.click(screen.getByRole("button", { name: /Other dimensions \(2\)/ }));
    await userEvent.click(within(rowFor("880")).getByRole("button", { name: "Use as depth" }));
    const saves = spies.of("onSaveObservation");
    expect(saves).toHaveLength(1);
    const [savedItem, mover, changes] = saves[0]!.args as [DrawingItem, DrawingObservation, Record<string, unknown>];
    expect(savedItem.id).toBe(staged.id);
    expect(mover.id).toBe(section.id);
    expect(changes).toEqual({ swapSlot: { slot: "D", displaces: [{ id: depth.id, version: depth.version }] } });
  });

  it("shows the slot a row already fills as pressed, not as something to click", () => {
    const { staged } = sectionB();
    renderCard(staged);
    const button = within(rowFor("2100")).getByRole("button", { name: "Use as width" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("is not offered on a row that states no figure", () => {
    resetIds();
    renderCard(item({ observations: [figure("REMARKS", "SUBMIT SHOP DRAWINGS FOR REVIEW", { attrGroup: "note" })] }));
    expect(screen.queryByRole("group", { name: "Use as" })).toBeNull();
  });
});

describe("a slot's rival figure", () => {
  it("offers Use this instead, which swaps the row that IS that figure into the slot", async () => {
    resetIds();
    const rival = figure("ELEVATION 2", "740", { unit: "mm", isOverall: false, page: 2, view: "ELEVATION 2" });
    const width = figure("Width", "760", {
      attrGroup: "dimension",
      dimensionSlot: "W",
      unit: "mm",
      isOverall: true,
      page: 1,
      view: "PLAN",
      candidates: [{ valueRaw: "740", unitRaw: null, view: "ELEVATION 2", page: 2, observationId: rival.id }],
    });
    const spies = renderCard(item({ observations: [width, rival], pages: [1, 2] }));
    await userEvent.click(within(rowFor("760")).getByRole("button", { name: "Use this instead" }));
    const [, mover, changes] = spies.of("onSaveObservation")[0]!.args as [DrawingItem, DrawingObservation, Record<string, unknown>];
    expect(mover.id).toBe(rival.id);
    expect(changes).toEqual({ swapSlot: { slot: "W", displaces: [{ id: width.id, version: 1 }] } });
  });

  it("finds the row by figure, page and view on a run staged before the link existed", async () => {
    resetIds();
    const rival = figure("ELEVATION 2", "740", { unit: "mm", isOverall: false, page: 2, view: "ELEVATION 2" });
    const width = figure("Width", "760", {
      attrGroup: "dimension",
      dimensionSlot: "W",
      unit: "mm",
      isOverall: true,
      page: 1,
      // The schema's one-line shape, as brief D staged it.
      candidates: [{ valueRaw: "740 (ELEVATION 2, page 2)", unitRaw: null, view: null, page: null }],
    });
    const spies = renderCard(item({ observations: [width, rival], pages: [1, 2] }));
    await userEvent.click(within(rowFor("760")).getByRole("button", { name: "Use this instead" }));
    expect((spies.of("onSaveObservation")[0]!.args[1] as DrawingObservation).id).toBe(rival.id);
  });

  it("offers nothing where no row states that figure", () => {
    resetIds();
    const width = figure("Width", "760", {
      attrGroup: "dimension",
      dimensionSlot: "W",
      unit: "mm",
      isOverall: true,
      page: 1,
      candidates: [{ valueRaw: "740", unitRaw: null, view: "SIDE", page: 2 }],
    });
    renderCard(item({ observations: [width] }));
    expect(screen.getByText(/also printed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this instead" })).toBeNull();
  });
});

describe("the unit control says what it does", () => {
  it("labels the row's select 'printed in' where a person can read it", () => {
    const { staged } = sectionB();
    renderCard(staged);
    const row = rowFor("2100");
    expect(within(row).getByText("printed in")).toBeVisible();
    expect(within(row).getByLabelText("printed in")).toHaveValue("mm");
  });

  it("says the card-wide control relabels every figure, and offers inches", async () => {
    const { staged } = sectionB();
    const spies = renderCard(staged);
    expect(screen.getByText("Every figure on this card is printed in:")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "in" }));
    expect(spies.of("onSetBulkUnit")[0]!.args).toEqual(["item", "in", staged.id]);
  });
});

describe("Show in mm", () => {
  it("prints each figure converted with what was printed, and saves nothing", async () => {
    resetIds();
    const width = figure("Width", `5'-7"`, { attrGroup: "dimension", dimensionSlot: "W", unit: "in", isOverall: true });
    const depth = figure("Depth", "84", { attrGroup: "dimension", dimensionSlot: "D", unit: "cm", isOverall: true });
    const height = figure("Height", "760", { attrGroup: "dimension", dimensionSlot: "H", unit: "mm", isOverall: true });
    const spies = renderCard(item({ observations: [width, depth, height] }));
    expect(screen.queryByTestId("in-millimetres")).toBeNull();

    const toggle = screen.getByRole("button", { name: "Show in mm" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(within(rowFor(`5'-7"`)).getByTestId("in-millimetres")).toHaveTextContent(`= 1702 mm (5'-7")`);
    expect(within(rowFor("84")).getByTestId("in-millimetres")).toHaveTextContent("= 840 mm (84 cm)");
    expect(within(rowFor("760")).getByTestId("in-millimetres")).toHaveTextContent("= 760 mm");
    expect(spies.calls).toEqual([]);
  });

  it("says why a figure cannot be converted, in the composer's words", async () => {
    resetIds();
    const width = figure("Width", `5'-7"`, { attrGroup: "dimension", dimensionSlot: "W", unit: "cm", isOverall: true });
    const depth = figure("Depth", "640", { attrGroup: "dimension", dimensionSlot: "D", unit: null, isOverall: true });
    renderCard(item({ observations: [width, depth] }));
    await userEvent.click(screen.getByRole("button", { name: "Show in mm" }));
    expect(within(rowFor(`5'-7"`)).getByTestId("in-millimetres")).toHaveTextContent("[feet and inches, recorded as cm]");
    expect(within(rowFor("640")).getByTestId("in-millimetres")).toHaveTextContent("[no unit]");
  });
});

describe("everything else the sheet states", () => {
  const sheet = () => {
    resetIds();
    return [
      figure("Width", "550", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", isOverall: true }),
      callout("SEAT", "Invented velvet", "UPH-01"),
      observation({ labelRaw: "FILLING", value: "Feathers", valueRaw: "Feathers", statement: true }),
      observation({ labelRaw: "LEAD TIME", value: "12 weeks", valueRaw: "12 weeks", statement: true }),
    ];
  };

  it("folds the statements by default, under their own heading and count", async () => {
    renderCard(item({ observations: sheet() }));
    expect(screen.getByDisplayValue("Invented velvet")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Feathers")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Everything else the sheet states \(2\)/ }));
    expect(screen.getByDisplayValue("Feathers")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12 weeks")).toBeInTheDocument();
  });

  it("still confirms them with the card", async () => {
    const rows = sheet();
    const spies = renderCard(item({ observations: rows }));
    await userEvent.click(screen.getByRole("button", { name: /Confirm 4 specs/ }));
    const [, confirmed] = spies.of("onReview")[0]!.args as [DrawingItem, DrawingObservation[]];
    expect(confirmed.map((o) => o.id).sort()).toEqual(rows.map((o) => o.id).sort());
  });

  it("never folds away a statement with a blocker on it", () => {
    const rows = sheet();
    const ordered = orderRows(rows, (o) => o.id === rows[3]!.id);
    expect(ordered.statementRows.map((o) => o.labelRaw)).toEqual(["FILLING"]);
  });

  it("folds nothing on a card holding only statements", () => {
    resetIds();
    const only = [observation({ labelRaw: "FILLING", value: "Feathers", valueRaw: "Feathers", statement: true })];
    expect(orderRows(only).statementRows).toEqual([]);
  });
});

describe("a doubt the read raised about a size", () => {
  const doubtful = (over: Partial<DrawingItem> = {}) => {
    resetIds();
    return item({
      observations: [figure("Width", "760", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", isOverall: true })],
      uncertain: [
        { about: "width", why: "The plan prints 760 and ELEVATION 2 prints 740." },
        { about: "grouping", why: "Page 3 may be another stool." },
      ],
      ...over,
    });
  };

  it("offers Checked on the slot doubt only, and saves it on the item", async () => {
    const staged = doubtful();
    const spies = renderCard(staged, {
      blockers: [{ code: "uncertain_unchecked", message: "The read was unsure of the width: …" }],
    });
    const notes = screen.getByRole("note", { name: "What the read was unsure of" });
    expect(within(notes).getAllByRole("button", { name: "Checked" })).toHaveLength(1);
    expect(within(notes).getByText(/holds the card until you check it/)).toBeInTheDocument();
    await userEvent.click(within(notes).getByRole("button", { name: "Checked" }));
    expect(spies.onSaveItem).toHaveBeenCalledWith(staged, { uncertainChecked: [0] });
    expect(screen.getByRole("button", { name: /Confirm 1 spec/ })).toBeDisabled();
  });

  it("says a checked or touched doubt is settled, and offers nothing more", () => {
    renderCard(doubtful({ uncertainChecked: [0] }));
    const notes = screen.getByRole("note", { name: "What the read was unsure of" });
    expect(within(notes).queryByRole("button", { name: "Checked" })).toBeNull();
    expect(within(notes).getByText("— checked")).toBeInTheDocument();
  });
});
