import { describe, expect, it } from "vitest";
import { apiErrorMessage, refusedRequestSentence, streamedErrorMessage } from "@/lib/anthropic";

describe("a refused request says why", () => {
  it("names a credit failure in words, with what to do", () => {
    const cause = { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } } };
    const sentence = refusedRequestSentence("400", apiErrorMessage(cause));
    expect(sentence).toMatch(/run out of credit/);
    expect(sentence).toMatch(/Retry/);
  });

  it("keeps the service's own sentence for any other refusal", () => {
    const cause = { status: 400, error: { error: { message: "messages.0.content.0: PDF exceeds 600 pages" } } };
    expect(refusedRequestSentence("400", apiErrorMessage(cause))).toBe("The request was refused (400): messages.0.content.0: PDF exceeds 600 pages");
  });

  it("falls back to the bare sentence when nothing came with it", () => {
    expect(refusedRequestSentence("404", apiErrorMessage(new Error("x")))).toBe("The request was refused (404).");
  });

  it("reads the message out of a streamed error event", () => {
    const raw = 'stream error {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}';
    expect(refusedRequestSentence(null, streamedErrorMessage(raw))).toMatch(/run out of credit/);
    expect(streamedErrorMessage("no json here")).toBeNull();
  });
});
