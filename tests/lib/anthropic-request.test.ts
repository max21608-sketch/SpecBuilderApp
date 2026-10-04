// Pure tier. The extraction call's REQUEST, per model, through the real
// `extractSpecDocument` with the SDK's transport stubbed.
//
// NO MODEL IS CALLED. The SDK class is subclassed with stubbed `messages` and
// `beta.messages`, keeping its real error classes — the classify-route test's
// pattern.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const DRAWINGS = { items: [], codeGroups: [], documentNotes: "nothing drawn" };

function streamOf(message: Record<string, unknown>) {
  return { finalMessage: async () => message, request_id: "req_test" };
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

const PDF = { type: "pdf" as const, base64: Buffer.from("%PDF-1.4").toString("base64") };

describe("extractSpecDocument on Opus 5.5 (the default)", () => {
  it("sends structured output on the beta endpoint: no tool_choice, the format, effort high, the refusal fallback", async () => {
    betaStream.mockReturnValue(
      streamOf({
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(DRAWINGS) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    const { extractSpecDocument } = await import("@/lib/anthropic");
    const result = await extractSpecDocument(PDF, "shop_drawings");

    expect(plainStream).not.toHaveBeenCalled();
    const body = betaStream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("tools");
    expect(body.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body.fallbacks).toBe("default");
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
    expect(result).toMatchObject({ ok: true, model: "claude-opus-5-5", requestId: "req_test" });
  });

  it("records the model that SERVED it when the fallback ran", async () => {
    betaStream.mockReturnValue(
      streamOf({
        model: "claude-opus-4-8",
        stop_reason: "end_turn",
        content: [
          { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: null } },
          { type: "text", text: JSON.stringify(DRAWINGS) },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    const { extractSpecDocument } = await import("@/lib/anthropic");
    expect(await extractSpecDocument(PDF, "shop_drawings")).toMatchObject({ ok: true, model: "claude-opus-4-8" });
  });

  it("reports text that is not JSON as no_json, terminal, with the model that answered", async () => {
    betaStream.mockReturnValue(
      streamOf({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "I cannot." }], usage: {} }),
    );
    const { extractSpecDocument } = await import("@/lib/anthropic");
    expect(await extractSpecDocument(PDF, "shop_drawings")).toMatchObject({
      ok: false,
      retryable: false,
      code: "no_json",
      model: "claude-opus-5-5",
    });
  });

  it("keeps a whole-chain refusal terminal", async () => {
    betaStream.mockReturnValue(streamOf({ model: "claude-opus-5-5", stop_reason: "refusal", content: [], usage: {} }));
    const { extractSpecDocument } = await import("@/lib/anthropic");
    expect(await extractSpecDocument(PDF, "shop_drawings")).toMatchObject({ ok: false, code: "refusal", retryable: false });
  });
});

describe("extractSpecDocument asked for Opus 5 (the eval harness's baseline)", () => {
  it("sends TODAY'S request: the forced tool on the plain endpoint, no format, no fallback", async () => {
    plainStream.mockReturnValue(
      streamOf({
        model: "claude-opus-5",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "record_drawing_items", input: DRAWINGS }],
        usage: {},
      }),
    );
    const { extractSpecDocument } = await import("@/lib/anthropic");
    const result = await extractSpecDocument(PDF, "shop_drawings", { model: "claude-opus-5", promptVariant: "v3" });

    expect(betaStream).not.toHaveBeenCalled();
    const body = plainStream.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_drawing_items" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body).not.toHaveProperty("fallbacks");
    expect(body).not.toHaveProperty("betas");
    expect(result).toMatchObject({ ok: true, model: "claude-opus-5" });
  });

  it("refuses a prompt variant that does not exist, before any call", async () => {
    const { extractSpecDocument } = await import("@/lib/anthropic");
    const result = await extractSpecDocument(PDF, "shop_drawings", { promptVariant: "v9" });
    expect(result).toMatchObject({ ok: false, code: "invalid_request" });
    expect(plainStream).not.toHaveBeenCalled();
    expect(betaStream).not.toHaveBeenCalled();
  });
});
