// The finishes library's kind suggestion.
//
// Every case here is a REAL row from the sandbox Panther library, read off the
// screen on 2026-09-18. The point of the feature was that nine of its eleven
// finishes carried no kind at all, so the kind filter did nothing — and the
// point of using the real rows is that a word list tuned against invented
// examples is a word list that will miss the pack it was written for.
import { describe, expect, it } from "vitest";
import { suggestFinishKind, suggestKindsFor } from "@/lib/finish-kind-guess";

describe("suggestFinishKind", () => {
  it("reads the client's own code first", () => {
    // The case Max raised: WD-01 is obviously a timber and nothing said so.
    expect(suggestFinishKind({ code: "WD-01", description: "Dark tinted wood" })).toEqual({
      kind: "timber",
      reason: "the code WD-01 says so",
    });
    // No description at all, and the code is still enough.
    expect(suggestFinishKind({ code: "WD-02", description: null })?.kind).toBe("timber");
    expect(suggestFinishKind({ code: "MT-01", description: null })?.kind).toBe("metal");
    expect(suggestFinishKind({ code: "UPH-07", description: "Aissa Dione, Kolda" })?.kind).toBe("fabric");
  });

  it("falls back to the description's own words", () => {
    // `CLO003 WD` folds to `clowd`, which matches no prefix — the WD there is
    // the client's suffix convention, not the BWS-style prefix. The
    // description answers it instead.
    const wood = suggestFinishKind({ code: "CLO003 WD", description: "Dark tinted wood" });
    expect(wood?.kind).toBe("timber");
    expect(wood?.reason).toContain("wood");
  });

  it("keeps leather apart from cloth", () => {
    // FABRIC_CALLOUT_WORDS contains `leather`, `hide` and `suede`, because the
    // drawings path cannot tell them apart and does not need to. The library
    // can, so leather is read first — otherwise every hide is a fabric.
    expect(suggestFinishKind({ code: "LE-01", description: "Tan aniline leather" })?.kind).toBe("leather");
    expect(suggestFinishKind({ code: "X-01", description: "Chestnut suede" })?.kind).toBe("leather");
  });

  it("reads the kinds no BWS field distinguishes", () => {
    expect(suggestFinishKind({ code: "ST-02", description: "Calacatta marble" })?.kind).toBe("stone");
    expect(suggestFinishKind({ code: "GL-01", description: "Antique mirror" })?.kind).toBe("glass");
    expect(suggestFinishKind({ code: "PT-01", description: "Eggshell, RAL 7016" })?.kind).toBe("paint");
  });

  it("does not read a part as a material", () => {
    // TIMBER_PART_WORDS ("legs", "frame") is evidence on a DRAWING, where the
    // caption names the part it labels. In a library description it says where
    // the finish goes, and a fabric for the legs is not a timber.
    expect(suggestFinishKind({ code: "X-02", description: "Bouclé, legs and front rail" })?.kind).toBe("fabric");
    expect(suggestFinishKind({ code: "X-03", description: "For the frame" })).toBeNull();
  });

  it("refuses to answer where nothing written down says", () => {
    // CH is deliberately unmapped: nothing on any page in the real set says
    // what it stands for. With no description there is nothing else to read.
    expect(suggestFinishKind({ code: "CH-01.2", description: null })).toBeNull();
    // A real code with a real description that names no material.
    expect(suggestFinishKind({ code: "CLO003 A", description: "Tibor Blob Amber Fern" })).toBeNull();
    // TBC carries no substance.
    expect(suggestFinishKind({ code: "CLO003 B", description: "TBC" })).toBeNull();
  });

  it("matches whole words only", () => {
    // `ash` is a timber and `Ashcombe` is a house; `ral` is a paint standard
    // and `coral` is a colour.
    expect(suggestFinishKind({ code: "X-04", description: "Ashcombe weave" })?.kind).toBe("fabric");
    expect(suggestFinishKind({ code: "X-05", description: "Coral" })).toBeNull();
  });

  it("reads a description even where the code is unmapped", () => {
    // CH-01.1's description names raffia, which is a fibre. The CODE says
    // nothing and still says nothing; the words are separate evidence.
    expect(
      suggestFinishKind({ code: "CH-01.1", description: "Aissa Dione black/straw diamonds, raffia, Gorée" })?.kind,
    ).toBe("fabric");
  });
});

describe("suggestKindsFor", () => {
  it("leaves a finish somebody has already filed alone", () => {
    const out = suggestKindsFor([
      { id: "a", code: "WD-01", description: "Dark tinted wood", kind: null },
      // Filed as `other` by a person. A suggestion here would be the app
      // second-guessing a decision.
      { id: "b", code: "WD-05", description: "Ceruse finish oak", kind: "other" },
      { id: "c", code: "CH-01.2", description: null, kind: null },
    ]);
    expect(out.map((entry) => entry.id)).toEqual(["a"]);
    expect(out[0]?.suggestion.kind).toBe("timber");
  });

  it("is empty when there is nothing to offer", () => {
    expect(suggestKindsFor([{ id: "a", code: "CH-01.2", description: null, kind: null }])).toEqual([]);
  });
});
