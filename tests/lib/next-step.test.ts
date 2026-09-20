// What a project needs next — the precedence, one fixture per state.
//
// The point of the function is that ONE place decides, so the point of this
// file is the ORDER. Every case below is a project that satisfies more than one
// clause; what is asserted is which of them wins, because a screen that showed
// "Categorise 6 items" over an unconfirmed bill would be sending somebody to a
// table that does not exist yet.
import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput } from "@/lib/next-step";

const PROJECT = "11111111-1111-1111-1111-111111111111";

function input(over: Partial<NextStepInput> = {}): NextStepInput {
  return {
    projectId: PROJECT,
    summary: { records: 0, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
    documents: [],
    runs: [],
    packId: null,
    ...over,
  };
}

function doc(over: Partial<NextStepInput["documents"][number]> = {}) {
  return {
    id: "import-1",
    status: "confirmed",
    source_kind: "spec_document",
    document_kind: "shop_drawings" as string | null,
    ...over,
  };
}

describe("the next step", () => {
  it("is the upload when nothing has arrived", () => {
    const step = nextStep(input());
    expect(step?.kind).toBe("upload");
    expect(step?.label).toBe("Upload the pack");
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}?tab=documents`);
    expect(step?.pending).toBe(false);
  });

  it("says what the app is doing, and says it is not something to press", () => {
    const step = nextStep(
      input({
        documents: [doc({ status: "parsing" }), doc({ id: "import-2", status: "parsing" })],
        summary: { records: 0, uncategorised: 0, toQuote: 0, documentsReading: 2, documentsFailed: 0 },
        packId: "batch-1",
      }),
    );
    expect(step?.kind).toBe("reading");
    expect(step?.label).toBe("Reading 2 documents…");
    expect(step?.pending).toBe(true);
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}/intake/batch-1`);
  });

  it("puts a failed read ahead of everything a record needs", () => {
    const step = nextStep(
      input({
        documents: [doc({ status: "failed" })],
        // Every later clause also applies. None of them is the answer.
        summary: { records: 12, uncategorised: 3, toQuote: 40, documentsReading: 0, documentsFailed: 1 },
        runs: [{ id: "run-1" }],
        packId: "batch-1",
      }),
    );
    expect(step?.kind).toBe("retry_failed");
    expect(step?.label).toBe("Retry the failed read");
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}/intake/batch-1`);
    expect(step?.tone).toBe("danger");
  });

  it("links a failed read to its own document when the pack is unknown", () => {
    const step = nextStep(
      input({
        documents: [doc({ id: "import-9", status: "failed" })],
        summary: { records: 0, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 1 },
      }),
    );
    expect(step?.href).toBe("/dashboard/imports/import-9");
  });

  // THE BILL FIRST. It is what creates the records every other document
  // describes, so a pack whose drawings are read and whose bill is not
  // confirmed resolves nothing at all.
  it("reviews the bill before any document that describes it", () => {
    const step = nextStep(
      input({
        documents: [
          doc({ id: "drawings-1", status: "parsed" }),
          doc({ id: "boq-1", status: "parsed", source_kind: "boq_xlsx", document_kind: null }),
        ],
        packId: "batch-1",
      }),
    );
    expect(step?.kind).toBe("review_boq");
    expect(step?.href).toBe("/dashboard/imports/boq-1");
  });

  it("reviews a read document before it asks anybody about a record", () => {
    const step = nextStep(
      input({
        documents: [doc({ id: "drawings-1", status: "parsed" }), doc({ id: "drawings-2", status: "parsed" })],
        summary: { records: 12, uncategorised: 3, toQuote: 40, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
        packId: "batch-1",
      }),
    );
    expect(step?.kind).toBe("review_documents");
    expect(step?.label).toBe("Review 2 documents");
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}/intake/batch-1`);
  });

  // An email is reviewed from the Inbox and belongs to no pack, so one sitting
  // unreviewed is not a step in this project's intake.
  it("does not treat an unreviewed email as a step in the intake", () => {
    const step = nextStep(
      input({
        documents: [doc({ id: "email-1", status: "parsed", document_kind: "email" })],
        summary: { records: 12, uncategorised: 2, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
      }),
    );
    expect(step?.kind).toBe("categorise");
  });

  // An uncategorised record has NO questions, so it contributes nothing to the
  // to-quote figure — which makes that figure an undercount until this is done.
  it("categorises before it counts what is missing", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 12, uncategorised: 6, toQuote: 40, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }, { id: "run-2" }],
      }),
    );
    expect(step?.kind).toBe("categorise");
    expect(step?.label).toBe("Categorise 6 items");
    expect(step?.count).toBe(6);
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}?tab=run-1&focus=no_category`);
  });

  it("lands the to-quote step on the first phase, already narrowed", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 14, uncategorised: 0, toQuote: 5, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
      }),
    );
    expect(step?.kind).toBe("to_quote");
    expect(step?.label).toBe("Review 14 items — 5 to-quote specs outstanding");
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}?tab=run-1&focus=tgq`);
  });

  it("says one item and one spec in the singular", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 1, uncategorised: 0, toQuote: 1, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
      }),
    );
    expect(step?.label).toBe("Review 1 item — 1 to-quote spec outstanding");
  });

  // THE SPEC TABLE REQUIRES A PHASE, so a project with none has nowhere for
  // these two steps to land and they are skipped rather than approximated.
  it("skips the record steps where there is no phase to land on", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 12, uncategorised: 6, toQuote: 40, documentsReading: 0, documentsFailed: 0 },
        runs: [],
      }),
    );
    expect(step?.kind).toBe("export");
  });

  it("is the chase once the questions are asked and nothing is back", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 14, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
        waiting: 3,
      }),
    );
    expect(step?.kind).toBe("waiting");
    expect(step?.label).toBe("3 questions waiting on a reply");
    expect(step?.href).toBe(`/dashboard/drafts?projectId=${PROJECT}`);
  });

  // A CALLER THAT CANNOT TELL SAYS NOTHING. `GET /api/projects/[id]` carries no
  // waiting figure; passing zero from there would make one screen claim nothing
  // is waiting while another with the real number says otherwise.
  it("skips the chase where the caller could not tell", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 14, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
      }),
    );
    expect(step?.kind).toBe("export");
  });

  it("is the export when a fully specified phase has nothing outstanding", () => {
    const step = nextStep(
      input({
        documents: [doc()],
        summary: { records: 22, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
        runs: [{ id: "run-1" }],
        waiting: 0,
      }),
    );
    expect(step?.kind).toBe("export");
    expect(step?.href).toBe(`/dashboard/projects/${PROJECT}?tab=run-1`);
    expect(step?.tone).toBe("good");
  });

  // NOTHING APPLIES. A confirmed bill that produced no records is not a project
  // to export: offering the file there is the same claim as a green pill over
  // 0 of 0, which is the empty-programme error in another place.
  it("returns null where a document has been read and there is nothing to act on", () => {
    expect(
      nextStep(
        input({
          documents: [doc()],
          summary: { records: 0, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
          waiting: 0,
        }),
      ),
    ).toBeNull();
  });
});
