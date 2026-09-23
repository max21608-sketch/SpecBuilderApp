// The card for configurations a document NAMES, rendered (schemaVersion 3).
//
// The S-301 shape, synthetic (tests/fixtures/named-configurations.ts): a
// specification sheet naming five room types, and the shop drawing of two of
// them. One card, one TAB per configuration, each showing that configuration
// complete — and a row shared by several is ONE observation on every tab.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfigurationCard from "@/components/imports/ConfigurationCard";
import { configurationCards } from "@/lib/configuration-cards";
import { namedConfigurationPlans, type DrawingItem, type DrawingObservation, type StagedDrawings } from "@/lib/drawing-document";
import type { ItemResolution } from "@/components/imports/DrawingItemCard";
import { callbacks, records, resolution, specFields } from "./fixtures";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";
import { namedSheetRun, SHOP_DRAWING, SPEC_SHEET } from "../fixtures/named-configurations";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

type Card = Extract<ReturnType<typeof configurationCards<ItemResolution>>[number], { kind: "configurations" }>;

function resolutionsFor(doc: StagedDrawings, over: (item: DrawingItem) => Partial<ItemResolution> = () => ({})) {
  const plans = namedConfigurationPlans(doc.items, doc);
  return new Map(
    doc.items.map((item) => {
      const plan = plans.get(item.id)!;
      return [
        item.id,
        resolution({
          id: item.id,
          named: {
            labels: plan.labels,
            rows: plan.rows,
            create: { "rec-main": plan.labels, "rec-ve": plan.labels },
            existing: { "rec-main": {}, "rec-ve": {} },
            recordNames: {},
          },
          ...over(item),
        }),
      ];
    }),
  );
}

function renderNamed(doc: StagedDrawings = namedSheetRun(), resolutions = resolutionsFor(doc)) {
  const spies = { ...callbacks(), onSaveItem: vi.fn(async () => undefined) };
  const card = configurationCards(doc.items, resolutions, doc)[0]!;
  if (card.kind !== "configurations" || !card.named) throw new Error("expected a named configuration card");
  function Host() {
    const [drafts, setDrafts] = useState<Record<string, Partial<DrawingObservation>>>({});
    return (
      <ConfigurationCard
        card={card as Card}
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
  return { spies, doc };
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.querySelector(".font-mono")?.textContent);

describe("a card whose document names its configurations", () => {
  it("is one card with a tab per configuration, named as the document names them", () => {
    renderNamed();
    // In the order a person counts, not the order the page mentioned them.
    expect(tabNames()).toEqual(["TYPE 1", "TYPE 2", "TYPE 3", "TYPE 4", "TYPE 5"]);
    // Never listed one after another down the page: one tab panel at a time.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("says in words how many records the confirm creates", () => {
    renderNamed();
    expect(screen.getAllByText(/5 configurations × 2 phases — confirming creates 10 records under Q-301/).length).toBeGreaterThan(0);
  });

  it("shows each configuration complete, and only what lands on it", async () => {
    renderNamed();
    // TYPE 1: the geometry ONCE — the drawing states the same figures, so its
    // rows fold into the sheet's — and fabric A from each page. Nothing of Type 2's.
    expect(screen.getAllByDisplayValue("550")).toHaveLength(1);
    expect(screen.getAllByDisplayValue("Maker A, Ref. X")).toHaveLength(1);
    expect(screen.getAllByDisplayValue("Maker A, Ref. X, woven")).toHaveLength(1);
    expect(screen.queryByDisplayValue("Maker B, Ref. Y")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: /TYPE 2/ }));
    // TYPE 2: the sheet's geometry only (the drawing depicts 1 and 5), and its
    // own fabric. The same layout: dimensions, then the fabric.
    expect(screen.getAllByDisplayValue("550")).toHaveLength(1);
    expect(screen.getAllByDisplayValue("Maker B, Ref. Y")).toHaveLength(1);
    expect(screen.queryByDisplayValue("Maker A, Ref. X")).toBeNull();
    const values = screen.getAllByRole("textbox").map((box) => (box as HTMLInputElement).value);
    expect(values.indexOf("550")).toBeLessThan(values.indexOf("Maker B, Ref. Y"));
  });

  it("maps the open tab's inputs one-to-one onto observations", async () => {
    const { doc } = renderNamed();
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 3/ }));
    const sheet = doc.items.find((item) => item.page === 1)!;
    // W, D, H, the Type 3 fabric and the shared timber: five rows, five value boxes, each once.
    for (const value of ["550", "560", "790", "Maker C, Ref. Z", "feet dark tinted wood as per approved sample"]) {
      expect(screen.getAllByDisplayValue(value)).toHaveLength(1);
    }
    expect(sheet.observations.filter((o) => o.configurations === undefined || o.configurations.includes("Type 3"))).toHaveLength(5);
  });

  it("says where else a row lands, and an edit on one tab is the edit on every tab", async () => {
    const { spies, doc } = renderNamed();
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 2/ }));
    // W, D, H and the shared timber.
    expect(screen.getAllByText(/shared by all 5 — one row, written to each/).length).toBe(4);
    expect(screen.getByText(/TYPE 2 only/)).toBeInTheDocument();

    const width = screen.getByDisplayValue("550");
    await userEvent.clear(width);
    await userEvent.type(width, "555");
    await userEvent.tab();
    const saves = spies.of("onSaveObservation");
    expect(saves).toHaveLength(1);
    const [savedItem, savedObservation] = saves[0]!.args as [DrawingItem, DrawingObservation];
    const sheet = doc.items.find((item) => item.page === 1)!;
    expect(savedItem.id).toBe(sheet.id);
    expect(savedObservation.labelRaw).toBe("Width");

    // The SAME observation on TYPE 4: it shows the edit.
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 4/ }));
    expect(screen.getByDisplayValue("555")).toBeInTheDocument();
  });

  it("shows one row per measurement, and says the other page states the same", () => {
    renderNamed();
    expect(screen.getAllByDisplayValue("550")).toHaveLength(1);
    expect(screen.getAllByText(/page 2 states the same/)).toHaveLength(3);
    expect(screen.getByText("W550 x D560 x H790mm")).toBeInTheDocument();
    expect(screen.queryByText(/Two width values/i)).toBeNull();
  });

  it("folds a later page naming the same finish by code, and says so", () => {
    renderNamed();
    expect(screen.getAllByDisplayValue("feet dark tinted wood as per approved sample")).toHaveLength(1);
    expect(screen.queryByDisplayValue("Dark tinted wood")).toBeNull();
    expect(screen.getByText(/Page 2 names the same finish, QW-01 — already recorded from page 1\./)).toBeInTheDocument();
  });

  it("shows a clash it can see BEFORE confirm, on both rows, and holds the confirm until it is decided", () => {
    const doc = namedSheetRun();
    const sheet = doc.items.find((item) => item.page === 1)!;
    const drawing = doc.items.find((item) => item.page === 2)!;
    const fabricA = sheet.observations.find((o) => o.configurations?.includes("Type 1"))!;
    const fabricB = drawing.observations.find((o) => o.materialCodeRaw === "QQ-01.1")!;
    const conflict = (observationId: string, other: string) => ({
      code: "field_conflict",
      observationId,
      pairKey: `${fabricA.id}|${fabricB.id}`,
      message: `Page 1 and page 2 both give COM 1 for TYPE 1 · TYPE 5, in different words — ${other}. Ignore one, or move one to another field.`,
    });
    const resolutions = resolutionsFor(doc, (item) => ({
      blockers:
        item.id === sheet.id
          ? [conflict(fabricA.id, "page 2 says “Maker A, Ref. X, woven”")]
          : [conflict(fabricB.id, "page 1 says “Maker A, Ref. X”")],
    }));
    renderNamed(doc, resolutions);
    expect(screen.getByRole("button", { name: /Confirm Q-301/ })).toBeDisabled();
    expect(screen.getByText(/1 decision left before Q-301 can be confirmed/)).toBeInTheDocument();
    // On BOTH rows, each naming the other page's words.
    expect(screen.getByText(/page 2 says “Maker A, Ref. X, woven”/)).toBeInTheDocument();
    expect(screen.getByText(/page 1 says “Maker A, Ref. X”/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /TYPE 1/ }).textContent).toContain("blocked");
  });

  it("on TYPE 1, names the one configuration a fabric shares", () => {
    renderNamed();
    expect(screen.getAllByText(/shared with TYPE 5 — one row, written to each/).length).toBeGreaterThan(0);
  });

  it("asks which configuration a new name is, and saves the choice on each page that names it", async () => {
    const doc = namedSheetRun();
    const blocked = resolutionsFor(doc, (item) =>
      item.page === 1
        ? {
            blockers: [
              {
                code: "configuration_new",
                recordId: "rec-main",
                label: "TYPE 2",
                existing: ["A"],
                namesRaw: ["MUR 2"],
                collides: false,
                message: "The page says MUR 2 (read as TYPE 2), and this item on MAIN RUN already has A. Pair it with one of them, or create it as a new configuration.",
              } as never,
            ],
          }
        : {},
    );
    for (const [, entry] of blocked) {
      entry.named!.existing = { "rec-main": { A: "variant-a" }, "rec-ve": {} };
    }
    const { spies } = renderNamed(doc, blocked);
    expect(screen.getByRole("tab", { name: /TYPE 2/ }).textContent).toContain("blocked");
    expect(screen.getByRole("button", { name: /Confirm Q-301/ })).toBeDisabled();
    // Both names shown: the page's own words, and what they were read as.
    expect(screen.getByText(/the page says MUR 2 \(read as TYPE 2\)/)).toBeInTheDocument();
    // A MULTI-SELECT of the bill line's live configurations, plus "a new one".
    const choice = screen.getByRole("group", { name: /TYPE 2 — the page says MUR 2 \(read as TYPE 2\) on MAIN RUN is:/ });
    expect(within(choice).getAllByRole("checkbox").map((box) => box.parentElement?.textContent)).toEqual([
      "A",
      "a new configuration",
    ]);
    await userEvent.click(within(choice).getByRole("checkbox", { name: "A" }));
    const sheet = doc.items.find((item) => item.page === 1)!;
    // Saved on every page that names TYPE 2 — here only the sheet.
    const saved = spies.onSaveItem.mock.calls.map((call) => call as unknown as [DrawingItem, Record<string, unknown>]);
    expect(saved.map(([item]) => item.id)).toEqual([sheet.id]);
    expect(saved[0]![1]).toEqual({ configurationPairs: [{ recordId: "rec-main", label: "TYPE 2", pairWith: ["A"] }] });
  });

  it("confirms page by page under one button", async () => {
    const { spies } = renderNamed();
    await userEvent.click(screen.getByRole("button", { name: /Confirm Q-301 \(5 configurations\)/ }));
    const [call] = spies.of("onReviewMany");
    const entries = call!.args[1] as { label: string }[];
    expect(entries.map((entry) => entry.label)).toEqual(["Page 1", "Page 2"]);
  });
});

// ============================================================================
// A REVIEWER'S CORRECTIONS ON THE CARD (brief C1). Each fires the existing
// autosave with the right payload; where the rows then land is the pure
// function's job and is pinned in tests/lib/named-configurations.test.ts.
// ============================================================================
describe("correcting the configurations on the card", () => {
  const MODEL = ["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 3", "TYPE 4"];
  const itemSaves = (spies: ReturnType<typeof renderNamed>["spies"]) =>
    spies.onSaveItem.mock.calls.map((call) => call as unknown as [DrawingItem, Record<string, unknown>]);

  it("ADDS one at the end of the strip, writing the whole list to every page", async () => {
    const { spies, doc } = renderNamed();
    await userEvent.click(screen.getByRole("button", { name: "+ Add configuration" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Configuration name" }), "type 6");
    await userEvent.click(screen.getByRole("button", { name: /^Add/ }));
    const saves = itemSaves(spies);
    expect(saves.map(([item]) => item.id).sort()).toEqual(doc.items.map((item) => item.id).sort());
    expect(saves[0]![1]).toEqual({
      configurationsByReviewer: [...MODEL.map((label) => ({ label, readAs: label })), { label: "TYPE 6", readAs: null }],
    });
  });

  it("refuses a name the database would refuse, in words, before anything is sent", async () => {
    const { spies } = renderNamed();
    await userEvent.click(screen.getByRole("button", { name: "+ Add configuration" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Configuration name" }), "Type 1 & 5 guest");
    expect(screen.getByText(/'TYPE 1 & 5 GUEST' is too long to be a configuration name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Add/ })).toBeDisabled();
    await userEvent.clear(screen.getByRole("textbox", { name: "Configuration name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Configuration name" }), "type 2");
    expect(screen.getByText(/TYPE 2 is already a configuration of this item/)).toBeInTheDocument();
    expect(spies.onSaveItem).not.toHaveBeenCalled();
  });

  it("RENAMES the open tab's configuration, keeping which reading it stands for", async () => {
    const { spies } = renderNamed();
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 5/ }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const box = screen.getByRole("textbox", { name: "New name for TYPE 5" });
    await userEvent.clear(box);
    await userEvent.type(box, "typo 5");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    const list = itemSaves(spies)[0]![1].configurationsByReviewer as { label: string; readAs: string | null }[];
    expect(list[1]).toEqual({ label: "TYPO 5", readAs: "TYPE 5" });
    expect(list.map((entry) => entry.label)).toEqual(["TYPE 1", "TYPO 5", "TYPE 2", "TYPE 3", "TYPE 4"]);
  });

  it("REMOVES one and, in the same act, says where its own rows go", async () => {
    const { spies } = renderNamed();
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 3/ }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/TYPE 3 has 1 row of its own/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Move TYPE 3's rows to" }), "TYPE 4");
    await userEvent.click(screen.getByRole("button", { name: /Remove, and move it there/ }));
    const list = itemSaves(spies)[0]![1].configurationsByReviewer as { label: string }[];
    expect(list.map((entry) => entry.label)).toEqual(["TYPE 1", "TYPE 5", "TYPE 2", "TYPE 4"]);
    // The Type 3 fabric is moved to TYPE 4 on its own observation.
    const rowSaves = spies.of("onSaveObservation");
    expect(rowSaves).toHaveLength(1);
    const [, observation, changes] = rowSaves[0]!.args as [DrawingItem, DrawingObservation, Record<string, unknown>];
    expect(observation.valueRaw).toBe("Maker C, Ref. Z");
    expect(changes).toEqual({ configurations: ["TYPE 4"] });
  });

  it("CHANGES which configurations a row applies to, on the row, including all", async () => {
    const { spies } = renderNamed();
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 2/ }));
    const pickers = screen.getAllByRole("button", { name: "Applies to…" });
    // Dimensions, then the fabric, then the (shared) timber finish.
    await userEvent.click(pickers[pickers.length - 2]!);
    await userEvent.click(screen.getByRole("checkbox", { name: "TYPE 3" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const [, observation, changes] = spies.of("onSaveObservation")[0]!.args as [DrawingItem, DrawingObservation, Record<string, unknown>];
    expect(observation.valueRaw).toBe("Maker B, Ref. Y");
    expect(changes).toEqual({ configurations: ["TYPE 2", "TYPE 3"] });
  });

  it("stores ALL as shared by every configuration", async () => {
    const { spies } = renderNamed();
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 2/ }));
    const pickers = screen.getAllByRole("button", { name: "Applies to…" });
    await userEvent.click(pickers[pickers.length - 2]!);
    await userEvent.click(screen.getByRole("checkbox", { name: "All" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((spies.of("onSaveObservation")[0]!.args as unknown[])[2]).toEqual({ configurations: [] });
  });

  it("says what was read against what the reviewer set, and a removed-only row needs a decision", () => {
    const doc = namedSheetRun();
    const edited: StagedDrawings = {
      ...doc,
      items: doc.items.map((item) => ({
        ...item,
        configurationsByReviewer: [
          { label: "TYPE 1", readAs: "TYPE 1" },
          { label: "TYPE 5", readAs: "TYPE 5" },
          { label: "TYPE 2", readAs: "TYPE 2" },
          { label: "TYPE 4", readAs: "TYPE 4" },
        ],
      })),
    };
    renderNamed(edited, resolutionsFor(edited));
    expect(screen.getByText("Read as 5, you set 4 — removed TYPE 3.")).toBeInTheDocument();
    expect(screen.getByText(/1 row belonged only to a configuration that has been removed/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Maker C, Ref. Z")).toBeInTheDocument();
    expect(tabNames()).toEqual(["TYPE 1", "TYPE 2", "TYPE 4", "TYPE 5"]);
  });
});

describe("the notes every configuration shares", () => {
  const withNotes = () =>
    namedSheetRun([
      { ...SPEC_SHEET, notesRaw: ["PROJECT: Invented hotel", "SUPPLIER: TO BID"] },
      { ...SHOP_DRAWING, notesRaw: ["TITLE: Invented desk chair"] },
    ]);

  it("fold behind one toggle at the end of the tab, after the dimensions and the finishes", async () => {
    renderNamed(withNotes());
    await userEvent.click(screen.getByRole("tab", { name: /TYPE 2/ }));
    expect(screen.queryByDisplayValue("Invented hotel")).toBeNull();
    const toggle = screen.getByRole("button", { name: "2 notes shared by all 5 — show" });
    // After every value box on the tab: dimensions, then fabrics and finishes, then the toggle.
    const boxes = screen.getAllByRole("textbox");
    expect(boxes[boxes.length - 1]!.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(toggle);
    expect(screen.getByDisplayValue("Invented hotel")).toBeInTheDocument();
    expect(screen.getByDisplayValue("TO BID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide the 2 shared notes" })).toBeInTheDocument();
  });

  it("leave a note belonging to fewer than all of them in view", () => {
    renderNamed(withNotes());
    // TYPE 1 is open: the drawing's title note lands on TYPE 1 and TYPE 5 only.
    expect(screen.getByDisplayValue("Invented desk chair")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Invented hotel")).toBeNull();
  });
});
