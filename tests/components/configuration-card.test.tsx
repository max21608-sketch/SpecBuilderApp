// One card per code, rendered.
//
// The AP364 set draws S-201 on two pages and S-301 on four: same chair, same
// geometry, different fabric. These assert the three things that make one card
// better than four — the geometry appears once, each configuration's own
// finishes are visibly its own, and one Confirm rules on the item.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfigurationCard from "@/components/imports/ConfigurationCard";
import { configurationCards } from "@/lib/configuration-cards";
import type { ItemResolution } from "@/components/imports/DrawingItemCard";
import { callbacks, callout, figure, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

// This tier's 5s default is a bound about the MACHINE, and this file has gone
// red under a second concurrent suite while passing alone. See
// `tests/components/tier-timeout.ts` for the measurements and for why this is
// not the global default.
vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });


const slot = (label: string, value: string, dimensionSlot: DrawingObservation["dimensionSlot"]) =>
  figure(label, value, { attrGroup: "dimension", dimensionSlot, slotSuggested: true, unit: "mm", unitSuggested: true, unitSource: "figures" });

/** One page of a chair: the four slots, two folded figures, one fabric. */
const page = (id: string, pageNo: number, fabric: string, code: string, over: Partial<DrawingItem> = {}) =>
  item({
    id,
    page: pageNo,
    itemCodeRaw: code,
    observations: [
      slot("FRONT", "640", "W"),
      slot("SIDE", "685", "D"),
      slot("FRONT", "680", "H"),
      slot("SIDE", "445", "SH"),
      figure("FRONT", "42", { unit: "mm" }),
      figure("SIDE", "50", { unit: "mm" }),
      callout("ARMCHAIR", fabric, "UPH-07"),
    ],
    ...over,
  });

function renderConfigurations(
  pages: DrawingItem[],
  resolutions?: Map<string, ItemResolution>,
  // The staged DOCUMENT. Without one the card falls back to counting pages,
  // which is the version 1 reading -- so a test about what a version 2 run
  // does has to supply it, exactly as the review screens do.
  doc?: Parameters<typeof configurationCards>[2],
) {
  const spies = { ...callbacks(), onSaveItem: vi.fn(async () => undefined) };
  const byItem =
    resolutions ??
    new Map(
      pages.map((staged, index) => [
        staged.id,
        resolution({ id: staged.id, variantLabel: String.fromCharCode(65 + index) }),
      ]),
    );
  const cards = configurationCards(pages, byItem, doc);
  const card = cards[0]!;
  if (card.kind !== "configurations") throw new Error("expected a configuration card");
  // The value boxes are controlled by `drafts`, so a stub setter would make
  // every keystroke a no-op and the blur handler would see no change.
  function Host() {
    const [drafts, setDrafts] = useState<Record<string, Partial<DrawingObservation>>>({});
    return (
      <ConfigurationCard
        card={card as Extract<ReturnType<typeof configurationCards<ItemResolution>>[number], { kind: "configurations" }>}
        importId="import-1"
        specFields={specFields}
        records={records}
        drafts={drafts}
        setDrafts={setDrafts}
        busy={null}
        onSaveObservation={spies.onSaveObservation}
        onSaveObservations={spies.onSaveObservations}
        onSaveTargets={spies.onSaveTargets}
        onSetBulkUnit={spies.onSetBulkUnit}
        onReview={spies.onReview}
        onReviewMany={spies.onReviewMany}
        onImage={spies.onImage}
        onSwatch={spies.onSwatch}
      onSetLevel={spies.onSetLevel}
        onSaveItem={spies.onSaveItem}
      />
    );
  }
  render(<Host />);
  return spies;
}

const twoPages = () => {
  resetIds();
  return [page("a", 5, "Woven raffia", "S-201"), page("b", 6, "Pale linen", "S-201")];
};

describe("the configuration card", () => {
  it("names every configuration once, in the header", () => {
    renderConfigurations(twoPages());
    expect(screen.getAllByText("S-201 A")).not.toHaveLength(0);
    expect(screen.getAllByText("S-201 B")).not.toHaveLength(0);
    expect(screen.getByText(/One bill line, drawn as 2 configurations/)).toBeInTheDocument();
  });

  it("says whether each configuration's record exists or will be created", async () => {
    resetIds();
    const pages = [page("a", 5, "Woven raffia", "S-201"), page("b", 6, "Pale linen", "S-201")];
    renderConfigurations(
      pages,
      new Map([
        ["a", resolution({ id: "a", variantLabel: "A", writesTo: { "rec-main": "variant-1" } })],
        ["b", resolution({ id: "b", variantLabel: "B", writesTo: {} })],
      ]),
    );
    // One configuration at a time: A's tab is open and says its record exists;
    // B's says its record will be created once it is opened.
    expect(screen.getByText(/record exists/)).toBeInTheDocument();
    expect(screen.queryByText(/record will be created/)).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /S-201 B/ }));
    expect(screen.getByText(/record will be created/)).toBeInTheDocument();
  });

  it("shows the geometry ONCE, not once per configuration", () => {
    renderConfigurations(twoPages());
    // Four slots, one table — not eight rows across two.
    expect(screen.getAllByDisplayValue("640")).toHaveLength(1);
    expect(screen.getAllByText("W640 x D685 x H680 x SH445mm")).toHaveLength(1);
    expect(screen.getByText(/Shared geometry/)).toBeInTheDocument();
  });

  it("writes a shared edit to the matching row on EVERY configuration's page", async () => {
    // Displayed once, written per page: `record_attributes` holds what a page
    // said, so B's width must come from page 6 and carry page 6 as its source.
    const spies = renderConfigurations(twoPages());
    const width = screen.getByDisplayValue("640");
    await userEvent.clear(width);
    await userEvent.type(width, "660");
    await userEvent.tab();
    const batches = spies.of("onSaveObservations");
    expect(batches).toHaveLength(1);
    const edits = batches[0]!.args[0] as { item: DrawingItem; observation: DrawingObservation }[];
    expect(edits.map((edit) => edit.item.id).sort()).toEqual(["a", "b"]);
    // Each carries its own page's row, with that row's own version.
    expect(new Set(edits.map((edit) => edit.observation.id)).size).toBe(2);
  });

  it("shows ONE configuration at a time, as a tab, with its own fabric", async () => {
    // Max, 2026-09-23: "you just see configuration one ... and then you go to
    // configuration two ... it's the same every time." Never listed one after
    // another down the page.
    renderConfigurations(twoPages());
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      expect.stringContaining("S-201 A"),
      expect.stringContaining("S-201 B"),
    ]);
    expect(screen.getByDisplayValue("Woven raffia")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Pale linen")).toBeNull();
    expect(document.querySelectorAll(".border-l-sky-400").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: /S-201 B/ }));
    expect(screen.getByDisplayValue("Pale linen")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Woven raffia")).toBeNull();
    // Its own colour, the band matching the tab: B is emerald, as it always was.
    expect(document.querySelectorAll(".border-l-emerald-400").length).toBeGreaterThan(0);
    // The same layout on every tab: the shared geometry is still there, once.
    expect(screen.getAllByDisplayValue("640")).toHaveLength(1);
  });

  it("folds the non-key measurements once, not once per page", () => {
    renderConfigurations(twoPages());
    expect(screen.getAllByText(/Other dimensions \(2\)/)).toHaveLength(1);
  });

  it("confirms every configuration under one button, in letter order", async () => {
    const spies = renderConfigurations(twoPages());
    const confirm = screen.getByRole("button", { name: /Confirm S-201 \(2 configurations\)/ });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    const [call] = spies.of("onReviewMany");
    const entries = call!.args[1] as { label: string; item: DrawingItem }[];
    expect(entries.map((entry) => entry.label)).toEqual(["S-201 A", "S-201 B"]);
  });

  it("refuses to confirm while ANY configuration is blocked, and names it", () => {
    // A confirm-all that skipped the blocked configuration would read as done.
    resetIds();
    const pages = [page("a", 5, "Woven raffia", "S-201"), page("b", 6, "Pale linen", "S-201")];
    renderConfigurations(
      pages,
      new Map([
        ["a", resolution({ id: "a", variantLabel: "A" })],
        [
          "b",
          resolution({
            id: "b",
            variantLabel: "B",
            blockers: [{ code: "unit_missing", message: "Choose millimetres or centimetres." }],
          }),
        ],
      ]),
    );
    expect(screen.getByRole("button", { name: /Confirm S-201/ })).toBeDisabled();
    expect(screen.getByText(/S-201 B cannot be confirmed yet: Choose millimetres or centimetres\./)).toBeInTheDocument();
  });

  it("collapses a configuration that has already been applied", async () => {
    resetIds();
    const applied = page("a", 5, "Woven raffia", "S-201");
    applied.observations = applied.observations.map((o) => ({
      ...o,
      reviewStatus: "applied" as const,
      reviewedAt: "2026-09-16T10:00:00Z",
    }));
    renderConfigurations([applied, page("b", 6, "Pale linen", "S-201")]);
    // The strip opens on the configuration still to review, and says the other is done.
    expect(screen.getByRole("tab", { name: /S-201 A/ }).textContent).toContain("applied");
    await userEvent.click(screen.getByRole("tab", { name: /S-201 A/ }));
    expect(screen.getByText(/applied on 16\/09\/2026/)).toBeInTheDocument();
    // Its fabric row is history, so it carries no controls.
    expect(screen.queryByDisplayValue("Woven raffia")).toBeNull();
    expect(screen.getByRole("button", { name: /Confirm S-201 \(1 configuration\)/ })).toBeInTheDocument();
  });
});

describe("when the pages do not agree on the size", () => {
  const disagreeing = () => {
    resetIds();
    const a = page("a", 5, "Woven raffia", "S-201");
    const b = page("b", 6, "Pale linen", "S-201");
    b.observations = b.observations.map((o) => (o.dimensionSlot === "H" ? { ...o, value: "720", valueRaw: "720" } : o));
    return [a, b];
  };

  it("names the difference per slot and never averages it", () => {
    renderConfigurations(disagreeing());
    expect(screen.getByText(/These pages do not agree on the size/)).toBeInTheDocument();
    expect(screen.getByText(/A 680mm, B 720mm/)).toBeInTheDocument();
    expect(screen.queryByText(/Shared geometry/)).toBeNull();
  });

  it("still lets the reviewer confirm — it is a notice, not a blocker", () => {
    renderConfigurations(disagreeing());
    expect(screen.getByRole("button", { name: /Confirm S-201 \(2 configurations\)/ })).toBeEnabled();
  });

  it("shows each configuration's own figures instead of a shared table", async () => {
    renderConfigurations(disagreeing());
    expect(screen.getByDisplayValue("680")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /S-201 B/ }));
    expect(screen.getByDisplayValue("720")).toBeInTheDocument();
  });
});

describe("applies to, across configurations", () => {
  it("flags a phase the configurations disagree about", () => {
    resetIds();
    const pages = [page("a", 5, "Woven raffia", "S-201"), page("b", 6, "Pale linen", "S-201")];
    renderConfigurations(
      pages,
      new Map([
        ["a", resolution({ id: "a", variantLabel: "A", targets: ["rec-main", "rec-ve"] })],
        ["b", resolution({ id: "b", variantLabel: "B", targets: ["rec-main"] })],
      ]),
    );
    expect(screen.getByText(/do not currently agree about which phases they apply to/)).toBeInTheDocument();
  });

  it("ticks a phase every configuration applies to", () => {
    renderConfigurations(twoPages());
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
  });
});

// ============================================================================
// ONE ITEM DESCRIBED TWICE MUST NOT CLAIM TO BE TWO THINGS TO MAKE
//
// The S-200 card announced "One bill line, drawn as 2 configurations" and
// chipped its two pages `S-200 A` and `S-200 B`, each "record will be created",
// over an armchair whose specification sheet and shop drawing both state the
// same fabric and the same timber. Confirming it would have created two records
// and taken the bill line out of the export, so BWS would receive two jobs for
// one chair.
// ============================================================================
describe("a card that is not splitting anything", () => {
  const pages = () => [page("a", 1, "Tibor Blob Amber Fern", "S-200"), page("b", 2, "Tibor Blob Amber Fern", "S-200")];

  /** No variant labels anywhere: what a `one_item` group resolves to. */
  const notSplit = (staged: DrawingItem[]) =>
    new Map(staged.map((entry) => [entry.id, resolution({ id: entry.id, variantLabel: null })]));

  /** A version 2 document whose model said these pages are one chair. */
  const oneItem = {
    schemaVersion: 2 as const,
    codeGroups: [
      {
        itemCodes: ["S-200"],
        pages: [1, 2],
        relationship: "one_item" as const,
        evidence: "the specification sheet and the shop drawing of one chair",
      },
    ],
  };

  it("says the pages describe one item, and that the bill line is what ships", () => {
    renderConfigurations(pages(), notSplit(pages()), oneItem);
    expect(screen.getByText(/One item, described on 2 pages/)).toBeInTheDocument();
    expect(screen.queryByText(/drawn as 2 configurations/)).not.toBeInTheDocument();
  });

  it("names its pages by page, never as records that are about to exist", () => {
    // `S-200 A` is the name of a record somebody will quote in an email. It
    // must not appear on a card that is creating no such record.
    renderConfigurations(pages(), notSplit(pages()), oneItem);
    expect(screen.getAllByText("Page 1").length).toBeGreaterThan(0);
    expect(screen.queryByText("S-200 A")).not.toBeInTheDocument();
  });

  it("still says configurations when something really is being split", () => {
    renderConfigurations(pages());
    expect(screen.getByText(/One bill line, drawn as 2 configurations/)).toBeInTheDocument();
    expect(screen.getAllByText("S-200 A").length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// EVERY OBSERVATION TABLE IS INSIDE ITS OWN SCROLL BOX
//
// Measured 2026-09-22 on the staged Panther-d pack: 8 of 14 observation tables
// had no `.overflow-x-auto` ancestor at all. Their effective x-overflow box was
// the configuration band, which is `overflow-hidden` for its rounded corners
// and its `border-l-4` colour -- so once the content wins those tables clip
// WITH NO SCROLLBAR, which is worse than the state Max reported on 2026-09-21,
// where the hidden column was at least reachable.
//
// This asserts the shape rather than a width, because jsdom lays nothing out:
// what a browser can then be trusted to do is scroll, and what it cannot
// recover from is there being nowhere to scroll.
describe("a wide observation table has somewhere to scroll", () => {
  const bandOf = (table: HTMLTableElement) => table.closest<HTMLElement>("div.border-l-4");

  it("gives every observation table an overflow-x-auto ancestor", () => {
    renderConfigurations(twoPages());
    const tables = Array.from(document.querySelectorAll("table"));
    // The shared geometry plus the OPEN configuration's own rows: one tab is
    // mounted at a time.
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const table of tables) {
      expect(table.closest(".overflow-x-auto")).not.toBeNull();
    }
  });

  it("does not reach for the scroll box by loosening the band", () => {
    // The band's `overflow-hidden` is load-bearing: it is what makes the
    // rounded corners and the coloured left border clip cleanly. The wrapper
    // goes INSIDE it.
    renderConfigurations(twoPages());
    const bands = Array.from(document.querySelectorAll("table"))
      .map(bandOf)
      .filter((band): band is HTMLElement => band !== null);
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) {
      expect(band.className).toContain("overflow-hidden");
    }
  });

  it("never makes the scroll box itself overflow-hidden", () => {
    // `overflow-hidden` on the wrapper makes it the sticky scroll container and
    // the header then covers a row -- a defect this repo has already had once.
    renderConfigurations(twoPages());
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const box = table.closest<HTMLElement>(".overflow-x-auto")!;
      expect(box.className).not.toContain("overflow-hidden");
    }
  });
});

// ============================================================================
// THE MANUAL codeGroups.relationship (brief C1): a reviewer splits pages the
// model called one item, joins pages it split, or names the configurations.
// Each writes to EVERY page of the code, beside the model's reading.
// ============================================================================
describe("a reviewer saying what these pages are", () => {
  const oneItemPages = () => {
    resetIds();
    return [page("a", 1, "Tibor Blob Amber Fern", "S-200"), page("b", 2, "Tibor Blob Amber Fern", "S-200")];
  };
  const oneItem = {
    schemaVersion: 2 as const,
    codeGroups: [{ itemCodes: ["S-200"], pages: [1, 2], relationship: "one_item" as const, evidence: "one chair" }],
  };
  const notSplit = (staged: DrawingItem[]) =>
    new Map(staged.map((entry) => [entry.id, resolution({ id: entry.id, variantLabel: null })]));

  it("splits pages the model called one item, on every page", async () => {
    const pages = oneItemPages();
    const spies = renderConfigurations(pages, notSplit(pages), oneItem);
    await userEvent.click(screen.getByRole("button", { name: "separate configurations" }));
    expect(spies.onSaveItem.mock.calls.map((call) => [(call[0] as DrawingItem).id, call[1]])).toEqual([
      ["a", { relationshipByReviewer: "configurations" }],
      ["b", { relationshipByReviewer: "configurations" }],
    ]);
  });

  it("says what was read and what the reviewer set, and can put the reading back", async () => {
    const pages = oneItemPages().map((entry) => ({ ...entry, relationshipByReviewer: "configurations" as const }));
    const spies = renderConfigurations(pages, undefined, oneItem);
    expect(screen.getByText(/read as one item; you set configurations/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Put the reading back" }));
    expect(spies.onSaveItem.mock.calls.map((call) => call[1])).toEqual([
      { relationshipByReviewer: null },
      { relationshipByReviewer: null },
    ]);
  });

  it("joins pages the model split", async () => {
    const spies = renderConfigurations(twoPages());
    await userEvent.click(screen.getByRole("button", { name: "one item" }));
    expect(spies.onSaveItem.mock.calls.map((call) => call[1])).toEqual([
      { relationshipByReviewer: "one_item" },
      { relationshipByReviewer: "one_item" },
    ]);
  });

  it("names the configurations instead, which makes it a card of named ones", async () => {
    const pages = oneItemPages();
    const spies = renderConfigurations(pages, notSplit(pages), oneItem);
    await userEvent.click(screen.getByRole("button", { name: "Name its configurations…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Configuration name" }), "Type 1, type 2");
    await userEvent.click(screen.getByRole("button", { name: /^Add/ }));
    expect(spies.onSaveItem.mock.calls[0]![1]).toEqual({
      configurationsByReviewer: [
        { label: "TYPE 1", readAs: null },
        { label: "TYPE 2", readAs: null },
      ],
    });
    expect(spies.onSaveItem).toHaveBeenCalledTimes(2);
  });
});

describe("a code whose pages name rooms but give them nothing different", () => {
  it("says it is read as one item, and offers the split by hand", async () => {
    resetIds();
    const pages = [page("a", 1, "Invented cloth", "S-100"), page("b", 2, "Invented cloth", "S-100")];
    const doc = {
      schemaVersion: 3 as const,
      codeGroups: [{ itemCodes: ["S-100"], pages: [1, 2], relationship: "one_item" as const, evidence: "one sofa" }],
    };
    pages[1] = { ...pages[1]!, configurations: [{ name: "Type 1", nameRaw: "MUR 1", evidence: null }, { name: "Type 5", nameRaw: "TYPO 5", evidence: null }], depictsConfigurations: ["Type 1", "Type 5"] };
    const spies = renderConfigurations(
      pages,
      new Map(pages.map((entry) => [entry.id, resolution({ id: entry.id, variantLabel: null })])),
      doc,
    );
    expect(screen.getByText(/The pages name TYPE 1 and TYPE 5 but give them nothing different, so this is read as one item/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Split into TYPE 1 and TYPE 5" }));
    expect(spies.onSaveItem.mock.calls.map((call) => call[1])).toEqual([
      { configurationsByReviewer: [{ label: "TYPE 1", readAs: "TYPE 1" }, { label: "TYPE 5", readAs: "TYPE 5" }] },
      { configurationsByReviewer: [{ label: "TYPE 1", readAs: "TYPE 1" }, { label: "TYPE 5", readAs: "TYPE 5" }] },
    ]);
  });
});
