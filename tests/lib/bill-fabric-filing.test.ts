// What a bill's fabric lines do to the finishes library — the decision, the
// swatch rule, and the review's one line per fabric row (2026-10-05).
//
// Pure tier. Every code is invented (`ZZ-`), every wording synthetic; the
// shapes are a pricing document's: a fabric line under its item, naming it in
// brackets, with a picture anchored on the row.
import { describe, expect, it } from "vitest";
import {
  billFinishPlanInputs,
  decideFabricFiling,
  fabricLineValue,
  fabricLineWrite,
  fabricMaterialCode,
  finishLineStatement,
  planBillFabrics,
  planBillFinishWrites,
  planFinishSwatches,
  swatchDifferNotice,
  wordsDescribeAFinish,
  type SwatchCandidate,
} from "@/lib/bill-fabric-filing";
import type { BillRowImage } from "@/lib/bill-row-image";
import type { Finish } from "@/lib/finishes";
import { planSheetDescriptions } from "@/lib/bill-description";

const finish = (over: Partial<Finish> = {}): Finish => ({
  id: "fin-1",
  code: "ZZ-FAB-13",
  codeNorm: "ZZ-FAB-13",
  codeOrigin: "client",
  kind: null,
  description: null,
  supplierRaw: null,
  reference: null,
  colour: null,
  state: "tbc",
  ...over,
});

const picture = (pathname: string | null, pictures = 1): BillRowImage => ({
  pathname,
  contentType: "image/png",
  size: 10,
  width: 4,
  height: 3,
  pictures,
});

describe("decideFabricFiling", () => {
  const base = { says: "Example velvet, ivory", words: "Example velvet, ivory", parentName: "Stool" };

  it("files a coded line exactly as before: new, matched, conflict", () => {
    expect(decideFabricFiling({ ...base, materialCode: "ZZ-FAB-13", library: [] })).toEqual({
      outcome: "new",
      code: "ZZ-FAB-13",
      describe: true,
    });
    const held = finish({ description: "Example velvet, ivory" });
    expect(decideFabricFiling({ ...base, materialCode: "zz-fab-13", library: [held] })).toMatchObject({
      outcome: "matched",
      finish: { id: "fin-1" },
    });
    const other = finish({ description: "Something else entirely" });
    expect(decideFabricFiling({ ...base, materialCode: "ZZ-FAB-13", library: [other] })).toMatchObject({
      outcome: "conflict",
    });
  });

  it("mints for an uncoded line with real words, and links one worded exactly like an in-house finish", () => {
    expect(decideFabricFiling({ ...base, materialCode: null, library: [] })).toEqual({ outcome: "mint" });
    const ours = finish({ id: "fin-9", code: "BW-ZZ-001", codeOrigin: "internal", description: "example VELVET,  ivory" });
    expect(decideFabricFiling({ ...base, materialCode: null, library: [ours] })).toMatchObject({
      outcome: "same_words",
      finish: { id: "fin-9" },
    });
  });

  it("never links an uncoded line to a CLIENT code by its words", () => {
    const theirs = finish({ description: "Example velvet, ivory" });
    expect(decideFabricFiling({ ...base, materialCode: null, library: [theirs] })).toEqual({ outcome: "mint" });
  });

  it("files a placeholder nowhere, and matches it to nothing", () => {
    const placeholder = "Fabric @ Stool (Option 1) Technical details TBC";
    const ours = finish({ codeOrigin: "internal", code: "BW-F-001", description: placeholder });
    expect(
      decideFabricFiling({ materialCode: null, says: placeholder, words: placeholder, parentName: "Stool", library: [ours] }),
    ).toEqual({ outcome: "placeholder" });
  });

  it("reads a line with no description of its own — only a bracket — as a placeholder, not as words", () => {
    expect(
      decideFabricFiling({ materialCode: null, says: "(ZZ-FUR-10)", words: "", parentName: "Stool", library: [] }),
    ).toEqual({ outcome: "placeholder" });
  });
});

describe("the fabric's own code when the bill writes its item's code after it", () => {
  const under = (code: string) => ({ code, itemDescription: "x", rowKind: "finish_for" as const, finishFor: { row: 4, code: "ZZ-FUR-04" } });
  it("takes the item's code off the end, bracketed or not", () => {
    expect(fabricMaterialCode(under("ZZ-FAB-13 (ZZ-FUR-04)"))).toBe("ZZ-FAB-13");
    expect(fabricMaterialCode(under("ZZ-FAB-13 ZZ-FUR-04"))).toBe("ZZ-FAB-13");
    expect(fabricMaterialCode(under("ZZ-FAB-13  zz-fur-04"))).toBe("ZZ-FAB-13");
  });
  it("leaves a second word that is not the item's own code alone", () => {
    expect(fabricMaterialCode(under("ZZ-FAB-13 ZZ-FUR-05"))).toBe("ZZ-FAB-13 ZZ-FUR-05");
    expect(fabricMaterialCode(under("ZZ FAB 13"))).toBe("ZZ FAB 13");
  });
});

describe("a CODED line whose words are only a placeholder", () => {
  // The bill names ZZ-FAB-13 in full under one item and again under another
  // as "Technical Details TBC": the same fabric, not repeated. Found on the
  // local walk of a real bill, 2026-10-05 — it read as a conflict.
  const words = "Fabric @ Desk Chair Technical Details TBC";
  const line = { says: words, words, parentName: "Desk Chair" };

  it("links to the code the library already describes, rather than conflicting with it", () => {
    const held = finish({ description: "Collection: Example plain, colour 0085" });
    expect(decideFabricFiling({ ...line, materialCode: "ZZ-FAB-13", library: [held] })).toMatchObject({
      outcome: "matched",
      finish: { id: "fin-1" },
    });
  });

  it("creates a new code with NO description, so the placeholder never becomes what the code is", () => {
    expect(decideFabricFiling({ ...line, materialCode: "ZZ-FAB-13", library: [] })).toEqual({
      outcome: "new",
      code: "ZZ-FAB-13",
      describe: false,
    });
  });

  it("still conflicts where the words are real and differ", () => {
    const held = finish({ description: "Collection: Example plain, colour 0085" });
    const real = "Fabric @ Desk Chair Collection: Another weave, colour 12";
    expect(
      decideFabricFiling({ says: real, words: real, parentName: "Desk Chair", materialCode: "ZZ-FAB-13", library: [held] }),
    ).toMatchObject({ outcome: "conflict" });
  });
});

describe("fabricMaterialCode", () => {
  it("is the fabric's own code, and none where the line carries only its item's", () => {
    expect(fabricMaterialCode({ code: "ZZ-FAB-13 (ZZ-FUR-10)", itemDescription: "", finishFor: { row: 3, code: "ZZ-FUR-10" } })).toBe(
      "ZZ-FAB-13",
    );
    expect(fabricMaterialCode({ code: "(ZZ-FUR-10)", itemDescription: "", finishFor: { row: 3, code: "ZZ-FUR-10" } })).toBeNull();
    expect(fabricMaterialCode({ code: "ZZ-FUR-10", itemDescription: "", finishFor: { row: 3, code: "ZZ-FUR-10" } })).toBeNull();
  });
});

describe("planFinishSwatches", () => {
  const at = (rowNo: number, image: BillRowImage | null): SwatchCandidate => ({ sheetName: "Bill", rowNo, image });

  it("takes the one picture every pictured line of a code agrees on", () => {
    const decisions = planFinishSwatches(
      new Map([["f", [at(3, picture("p/a.png")), at(5, null), at(7, picture("p/a.png"))]]]),
      new Set(),
    );
    expect(decisions.get("f")).toMatchObject({ take: { rowNo: 3, image: { pathname: "p/a.png" } } });
  });

  it("takes none where two lines of a code carry different pictures, and names the rows", () => {
    const decisions = planFinishSwatches(
      new Map([["f", [at(10, picture("p/a.png")), at(13, picture("p/b.png"))]]]),
      new Set(),
    );
    expect(decisions.get("f")).toEqual({ none: "differ", rows: [10, 13] });
    expect(swatchDifferNotice("ZZ-FAB-13", [10, 13])).toBe(
      "ZZ-FAB-13: rows 10 and 13 carry different pictures — no swatch taken",
    );
  });

  it("never replaces a swatch the library already has", () => {
    const decisions = planFinishSwatches(new Map([["f", [at(3, picture("p/a.png"))]]]), new Set(["f"]));
    expect(decisions.get("f")).toEqual({ none: "held" });
  });

  it("takes nothing from a row with two pictures, and lets another row give one", () => {
    expect(planFinishSwatches(new Map([["f", [at(3, picture(null, 2))]]]), new Set()).get("f")).toEqual({
      none: "no_picture",
    });
    expect(
      planFinishSwatches(new Map([["f", [at(3, picture(null, 2)), at(5, picture("p/a.png"))]]]), new Set()).get("f"),
    ).toMatchObject({ take: { rowNo: 5 } });
  });
});

describe("planBillFabrics — the review's line per fabric row", () => {
  type Line = Parameters<typeof planBillFabrics>[0]["sheets"][number]["lines"][number];
  const item = (index: number, lineNo: number, code: string, name: string): Line => ({
    index,
    lineNo,
    code,
    itemDescription: name,
    ignored: false,
    rowKind: "item",
  });
  const fabric = (index: number, lineNo: number, code: string | null, words: string, parentRow: number, parentCode: string): Line => ({
    index,
    lineNo,
    code,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: parentRow, code: parentCode },
  });
  const sheet = (lines: Line[]) => ({ sheetName: "Bill", ignored: false, lines });
  const images = (byRow: Record<number, BillRowImage>) => ({
    Bill: Object.fromEntries(Object.entries(byRow).map(([row, image]) => [row, image])),
  });
  const plan = (
    lines: Line[],
    over: Partial<Parameters<typeof planBillFabrics>[0]> = {},
  ) =>
    planBillFabrics({
      sheets: [sheet(lines)],
      rowImages: null,
      library: [],
      heldSwatches: new Set(),
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: () => [],
      ...over,
    });

  it("says a new library entry, the same code on a later line, and the swatch both rows share", () => {
    const out = plan(
      [
        item(0, 2, "ZZ-FUR-10", "Stool"),
        fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet, ivory", 2, "ZZ-FUR-10"),
        item(2, 4, "ZZ-FUR-26", "Drawers"),
        fabric(3, 5, "ZZ-FAB-13 (ZZ-FUR-26)", "Example velvet, ivory", 4, "ZZ-FUR-26"),
      ],
      { rowImages: images({ 3: picture("p/a.png"), 5: picture("p/a.png") }) },
    );
    expect(out.get("0:1")).toEqual({
      goesTo: "→ Fabric 1",
      filing: "new library entry ZZ-FAB-13",
      swatch: "swatch: this row's picture",
      askForShortCode: false,
      tbc: false,
    });
    expect(out.get("0:3")?.filing).toBe("new library entry ZZ-FAB-13, with row 3");
    expect(out.get("0:3")?.swatch).toBe("swatch: this row's picture");
  });

  it("says a library match, and that the library's swatch stays", () => {
    const held = finish({ id: "fin-7", code: "ZZ-FAB-13", description: "Example velvet, ivory" });
    const out = plan(
      [item(0, 2, "ZZ-FUR-10", "Stool"), fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet, ivory", 2, "ZZ-FUR-10")],
      { library: [held], heldSwatches: new Set(["fin-7"]), rowImages: images({ 3: picture("p/a.png") }) },
    );
    expect(out.get("0:1")).toEqual({
      goesTo: "→ Fabric 1",
      filing: "matches ZZ-FAB-13 in the library",
      swatch: "swatch: none (the library already has one)",
      askForShortCode: false,
      tbc: false,
    });
  });

  it("names the rows whose pictures differ", () => {
    const out = plan(
      [
        item(0, 9, "ZZ-FUR-04", "Armchair"),
        fabric(1, 10, "ZZ-FAB-14 (ZZ-FUR-04)", "Example linen", 9, "ZZ-FUR-04"),
        item(2, 12, "ZZ-FUR-05", "Side chair"),
        fabric(3, 13, "ZZ-FAB-14 (ZZ-FUR-05)", "Example linen", 12, "ZZ-FUR-05"),
      ],
      { rowImages: images({ 10: picture("p/a.png"), 13: picture("p/b.png") }) },
    );
    expect(out.get("0:1")?.swatch).toBe("swatch: none — rows 10 and 13 differ");
    expect(out.get("0:3")?.swatch).toBe("swatch: none — rows 10 and 13 differ");
  });

  it("says an in-house fabric is numbered in the project's series, and the same words share it", () => {
    const words = "Fabric @ Sofa Collection: Example boucle, Colour: Ivory";
    const out = plan(
      [
        item(0, 2, "ZZ-FUR-06", "Sofa"),
        fabric(1, 3, "(ZZ-FUR-06)", words, 2, "ZZ-FUR-06"),
        item(2, 4, "ZZ-FUR-07", "Sofa"),
        fabric(3, 5, "(ZZ-FUR-07)", words, 4, "ZZ-FUR-07"),
      ],
      { rowImages: images({ 3: picture("p/c.png") }) },
    );
    expect(out.get("0:1")).toEqual({
      goesTo: "→ Fabric 1",
      filing: "new in-house fabric — numbered BW-ZZA-… at confirm",
      swatch: "swatch: this row's picture",
      askForShortCode: false,
      tbc: false,
    });
    expect(out.get("0:3")).toEqual({
      goesTo: "→ Fabric 1",
      filing: "same words as row 3 — one in-house code",
      swatch: "swatch: row 3's picture",
      askForShortCode: false,
      tbc: false,
    });
  });

  it("asks for a short code where the project has none", () => {
    const out = plan(
      [item(0, 2, "ZZ-FUR-06", "Sofa"), fabric(1, 3, "(ZZ-FUR-06)", "Example boucle, ivory", 2, "ZZ-FUR-06")],
      { prefix: null },
    );
    expect(out.get("0:1")).toEqual({
      goesTo: "→ Fabric 1",
      filing: "new in-house fabric — numbered BW-F-… at confirm",
      swatch: "swatch: none in the bill",
      askForShortCode: true,
      tbc: false,
    });
  });

  it("says an existing in-house fabric with the same words is matched", () => {
    const ours = finish({ id: "fin-3", code: "BW-ZZA-003", codeOrigin: "internal", description: "Example boucle, ivory" });
    const out = plan(
      [item(0, 2, "ZZ-FUR-06", "Sofa"), fabric(1, 3, "(ZZ-FUR-06)", "Example boucle, ivory", 2, "ZZ-FUR-06")],
      { library: [ours] },
    );
    expect(out.get("0:1")?.filing).toBe("matches BW-ZZA-003 (same words)");
  });

  it("says a placeholder is not filed, and offers no swatch for it", () => {
    const out = plan(
      [
        item(0, 2, "ZZ-FUR-08", "Ottoman"),
        fabric(1, 3, "(ZZ-FUR-08)", "Fabric @ Ottoman (Option 1) Technical details TBC", 2, "ZZ-FUR-08"),
      ],
      { rowImages: images({ 3: picture("p/e.png") }) },
    );
    expect(out.get("0:1")).toEqual({
      goesTo: "→ Fabric 1",
      filing: "placeholder — not filed",
      swatch: null,
      askForShortCode: false,
      tbc: true,
    });
  });

  it("sees a code the item's own DESCRIPTION files first, in the confirm's order", () => {
    const out = plan(
      [item(0, 2, "ZZ-FUR-10", "Stool"), fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet", 2, "ZZ-FUR-10")],
      { descriptionCodes: (_sheet, line) => (line === 0 ? [{ code: "ZZ-FAB-13", words: "Example velvet" }] : []) },
    );
    expect(out.get("0:1")?.filing).toBe("new library entry ZZ-FAB-13, with row 2");
  });

  it("says a carried record already holding the fabric files nothing", () => {
    const carried: Line = { ...item(0, 2, "ZZ-FUR-10", "Stool"), replaces: { recordId: "rec-1", recordVersion: 3 } };
    const out = plan([carried, fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet", 2, "ZZ-FUR-10")], {
      heldFabric: (recordId) => (recordId === "rec-1" ? ["Example velvet"] : []),
    });
    expect(out.get("0:1")?.filing).toBe("already on the record from the bill — nothing filed");
  });
});

describe("the review's swatch sentence reads the row's EFFECTIVE picture", () => {
  type Line = Parameters<typeof planBillFabrics>[0]["sheets"][number]["lines"][number];
  const item = (index: number, lineNo: number, code: string, words: string): Line => ({
    index,
    lineNo,
    code,
    itemDescription: words,
    ignored: false,
    rowKind: "item",
  });
  const fabric = (index: number, lineNo: number, code: string, words: string, parentRow: number, parentCode: string, over: Partial<Line> = {}): Line => ({
    index,
    lineNo,
    code,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: parentRow, code: parentCode },
    ...over,
  });
  const crop = { pathname: "p/crop-3.png", contentType: "image/png", size: 5, width: 2, height: 2 };
  const plan = (lines: Line[]) =>
    planBillFabrics({
      sheets: [{ sheetName: "Bill", ignored: false, lines }],
      rowImages: { Bill: { "3": picture("p/a.png"), "5": picture("p/a.png") } },
      library: [],
      heldSwatches: new Set(),
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: () => [],
    });

  it("says a crop is the swatch, and that one cropped line now differs from its uncropped twin", () => {
    const out = plan([
      item(0, 2, "ZZ-FUR-10", "Stool"),
      fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet", 2, "ZZ-FUR-10", { picture: crop }),
      item(2, 4, "ZZ-FUR-26", "Drawers"),
      fabric(3, 5, "ZZ-FAB-13 (ZZ-FUR-26)", "Example velvet", 4, "ZZ-FUR-26"),
    ]);
    expect(out.get("0:1")?.swatch).toBe("swatch: none — rows 3 and 5 differ");
    expect(out.get("0:3")?.swatch).toBe("swatch: none — rows 3 and 5 differ");
  });

  it("takes a crop as the swatch where it is the code's only picture", () => {
    const out = plan([
      item(0, 2, "ZZ-FUR-10", "Stool"),
      fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet", 2, "ZZ-FUR-10", { picture: crop }),
      item(2, 4, "ZZ-FUR-26", "Drawers"),
      fabric(3, 5, "ZZ-FAB-13 (ZZ-FUR-26)", "Example velvet", 4, "ZZ-FUR-26", { picture: { none: true } }),
    ]);
    expect(out.get("0:1")?.swatch).toBe("swatch: this row's crop");
    expect(out.get("0:3")?.swatch).toBe("swatch: row 3's picture");
  });

  it("says no picture was chosen where every line of the code refused one", () => {
    const out = plan([
      item(0, 2, "ZZ-FUR-10", "Stool"),
      fabric(1, 3, "ZZ-FAB-13 (ZZ-FUR-10)", "Example velvet", 2, "ZZ-FUR-10", { picture: { none: true } }),
    ]);
    expect(out.get("0:1")?.swatch).toBe("swatch: none — no picture chosen for this row");
  });
});

// Max, 2026-10-13: a placeholder fabric line is TBC, and a line with no words
// of its own has no value — never its code cell.
describe("fabricLineWrite — what the confirm stores and the review predicts", () => {
  const line = (code: string | null, itemDescription: string) => ({
    code,
    itemDescription,
    rowKind: "finish_for" as const,
    finishFor: { row: 2, code: "ZZ-FUR-22" },
  });

  it("writes a placeholder TBC, keeping its words", () => {
    expect(fabricLineWrite(line("N/A", "Fabric @ Armchair (Option 1)"), "Armchair (Option 1)")).toEqual({
      value: "Fabric @ Armchair (Option 1)",
      state: "tbc",
    });
    // Its finish label is read off (R8, 2026-11-20): the label is not the finish.
    expect(fabricLineWrite(line(null, "Fabric: N/A"), "Armchair")).toEqual({ value: "N/A", state: "tbc" });
    expect(fabricLineWrite(line(null, "N/A"), "Armchair")).toEqual({ value: "N/A", state: "tbc" });
  });

  it("never writes the code cell as the words: no words is a TBC with no value", () => {
    expect(fabricLineWrite(line("ZZ-FAB-13 (ZZ-FUR-22)", ""), "Armchair")).toEqual({ value: null, state: "tbc" });
    expect(fabricLineWrite(line("ZZ-FUR-22", "  "), "Armchair")).toEqual({ value: null, state: "tbc" });
    expect(fabricLineValue(line("N/A", ""))).toBe("");
  });

  it("leaves a described fabric confirmed, and a TBC phrase TBC, as before", () => {
    expect(fabricLineWrite(line("ZZ-FAB-13", "Fabric @ Armchair Collection: Example velvet, Colour: Ivory"), "Armchair")).toEqual({
      value: "Fabric @ Armchair Collection: Example velvet, Colour: Ivory",
      state: "confirmed",
    });
    expect(fabricLineWrite(line("ZZ-FAB-13", "Example velvet — colour TBC"), "Armchair").state).toBe("tbc");
  });
});

// ---- a line that names its finish by a schedule code (2026-10-15) -----------------
//
// The shape is the Ronnie Scott's procurement schedule's (LBPCo): each COM line
// carries its own FF&E code (a POSITION code two cloths may share), a COM CODE
// the COM list describes the cloth under, a description that says where the
// cloth goes, and the cloth itself in the Finish column. Codes and words are
// invented.
describe("a finish line filed by its schedule code (the bill's COM CODE column)", () => {
  type Line = Parameters<typeof planBillFabrics>[0]["sheets"][number]["lines"][number];
  const item = (index: number, lineNo: number, code: string, name: string): Line => ({
    index,
    lineNo,
    code,
    itemDescription: name,
    ignored: false,
    rowKind: "item",
    finishCode: null,
  });
  const com = (
    index: number,
    lineNo: number,
    own: string,
    comCode: string | null,
    words: string,
    cloth: string | null,
    parentRow: number,
    parentCode: string,
  ): Line => ({
    index,
    lineNo,
    code: own,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: parentRow, code: parentCode },
    finishCode: comCode,
    finishRaw: cloth,
  });
  const cloth = "NAME: EXAMPLE VELVET\nCODE: 1234.56\nCOLOUR: IVORY";

  it("files under the COM code, writes the Finish column's cloth on one line, and keeps the placement as the qualifier", () => {
    const line = com(1, 3, "ZB-CH-01A", "ZB_01", "POUFFE DEPTH FABRIC", cloth, 2, "ZC-01");
    expect(fabricMaterialCode(line)).toBe("ZB_01");
    expect(fabricLineWrite(line, "POUFEE")).toEqual({
      value: "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY",
      state: "confirmed",
      qualifier: "POUFFE DEPTH",
    });
    expect(fabricLineWrite(com(1, 3, "ZB-CH-02B", "ZB_09", "ARMCHAIR MAIN BODY FABRIC", cloth, 2, "ZC-02"), "ARMCHAIR").qualifier).toBe(
      "ARMCHAIR MAIN BODY",
    );
  });

  it("gives no qualifier where the description is a placeholder or a bare code", () => {
    expect(fabricLineWrite(com(1, 3, "ZB-SO-01", "ZB_16", "SOFA @ FABRIC", cloth, 2, "ZS-01"), "SOFA")).not.toHaveProperty(
      "qualifier",
    );
    expect(fabricLineWrite(com(1, 3, "ZT-CH-01B", "ZT_01", "ZT-CH-01", cloth, 2, "ZC-01"), "POUFEE")).not.toHaveProperty("qualifier");
    expect(fabricLineWrite(com(1, 3, "ZB-CH-07", "ZB_14", "TBC", cloth, 2, "ZC-07"), "POUFFE")).not.toHaveProperty("qualifier");
    // The item's name with more said is a placement.
    expect(fabricLineWrite(com(1, 3, "ZB-TB-01", "ZB_12", "TABLE SKIRT @ LEATHER", cloth, 2, "ZT-15"), "TABLE").qualifier).toBe(
      "TABLE SKIRT",
    );
  });

  it("keeps the description where the Finish cell is blank, and files by the line's own code where the COM cell is blank or N/A", () => {
    expect(fabricLineWrite(com(1, 3, "ZB-CH-01A", "ZB_01", "POUFFE DEPTH FABRIC", null, 2, "ZC-01"), "POUFEE")).toEqual({
      value: "POUFFE DEPTH FABRIC",
      state: "confirmed",
    });
    const blank = com(1, 3, "ZB-CH-01A", "N/A", "POUFFE DEPTH FABRIC", cloth, 2, "ZC-01");
    expect(fabricMaterialCode(blank)).toBe("ZB-CH-01A");
    expect(fabricLineValue(blank)).toBe("POUFFE DEPTH FABRIC");
  });

  it("links by the code whatever the bill's copy of the cloth says, and creates a new code with NO description", () => {
    const says = "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY";
    const listed = finish({ code: "ZB_04", codeNorm: "ZB_04", description: "EXAMPLE VELVET; Colour: IVORY" });
    const input = { materialCode: "ZB_04", says, words: "ARMCHAIR @ FABRIC", parentName: "ARMCHAIR" };
    expect(decideFabricFiling({ ...input, library: [listed], byScheduleCode: true })).toMatchObject({
      outcome: "matched",
      finish: { id: "fin-1" },
    });
    expect(decideFabricFiling({ ...input, library: [], byScheduleCode: true })).toEqual({
      outcome: "new",
      code: "ZB_04",
      describe: false,
    });
    // Without the column, the same words against the same row are the CONFLICT rule, unchanged.
    expect(decideFabricFiling({ ...input, words: says, library: [listed] })).toMatchObject({ outcome: "conflict" });
  });

  it("puts three items quoting one COM code on ONE library entry, and says what each line writes", () => {
    const out = planBillFabrics({
      sheets: [
        {
          sheetName: "UPHOLSTERED",
          ignored: false,
          columns: { finishCode: { heading: "COM CODE" } },
          lines: [
            item(0, 2, "ZC-01", "POUFEE"),
            com(1, 3, "ZB-CH-01C.A", "ZB_04", "POUFFE DEPTH FABRIC", cloth, 2, "ZC-01"),
            item(2, 4, "ZC-03", "ARMCHAIR"),
            com(3, 5, "ZB-CH-03", "ZB_04", "ARMCHAIR @ FABRIC", cloth, 4, "ZC-03"),
            item(4, 6, "ZS-03", "BENCH"),
            com(5, 7, "ZB-SO-03", "ZB_04", "BENCH @ FABRIC", cloth, 6, "ZS-03"),
          ],
        },
      ],
      rowImages: null,
      library: [],
      heldSwatches: new Set(),
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: () => [],
    });
    expect(out.get("0:1")).toMatchObject({
      goesTo: "→ Fabric 1",
      filing: "new library entry ZB_04, by its COM CODE — described when the finishes schedule is read",
      writes: { value: "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY", qualifier: "POUFFE DEPTH" },
      tbc: false,
    });
    expect(out.get("0:3")?.filing).toBe("new library entry ZB_04, with row 3, by its COM CODE");
    expect(out.get("0:5")?.filing).toBe("new library entry ZB_04, with row 3, by its COM CODE");
    expect(out.get("0:5")?.writes).toEqual({ value: "NAME: EXAMPLE VELVET CODE: 1234.56 COLOUR: IVORY", qualifier: null });
  });
});

// ---- audit 2026-11-06, item 1.5 (C5): ONE planner for what each finish line
// writes, where, and what refuses — read by the review's line and executed by
// the confirm. The confirm used to re-read what a record held for every line,
// rows it had written moments before included, so a second fabric under one
// carried item found the first "held" and refused the whole bill, while the
// review said "→ Fabric 2".
describe("planBillFinishWrites — the one plan the review and the confirm share", () => {
  type Line = Parameters<typeof planBillFinishWrites>[0]["sheets"][number]["lines"][number];
  const item = (index: number, lineNo: number, code: string, over: Partial<Line> = {}): Line => ({
    index,
    lineNo,
    code,
    itemDescription: "Armchair",
    ignored: false,
    rowKind: "item",
    ...over,
  });
  const finishLine = (index: number, lineNo: number, words: string, parentRow: number, parentCode: string): Line => ({
    index,
    lineNo,
    code: null,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: parentRow, code: parentCode },
  });
  const run = (lines: Line[], over: Partial<Parameters<typeof planBillFinishWrites>[0]> = {}) =>
    planBillFinishWrites({
      sheets: [{ sheetName: "Bill", ignored: false, lines }],
      library: [],
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: () => [],
      ...over,
    });
  const slotsOf = (plan: ReturnType<typeof run>, key: string) =>
    plan.lines.get(key)?.onRows.map((entry) => (entry.held ? "held" : (entry.placement?.jsonId ?? "none")));

  it("gives three fabrics on one item COM 1, 2 and 3, keeps a fourth with no field, and a timber its own", () => {
    const plan = run([
      item(0, 2, "ZZ-CH-01"),
      finishLine(1, 3, "Example velvet, ivory", 2, "ZZ-CH-01"),
      finishLine(2, 4, "Example boucle, sand", 2, "ZZ-CH-01"),
      finishLine(3, 5, "Example linen, grey", 2, "ZZ-CH-01"),
      finishLine(4, 6, "Example mohair, rust", 2, "ZZ-CH-01"),
      finishLine(5, 7, "Solid oak timber, natural", 2, "ZZ-CH-01"),
    ]);
    expect(["0:1", "0:2", "0:3", "0:4", "0:5"].map((key) => slotsOf(plan, key))).toEqual([[1], [2], [14], ["none"], [4]]);
    expect(plan.lines.get("0:4")?.onRows[0]?.placement?.kept).toBe("full");
    expect(plan.refusals).toEqual([]);
  });

  it("writes a revision's second fabric of a kind the item already holds into the next slot, refusing nothing", () => {
    const carried = item(0, 2, "ZZ-CH-01", { replaces: { recordId: "rec-1", recordVersion: 4 } });
    const plan = run(
      [carried, finishLine(1, 3, "Example velvet, ivory", 2, "ZZ-CH-01"), finishLine(2, 4, "Example boucle, sand", 2, "ZZ-CH-01")],
      {
        heldFabric: (recordId, kind) => (recordId === "rec-1" && kind === "fabric" ? ["Example velvet, ivory"] : []),
        // COM 1 is held, by the velvet the first confirm wrote.
        heldSlots: (_sheet, line) => (line === 0 ? [1] : []),
      },
    );
    expect(slotsOf(plan, "0:1")).toEqual(["held"]);
    expect(plan.lines.get("0:1")?.filing).toBeNull();
    expect(slotsOf(plan, "0:2")).toEqual([2]);
    expect(plan.refusals).toEqual([]);
  });

  it("refuses, naming the row and the value, where the revision no longer lists a fabric the item holds", () => {
    const carried = item(0, 2, "ZZ-CH-01", { replaces: { recordId: "rec-1", recordVersion: 4 } });
    const plan = run([carried, finishLine(1, 3, "Example boucle, sand", 2, "ZZ-CH-01")], {
      heldFabric: (recordId, kind) => (recordId === "rec-1" && kind === "fabric" ? ["Example velvet, ivory"] : []),
      heldSlots: (_sheet, line) => (line === 0 ? [1] : []),
    });
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]).toMatchObject({ sheetIndex: 0, row: 2, kind: "fabric", held: "Example velvet, ivory", lineIndex: 1 });
    expect(plan.refusals[0]!.sentence).toContain("Row 2");
    expect(plan.refusals[0]!.sentence).toContain("Example velvet, ivory");
    expect(plan.refusals[0]!.sentence).toContain("retire it");
  });

  it("refuses nothing where the revision gives the item no line of that kind at all", () => {
    // A held fabric may have come from the item's own description cell, which
    // a revision does not write again; with no fabric line to compare, the
    // revision says nothing about it.
    const carried = item(0, 2, "ZZ-CH-01", { replaces: { recordId: "rec-1", recordVersion: 4 } });
    const plan = run([carried, finishLine(1, 3, "Solid oak timber, natural", 2, "ZZ-CH-01")], {
      heldFabric: (recordId, kind) => (recordId === "rec-1" && kind === "fabric" ? ["Example velvet, ivory"] : []),
    });
    expect(plan.refusals).toEqual([]);
  });

  it("is what the review describes: the arrow reads the plan's slot", () => {
    const carried = item(0, 2, "ZZ-CH-01", { replaces: { recordId: "rec-1", recordVersion: 4 } });
    const lines = [carried, finishLine(1, 3, "Example velvet, ivory", 2, "ZZ-CH-01"), finishLine(2, 4, "Example boucle, sand", 2, "ZZ-CH-01")];
    const over = {
      heldFabric: (recordId: string) => (recordId === "rec-1" ? ["Example velvet, ivory"] : []),
      heldSlots: (_sheet: number, line: number) => (line === 0 ? [1] : []),
    };
    const review = planBillFabrics({ sheets: [{ sheetName: "Bill", ignored: false, lines }], rowImages: null, library: [], heldSwatches: new Set(), prefix: "ZZA", descriptionCodes: () => [], ...over });
    expect(review.get("0:2")?.goesTo).toBe("→ Fabric 2");
    expect(review.get("0:2")?.refusal).toBeUndefined();
  });

  it("puts a refusal on the review's line, in the confirm's own words", () => {
    const carried = item(0, 2, "ZZ-CH-01", { replaces: { recordId: "rec-1", recordVersion: 4 } });
    const lines = [carried, finishLine(1, 3, "Example boucle, sand", 2, "ZZ-CH-01")];
    const heldFabric = (recordId: string) => (recordId === "rec-1" ? ["Example velvet, ivory"] : []);
    const plan = run(lines, { heldFabric });
    const review = planBillFabrics({ sheets: [{ sheetName: "Bill", ignored: false, lines }], rowImages: null, library: [], heldSwatches: new Set(), prefix: "ZZA", descriptionCodes: () => [], heldFabric, heldSlots: () => [] });
    expect(review.get("0:1")?.refusal).toBe(plan.refusals[0]!.sentence);
  });
});

// R6 (2026-11-20). An invented bill's sofa says `Legs: ZZ-MTL-01 brushed brass`
// in its description, and the line `ZZ-MTL-01 / Finish: Example brass,
// lacquered` under it was set to "Finish for" the sofa. The confirm wrote both:
// Main metal finish from the description and Metal Finish 2 from the line, the
// second linked to nothing. One code on one record is ONE finish.
describe("one code in a description and on a finish line is one finish", () => {
  const FIELDS = [
    { id: "f-com1", jsonId: 1, name: "COM 1" },
    { id: "f-com2", jsonId: 2, name: "COM 2" },
    { id: "f-tim1", jsonId: 4, name: "Main timber finish" },
    { id: "f-tim2", jsonId: 31, name: "Timber Finish 2" },
    { id: "f-mtl1", jsonId: 5, name: "Main metal finish" },
    { id: "f-mtl2", jsonId: 35, name: "Metal Finish 2" },
  ];
  type Line = Parameters<typeof planSheetDescriptions>[0][number] & Parameters<typeof planBillFinishWrites>[0]["sheets"][number]["lines"][number];
  const sofa: Line = {
    index: 0,
    lineNo: 7,
    code: "ZZ-SF-01",
    itemDescription: "Three seat sofa",
    itemDescriptionRaw: "Three seat sofa\nLegs: ZZ-MTL-01 brushed brass\nFrame: ZZ-WD-01\nTop: ZZ-STN-01 honed",
    ignored: false,
    rowKind: "item",
  };
  const line = (index: number, lineNo: number, code: string, words: string): Line => ({
    index,
    lineNo,
    code,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: 7, code: "ZZ-SF-01" },
  });
  const plan = (lines: Line[], library: Finish[] = []) => {
    const descriptions = planSheetDescriptions(lines, FIELDS);
    const finishPlan = planBillFinishWrites({
      sheets: [{ sheetName: "Guest Rooms", ignored: false, lines }],
      library,
      prefix: "ZZA",
      heldFabric: () => [],
      ...billFinishPlanInputs({
        sheets: [{ lines }],
        descriptions: [new Map([...descriptions].map(([index, p]) => [index, { ...p, held: false }]))],
        carriedFieldIds: () => [],
        jsonIdOfField: new Map(FIELDS.map((field) => [field.id, field.jsonId])),
      }),
    });
    return { description: descriptions.get(0)!, finishPlan };
  };

  it("keeps the description's statement as a note and writes the line's finish once, in the first field of its kind", () => {
    const { description, finishPlan } = plan([sofa, line(1, 10, "ZZ-MTL-01", "Finish: Example brass, lacquered")]);
    const legs = description.attributes.find((attribute) => attribute.label === "Legs")!;
    expect(legs).toMatchObject({ attrGroup: "note", specFieldId: null, materialCode: null });
    expect(legs.why).toMatch(/^Row 10 is this item's own finish line for ZZ-MTL-01/);
    const write = finishPlan.lines.get("0:1")!;
    expect(write.kind).toBe("metal");
    expect(write.onRows.map((entry) => entry.placement?.jsonId)).toEqual([5]);
    // Nothing else files the code first, so the line's own words file it — and it is linked.
    expect(write.filing).toMatchObject({ outcome: "new", code: "ZZ-MTL-01" });
    expect(write.finishKey).not.toBeNull();
  });

  it("links the line to the library row that exists", () => {
    const held = finish({ id: "fin-mtl", code: "ZZ-MTL-01", codeNorm: "ZZ-MTL-01", description: null });
    const { finishPlan } = plan([sofa, line(1, 10, "ZZ-MTL-01", "Finish: Example brass, lacquered")], [held]);
    expect(finishPlan.lines.get("0:1")).toMatchObject({ filing: { outcome: "matched" }, finishKey: "fin-mtl" });
  });

  it("holds for a timber and a code no field holds, and leaves a statement with another code alone", () => {
    const { description, finishPlan } = plan([
      sofa,
      line(1, 10, "ZZ-WD-01", "Finish: Example oak, oiled"),
      line(2, 11, "ZZ-STN-01", "Finish: Example stone, honed"),
    ]);
    const byLabel = new Map(description.attributes.map((attribute) => [attribute.label, attribute]));
    expect(byLabel.get("Frame")?.attrGroup).toBe("note");
    expect(byLabel.get("Top")?.attrGroup).toBe("note");
    // The metal the description names and no line carries is written as before.
    expect(byLabel.get("Legs")).toMatchObject({ attrGroup: "finish", specFieldName: "Main metal finish", materialCode: "ZZ-MTL-01" });
    expect(finishPlan.lines.get("0:1")!.onRows.map((entry) => entry.placement?.jsonId)).toEqual([4]);
  });

  it("is not read from a line nobody has made a finish line, or one left out", () => {
    const loose = { ...line(1, 10, "ZZ-MTL-01", "Finish: Example brass"), rowKind: "item" as const, finishFor: null };
    expect(plan([sofa, loose]).description.attributes.find((attribute) => attribute.label === "Legs")?.attrGroup).toBe("finish");
    const ignored = { ...line(1, 10, "ZZ-MTL-01", "Finish: Example brass"), ignored: true };
    expect(plan([sofa, ignored]).description.attributes.find((attribute) => attribute.label === "Legs")?.attrGroup).toBe("finish");
  });
});

// R8 (2026-11-20). After R6 the invented sofa's one metal finish was the line
// `ZZ-MTL-01 / Finish: Example brass, lacquered`, stored with the word
// "Finish:" — in the BWS cell, and a CONFLICT against a library row describing
// the code as "Example brass, lacquered".
describe("a finish line's own label is read off its value", () => {
  type Line = Parameters<typeof planBillFinishWrites>[0]["sheets"][number]["lines"][number];
  const sofa: Line = { index: 0, lineNo: 7, code: "ZZ-SF-01", itemDescription: "Three seat sofa", ignored: false, rowKind: "item" };
  const metal = (words: string): Line => ({
    index: 1,
    lineNo: 10,
    code: "ZZ-MTL-01",
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: 7, code: "ZZ-SF-01" },
  });
  const run = (lines: Line[], over: Partial<Parameters<typeof planBillFinishWrites>[0]> = {}) =>
    planBillFinishWrites({
      sheets: [{ sheetName: "Guest Rooms", ignored: false, lines }],
      library: [],
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: () => [],
      ...over,
    });

  it("reads a leading finish label through the description reader's own split, and nothing else", () => {
    expect(finishLineStatement("Finish: Example brass, lacquered")).toEqual({ label: "Finish", value: "Example brass, lacquered" });
    expect(finishLineStatement("LEATHER: Example hide, tan").value).toBe("Example hide, tan");
    // Not one of the finish words, a label with nothing after it, or no label: unchanged.
    for (const words of ["Fabric @ Stool Collection & Pattern Ref: Example", "Finish:", "Example brass", "Colour: Ivory"]) {
      expect(finishLineStatement(words), words).toEqual({ label: null, value: words });
    }
  });

  it("writes the finish without its label, links it where the library's words agree, and says so on the review", () => {
    const library = [finish({ id: "fin-mtl", code: "ZZ-MTL-01", codeNorm: "ZZ-MTL-01", description: "Example brass, lacquered", state: "confirmed" })];
    const plan = run([sofa, metal("Finish: Example brass, lacquered")], { library });
    const write = plan.lines.get("0:1")!;
    expect(write.written).toEqual({ value: "Example brass, lacquered", state: "confirmed" });
    expect(write).toMatchObject({ kind: "metal", filing: { outcome: "matched" }, finishKey: "fin-mtl" });
    const review = planBillFabrics({
      sheets: [{ sheetName: "Guest Rooms", ignored: false, lines: [sofa, metal("Finish: Example brass, lacquered")] }],
      rowImages: null,
      library,
      heldSwatches: new Set(),
      prefix: "ZZA",
      descriptionCodes: () => [],
      heldFabric: () => [],
      heldSlots: () => [],
    });
    expect(review.get("0:1")?.writes).toEqual({ value: "Example brass, lacquered", qualifier: null });
  });

  it("still reads the line's kind from its label", () => {
    const cloth = { ...metal("Fabric: Example boucle, ivory"), code: null };
    expect(run([sofa, cloth]).lines.get("0:1")).toMatchObject({ kind: "fabric", written: { value: "Example boucle, ivory" } });
  });

  it("does not refuse a revision of a record that holds the line as a confirm before this stored it", () => {
    const carried = { ...sofa, replaces: { recordId: "rec-1", recordVersion: 3 } };
    const plan = run([carried, metal("Finish: Example brass, lacquered")], {
      heldFabric: (recordId, kind) => (recordId === "rec-1" && kind === "metal" ? ["Finish: Example brass, lacquered"] : []),
    });
    expect(plan.refusals).toEqual([]);
    expect(plan.lines.get("0:1")?.onRows.map((entry) => entry.held)).toEqual([true]);
  });
});

// R10 (2026-11-20). A wordless description statement (`Base: ZZ-MTL-01`)
// created the code before the item's own finish line, with words, was walked;
// the row stayed empty. A row THIS confirm creates takes the first real words.
describe("a finish this confirm creates is described by the first real words", () => {
  type Line = Parameters<typeof planBillFinishWrites>[0]["sheets"][number]["lines"][number];
  const table: Line = { index: 0, lineNo: 3, code: "ZZ-ST-01", itemDescription: "Side table", ignored: false, rowKind: "item" };
  const sofa: Line = { index: 1, lineNo: 4, code: "ZZ-SF-01", itemDescription: "Sofa", ignored: false, rowKind: "item" };
  const line = (index: number, code: string, words: string): Line => ({
    index,
    lineNo: index + 3,
    code,
    itemDescription: words,
    ignored: false,
    rowKind: "finish_for",
    finishFor: { row: 4, code: "ZZ-SF-01" },
  });
  const run = (lines: Line[], codes: Record<number, { code: string; words: string | null }[]>, library: Finish[] = []) =>
    planBillFinishWrites({
      sheets: [{ sheetName: "Rooms", ignored: false, lines }],
      library,
      prefix: "ZZA",
      descriptionCodes: (_sheet, index) => codes[index] ?? [],
      heldFabric: () => [],
      heldSlots: () => [],
    });
  const describedAs = (plan: ReturnType<typeof run>, code: string) =>
    [...plan.planned.values()].find((entry) => entry.finish.code === code)?.finish.description ?? null;

  it("gives the row a wordless description statement created the finish line's words, once", () => {
    const plan = run([table, sofa, line(2, "ZZ-MTL-01", "Finish: Example brass, lacquered")], { 0: [{ code: "ZZ-MTL-01", words: null }] });
    expect(plan.lines.get("0:2")).toMatchObject({ filing: { outcome: "matched" }, describes: "Example brass, lacquered" });
    expect(describedAs(plan, "ZZ-MTL-01")).toBe("Example brass, lacquered");
  });

  it("lets a later description statement with words describe it too, and never a placeholder", () => {
    const words = run([table, sofa], { 0: [{ code: "ZZ-MTL-01", words: null }], 1: [{ code: "ZZ-MTL-01", words: "example bronze" }] });
    expect(describedAs(words, "ZZ-MTL-01")).toBe("example bronze");
    const placeholder = run([table, sofa, line(2, "ZZ-FAB-13", "Technical details TBC")], { 0: [{ code: "ZZ-FAB-13", words: null }] });
    expect(placeholder.lines.get("0:2")?.describes).toBeUndefined();
    expect(describedAs(placeholder, "ZZ-FAB-13")).toBeNull();
  });

  it("never describes it with words that say the finish is not decided, though they are not the item's placeholder", () => {
    // The real Aman shape, invented: a daybed's TBC fabric line copied under an armchair.
    const copied = { ...line(2, "ZZ-FAB-12", "Fabric @ Daybed Technical Details TBC"), finishFor: { row: 4, code: "ZZ-SF-01" } };
    const plan = run([table, sofa, copied], { 0: [{ code: "ZZ-FAB-12", words: null }] });
    expect(plan.lines.get("0:2")?.describes).toBeUndefined();
    expect(describedAs(plan, "ZZ-FAB-12")).toBeNull();
    expect(wordsDescribeAFinish("Example brass")).toBe(true);
    expect(wordsDescribeAFinish("Example brass TBC")).toBe(false);
  });

  it("never describes a row that existed before the confirm, empty or not", () => {
    const existing = finish({ id: "fin-9", code: "ZZ-MTL-09", codeNorm: "ZZ-MTL-09", description: null });
    const plan = run([table, sofa, line(2, "ZZ-MTL-09", "Finish: Example bronze")], {}, [existing]);
    expect(plan.lines.get("0:2")).toMatchObject({ filing: { outcome: "matched" }, finishKey: "fin-9" });
    expect(plan.lines.get("0:2")?.describes).toBeUndefined();
    expect(existing.description).toBeNull();
  });
});
