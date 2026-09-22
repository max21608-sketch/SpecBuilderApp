// The finishes library's rules. Pure, so no database.
import { describe, it, expect } from "vitest";
import {
  combineFinishState,
  composeFinishCell,
  formatInternalFinishCode,
  internalFinishNumber,
  normaliseFinishCode,
  readUncodedFinish,
  resolveFinishCode,
  type Finish,
} from "@/lib/finishes";
import { renderAttributeValue } from "@/lib/bws-export";

const finish = (over: Partial<Finish> = {}): Finish => ({
  id: "fin-1",
  code: "CH-01.1",
  codeNorm: "CH-01.1",
  codeOrigin: "client",
  kind: "fabric",
  description: "Yarn Collective Tessarae",
  supplierRaw: null,
  reference: "YC04158 - 01",
  colour: null,
  state: "confirmed",
  ...over,
});

describe("normaliseFinishCode", () => {
  it("folds case and whitespace", () => {
    expect(normaliseFinishCode("  ch-01.1 ")).toBe("CH-01.1");
    expect(normaliseFinishCode("CH  01")).toBe("CH 01");
  });

  it("keeps two differently punctuated codes apart", () => {
    // A normaliser clever enough to merge these is clever enough to merge two
    // codes a client meant to keep apart, and there is no way back from that:
    // the two sets of items are now one. Merging is a button.
    expect(normaliseFinishCode("CH-01.1")).not.toBe(normaliseFinishCode("CH-01-1"));
  });

  it("does not fold a dash into a space, or a dot into either (row e1)", () => {
    // Variance matrix row e1, stated as the three pairs it is actually about.
    // The same rule `normalisePaletteValue` carries, and for the same reason.
    // Which of these the LIBRARY then treats as one row is the partial unique
    // index on (project_id, code_norm), pinned in
    // tests/db/finishes-variance.test.ts — a fold nobody applies is a fold
    // that decides nothing.
    expect(normaliseFinishCode("CH 01")).not.toBe(normaliseFinishCode("CH-01"));
    expect(normaliseFinishCode("CH.01")).not.toBe(normaliseFinishCode("CH-01"));
    expect(normaliseFinishCode("CH.01")).not.toBe(normaliseFinishCode("CH 01"));
    // And the two it DOES fold, which is the whole of what it may do.
    expect(normaliseFinishCode(" ch-01.1  ")).toBe(normaliseFinishCode("CH-01.1"));
    expect(normaliseFinishCode("CH   01")).toBe(normaliseFinishCode("ch 01"));
  });
});

describe("composeFinishCell", () => {
  it("leads with the client's own code, then the supplier's reference", () => {
    // FMT-COM-01: the code is how the fabric is tracked on the client's
    // schedule, the reference is what gets ordered. Dropping either makes the
    // line untraceable or unorderable.
    expect(composeFinishCell(finish({ supplierRaw: "Yarn Collective" }))).toBe(
      "CH-01.1; Yarn Collective Tessarae Yarn Collective YC04158 - 01",
    );
  });

  it("is just the code when nothing else is known yet", () => {
    expect(composeFinishCell(finish({ description: null, reference: null }))).toBe("CH-01.1");
  });

  it("NEVER emits a code this app minted", () => {
    // `BW-F-001` is ours, minted because the client gave no code (0036). The
    // cell leads with the code, so emitting it would put a code the client has
    // never seen at the front of a BWS cell, a quote line and a check sheet
    // row, exactly where their own schedule reference goes. The description is
    // what the page said, which is what those files carried before the library
    // could hold this fabric at all.
    const ours = finish({
      code: "BW-F-001",
      codeNorm: "BW-F-001",
      codeOrigin: "internal",
      description: "Aissa Dione, ref. Losange raphia beige et écru",
      reference: null,
    });
    expect(composeFinishCell(ours)).toBe("Aissa Dione, ref. Losange raphia beige et écru");
    expect(composeFinishCell(ours)).not.toContain("BW-F-");
  });

  it("returns nothing at all for an internal finish with no words left", () => {
    // Reachable only by clearing a TBC finish's description on the library
    // screen. Every caller falls back to the attribute's own words rather than
    // shipping a blank — and a bare `BW-F-001` is the one thing that must not
    // happen here.
    expect(
      composeFinishCell(
        finish({ code: "BW-F-002", codeOrigin: "internal", description: null, reference: null, colour: null }),
      ),
    ).toBe("");
  });
});

describe("internal finish codes", () => {
  it("round-trips a number through the printed form", () => {
    expect(formatInternalFinishCode(1)).toBe("BW-F-001");
    expect(formatInternalFinishCode(1234)).toBe("BW-F-1234");
    expect(internalFinishNumber("BW-F-001")).toBe(1);
    expect(internalFinishNumber("bw-f-042")).toBe(42);
  });

  it("reads nothing out of a client's own code", () => {
    expect(internalFinishNumber("CH-01.1")).toBeNull();
    expect(internalFinishNumber("BW-F-")).toBeNull();
    expect(internalFinishNumber("BW-F-001A")).toBeNull();
  });
});

describe("readUncodedFinish", () => {
  const AISSA = "Aissa Dione, ref. Losange raphia beige et écru";
  const ours = (over: Partial<Finish> = {}): Finish =>
    finish({
      id: "fin-ours",
      code: "BW-F-001",
      codeNorm: "BW-F-001",
      codeOrigin: "internal",
      description: AISSA,
      reference: null,
      state: "tbc",
      ...over,
    });

  it("asks, and files nothing, when the library holds nothing like it", () => {
    const reading = readUncodedFinish(AISSA, [], null);
    expect(reading.outcome).toBe("none");
    expect(reading.suggestion).toBeNull();
  });

  it("links on EXACTLY the same wording, folding case and whitespace only", () => {
    const reading = readUncodedFinish(`  aissa dione,   ref. Losange raphia beige et écru `, [ours()], null);
    expect(reading.outcome).toBe("link");
    expect(reading.finish?.code).toBe("BW-F-001");
    expect(reading.why).toBe("Same wording as BW-F-001");
  });

  it("links NOTHING one character apart, and offers the candidate instead", () => {
    // `écru` against `ecru`. This is the trap found-in-use.md names in this
    // very entry: a normaliser clever enough to merge two spellings is clever
    // enough to merge two fabrics somebody kept apart. It is OFFERED, and a
    // person's press is what files anything.
    const reading = readUncodedFinish("Aissa Dione, ref. Losange raphia beige et ecru", [ours()], null);
    expect(reading.outcome).toBe("none");
    expect(reading.finish).toBeNull();
    expect(reading.suggestion?.finish.code).toBe("BW-F-001");
  });

  it("never lets a description reach a CLIENT-coded finish", () => {
    // Where the client issued a code, the code is the key and stays the key.
    const clientRow = finish({ description: AISSA, reference: null });
    const reading = readUncodedFinish(AISSA, [clientRow], null);
    expect(reading.outcome).toBe("none");
    expect(reading.suggestion).toBeNull();
  });

  it("mints only when a person has said there is no client code", () => {
    expect(readUncodedFinish(AISSA, [], { mode: "internal" }).outcome).toBe("mint");
    expect(readUncodedFinish(AISSA, [], null).outcome).toBe("none");
  });

  it("joins the existing row rather than minting a second code for one fabric", () => {
    // Max's whole request: "use this again if it matches in another line item
    // where the same fabric appears". A press on the second item must not mint
    // BW-F-002 for the fabric BW-F-001 already names.
    const reading = readUncodedFinish(AISSA, [ours()], { mode: "internal" });
    expect(reading.outcome).toBe("link");
    expect(reading.finish?.code).toBe("BW-F-001");
  });

  it("takes a near miss the reviewer accepted, by code", () => {
    const reading = readUncodedFinish("Aissa Dione, ref. Losange raphia beige et ecru", [ours()], {
      mode: "link",
      codeNorm: "BW-F-001",
    });
    expect(reading.outcome).toBe("link");
    expect(reading.finish?.code).toBe("BW-F-001");
  });

  it("files nothing when the accepted candidate has gone", () => {
    const reading = readUncodedFinish("something else", [ours()], { mode: "link", codeNorm: "BW-F-009" });
    expect(reading.outcome).toBe("none");
  });

  it("lets a person overrule the automatic link", () => {
    // The one automatic step in this item is the one that most needs a way
    // out: two fabrics can read identically and be different.
    const reading = readUncodedFinish(AISSA, [ours()], { mode: "apart" });
    expect(reading.outcome).toBe("none");
    expect(reading.why).toContain("Kept apart");
  });

  it("says nothing about a row with no words", () => {
    expect(readUncodedFinish(null, [ours()], { mode: "internal" }).outcome).toBe("none");
    expect(readUncodedFinish("   ", [ours()], { mode: "internal" }).outcome).toBe("none");
  });
});

describe("combineFinishState", () => {
  it("takes the weaker of the two", () => {
    // A gate reporting satisfied over a fabric nobody has chosen is the trap
    // the whole promotion path was written to avoid.
    expect(combineFinishState("confirmed", finish({ state: "tbc" }))).toBe("tbc");
    expect(combineFinishState("tbc", finish({ state: "confirmed" }))).toBe("tbc");
    expect(combineFinishState("confirmed", finish())).toBe("confirmed");
  });

  it("leaves an unlinked attribute alone", () => {
    expect(combineFinishState("confirmed", null)).toBe("confirmed");
  });
});

describe("renderAttributeValue with a linked finish", () => {
  it("renders the LIBRARY, not what this page said", () => {
    const cell = renderAttributeValue({
      value: "Old fabric nobody updated",
      unit: null,
      state: "confirmed",
      finish: finish(),
    });
    expect(cell).toBe("CH-01.1; Yarn Collective Tessarae YC04158 - 01");
    expect(cell).not.toContain("Old fabric");
  });

  it("marks a TBC finish as TBC however confirmed the attribute was", () => {
    const cell = renderAttributeValue({
      value: "Yarn Tessarae",
      unit: null,
      state: "confirmed",
      finish: finish({ state: "tbc", description: null, reference: null }),
    });
    expect(cell).toBe("CH-01.1 TBC");
  });

  it("falls back to the page's own words when nothing is linked", () => {
    expect(renderAttributeValue({ value: "Dark tinted wood", unit: null, state: "confirmed", finish: null })).toBe(
      "Dark tinted wood",
    );
  });
});

describe("resolveFinishCode", () => {
  const library = [finish()];

  it("matches an existing code however it was punctuated on the page", () => {
    const result = resolveFinishCode(" ch-01.1 ", "Yarn Collective Tessarae", library);
    expect(result.status).toBe("matched");
  });

  it("offers to create a code the library has never seen", () => {
    const result = resolveFinishCode("WD-01", "Dark tinted oak", library);
    expect(result).toMatchObject({ status: "new", codeNorm: "WD-01" });
  });

  it("flags a CONFLICT rather than choosing, when the page disagrees with the library", () => {
    // Either the library is out of date or this page is, and only a person can
    // tell. Picking one would propagate a wrong value to every linked item.
    const result = resolveFinishCode("CH-01.1", "Something else entirely", library);
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") expect(result.saysInstead).toBe("Something else entirely");
  });

  it("is not a conflict when the library has not committed to anything yet", () => {
    const blank = [finish({ description: null, state: "tbc" })];
    expect(resolveFinishCode("CH-01.1", "Yarn Tessarae", blank).status).toBe("matched");
  });

  // THE PREMISE THE CORRECTION VERB RESTS ON (src/lib/attribute-correct.ts).
  //
  // Correcting a spec that is already LINKED asks only whether the corrected
  // words still match, so it passes the library row's OWN code — and the whole
  // question is void unless that always resolves to the row it came from. The
  // first version of it passed the ATTRIBUTE'S code instead, and a db-tier
  // fixture whose hand-written `code_norm` did not match produced `new` rather
  // than `conflict`: a correction contradicting the library kept its link, and
  // the test that should have caught it passed for the wrong reason.
  it("always resolves a library row against its own code, however it is punctuated", () => {
    for (const code of ["CH-01.1", " ch-01.1 ", "__QA UPH-07", "WD  05"]) {
      const row = finish({ code, codeNorm: normaliseFinishCode(code), description: "Yarn Tessarae" });
      expect(resolveFinishCode(row.code, "Yarn Tessarae", [row]).status).toBe("matched");
      expect(resolveFinishCode(row.code, "Something else entirely", [row]).status).toBe("conflict");
    }
  });

  it("says nothing at all about a spec with no code", () => {
    expect(resolveFinishCode(null, "Dark tinted wood", library).status).toBe("none");
    expect(resolveFinishCode("   ", "Dark tinted wood", library).status).toBe("none");
  });
});
