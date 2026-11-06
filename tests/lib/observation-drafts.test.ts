// What a drawings row's draft becomes when its save comes back (audit G10).
import { describe, expect, it } from "vitest";
import { draftAfterSave, refusedSentence, typedDraft } from "@/lib/observation-drafts";

describe("draftAfterSave", () => {
  it("drops the draft once the save that carried it lands", () => {
    const drafts = { a: { value: "450" } };
    expect(draftAfterSave(drafts, "a", { value: "450" }, { ok: true })).toEqual({});
  });

  it("keeps typing that carried on while the save was away", () => {
    const drafts = { a: { value: "4500" } };
    expect(draftAfterSave(drafts, "a", { value: "450" }, { ok: true })).toEqual({ a: { value: "4500" } });
  });

  it("an emptied box and a null value are the same words", () => {
    expect(draftAfterSave({ a: { value: "" } }, "a", { value: null }, { ok: true })).toEqual({});
  });

  it("a refusal drops the typed words and leaves one sentence", () => {
    const drafts = { a: { value: "450" } };
    expect(draftAfterSave(drafts, "a", { value: "450" }, { ok: false, error: "Edited elsewhere." })).toEqual({
      a: { refused: "Your '450' was not saved: Edited elsewhere." },
    });
  });

  it("a refusal of something other than the value leaves the draft alone", () => {
    const drafts = { a: { value: "450" } };
    expect(draftAfterSave(drafts, "a", { unit: "mm" }, { ok: false, error: "No." })).toBe(drafts);
  });

  it("a later successful save clears an old refusal", () => {
    const drafts = { a: { refused: "Your '450' was not saved: x" } };
    expect(draftAfterSave(drafts, "a", { unit: "mm" }, { ok: true })).toEqual({});
  });

  it("typing again answers the refusal", () => {
    expect(typedDraft({ a: { refused: "x" } }, "a", "46")).toEqual({ a: { value: "46" } });
  });
});

describe("refusedSentence", () => {
  it("says a cleared value was not saved in words", () => {
    expect(refusedSentence(null, "No.")).toBe("Clearing this value was not saved: No.");
  });
});
