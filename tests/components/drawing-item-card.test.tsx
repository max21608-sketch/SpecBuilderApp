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
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, callout, figure, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingObservation } from "@/lib/drawing-document";

function renderCard(
  observations: DrawingObservation[],
  over: Parameters<typeof resolution>[0] = {},
  itemOver: Parameters<typeof item>[0] = {},
) {
  const spies = callbacks();
  const staged = item({ observations, ...itemOver });
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
    />,
  );
  return spies;
}

/** The rows of the observation table, by the label cell a reviewer reads. */
function rowLabels(): string[] {
  return screen
    .getAllByRole("row")
    .filter((row) => !row.hasAttribute("data-figure-row"))
    .map((row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "")
    .filter(Boolean);
}

/** The row holding this value: a size figure by the figure it prints, any other row by its value box. */
function rowFor(value: string): HTMLElement {
  const figureRow = figureRows().find((row) =>
    [...row.querySelectorAll("span.font-mono")].some((span) => span.textContent === value),
  );
  const found = figureRow ?? screen.getAllByRole("row").find((row) => within(row).queryByDisplayValue(value) !== null);
  if (!found) throw new Error(`No row holds the value ${value}`);
  return found;
}

/** The size section's figure rows, in the order shown (workstream E). */
function figureRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-figure-row]")];
}

/** The size section's rows by the label the page printed beside each figure. */
function figureLabels(): string[] {
  return figureRows().map((row) => row.getAttribute("data-label") ?? "");
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
    expect(screen.getByText(/Every other figure the drawing prints \(3\)/)).toBeInTheDocument();
    // Two FRONT rows on screen: the placed width and the placed height. The
    // front elevation's 42 and 27 are folded away with the side's 50.
    expect(figureLabels().filter((label) => label === "FRONT")).toHaveLength(2);
    expect(figureRows()).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: /Every other figure the drawing prints \(3\) — show/ }));
    expect(figureLabels().filter((label) => label === "FRONT")).toHaveLength(4);
    expect(rowFor("42")).toBeInTheDocument();
  });

  // Workstream E: "only three of the four" figures offered a slot.
  it("gives every figure, folded or not, the same one picker — and only one", async () => {
    renderCard(s201());
    await userEvent.click(screen.getByRole("button", { name: /Every other figure the drawing prints \(3\) — show/ }));
    const pickers = within(screen.getByTestId("drawing-figures")).getAllByRole("group", { name: /^What .* is$/ });
    expect(pickers).toHaveLength(7);
    for (const picker of pickers) {
      expect(within(picker).getAllByRole("button").map((button) => button.textContent)).toEqual(["W", "D", "H", "SH", "Dia", "note"]);
    }
    // No slot select and no separate "Use as" row beside it any more.
    expect(screen.queryByRole("group", { name: "Use as" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Keep as a note" })).toBeNull();
  });

  it("says what each figure becomes, and what BWS receives at the top", () => {
    renderCard(s201());
    expect(within(rowFor("640")).getByText("W 640 mm")).toBeInTheDocument();
    expect(within(screen.getByTestId("what-bws-receives")).getByTestId("bws-cell")).toHaveTextContent("W640 x D685 x H680 x SH445mm");
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
    expect(screen.queryByText(/Every other figure/)).toBeNull();
    expect(figureLabels()).toEqual(["FRONT", "SIDE"]);
  });

  it("says so in words when nothing is placed, rather than showing no line", () => {
    // It used to render the line only once something had been placed, so two
    // cards of one code differed on screen by whether the guess had found
    // anything -- and a card with no line reads as one with nothing to say
    // about its size.
    resetIds();
    renderCard([figure("FRONT", "640"), figure("SIDE", "685")]);
    expect(screen.getByText(/What BWS receives/i)).toBeInTheDocument();
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
    // It used to assert the em-dash placeholder the Unit COLUMN printed here.
    // The column is gone -- it was 99px of em-dash on every row that is not a
    // measurement, and losing it is what stopped the card being clipped -- so
    // the unit is simply absent, which says the same thing more quietly.
    expect(within(row).queryByLabelText("printed in")).toBeNull();
  });

  it("offers the bulk unit control whenever the page holds a measurement", () => {
    // Gated on `attrGroup === "dimension"`, it was hidden from exactly the
    // pages whose figures were all still notes. Since brief F it says what it
    // does: it states what the figures are PRINTED in, and converts nothing.
    resetIds();
    renderCard([figure("FRONT", "640")]);
    expect(screen.getByText(/Every figure on this card is printed in:/)).toBeInTheDocument();
    for (const unit of ["mm", "cm", "in"]) expect(screen.getByRole("button", { name: unit })).toBeInTheDocument();
  });
});

function observationNote() {
  return figure("REMARKS", "SUBMIT SHOP DRAWINGS FOR REVIEW", { attrGroup: "note" });
}

describe("the state control", () => {
  /**
   * The S-203 general-conditions block: fifteen lines merged into one row, no
   * BWS field, no dimension slot, and `mergeNoteBlocks` leaving it unruled
   * because one of the fifteen was.
   */
  const mergedBlock = () =>
    figure("Remarks", "REMARKS: SUBMIT SHOP DRAWINGS FOR REVIEW\nSUPPLIER: TO BID", {
      attrGroup: "note",
      state: null,
    });

  it("is not offered on a merged note block, which composes into nothing", () => {
    // Its state is written and never read, so `Choose…` beside it was a
    // question with no consequence that still held the card.
    resetIds();
    renderCard([mergedBlock()]);
    // By its label cell, not by its value: a merged block renders in a
    // textarea, whose display value does not match a newline literally.
    const row = screen.getAllByRole("row").find((candidate) => candidate.textContent?.includes("SUPPLIER: TO BID"));
    if (!row) throw new Error("the merged block did not render");
    expect(within(row).queryByLabelText("State")).toBeNull();
    expect(within(row).queryByRole("option", { name: "Stated" })).toBeNull();
  });

  it("is offered on a row carrying a BWS field, whatever its group", () => {
    // `renderAttributeValue` puts this row's TBC marker into the exported
    // cell, so the state is read there and the question is a real one.
    resetIds();
    renderCard([callout("ARMCHAIR", "Woven raffia", "UPH-07", { specFieldId: "field-com1" })]);
    const row = rowFor("Woven raffia");
    expect(within(row).getByLabelText("State")).toBeInTheDocument();
    expect(within(row).getByRole("option", { name: "TBC" })).toBeInTheDocument();
  });

  it("is offered on a row carrying a dimension slot", () => {
    resetIds();
    renderCard([
      figure("FRONT", "840", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", state: null }),
    ]);
    expect(within(rowFor("840")).getByLabelText("State")).toBeInTheDocument();
  });
});

describe("the table's width", () => {
  // WHY THIS IS TESTED AT ALL. The card was CLIPPED on a full-width monitor:
  // `PageBody` caps at 1400px and the picture sidebar takes a fixed 300 of it,
  // so the table gets ~1010px at 1920 AND at 1440, while seven columns wanted
  // up to 1091. What fell off the edge was the ACTION column, which carries no
  // heading -- so nothing in the header row went missing to say so and *Ignore*
  // was reachable only by scrolling sideways. jsdom lays nothing out, so the
  // widths themselves are a browser check (done, both sizes, on a real staged
  // Panther run). What CAN be held here is the count: one column fewer is what
  // bought the room, and a `colSpan` that does not match it is the trap that
  // squeezed the replace acknowledgement into a ribbon once already.
  it("has six columns, and every spanning panel covers its own table's columns", () => {
    resetIds();
    const rows = [
      figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm" }),
      observationNote(),
    ];
    renderCard(rows, {
      blockers: [{ code: "unit_missing", message: "Choose millimetres or centimetres.", observationId: rows[0]!.id }],
    });
    const figures = screen.getByTestId("drawing-figures");
    const specs = [...document.querySelectorAll("table")].find((table) => table !== figures && within(table).queryByText("Group"))!;
    expect(within(specs).getAllByRole("columnheader").map((cell) => cell.textContent?.trim())).toEqual([
      "Group",
      "Label",
      "Value",
      "Dimension / BWS field",
      "State",
      "",
    ]);
    // The size section: figure, what it is, what it becomes, the row's actions.
    expect(within(figures).getAllByRole("columnheader")).toHaveLength(4);

    // A spanning panel is its OWN `<tr>` with ONE cell, and that cell spans
    // every column of the table it is in. Short and the panel stops before the
    // last column; long and the row is wider than the table it is in.
    const spanning = [...document.querySelectorAll("td[colspan]")];
    expect(spanning.length).toBeGreaterThan(0);
    for (const cell of spanning) {
      const table = cell.closest("table")!;
      expect(cell.getAttribute("colspan")).toBe(String(table.querySelectorAll("thead th").length));
      expect(cell.parentElement?.children).toHaveLength(1);
    }
  });

  it("keeps the unit beside the figure it belongs to, with its provenance", async () => {
    // "printed on the page" is not decoration, it is the difference between a
    // measurement and a guess. The unit select is one click away (Edit value).
    resetIds();
    renderCard([figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", unitSource: "printed" })]);
    const row = rowFor("640");
    const figureCell = row.querySelectorAll("td")[0]!;
    expect(within(figureCell).getByText(/printed on the page/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Edit value" }));
    expect(within(rowFor("640")).getByLabelText("printed in")).toHaveValue("mm");
  });
});

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

describe("the picture panel, when the item already has a picture (Max, 2026-10-05)", () => {
  it("passes the server's answer through, so the panel starts at none and says why", () => {
    resetIds();
    const onImage = vi.fn();
    const spies = callbacks();
    render(
      <ItemCard
        item={item({ observations: [figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm" })] })}
        importId="import-1"
        resolution={resolution({ pictureHeld: { recordIds: ["rec-main"], of: 2 } })}
        specFields={specFields}
        records={records}
        drafts={{}}
        setDrafts={() => undefined}
        busy={false}
        onSaveObservation={spies.onSaveObservation}
        onSaveTargets={spies.onSaveTargets}
        onSetBulkUnit={spies.onSetBulkUnit}
        onReview={spies.onReview}
        onImage={onImage}
        onSwatch={spies.onSwatch}
        onSetLevel={spies.onSetLevel}
      />,
    );
    expect(screen.getByText("1 of 2 records already have a picture, so none will be taken from this drawing.")).toBeInTheDocument();
    // What the card holds is "no picture", which is what the confirm then
    // sends -- and the confirm writes no picture when it is sent none.
    expect(onImage).toHaveBeenLastCalledWith("item-1", null);
  });

  it("leaves the panel as it was where no record has one", () => {
    resetIds();
    renderCard([figure("FRONT", "640", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm" })]);
    expect(screen.queryByText(/already ha(s|ve) a picture/)).toBeNull();
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
      onSetLevel={spies.onSetLevel}
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

// ============================================================================
// THE S-201 SPRAWL, AS A TEST
//
// Reported on sight of the real card: "loads of dimensions everywhere,
// nothing's grouped, it's all just over the place". The sheet prints a
// dimensions TABLE and only W, D and H were filled in, so WIDTH SEAT, WIDTH
// BACK, DEPTH SEAT, DEPTH BACK and HEIGHT BACK all came through as `TBC`.
//
// They state no figure, so the old fold -- which asked "is this value a number"
// -- could not catch them, and five rows of nothing printed inline between the
// four that matter and the fabrics. Version 2 asks the model whether a figure
// measures the whole item instead, and a blank sub-dimension is not overall.
// ============================================================================
describe("a specification sheet's blank sub-dimensions", () => {
  const s201Sheet = () => {
    resetIds();
    return [
      figure("WIDTH", "660", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", unitSource: "printed", isOverall: true }),
      figure("DEPTH", "720", { attrGroup: "dimension", dimensionSlot: "D", unit: "mm", unitSource: "printed", isOverall: true }),
      figure("HEIGHT", "700", { attrGroup: "dimension", dimensionSlot: "H", unit: "mm", unitSource: "printed", isOverall: true }),
      figure("HEIGHT SEAT", "TBC", { attrGroup: "dimension", dimensionSlot: "SH", unit: "mm", unitSource: "figures", state: "tbc", isOverall: true }),
      figure("WIDTH SEAT", "TBC", { state: "tbc", isOverall: false }),
      figure("WIDTH BACK", "TBC", { state: "tbc", isOverall: false }),
      figure("DEPTH SEAT", "TBC", { state: "tbc", isOverall: false }),
      figure("DEPTH BACK", "TBC", { state: "tbc", isOverall: false }),
      figure("HEIGHT BACK", "TBC", { state: "tbc", isOverall: false }),
      callout("FABRIC CODE", "TBC – Aissa Dione black/straw diamonds", "UPH-07"),
      callout("EXPOSED WOODWORK", "TBC", null),
    ];
  };

  it("folds a blank sub-dimension away, though it states no figure at all", async () => {
    renderCard(s201Sheet());
    const labels = figureLabels();
    expect(labels).toContain("WIDTH");
    expect(labels).not.toContain("WIDTH SEAT");
    expect(labels).not.toContain("DEPTH BACK");

    await userEvent.click(screen.getByRole("button", { name: /Every other figure the drawing prints \(5\)/ }));
    expect(figureLabels()).toContain("WIDTH SEAT");
    // It states no figure, so it says so where a slot would be offered.
    expect(within(screen.getByTestId("drawing-figures")).getAllByText("no figure printed")).toHaveLength(5);
  });

  it("puts the four that matter first, in the order the composed cell writes them", () => {
    // The panel above the table says `W660 x D720 x H700mm x SH TBC`. A table
    // under it in a different order makes a transposition harder to spot, not
    // easier, and spotting one is the entire point of that panel.
    renderCard(s201Sheet());
    expect(figureLabels().slice(0, 4)).toEqual(["WIDTH", "DEPTH", "HEIGHT", "HEIGHT SEAT"]);
  });

  it("groups what is left instead of leaving it in the order the model reported it", () => {
    resetIds();
    renderCard([
      figure("WIDTH", "660", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", unitSource: "printed", isOverall: true }),
      { ...callout("REMARKS", "Comply with the preamble", null), attrGroup: "note" as const },
      callout("FABRIC CODE", "Woven raffia", "UPH-07", { attrGroup: "material" }),
      { ...callout("Item", "REFER TO JACQUES GRANGE DRAWINGS", null), attrGroup: "note" as const },
      callout("EXPOSED WOODWORK", "Dark tinted wood", "WD-05"),
    ]);
    // Materials, then finishes, then the paragraphs — whatever order the page
    // happened to state them in. The width is in the size section above.
    expect(figureLabels()).toEqual(["WIDTH"]);
    expect(rowLabels()).toEqual(["FABRIC CODE", "EXPOSED WOODWORK", "REMARKS", "Item"]);
  });
});

// ============================================================================
// ITEM 1.15 — THE LEVEL, SET WHERE THE EVIDENCE FOR IT IS.
//
// Every BOQ row read *Simple · guessed*, including packaging, and there was no
// level control on the drawings review at all — which is where the brass leg
// first appears. Three things have to hold and each is a trap: the control is
// never a pre-filled select (0025: a select already reading "Simple" fires no
// change event when somebody picks Simple, so agreeing would do nothing); the
// card says how far one click reaches, because a drawing quoted by three
// phases writes three records; and a level already decided is shown rather
// than re-suggested.
// ============================================================================
describe("the item card's level control", () => {
  const brass = () => {
    resetIds();
    return [
      figure("WIDTH", "660", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", unitSource: "printed", isOverall: true }),
      callout("LEGS", "Antique brass", "MT-02"),
    ];
  };

  it("offers the level as buttons, never as a select", async () => {
    renderCard(brass());
    // The suggestion is an offer with what it was read from beside it.
    expect(screen.getByRole("button", { name: /Complex/ })).toBeInTheDocument();
    expect(screen.getByText(/a brass callout on page 5/)).toBeInTheDocument();
    // Opening the other choices gives three BUTTONS. A select here is the
    // 0025 trap: choosing the value it already shows fires nothing.
    await userEvent.click(screen.getByRole("button", { name: "Set another level…" }));
    for (const label of ["Simple", "Complex", "Hero"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("combobox", { name: /level/i })).toBeNull();
  });

  it("says how many records one click reaches, and sends exactly those", async () => {
    const spies = renderCard(brass());
    // The fixture resolves to the main phase and the VE phase.
    expect(screen.getByText("sets the level on 2 records")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Complex/ }));
    expect(spies.of("onSetLevel")).toHaveLength(1);
    expect(spies.of("onSetLevel")[0]!.args).toEqual([["rec-main", "rec-ve"], "complex"]);
  });

  it("shows a level that is already decided, and does not re-suggest one", () => {
    renderCard(brass(), {
      resolution: {
        runs: [
          {
            runId: "run-main",
            runName: "MAIN RUN",
            status: "matched",
            record: { ...records[0]!, level: "hero" },
          },
        ],
        suggested: ["rec-main"],
      },
      targets: ["rec-main"],
    });
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("decided on 1 of 1 record")).toBeInTheDocument();
    // No offer over a decision, and the way to change it says so.
    expect(screen.queryByRole("button", { name: /Complex \?/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Change…" })).toBeInTheDocument();
    // One record, so no fan-out sentence to mislead anybody.
    expect(screen.queryByText(/sets the level on/)).toBeNull();
  });

  it("says it has nothing to suggest rather than guessing simple", () => {
    // `guessLevelFromAttributes` never returns `simple`: a page that names no
    // metal is not evidence that the item has none.
    resetIds();
    renderCard([callout("FABRIC CODE", "Woven raffia", "UPH-07", { attrGroup: "material" })]);
    expect(screen.getByText(/nothing to suggest/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set a level…" })).toBeInTheDocument();
  });
});

// ONE CODE ON TWO LINES OF ONE PHASE (pilot, 2026-10-11): PL-FUR-11 is on two
// lines of the Aman Main Phase and the one drawing is for both. The card must
// send BOTH lines as ticked when the second is pressed — the picker's own
// behaviour is in `run-targets-picker.test.tsx`; this is the card saving it.
describe("an item whose code is on two lines of one phase", () => {
  const twoLines = {
    resolution: {
      runs: [{ runId: "run-main", runName: "MAIN RUN", status: "ambiguous" as const, candidates: [records[0]!, records[1]!] }],
      suggested: [],
    },
    targets: ["rec-main"],
  };

  it("keeps the first line ticked when the second is ticked", async () => {
    resetIds();
    const spies = renderCard([], twoLines, { targets: { ticked: ["rec-main"], unticked: [] } });
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    await userEvent.click(boxes[1]!);
    expect(spies.of("onSaveTargets")[0]!.args.slice(1)).toEqual([["rec-main", "rec-ve"], []]);
  });

  it("un-picks the first line when it is pressed again", async () => {
    resetIds();
    const spies = renderCard([], twoLines, { targets: { ticked: ["rec-main"], unticked: [] } });
    await userEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(spies.of("onSaveTargets")[0]!.args.slice(1)).toEqual([[], ["rec-main"]]);
  });

  it("un-picks the other line where the page code only ends both bill codes", async () => {
    resetIds();
    const spies = renderCard(
      [],
      {
        ...twoLines,
        resolution: {
          ...twoLines.resolution,
          matchedBy: { kind: "code_end", code: null, message: "The page names FUR-11, which is the end of 2 bill codes." },
        },
      },
      { targets: { ticked: ["rec-main"], unticked: [] } },
    );
    await userEvent.click(screen.getByRole("button", { name: /AP364c-025/ }));
    expect(spies.of("onSaveTargets")[0]!.args.slice(1)).toEqual([["rec-ve"], ["rec-main"]]);
  });
});
