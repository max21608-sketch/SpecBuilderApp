import { describe, expect, it } from "vitest";
import { streamedErrorType } from "@/lib/anthropic";

// A STREAMED failure carries no HTTP status. Anthropic sends an SSE `error`
// event, the SDK rejects with an Error whose message is the raw event, and the
// status-based mapping in classifyTransportFailure never sees a `.status` — so
// a real 529 was reported to a reviewer as "The model could not be reached",
// which reads like this app's network or this app's fault.
describe("streamedErrorType", () => {
  it("reads the overload that stalled the AP364b drawing set", () => {
    // Verbatim, off the screen on 2026-09-16.
    const message =
      '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011Cf7dhz2gzgrC7b3B2ijuq"}';
    expect(streamedErrorType(message)).toBe("overloaded_error");
  });

  it("finds the payload when the SDK has wrapped it in prose", () => {
    expect(
      streamedErrorType('Stream error: {"type":"error","error":{"type":"rate_limit_error"}} (aborted)'),
    ).toBe("rate_limit_error");
  });

  it("returns null on anything it cannot read", () => {
    // An unrecognised failure must never be dressed up as a recognised one:
    // null lands on the generic transport branch, which is retryable and says
    // exactly what it saw.
    expect(streamedErrorType("socket hang up")).toBeNull();
    expect(streamedErrorType("ECONNRESET {not json}")).toBeNull();
    expect(streamedErrorType('{"type":"error","error":{}}')).toBeNull();
    expect(streamedErrorType("")).toBeNull();
  });
});
