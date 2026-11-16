// A PDF bill HELD until its transcription runs is `parsed` with no lines on
// it, and the Documents list called it "Ready to review" (found in use,
// 2026-10-15). It says the next step instead, wherever its state is printed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AWAITING_TRANSCRIPTION_LABEL,
  documentReviewLabel,
  documentReviewTone,
  intakeStatusLabel,
  packTally,
} from "@/lib/intake-status";
import { isAwaitingTranscription } from "@/lib/pdf-bill-checks";
import { nextStep, type NextStepInput } from "@/lib/next-step";

describe("a bill held for its transcription", () => {
  it("is called what it needs, in amber, and never Ready to review", () => {
    const held = { status: "parsed", awaitingTranscription: true };
    expect(documentReviewLabel(held)).toBe(AWAITING_TRANSCRIPTION_LABEL);
    expect(AWAITING_TRANSCRIPTION_LABEL).toBe("Needs transcribing");
    expect(documentReviewTone(held)).toBe("warn");
    expect(documentReviewLabel(held)).not.toBe(intakeStatusLabel("parsed"));
  });

  it("is only ever a parsed bill: a transcribed or a confirmed one reads as before", () => {
    expect(documentReviewLabel({ status: "parsed", awaitingTranscription: false })).toBe("Ready to review");
    expect(documentReviewLabel({ status: "parsed" })).toBe("Ready to review");
    expect(documentReviewLabel({ status: "confirmed", awaitingTranscription: true })).toBe("Review complete");
    expect(documentReviewLabel({ status: "failed", awaitingTranscription: true })).toBe("Failed");
  });

  it("waits for a person in the pack's count, as a bill to review does", () => {
    expect(packTally([{ status: "parsed", awaitingTranscription: true }]).toReview).toBe(1);
  });

  it("is decided by the staged transcription's own state", () => {
    expect(isAwaitingTranscription({ pdfTranscription: { state: "waiting" } })).toBe(true);
    expect(isAwaitingTranscription({ pdfTranscription: { state: "done" } })).toBe(false);
    expect(isAwaitingTranscription({})).toBe(false);
    expect(isAwaitingTranscription(null)).toBe(false);
  });

  it("is the next step as Transcribe the bill", () => {
    const input: NextStepInput = {
      projectId: "11111111-1111-1111-1111-111111111111",
      summary: { records: 0, uncategorised: 0, toQuote: 0, documentsReading: 0, documentsFailed: 0 },
      documents: [{ id: "boq-1", status: "parsed", source_kind: "boq_xlsx", document_kind: null, awaiting_transcription: true }],
      runs: [],
      packId: null,
    };
    const step = nextStep(input);
    expect(step?.kind).toBe("review_boq");
    expect(step?.label).toBe("Transcribe the bill");
  });

  // Two SQL copies of `isAwaitingTranscription`, because the driver cannot
  // share a fragment. If one drifts, the Documents tab and the pack disagree.
  const fold = (text: string) => text.replace(/\s+/g, " ");
  const expression =
    "(r.source_kind = 'boq_xlsx' and r.status = 'parsed' and r.parsed->'pdfTranscription'->>'state' = 'waiting')";
  for (const file of ["src/app/api/projects/[id]/route.ts", "src/app/api/projects/[id]/batches/route.ts"]) {
    it(`is the same SQL in ${file}`, () => {
      expect(fold(readFileSync(file, "utf8"))).toContain(expression);
    });
  }
});
