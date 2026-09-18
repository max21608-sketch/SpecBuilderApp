// What a document IS, and the line between reading it and filing it.
//
// The model answers in TRADE terms — what somebody in furniture manufacturing
// would call the document — and this file maps that onto the app's own two
// fields. That mapping is the exact half of house convention 6 and it is here
// so it can be tested; putting the app's vocabulary in the prompt would make it
// untestable and let it drift silently.
import { describe, expect, it } from "vitest";
import {
  ClassifyOutput,
  DOCUMENT_GENRES,
  KIND_FROM_GENRE,
  type DocumentGenre,
} from "@/lib/document-classify";
import { DOCUMENT_KINDS } from "@/lib/spec-vocab";

describe("a trade genre becomes this app's import type and document kind", () => {
  it("has a mapping for every genre but `unclear`", () => {
    // `unclear` deliberately has none: it is the answer that asks a person, and
    // giving it a kind would be the guess this whole design removes.
    const mapped = Object.keys(KIND_FROM_GENRE).sort();
    const expected = DOCUMENT_GENRES.filter((genre) => genre !== "unclear").sort();
    expect(mapped).toEqual([...expected]);
  });

  it("only ever produces a kind this app's schema allows", () => {
    // `intake_runs_document_kind_check` is the constraint behind this. A genre
    // mapped to a kind the database refuses would 500 at registration, after
    // the upload and after the file was stored.
    for (const decision of Object.values(KIND_FROM_GENRE)) {
      if (decision.importType === "boq") {
        expect(decision.documentKind).toBeNull();
      } else {
        expect(DOCUMENT_KINDS).toContain(decision.documentKind);
      }
    }
  });

  it("sends only the bill of quantities down the bill's pipeline", () => {
    // The one route that creates a project's records from a file. Everything
    // else is a specification document, whatever it is called.
    const toBoq = (Object.entries(KIND_FROM_GENRE) as [DocumentGenre, { importType: string }][])
      .filter(([, decision]) => decision.importType === "boq")
      .map(([genre]) => genre);
    expect(toBoq).toEqual(["bill_of_quantities"]);
  });

  it("reads specification sheets and shop drawings the same way", () => {
    // One prompt covers both, and the Panther pack contains both — nine
    // SPEC-346 sheets and one shop-drawing set. The GENRE is kept apart from
    // the kind so this can stop being true without touching a prompt.
    expect(KIND_FROM_GENRE.specification_sheets).toEqual(KIND_FROM_GENRE.shop_drawings);
  });
});

describe("what comes back from the model", () => {
  const answer = (over: Partial<ClassifyOutput> = {}) =>
    ClassifyOutput.parse({
      genre: "bill_of_quantities",
      titleText: "BILL OF QUANTITIES",
      evidence: "the first sheet is headed BILL OF QUANTITIES",
      certain: true,
      ...over,
    });

  it("falls back to `unclear` rather than to a kind, for anything it cannot read", () => {
    // `.catch` on a controlled vocabulary has to land on the answer that asks a
    // person. Landing on `bill_of_quantities` would stage a project's worth of
    // wrong records from a value nobody typed.
    expect(ClassifyOutput.parse({ genre: "a new genre", titleText: null, evidence: "", certain: true }).genre).toBe(
      "unclear",
    );
  });

  it("treats a missing `certain` as not certain", () => {
    expect(ClassifyOutput.parse({ genre: "preamble", titleText: null, evidence: "" }).certain).toBe(false);
  });

  it("keeps the evidence, because it is what a person checks the answer against", () => {
    expect(answer().evidence).toContain("headed BILL OF QUANTITIES");
  });
});
