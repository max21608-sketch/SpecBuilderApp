// The finishes library's rules. Pure, so no database.
import { describe, it, expect } from "vitest";
import {
  combineFinishState,
  composeFinishCell,
  normaliseFinishCode,
  resolveFinishCode,
  type Finish,
} from "@/lib/finishes";
import { renderAttributeValue } from "@/lib/bws-export";

const finish = (over: Partial<Finish> = {}): Finish => ({
  id: "fin-1",
  code: "CH-01.1",
  codeNorm: "CH-01.1",
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

  it("says nothing at all about a spec with no code", () => {
    expect(resolveFinishCode(null, "Dark tinted wood", library).status).toBe("none");
    expect(resolveFinishCode("   ", "Dark tinted wood", library).status).toBe("none");
  });
});
