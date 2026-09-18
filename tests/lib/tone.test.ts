// The colour language is literal class strings, or Tailwind never ships it.
//
// Tailwind's JIT finds class names by scanning source text. A slot built as
// `bg-${tone}-700` is valid TypeScript, renders as an unstyled element, and
// raises no error anywhere — which is why this test exists rather than a
// comment. It also asserts every tone fills every slot, so a new tone cannot
// land half-described and fall back to the browser default on one screen.
import { describe, expect, it } from "vitest";
import { TONE, TONES, type ToneClasses } from "@/components/ui/tone";

const SLOTS: (keyof ToneClasses)[] = ["edge", "text", "chip", "pill", "note", "bubble", "row", "dot"];

describe("tone vocabulary", () => {
  it("names every tone once", () => {
    expect(Object.keys(TONE).sort()).toEqual([...TONES].sort());
  });

  it("holds a literal class string in every slot", () => {
    for (const tone of TONES) {
      for (const slot of SLOTS) {
        const value = TONE[tone][slot];
        expect(typeof value, `${tone}.${slot}`).toBe("string");
        expect(value, `${tone}.${slot} interpolates`).not.toContain("${");
        // `plain.row` is the one deliberately empty slot: an untinted row.
        if (!(tone === "plain" && slot === "row")) expect(value.length, `${tone}.${slot} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the guessed-row background the drawings card test pins", () => {
    expect(TONE.guess.row).toContain("bg-yellow-100/70");
  });

  it("keeps blocked dashed and never red", () => {
    expect(TONE.blocked.chip).toContain("border-dashed");
    expect(TONE.blocked.chip).not.toMatch(/red/);
  });
});
