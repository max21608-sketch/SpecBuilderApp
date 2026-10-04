// How this app asks a model for ONE structured answer, and how it reads it back.
//
// ============================================================================
// TWO REQUEST SHAPES, CHOSEN BY THE MODEL — NEVER BY A CALLER'S FLAG.
//
// Every read in this app wants one JSON object of a known shape: a drawing's
// items, a schedule's observations, a bill's layout, a document's kind. Until
// 2026-10-04 each got it by FORCING a tool (`tool_choice: {type: "tool"}`).
// Claude Opus 5.5 refuses that with a 400 (so do Sonnet 5.5 and Fable 5.1), so
// on those models the same object is asked for as STRUCTURED OUTPUT —
// `output_config.format` with a JSON schema — and comes back as the text block.
//
// `forcedToolAllowed(model)` decides, from the model id alone. The eval harness
// re-asks a document of Opus 5 to reproduce the baseline, and that has to be
// TODAY'S request, byte for byte, or the baseline measures something nobody
// ran; a caller-set flag is one somebody forgets to set.
//
// THE SCHEMA IS DERIVED, NEVER WRITTEN TWICE. `toOutputSchema` turns a tool's
// `input_schema` into one structured outputs accepts: it strips the keywords
// structured outputs rejects (length, range and item-count bounds) and sets
// `additionalProperties: false` on every object. The bounds are not lost — the
// Zod schema beside every tool still validates every response, so a document
// still cannot talk this process into unbounded memory.
//
// AND THE MODEL STILL SEES THEM, IN WORDS. A stripped `maxLength: 400` becomes
// "At most 400 characters." in that field's description. Without it the model
// no longer knows the bound Zod will hold it to, and what Zod does with an
// over-long answer is the expensive half: an over-long text field becomes null
// (`nullableText`'s catch, silently), and an over-long list fails a read that
// has already been paid for. Found on the first live call (2026-10-04): the
// classify `evidence` came back empty because the answer outgrew a bound the
// schema had stopped stating.
//
// REFUSAL FALLBACK. On a structured-output model the request carries
// `fallbacks: "default"` under the `server-side-fallback-2026-07-01` beta: a
// safety-classifier decline on a drawing is re-run server-side on the model
// Anthropic recommends for that category, inside the same call, instead of
// becoming a terminal failure. `response.model` then names the model that
// actually SERVED it, and callers record that. Max, 2026-10-04.
//
// The forced-tool shape carries no fallback: it exists to reproduce the old
// request exactly.
// ============================================================================

/** The beta that gates `fallbacks: "default"`. The ARRAY form uses `-2026-06-01`; pairing either with the other is a 400. */
export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Models that answer a forced `tool_choice` (`tool` / `any`) with a 400. */
const NO_FORCED_TOOL = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1"];

/**
 * May this model be asked to call a tool by force? False for the models that
 * refuse it; true for the ones this app has always forced (Opus 5, Haiku 4.5).
 * A dated or prefixed id (`anthropic.claude-opus-5-5`) is read by its stem.
 */
export function forcedToolAllowed(model: string): boolean {
  const id = model.trim().toLowerCase();
  return !NO_FORCED_TOOL.some((stem) => id === stem || id.endsWith(`.${stem}`) || id.startsWith(`${stem}-2`) || id.startsWith(`${stem}@`));
}

/** JSON-schema keywords structured outputs does not accept. Zod enforces each of them afterwards. */
export const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

const UNSUPPORTED = new Set<string>(UNSUPPORTED_SCHEMA_KEYWORDS);

/** Keywords whose value is a map of NAMES to schemas, not a schema itself. */
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions", "patternProperties"]);

function isObjectSchema(schema: Record<string, unknown>): boolean {
  const type = schema.type;
  return type === "object" || (Array.isArray(type) && type.includes("object")) || "properties" in schema;
}

/**
 * A tool's `input_schema` as a structured-output schema. Pure; the input is
 * not touched.
 *
 * Recursive over every nested schema (`properties`, `items`, `anyOf`, ...).
 * A property NAMED like a keyword (`minimum` as a field name) survives,
 * because names inside `properties` are never treated as keywords.
 */
export function toOutputSchema(inputSchema: unknown): Record<string, unknown> {
  const out = convert(inputSchema);
  if (!out || typeof out !== "object" || Array.isArray(out)) {
    throw new Error("A tool's input_schema must be a JSON object.");
  }
  return out as Record<string, unknown>;
}

/** The bounds a schema states, as a sentence; null when it states none. */
function boundsInWords(schema: Record<string, unknown>): string | null {
  const num = (key: string) => (typeof schema[key] === "number" ? (schema[key] as number) : null);
  const sentences: string[] = [];
  const minLength = num("minLength");
  const maxLength = num("maxLength");
  if (maxLength !== null) sentences.push(`At most ${maxLength} characters.`);
  if (minLength !== null && minLength > 0) sentences.push(`At least ${minLength} characters.`);
  const minItems = num("minItems");
  const maxItems = num("maxItems");
  if (minItems !== null && minItems === maxItems) sentences.push(`Exactly ${minItems} entries.`);
  else {
    if (minItems !== null && minItems > 0) sentences.push(`At least ${minItems} ${minItems === 1 ? "entry" : "entries"}.`);
    if (maxItems !== null) sentences.push(`At most ${maxItems} entries.`);
  }
  const minimum = num("minimum");
  const maximum = num("maximum");
  if (minimum !== null && maximum !== null) sentences.push(`A number from ${minimum} to ${maximum}.`);
  else if (minimum !== null) sentences.push(`At least ${minimum}.`);
  else if (maximum !== null) sentences.push(`At most ${maximum}.`);
  return sentences.length > 0 ? sentences.join(" ") : null;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!node || typeof node !== "object") return node;
  const schema = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED.has(key)) continue;
    if (SCHEMA_MAPS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, convert(sub)]));
    } else if (key === "enum" || key === "const" || key === "required" || key === "description" || key === "default") {
      // Values, not schemas: copied as they are.
      out[key] = value;
    } else {
      out[key] = convert(value);
    }
  }
  const bounds = boundsInWords(schema);
  if (bounds) out.description = typeof out.description === "string" && out.description ? `${out.description} ${bounds}` : bounds;
  if (isObjectSchema(out)) out.additionalProperties = false;
  return out;
}

/** A tool as this app defines one: a name, a description and an input schema. */
export type AnswerTool = { name: string; description: string; input_schema: Record<string, unknown> };

export type AnswerEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * The parts of a request that decide HOW the answer is asked for. The caller
 * adds `model`, `max_tokens`, `messages` and the transport.
 *
 *   forced_tool  — `tool_choice` forced onto the tool, the app's request until
 *                  2026-10-04. `betas` is empty: it goes to the plain endpoint.
 *   structured   — `output_config.format` carrying the derived schema, the
 *                  tool's description first in it, and the refusal fallback.
 *                  Goes to the BETA endpoint, because `fallbacks` is a beta.
 *
 * Effort is ALWAYS explicit: Opus 5.5 defaults to `medium`, one level below
 * Opus 5, so an omitted effort would quietly lower every read.
 */
export function answerRequest(input: {
  model: string;
  tool: AnswerTool;
  effort: AnswerEffort;
  /** Adaptive thinking, as every extraction-model read in this app asks for. False for the fast classify model. */
  thinking: boolean;
}):
  | { mode: "forced_tool"; betas: []; body: Record<string, unknown> }
  | { mode: "structured"; betas: [typeof REFUSAL_FALLBACK_BETA]; body: Record<string, unknown> } {
  const thinking = input.thinking ? { thinking: { type: "adaptive" } } : {};
  if (forcedToolAllowed(input.model)) {
    return {
      mode: "forced_tool",
      betas: [],
      body: {
        ...thinking,
        output_config: { effort: input.effort },
        tool_choice: { type: "tool", name: input.tool.name },
        tools: [input.tool],
      },
    };
  }
  return {
    mode: "structured",
    betas: [REFUSAL_FALLBACK_BETA],
    body: {
      ...thinking,
      output_config: {
        effort: input.effort,
        format: {
          type: "json_schema",
          schema: { description: input.tool.description, ...toOutputSchema(input.tool.input_schema) },
        },
      },
      // The SDK (0.110.0) types `fallbacks` as the ARRAY form only; the scalar
      // "default" form is newer than its types, so the body is built untyped
      // here and cast once at the call site.
      fallbacks: "default",
    },
  };
}

export type ReadAnswer = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * The structured answer in a finished response, whichever way it was asked:
 * the forced tool's `input`, or the JSON object in the text.
 *
 * TEXT AFTER THE LAST `fallback` BLOCK ONLY. A server-side fallback splices the
 * substitute model's answer after a `fallback` marker; anything before it is
 * the declining model's partial output and is not the answer.
 *
 * Never throws: text that is not ONE JSON object is `ok: false` with a reason,
 * which every caller reports as `no_json` (or its own equivalent).
 */
export function readAnswer(
  message: { content?: readonly unknown[] | null },
  toolName: string,
): ReadAnswer {
  const content = Array.isArray(message.content) ? message.content : [];
  const blocks = content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object");

  const toolUse = blocks.find((block) => block.type === "tool_use" && block.name === toolName);
  if (toolUse) return { ok: true, value: toolUse.input };

  let start = 0;
  blocks.forEach((block, index) => {
    if (block.type === "fallback") start = index + 1;
  });
  const text = blocks
    .slice(start)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("")
    .trim();
  if (!text) return { ok: false, reason: "The model answered with no JSON at all." };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The model's answer was not valid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "The model's answer was not one JSON object." };
  }
  return { ok: true, value };
}
