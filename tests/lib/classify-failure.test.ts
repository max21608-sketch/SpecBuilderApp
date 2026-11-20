// How the upload screen reads a failed classify response.
//
// The route sends a code and `charged`; a Vercel 504 page sends neither. Both
// have to come out as a red failure with a truthful "was this sent", because
// the footer's "nothing has been charged" is only ever said of files that were
// never sent.
import { describe, expect, it } from "vitest";
import {
  CLASSIFY_FAILURE_BANNER,
  CLASSIFY_FAILURE_CODES,
  classifyFailureFromResponse,
} from "@/lib/classify-failure";
import {
  CLASSIFY_DEADLINE_MS,
  classifyDeadlineFor,
  LARGE_CLASSIFY_DEADLINE_MS,
  LONG_PDF_PAGES,
} from "@/lib/document-classify";

describe("classifyFailureFromResponse", () => {
  it("takes the route's own code and charge", () => {
    expect(classifyFailureFromResponse(503, { ok: false, code: "not_configured", charged: false }, "no key")).toEqual({
      code: "not_configured",
      message: "no key",
      sent: false,
    });
    expect(classifyFailureFromResponse(504, { ok: false, code: "timeout", charged: true }, "slow").sent).toBe(true);
  });

  it("reads a 504 with no body as a timeout that may have been sent", () => {
    // Vercel's own ceiling: the route ran, so the model may have been asked.
    expect(classifyFailureFromResponse(504, null, "The server took too long to respond. Try again.")).toMatchObject({
      code: "timeout",
      sent: true,
    });
  });

  it("reads a 500 page as a failure that may have been sent", () => {
    expect(classifyFailureFromResponse(500, null, "boom")).toMatchObject({ code: "failed", sent: true });
  });

  it("reads an unreachable server and a refused request as never sent", () => {
    expect(classifyFailureFromResponse(0, null, "Could not reach the server.")).toMatchObject({ code: "failed", sent: false });
    expect(classifyFailureFromResponse(400, { ok: false, error: "That file does not belong to this project" }, "x").sent).toBe(
      false,
    );
  });

  it("does not take an unknown code on trust", () => {
    expect(classifyFailureFromResponse(502, { code: "nonsense" }, "x").code).toBe("failed");
  });

  it("has a banner for every code", () => {
    for (const code of CLASSIFY_FAILURE_CODES) expect(CLASSIFY_FAILURE_BANNER[code]).toMatch(/\S/);
    // The pilot sentence, word for word, because it is the one somebody will
    // read on a deployment with no key.
    expect(CLASSIFY_FAILURE_BANNER.not_configured).toBe(
      "Document reading is not configured on this deployment — nothing was read, and the files are stored. " +
        "Choose each kind by hand, or ask for the key to be set.",
    );
  });
});

describe("classifyDeadlineFor", () => {
  it("gives the short deadline up to a hundred pages and to anything uncounted", () => {
    expect(LONG_PDF_PAGES).toBe(100);
    expect(classifyDeadlineFor("pdf", 100)).toBe(CLASSIFY_DEADLINE_MS);
    expect(classifyDeadlineFor("pdf", null)).toBe(CLASSIFY_DEADLINE_MS);
    expect(classifyDeadlineFor("spreadsheet", 5000)).toBe(CLASSIFY_DEADLINE_MS);
  });

  it("gives a longer PDF the longer deadline", () => {
    expect(classifyDeadlineFor("pdf", 101)).toBe(LARGE_CLASSIFY_DEADLINE_MS);
    expect(classifyDeadlineFor("pdf", 600)).toBe(LARGE_CLASSIFY_DEADLINE_MS);
  });
});
