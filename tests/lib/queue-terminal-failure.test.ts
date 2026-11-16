// What a document's row says once the queue gives up on its message (review
// 2.1). The cause used to be printed as it came, so a driver error out of the
// claim statement reached the screen with its table names.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalFailureText, UNRECOGNISED_FAILURE } from "@/lib/extraction-run";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminalFailureText", () => {
  it("passes a sentence this app wrote through, with the delivery count", () => {
    expect(terminalFailureText(new Error("The model is overloaded right now."), 4)).toBe(
      "The model is overloaded right now. (gave up after 4 attempts)",
    );
  });

  it("gives a driver error the unrecognised sentence and a reference, and logs it under that reference", () => {
    const driver = Object.assign(new Error('relation "intake_runs_secret" does not exist'), { code: "42P01" });
    const text = terminalFailureText(driver, 4);
    expect(text).not.toContain("intake_runs_secret");
    expect(text.startsWith(UNRECOGNISED_FAILURE)).toBe(true);
    const reference = /Reference ([0-9a-f]{8})\./.exec(text)?.[1];
    expect(reference).toBeDefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`failure ${reference}`));
  });

  it("keeps a mail fetch's Graph sentence, which names what to check", () => {
    const graph = Object.assign(new Error("Microsoft would not issue a token (401). Check GRAPH_CLIENT_SECRET has not expired."), {
      name: "GraphError",
    });
    expect(terminalFailureText(graph, 4)).toMatch(/^Microsoft would not issue a token/);
  });
});
