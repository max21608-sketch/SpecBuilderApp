// The palette on a drawings card, rendered.
//
// ============================================================================
// WHY THIS TIER, FOR THIS
//
// Everything this control decides is a rendering decision: whether the select
// appears at all, whether it sits on an option or on "Other...", whether the
// page's own words survive beside it, and whether a palette with no options
// says so in a sentence instead of offering an empty dropdown. The pure tier
// covers `normalisePaletteValue` and `paletteForField`; nothing between them
// and the screen was visible without a person opening the app — which is the
// gap the drawings-card tests were written to close in the first place.
//
// Every assertion here is a row of brief 2.2's variance table.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import type { Palette } from "@/lib/palettes";
import type { DrawingObservation } from "@/lib/drawing-document";
import type { SpecField } from "@/components/imports/DrawingItemCard";
import { callbacks, callout, item, records, resetIds, resolution } from "./fixtures";

/**
 * BWS's own timber list, shortened. The wording is BWS's shape -- a BW product
 * name, not a designer's description -- because that difference is the whole
 * reason the exact step misses.
 */
const timber: Palette = {
  key: "bws_timber_finish",
  name: "BWS timber finish palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: "Captured from BWS 2026-09-22.",
  syncedAt: "2026-09-22T00:00:00.000Z",
  options: [
    { value: "BW Oak Natural - Open grain 10%", label: "BW Oak Natural - Open grain 10%", sortOrder: 1, isDefault: false, code: null },
    { value: "BW Walnut Dark", label: "BW Walnut Dark", sortOrder: 2, isDefault: false, code: null },
  ],
};

/** Stud spec: BWS prints its own code inside the label and the label keeps it. */
const stud: Palette = {
  key: "bws_stud",
  name: "BWS stud palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: "Captured from BWS 2026-09-22.",
  syncedAt: "2026-09-22T00:00:00.000Z",
  options: [
    {
      value: "Standard - French Natural | BWE Code: U1660-6031",
      label: "Standard - French Natural | BWE Code: U1660-6031",
      sortOrder: 1,
      isDefault: false,
      code: "U1660-6031",
    },
  ],
};

/** A gate row pointing at a list nobody has read yet. Nothing is unheld today. */
const unheld: Palette = {
  key: "bws_glass_mirror",
  name: "BWS glass and mirror palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: "NOT HELD.",
  syncedAt: null,
  options: [],
};

const fields = (over: Partial<Record<"timber" | "com1" | "stud", Palette | null>> = {}): SpecField[] => [
  { id: "field-com1", json_id: 21, name: "COM 1", field_category: "Upholstery", palette: over.com1 ?? null },
  { id: "field-timber", json_id: 7, name: "Main timber finish", field_category: "Timber", palette: over.timber ?? timber },
  { id: "field-stud", json_id: 16, name: "Stud spec", field_category: "Upholstery", palette: over.stud ?? stud },
];

function renderCard(observations: DrawingObservation[], specFields: SpecField[] = fields()) {
  const spies = callbacks();
  render(
    <ItemCard
      item={item({ observations })}
      importId="import-1"
      resolution={resolution()}
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

/** The table row whose value box holds this text. */
function rowFor(value: string): HTMLElement {
  const found = screen.getAllByRole("row").find((row) => within(row).queryByDisplayValue(value) !== null);
  if (!found) throw new Error(`No row holds the value ${value}`);
  return found;
}

/**
 * The palette select on a row.
 *
 * Found by its own "keep the drawing's own words" option, NOT by the word
 * "Other" -- the group select two columns left offers an "Other" group, and
 * matching on that found it every time and made every assertion below pass or
 * fail against the wrong control.
 */
function paletteSelect(row: HTMLElement): HTMLSelectElement {
  const select = within(row)
    .getAllByRole("combobox")
    .find((box) => within(box).queryByText(/keep the drawing/) !== null);
  if (!select) throw new Error("That row offers no palette select");
  return select as HTMLSelectElement;
}

function timberCallout(value: string | null): DrawingObservation {
  resetIds();
  return callout("SOFA FEET", value, "WD-05", { specFieldId: "field-timber" });
}

describe("a callout on a palette-backed BWS field", () => {
  it("names the palette as the BW standard, offers its options and TBC, and keeps the drawing's words", () => {
    // The real pack says this forty times over. It is not on BWS's list and
    // never will be: the drawing states the designer's intent and the palette
    // is BW's manufacturing range.
    renderCard([timberCallout("Dark tinted wood")]);
    const row = rowFor("Dark tinted wood");

    expect(within(row).getByText(/BW standard — BWS timber finish palette/)).toBeInTheDocument();
    const select = paletteSelect(row);
    expect(within(select).getByText("BW Oak Natural - Open grain 10%")).toBeInTheDocument();
    expect(within(select).getByText("BW Walnut Dark")).toBeInTheDocument();
    expect(within(select).getByText(/TBC — BW to propose one/)).toBeInTheDocument();
    // FREE TEXT IS THE DEFAULT AND IT IS STILL THERE.
    expect(within(row).getByDisplayValue("Dark tinted wood")).toBeInTheDocument();
  });

  it("says in one quiet line that the value is not on the list, and blocks nothing", () => {
    renderCard([timberCallout("Dark tinted wood")]);
    const row = rowFor("Dark tinted wood");
    const note = within(row).getByText(/Not one of the BWS timber finish palette options/);
    expect(note).toHaveTextContent("Kept as written.");
    // NEUTRAL, NOT AMBER. Every real callout is off-palette, and amber on all
    // of them teaches a reviewer to ignore amber.
    expect(note.className).toContain("text-neutral-500");
    expect(note.className).not.toContain("amber");
    // Nothing about it stops the card committing.
    expect(screen.getByRole("button", { name: /^Confirm/ })).toBeEnabled();
  });

  it("sits on Other... while no BW standard is set", () => {
    renderCard([timberCallout("Dark tinted wood")]);
    expect(paletteSelect(rowFor("Dark tinted wood")).value).toBe("__other__");
  });

  it("OFFERS the option as a suggestion where the drawing quotes BWS's own wording, and writes nothing unseen", async () => {
    // Expect this almost never to fire on today's data. The exact step is the
    // whole matcher, and an exact hit is still only an offer (0041).
    const spies = renderCard([timberCallout("BW WALNUT DARK")]);
    const row = rowFor("BW WALNUT DARK");
    expect(paletteSelect(row).value).toBe("__other__");
    expect(within(row).getByText("the drawing's own words are this BWS option")).toBeInTheDocument();
    // On the list, so nothing is said about it being off it.
    expect(screen.queryByText(/Not one of the/)).toBeNull();
    expect(spies.of("onSaveObservation")).toHaveLength(0);

    await userEvent.click(within(row).getByRole("button", { name: /Use BW Walnut Dark as the BW standard/ }));
    const saved = spies.of("onSaveObservation");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.args[2]).toEqual({ standard: { state: "proposed", value: "BW Walnut Dark" } });
  });

  it("offers the option where the drawing quotes only BWS's code", () => {
    // The case `spec_palette_options.code` exists for (0035).
    resetIds();
    renderCard([callout("STUDS", "U1660-6031", null, { specFieldId: "field-stud" })]);
    expect(
      within(rowFor("U1660-6031")).getByRole("button", {
        name: /Use Standard - French Natural \| BWE Code: U1660-6031 as the BW standard/,
      }),
    ).toBeInTheDocument();
  });

  it("says nothing at all about a row that states nothing", () => {
    // A TBC callout carries no words to match, so there is no mismatch to
    // report — only the list, in case the reviewer knows the answer.
    renderCard([timberCallout(null)]);
    expect(screen.queryByText(/Not one of the/)).toBeNull();
    expect(screen.getByText(/BWS timber finish palette/)).toBeInTheDocument();
  });
});

describe("picking a BW standard (0041)", () => {
  it("writes the standard through the autosave, and never the value", async () => {
    const spies = renderCard([timberCallout("Dark tinted wood")]);
    await userEvent.selectOptions(paletteSelect(rowFor("Dark tinted wood")), "BW Walnut Dark");

    const saved = spies.of("onSaveObservation");
    expect(saved).toHaveLength(1);
    // THE STANDARD AND NOTHING ELSE. `value` is the client's words, and the
    // pick writing over it was the defect 0041 closed.
    expect(saved[0]?.args[2]).toEqual({ standard: { state: "proposed", value: "BW Walnut Dark" } });
  });

  it("can say BW will propose one", async () => {
    const spies = renderCard([timberCallout("Dark tinted wood")]);
    await userEvent.selectOptions(paletteSelect(rowFor("Dark tinted wood")), "__standard_tbc__");
    expect(spies.of("onSaveObservation")[0]?.args[2]).toEqual({ standard: { state: "tbc" } });
  });

  it("shows the client's words and the standard side by side", () => {
    renderCard([
      timberCallout("feet dark tinted wood as per approved sample"),
    ].map((row) => ({ ...row, standard: { state: "proposed" as const, value: "BW Walnut Dark", optionId: "opt-1" } })));
    const row = rowFor("feet dark tinted wood as per approved sample");
    expect(paletteSelect(row).value).toBe("BW Walnut Dark");
    // Both halves, on one line: what the page said, and BW's answer to it.
    const line = within(row).getByText(/Client:/).closest("p");
    expect(line).toHaveTextContent(
      "Client: feet dark tinted wood as per approved sample · BW standard: BW Walnut Dark (proposed)",
    );
    // The value box is still the client's words, untouched.
    expect(within(row).getByDisplayValue("feet dark tinted wood as per approved sample")).toBeInTheDocument();
    // A row with a standard is not nagged about being off the list.
    expect(screen.queryByText(/Not one of the/)).toBeNull();
  });

  it("clears the standard with Other..., and never destroys the client's words", async () => {
    const spies = renderCard([
      { ...timberCallout("Dark tinted wood"), standard: { state: "proposed", value: "BW Walnut Dark", optionId: "opt-1" } },
    ]);
    const row = rowFor("Dark tinted wood");
    await userEvent.selectOptions(paletteSelect(row), "__other__");
    const saved = spies.of("onSaveObservation");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.args[2]).toEqual({ standard: null });
    // Nothing about the value was sent, and the box still holds it.
    expect(Object.keys(saved[0]?.args[2] as object)).not.toContain("value");
    expect(within(row).getByDisplayValue("Dark tinted wood")).toBeInTheDocument();
  });
});

describe("a palette this app does not hold", () => {
  it("says so in a sentence and offers no dropdown", () => {
    // Nothing is unheld since the 2026-09-22 capture. The branch stays live
    // for the next gate row pointing at a list nobody has read, and an empty
    // select reads as broken and gets typed around.
    renderCard([timberCallout("Dark tinted wood")], fields({ timber: unheld }));
    const row = rowFor("Dark tinted wood");
    expect(within(row).getByText(/BWS glass and mirror palette/)).toHaveTextContent(
      "BWS owns this list and it is not loaded here, so this stays free text.",
    );
    expect(() => paletteSelect(row)).toThrow(/offers no palette select/);
    expect(within(row).getByDisplayValue("Dark tinted wood")).toBeInTheDocument();
  });
});

describe("a row with no palette behind it", () => {
  it("renders exactly as it did before — COM is free text in BWS", () => {
    resetIds();
    renderCard([callout("SOFA", "Woven raffia", "UPH-07", { specFieldId: "field-com1" })]);
    const row = rowFor("Woven raffia");
    expect(() => paletteSelect(row)).toThrow(/offers no palette select/);
    expect(screen.queryByText(/Not one of the/)).toBeNull();
  });

  it("renders exactly as it did before when the row has no BWS field at all", () => {
    resetIds();
    renderCard([callout("ARM HEIGHT", "520", null)]);
    expect(() => paletteSelect(rowFor("520"))).toThrow(/offers no palette select/);
  });

  it("renders exactly as it did before when the register could not be read", () => {
    // `upgradeCalloutGuesses`' rule: a caller with no register to hand degrades
    // honestly rather than disagreeing with the confirm.
    renderCard([timberCallout("Dark tinted wood")], [
      { id: "field-timber", json_id: 7, name: "Main timber finish", field_category: "Timber" },
    ]);
    expect(() => paletteSelect(rowFor("Dark tinted wood"))).toThrow(/offers no palette select/);
  });
});
