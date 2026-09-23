// What a filename says a document is — against the real Panther pack.
//
// ============================================================================
// THE ELEVEN, READ OFF SHAREPOINT rather than invented (FIU 2026-09-22).
//
// `Enterprise/.../ap364-project-panther p17726/Project Specs and BOQ` holds
// eleven files, and the twelfth below — the Argenta FF&E preamble, `Apx 1b` —
// is part of the pack and has never been in that folder. Both readings of "the
// eleven" are covered, because it is the preamble that tests the rule hardest:
// its name carries "FF&E", which names the PACKAGE and not the document.
//
// The abstentions are the other half and they cost nothing: a held file is
// exactly what the screen does today with a document the model cannot settle.
// ============================================================================
import { describe, expect, it } from "vitest";
import { guessKindFromName } from "@/lib/document-name-guess";
import { KIND_FROM_GENRE } from "@/lib/document-kinds";

/** The pack as it sits on SharePoint, plus the preamble that belongs to it. */
const PANTHER: [string, string | null][] = [
  ["AP364 - Apx 1a - SHOP DRAWINGS - SEATING.pdf", "shop_drawings"],
  ["AP364 - Apx 2 - Panther - BOQ - Seating.xlsx", "bill_of_quantities"],
  ["SPEC-346-Seating - S-100 - Sofa.pdf", "specification_sheets"],
  ["SPEC-346-Seating - S-101 - Sofa.pdf", "specification_sheets"],
  ["SPEC-346-Seating - S-200 - Armchair.pdf", "specification_sheets"],
  ["SPEC-346-Seating - S-201 - Armchair.pdf", "specification_sheets"],
  ["SPEC-346-Seating - S-203 - Armchair.pdf", "specification_sheets"],
  ["SPEC-346-Seating - S-301 - Desk chair.pdf", "specification_sheets"],
  ["SPEC-346-Seating - S-402 - Bench.pdf", "specification_sheets"],
  ["SPEC-346-Upholstery - UP-100 - Headboard.pdf", "specification_sheets"],
  ["SPEC-346-Upholstery - UP-101 - Headboard.pdf", "specification_sheets"],
  ["AP364 - Apx 1b - Argenta FF&E Preamble.pdf", "preamble"],
];

describe("the real Panther pack", () => {
  for (const [filename, genre] of PANTHER) {
    it(`reads ${filename} as ${genre ?? "nothing"}`, () => {
      expect(guessKindFromName(filename)?.genre ?? null).toBe(genre);
    });
  }

  it("quotes what it read, in the file's own casing", () => {
    expect(guessKindFromName("AP364 - Apx 2 - Panther - BOQ - Seating.xlsx")?.evidence).toBe(
      "The name says “BOQ”.",
    );
    expect(guessKindFromName("SPEC-346-Seating - S-100 - Sofa.pdf")?.evidence).toBe(
      "The name says “SPEC-346”.",
    );
  });

  it("files a specification sheet the way the classify route does", () => {
    // ONE TABLE, TWO READERS. A second mapping here is how the upload screen
    // comes to file a document differently from the model's own answer.
    expect(guessKindFromName("SPEC-346-Seating - S-100 - Sofa.pdf")?.decision).toEqual(
      KIND_FROM_GENRE.specification_sheets,
    );
  });
});

describe("a saved email is settled by its extension", () => {
  it("answers email whatever the subject line carries", () => {
    expect(guessKindFromName("RE Fabric for S-201.eml")?.genre).toBe("email");
    // A reply ABOUT the bill is not the bill.
    expect(guessKindFromName("RE BOQ rev C.eml")?.genre).toBe("email");
  });
});

describe("it abstains wherever two kinds are possible", () => {
  it("says nothing about a bare schedule", () => {
    // FF&E, finishes or fabric. A person settles it in seconds.
    expect(guessKindFromName("AP364 - Apx 3 - Schedule.xlsx")).toBeNull();
    expect(guessKindFromName("Panther schedule rev B.xlsx")).toBeNull();
  });

  it("says nothing about a name carrying both BOQ and schedule", () => {
    // The asymmetric case the classify prompt already guards, wearing a
    // helpful name: a bill read as a schedule is a project's worth of wrong
    // records.
    expect(guessKindFromName("AP364 - BOQ schedule - Seating.xlsx")).toBeNull();
  });

  it("says nothing when two kinds are named outright", () => {
    expect(guessKindFromName("Finishes schedule and fabric schedule.xlsx")).toBeNull();
    expect(guessKindFromName("SPEC-346 - BOQ.xlsx")).toBeNull();
  });

  it("takes two names for one kind as one answer", () => {
    const guess = guessKindFromName("SPEC-346 specification sheets - Seating.pdf");
    expect(guess?.genre).toBe("specification_sheets");
    expect(guess?.evidence).toContain("SPEC-346");
  });

  it("qualifies a schedule where the name qualifies it", () => {
    expect(guessKindFromName("AP364 - FF&E Schedule.xlsx")?.genre).toBe("ffe_schedule");
    expect(guessKindFromName("Panther - FFE schedule.xlsx")?.genre).toBe("ffe_schedule");
    expect(guessKindFromName("Finishes Schedule.xlsx")?.genre).toBe("finishes_schedule");
    expect(guessKindFromName("Fabric schedule - rev A.xlsx")?.genre).toBe("fabric_schedule");
  });
});

describe("a word that is not a kind names nothing", () => {
  it("leaves a bare bill, a bare drawing and a bare spec alone", () => {
    // "Bill" is on an invoice; "drawings" is on half a tender pack; "spec"
    // with no number is in "spec bible" and in every folder name.
    expect(guessKindFromName("Example bill.pdf")).toBeNull();
    expect(guessKindFromName("Example drawings.pdf")).toBeNull();
    expect(guessKindFromName("Spec pack.pdf")).toBeNull();
    expect(guessKindFromName("")).toBeNull();
  });

  it("does not read a bill out of anything but a spreadsheet", () => {
    // A bill inside a PDF is refused downstream, so filling the box with it
    // would put somebody one press from a refusal.
    expect(guessKindFromName("AP364 - BOQ - Seating.pdf")).toBeNull();
    expect(guessKindFromName("AP364 - BOQ - Seating.csv")?.genre).toBe("bill_of_quantities");
  });
});

describe("a bill named the way a tender names it (plan any-bill, step 3)", () => {
  it("reads 'bill of quantities' and 'pricing document' on a spreadsheet, as one answer", () => {
    // The shape of the Aman bill's name, with invented parts.
    const guess = guessKindFromName("Appendix 2 - XYZ_Bill of Quantities (Pricing Document) - Supplier ABC.xlsx");
    expect(guess?.genre).toBe("bill_of_quantities");
    expect(guess?.evidence).toContain("Bill of Quantities");
    expect(guess?.evidence).toContain("Pricing Document");
    expect(guessKindFromName("PRICING DOCUMENT - Seating.xlsx")?.genre).toBe("bill_of_quantities");
    expect(guessKindFromName("Tender pricing documents.csv")?.genre).toBe("bill_of_quantities");
  });

  it("abstains on anything short of the whole phrase, or not on a spreadsheet", () => {
    expect(guessKindFromName("Pricing Document.pdf")).toBeNull();
    expect(guessKindFromName("Supplier pricing.xlsx")).toBeNull();
    expect(guessKindFromName("Pricing documentation.xlsx")).toBeNull();
    expect(guessKindFromName("Repricing document.xlsx")).toBeNull();
    // Two kinds named is still no kind.
    expect(guessKindFromName("Pricing document and finishes schedule.xlsx")).toBeNull();
  });

  it("reads nothing into a specifier's drawing numbers", () => {
    // The Miami Beach drawings are numbered, not named; a numbering scheme is
    // not evidence of a kind.
    expect(guessKindFromName("AM-ID-MUR-415.pdf")).toBeNull();
    expect(guessKindFromName("AM-ID-MUR-FUR-02.pdf")).toBeNull();
    expect(guessKindFromName("260824 - OMS and FF&E Tracker.pdf")).toBeNull();
  });
});
