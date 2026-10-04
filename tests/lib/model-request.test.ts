// Pure tier. How the app asks a model for one structured answer
// (src/lib/model-request.ts): which request shape a model gets, the schema
// structured outputs is sent, and how the answer is read back.
import { describe, expect, it } from "vitest";
import {
  REFUSAL_FALLBACK_BETA,
  UNSUPPORTED_SCHEMA_KEYWORDS,
  answerRequest,
  forcedToolAllowed,
  readAnswer,
  toOutputSchema,
} from "@/lib/model-request";
import { TOOLS, TOOL_VARIANTS } from "@/lib/extraction-schema";
import { STRUCTURE_TOOL } from "@/lib/boq-structure";
import { CLASSIFY_TOOL } from "@/lib/document-classify";
import { DOCUMENT_KINDS } from "@/lib/spec-vocab";
import { EXTRACTION_MODEL, readExtractionResponse } from "@/lib/anthropic";

describe("which models may be forced to call a tool", () => {
  it.each([
    ["claude-opus-5", true],
    ["claude-haiku-4-5-20251001", true],
    ["claude-opus-5-5", false],
    ["claude-sonnet-5-5", false],
    ["claude-fable-5-1", false],
    ["anthropic.claude-opus-5-5", false],
  ])("%s -> %s", (model, allowed) => {
    expect(forcedToolAllowed(model)).toBe(allowed);
  });

  it("puts every extraction on Opus 5.5, which may not be", () => {
    expect(EXTRACTION_MODEL).toBe("claude-opus-5-5");
    expect(forcedToolAllowed(EXTRACTION_MODEL)).toBe(false);
  });
});

const TOOL = TOOLS.shop_drawings.tool;

describe("the request shape", () => {
  it("asks Opus 5.5 for structured output, never a forced tool, with effort and the fallback explicit", () => {
    const request = answerRequest({ model: "claude-opus-5-5", tool: TOOL, effort: "high", thinking: true });
    expect(request.mode).toBe("structured");
    expect(request.betas).toEqual([REFUSAL_FALLBACK_BETA]);
    expect(REFUSAL_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(request.body).not.toHaveProperty("tool_choice");
    expect(request.body).not.toHaveProperty("tools");
    expect(request.body.fallbacks).toBe("default");
    expect(request.body.thinking).toEqual({ type: "adaptive" });
    const config = request.body.output_config as { effort: string; format: { type: string; schema: Record<string, unknown> } };
    expect(config.effort).toBe("high");
    expect(config.format.type).toBe("json_schema");
    expect(config.format.schema).toMatchObject({ type: "object", additionalProperties: false, description: TOOL.description });
  });

  it("keeps Opus 5 on TODAY'S request — the forced tool, no format, no fallback — so the baseline reproduces", () => {
    const request = answerRequest({ model: "claude-opus-5", tool: TOOL, effort: "high", thinking: true });
    expect(request.mode).toBe("forced_tool");
    expect(request.betas).toEqual([]);
    expect(request.body).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      tool_choice: { type: "tool", name: TOOL.name },
      tools: [TOOL],
    });
  });

  it("sends no thinking where the caller asks for none", () => {
    const request = answerRequest({ model: "claude-opus-5-5", tool: TOOL, effort: "low", thinking: false });
    expect(request.body).not.toHaveProperty("thinking");
    expect((request.body.output_config as { effort: string }).effort).toBe("low");
  });
});

/** Every keyword in a schema, never a property NAME. */
function walk(node: unknown, visit: (schema: Record<string, unknown>, path: string) => void, path = "$"): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => walk(entry, visit, `${path}[${index}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  const schema = node as Record<string, unknown>;
  visit(schema, path);
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && value && typeof value === "object") {
      for (const [name, sub] of Object.entries(value)) walk(sub, visit, `${path}.properties.${name}`);
    } else if (key !== "enum" && key !== "const" && key !== "required" && key !== "description") {
      walk(value, visit, `${path}.${key}`);
    }
  }
}

const EVERY_TOOL = [
  ...DOCUMENT_KINDS.map((kind) => [`extraction: ${kind}`, TOOLS[kind].tool] as const),
  ["extraction: shop_drawings v3", TOOL_VARIANTS.shop_drawings!.v3!.tool] as const,
  ["bill structure", STRUCTURE_TOOL] as const,
  ["classify", CLASSIFY_TOOL] as const,
];

describe("toOutputSchema over every tool that is sent to the extraction model", () => {
  it.each(EVERY_TOOL)("%s: no unsupported keyword survives, and every object forbids extra keys", (_, tool) => {
    const before = JSON.stringify(tool.input_schema);
    const schema = toOutputSchema(tool.input_schema);
    const problems: string[] = [];
    walk(schema, (node, path) => {
      for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) if (keyword in node) problems.push(`${path}.${keyword}`);
      const isObject = node.type === "object" || "properties" in node;
      if (isObject && node.additionalProperties !== false) problems.push(`${path} allows extra keys`);
    });
    expect(problems).toEqual([]);
    // The tool itself is untouched: the Opus 5 path still sends it whole.
    expect(JSON.stringify(tool.input_schema)).toBe(before);
  });

  it("keeps a property NAMED like a keyword, the enums and required lists, and states each bound in words", () => {
    const schema = toOutputSchema({
      type: "object",
      properties: {
        minimum: { type: "integer", minimum: 1 },
        kind: { type: "string", enum: ["a", "b"], maxLength: 3, description: "Which kind." },
        list: { type: "array", maxItems: 4, items: { type: "object", properties: { x: { type: "number", minimum: 0, maximum: 1 } } } },
        box: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } },
      },
      required: ["minimum", "kind"],
    });
    expect(schema).toEqual({
      type: "object",
      properties: {
        minimum: { type: "integer", description: "At least 1." },
        kind: { type: "string", enum: ["a", "b"], description: "Which kind. At most 3 characters." },
        list: {
          type: "array",
          description: "At most 4 entries.",
          items: {
            type: "object",
            properties: { x: { type: "number", description: "A number from 0 to 1." } },
            additionalProperties: false,
          },
        },
        box: { type: "array", items: { type: "number" }, description: "Exactly 4 entries." },
      },
      required: ["minimum", "kind"],
      additionalProperties: false,
    });
  });
});

describe("reading the answer back", () => {
  it("takes a forced tool's input", () => {
    expect(readAnswer({ content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }, "t")).toEqual({ ok: true, value: { a: 1 } });
  });

  it("takes the JSON object in the text, past any thinking", () => {
    const answer = readAnswer({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: ' {"a": 1}\n' }] }, "t");
    expect(answer).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reads only what the substitute model wrote after a fallback", () => {
    const answer = readAnswer(
      {
        content: [
          { type: "text", text: '{"partial":' },
          { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
          { type: "text", text: '{"a": 2}' },
        ],
      },
      "t",
    );
    expect(answer).toEqual({ ok: true, value: { a: 2 } });
  });

  it.each([
    [[], /no JSON at all/],
    [[{ type: "text", text: "I could not read it." }], /not valid JSON/],
    [[{ type: "text", text: "[1, 2]" }], /not one JSON object/],
  ])("refuses %j", (content, reason) => {
    const answer = readAnswer({ content }, "t");
    expect(answer.ok).toBe(false);
    expect(answer.ok ? "" : answer.reason).toMatch(reason);
  });
});

describe("what a finished extraction response amounts to", () => {
  const drawings = { items: [], codeGroups: [], documentNotes: null };
  const items = { documentNotes: null, nonItemPages: [], items: [] };

  it("validates a structured answer read from the text", () => {
    const read = readExtractionResponse({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(items) }] }, "shop_drawings");
    expect(read).toMatchObject({ ok: true, output: { outputKind: "drawing_items_v4" } });
  });

  it("checks a response against the shape its pipeline asked for", () => {
    // The harness re-scores a saved v3 response: it must be read as v3.
    const read = readExtractionResponse(
      { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(drawings) }] },
      "shop_drawings",
      "v3",
    );
    expect(read).toMatchObject({ ok: true, output: { outputKind: "drawing_items" } });
    expect(readExtractionResponse({ stop_reason: "end_turn", content: [] }, "shop_drawings", "v9")).toMatchObject({ ok: false });
  });

  it("calls text that is not one JSON object no_json", () => {
    const read = readExtractionResponse({ stop_reason: "end_turn", content: [{ type: "text", text: "Sorry." }] }, "shop_drawings");
    expect(read).toMatchObject({ ok: false, code: "no_json" });
  });

  it("keeps refusal and truncation as they were", () => {
    expect(readExtractionResponse({ stop_reason: "refusal", content: [] }, "shop_drawings")).toMatchObject({ ok: false, code: "refusal" });
    expect(readExtractionResponse({ stop_reason: "max_tokens", content: [] }, "shop_drawings")).toMatchObject({ ok: false, code: "truncated" });
  });

  it("names where a schema failure is", () => {
    const read = readExtractionResponse(
      { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ ...drawings, items: "[{" }) }] },
      "shop_drawings",
    );
    expect(read).toMatchObject({ ok: false, code: "schema" });
    expect(read.ok ? "" : read.error).toMatch(/\(at items\)/);
  });
});
