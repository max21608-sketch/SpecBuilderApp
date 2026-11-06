// Pure tier. A read that runs out of time is TERMINAL, through the real
// `extractSpecDocument` with the SDK's transport stubbed (the
// anthropic-request.test.ts pattern). NO MODEL IS CALLED.
//
// Audit D1 (2026-11-06): our own deadline aborts the stream, the SDK rejects
// with an APIUserAbortError that has no `.status` and no streamed type, and it
// fell through to the "could not be reached" branch as RETRYABLE. The queue
// then redelivered a 740-second read up to four times, each billed for what it
// streamed before the abort, and finally blamed the network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

const plainStream = vi.hoisted(() => vi.fn());
const betaStream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  class Stubbed extends Real {
    constructor(options: ConstructorParameters<typeof Real>[0]) {
      super(options);
      (this as unknown as { messages: unknown }).messages = { stream: plainStream };
      (this as unknown as { beta: unknown }).beta = { messages: { stream: betaStream } };
    }
  }
  return { ...actual, default: Stubbed };
});

const savedKey = process.env.ANTHROPIC_API_KEY;
const PDF = { type: "pdf" as const, base64: Buffer.from("%PDF-1.4").toString("base64") };

/** What the SDK's stream holds when the abort lands: the message so far. */
const PARTIAL = {
  model: "claude-opus-5-5",
  stop_reason: null,
  content: [{ type: "thinking", thinking: "Reading page 61 of 100" }],
  usage: { input_tokens: 400_000, output_tokens: 31_000 },
};

/** A stream that fails the way the SDK fails it, keeping the snapshot it had. */
function failingStream(cause: unknown, currentMessage: unknown = PARTIAL) {
  return {
    finalMessage: async () => {
      throw cause;
    },
    currentMessage,
    request_id: "req_aborted",
  };
}

beforeEach(() => {
  vi.resetModules();
  plainStream.mockReset();
  betaStream.mockReset();
  process.env.ANTHROPIC_API_KEY = "__qa-not-a-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe("a read that runs out of time", () => {
  it("is terminal, says so in minutes, and keeps what was streamed before the abort", async () => {
    // The run's own abort has fired (RUN_ABORT_MS, or the 740 s deadline: one
    // signal combines both). The SDK reports it as a user abort.
    const run = new AbortController();
    run.abort();
    betaStream.mockReturnValue(failingStream(new Anthropic.APIUserAbortError()));

    const { extractSpecDocument } = await import("@/lib/anthropic");
    const result = await extractSpecDocument(PDF, "shop_drawings", { signal: run.signal });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
    expect(result.code).toBe("timeout");
    expect(result.error).toMatch(/ran out of time after \d+ minutes?/);
    expect(result.error).toMatch(/Split the document/);
    // Not the network's fault, and the sentence must not say it was.
    expect(result.error).not.toMatch(/could not be reached/);
    // The tokens were paid for; what they bought is the only evidence of why.
    expect(result.rawResponse).toEqual(PARTIAL);
    expect(result.usage).toEqual(PARTIAL.usage);
    expect(result.requestId).toBe("req_aborted");
  });

  it("is terminal whatever the SDK threw once the signal has fired", async () => {
    // An abort can surface as a bare socket error mid-stream rather than the
    // SDK's own class. The signal, not the error's shape, says it was ours.
    const run = new AbortController();
    run.abort();
    betaStream.mockReturnValue(failingStream(new Error("terminated"), undefined));

    const { extractSpecDocument } = await import("@/lib/anthropic");
    const result = await extractSpecDocument(PDF, "shop_drawings", { signal: run.signal });
    expect(result).toMatchObject({ ok: false, retryable: false, code: "timeout" });
  });

  it("leaves a genuine socket error retryable, as transport", async () => {
    betaStream.mockReturnValue(failingStream(new Error("socket hang up")));

    const { extractSpecDocument } = await import("@/lib/anthropic");
    const result = await extractSpecDocument(PDF, "shop_drawings", { signal: new AbortController().signal });
    expect(result).toMatchObject({ ok: false, retryable: true, code: "transport" });
    if (result.ok) return;
    expect(result.error).toMatch(/could not be reached: socket hang up/);
    // Kept here too: a stream that died mid-answer still says how far it got.
    expect(result.rawResponse).toEqual(PARTIAL);
  });
});

describe("classifyCallFailure", () => {
  it("reads the signal, not the error: aborted is timeout, otherwise the transport rules", async () => {
    const { classifyCallFailure } = await import("@/lib/anthropic");
    const fired = AbortSignal.abort();
    const live = new AbortController().signal;
    const abortError = new Anthropic.APIUserAbortError();

    expect(classifyCallFailure(abortError, 745_000, fired)).toMatchObject({
      retryable: false,
      code: "timeout",
      error: expect.stringMatching(/after 12 minutes/),
    });
    expect(classifyCallFailure(abortError, 1_000, live)).toMatchObject({ retryable: true, code: "transport" });
    // A streamed overload is still an overload, not a timeout, when nothing fired.
    const overloaded = new Error('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
    expect(classifyCallFailure(overloaded, 1_000, live)).toMatchObject({ retryable: true, code: "overloaded" });
  });

  it("says one minute, not one minutes", async () => {
    const { ranOutOfTimeSentence } = await import("@/lib/anthropic");
    expect(ranOutOfTimeSentence(20_000)).toMatch(/after 1 minute,/);
    expect(ranOutOfTimeSentence(745_000)).toMatch(/after 12 minutes,/);
  });
});
