import { describe, expect, it } from "vitest";
import { clampText, isShouted, looksShouted, softenShout } from "@/lib/shout";

// The real lines, off the Panther S-402 bench sheet. Every assertion here is
// about READING; nothing in this file is about what gets stored.
describe("looksShouted", () => {
  it("takes a shouted sentence", () => {
    expect(
      looksShouted("ALL METAL PARTS MUST BE GUARANTEED AGAINST CORROSION, PITTING AND ABRASION."),
    ).toBe(true);
  });

  it("leaves a shouted PHRASE alone — that is how a drawing writes a value", () => {
    // Short capitals are a value, a name or a code, not a paragraph.
    expect(looksShouted("WOOD")).toBe(false);
    expect(looksShouted("TO BID")).toBe(false);
    expect(looksShouted("FINISH SAMPLE, FABRIC CUTTING, STRIKE OFF")).toBe(false);
    expect(looksShouted("REFER TO JACQUES GRANGE DRAWINGS")).toBe(false);
  });

  it("leaves anything with a lower-case letter alone", () => {
    // Somebody chose that case. It is not ours to change.
    expect(looksShouted("Area used: Refer to Argenta room by room schedule, per the issued layout")).toBe(false);
  });
});

describe("softenShout", () => {
  it("renders a shouted sentence as prose", () => {
    expect(softenShout("ALL METAL PARTS MUST BE GUARANTEED AGAINST CORROSION, PITTING AND ABRASION.")).toBe(
      "All metal parts must be guaranteed against corrosion, pitting and abrasion.",
    );
  });

  it("keeps figures and codes exactly as printed", () => {
    expect(
      softenShout("MANUFACTURER MUST SUBMIT A YARN TESSARAE YC04158 SAMPLE BEFORE ANY CUTTING TAKES PLACE."),
    ).toContain("YC04158");
  });

  it("keeps the words that mean something in capitals", () => {
    const out = softenShout("ALL FABRICS ARE COM AND MUST CARRY AN FR CERTIFICATE BEFORE DELIVERY TO SITE.");
    expect(out).toBe("All fabrics are COM and must carry an FR certificate before delivery to site.");
  });

  it("softens sentence by sentence, leaving mixed-case halves untouched", () => {
    // A merged note block is routinely half shouted. Judging the whole value at
    // once would rewrite the half somebody had already written properly.
    const input =
      "Area used: Refer to Argenta room by room schedule\n" +
      "MANUFACTURER MUST PROVIDE A STRUCTURALLY SOUND PRODUCT WITH PROPER PROPORTIONS TO ENSURE STABILITY.";
    expect(softenShout(input)).toBe(
      "Area used: Refer to Argenta room by room schedule\n" +
        "Manufacturer must provide a structurally sound product with proper proportions to ensure stability.",
    );
  });

  it("preserves the line breaks mergeNoteBlocks put there", () => {
    const input = "SUBMIT SHOP DRAWINGS FOR REVIEW AND APPROVAL PRIOR TO FABRICATION.\nWOOD\nTO BID";
    const out = softenShout(input);
    expect(out.split("\n")).toHaveLength(3);
    expect(out.split("\n")[1]).toBe("WOOD");
    expect(out.split("\n")[2]).toBe("TO BID");
  });

  it("is idempotent, so a screen can soften an already-softened value", () => {
    const once = softenShout("ALL TIMBER COMPONENTS ARE TO BE FREE OF DEFECTS, VERMIN AND INSECTS, FINISHED KILN DRIED.");
    expect(softenShout(once)).toBe(once);
  });

  it("changes nothing at all in a value that was never shouted", () => {
    const input = "Dark tinted wood as per approved sample";
    expect(softenShout(input)).toBe(input);
    expect(isShouted(input)).toBe(false);
  });

  it("reports when it has done something, so the screen can offer 'as printed'", () => {
    expect(isShouted("CONSTRUCTION TO BE OF COMMERCIAL QUALITY; ALL JOINTS MORTAR-GLUED AND REINFORCED.")).toBe(true);
  });
});

describe("clampText", () => {
  const LINES = Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join("\n");

  it("keeps a short value exactly as it is, and says it did not clamp", () => {
    const out = clampText("Dark tinted wood", 4, 300);
    expect(out).toEqual({ clamped: "Dark tinted wood", wasClamped: false });
  });

  it("cuts to the line budget", () => {
    const out = clampText(LINES, 4, 300);
    expect(out.wasClamped).toBe(true);
    expect(out.clamped).toBe("line 1\nline 2\nline 3\nline 4…");
  });

  it("cuts one very long line to the character budget too", () => {
    // Fifteen short lines and one 1,800-character line are equally tall.
    const out = clampText("x".repeat(50) + " " + "y".repeat(500), 4, 300);
    expect(out.wasClamped).toBe(true);
    expect(out.clamped.length).toBeLessThanOrEqual(301);
  });

  it("backs up to a word boundary when one is close", () => {
    const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet ".repeat(8);
    const out = clampText(words, 4, 300);
    expect(out.clamped.endsWith("…")).toBe(true);
    // The kept text is a whole-word prefix of the source: the next character
    // in the original is a space, so no word was cut in half.
    const kept = out.clamped.slice(0, -1);
    expect(words.startsWith(kept)).toBe(true);
    expect(words[kept.length]).toBe(" ");
  });

  it("does not throw a long unbroken code away to find a space", () => {
    const out = clampText("REF" + "0".repeat(400), 4, 300);
    expect(out.clamped.length).toBe(301);
  });
});
