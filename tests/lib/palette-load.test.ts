// Pure tier — the link half of the palette loader.
//
// `loadPalettes` itself is two statements and is asserted against the seeded
// register in the db tier. What is decided in code is which FIELD offers which
// list, and that is here: it is the step a drawings observation resolves
// through, and the step that has to answer "nothing" honestly rather than
// guessing when the register is short.
import { describe, expect, it } from "vitest";
import { palettesByFieldJsonId, withPalettes, type PaletteRegister } from "@/lib/palette-load";
import type { PaletteRow } from "@/lib/palettes";

const timber: PaletteRow = {
  key: "bws_timber_finish",
  name: "BWS timber finish palette",
  owner: "bws",
  allows_free_text: true,
  source_note: "Captured from BWS 2026-09-22.",
  synced_at: "2026-09-22T00:00:00.000Z",
  options: [{ value: "BW Oak Natural", label: "BW Oak Natural", sortOrder: 1, isDefault: false, code: null }],
};

const metal: PaletteRow = {
  key: "bws_metal_finish",
  name: "BWS metal finish palette",
  owner: "bws",
  allows_free_text: true,
  source_note: "Captured from BWS 2026-09-22.",
  synced_at: "2026-09-22T00:00:00.000Z",
  options: [{ value: "BW Antiqued Brass", label: "BW Antiqued Brass", sortOrder: 1, isDefault: false, code: null }],
};

/** A gate row pointing at a list nobody has read yet. Nothing is unheld today. */
const unheld: PaletteRow = {
  key: "bws_glass_mirror",
  name: "BWS glass and mirror palette",
  owner: "bws",
  allows_free_text: true,
  source_note: "NOT HELD.",
  synced_at: null,
  options: [],
};

const register: PaletteRegister = {
  palettes: [timber, metal, unheld],
  paletteByQuestion: [
    // Matthew's rows 18, 19 and 20: three timber fields, one list.
    { json_id: 4, local_key: null, palette_key: "bws_timber_finish" },
    { json_id: 31, local_key: null, palette_key: "bws_timber_finish" },
    { json_id: 143, local_key: null, palette_key: "bws_timber_finish" },
    { json_id: 5, local_key: null, palette_key: "bws_metal_finish" },
    { json_id: 35, local_key: null, palette_key: "bws_metal_finish" },
    // A readiness row: no BWS field, addressed by its local key instead.
    { json_id: null, local_key: "headboard_fitted", palette_key: "yes_no" },
  ],
};

describe("palettesByFieldJsonId", () => {
  it("gives the three timber fields and the two metal ones one list each", () => {
    const byField = palettesByFieldJsonId(register);
    expect(byField.get(4)?.key).toBe("bws_timber_finish");
    expect(byField.get(31)?.key).toBe("bws_timber_finish");
    expect(byField.get(143)?.key).toBe("bws_timber_finish");
    expect(byField.get(5)?.key).toBe("bws_metal_finish");
    expect(byField.get(35)?.key).toBe("bws_metal_finish");
  });

  it("folds the row into the domain type, options and all", () => {
    const palette = palettesByFieldJsonId(register).get(4);
    expect(palette?.allowsFreeText).toBe(true);
    expect(palette?.options[0]?.value).toBe("BW Oak Natural");
  });

  it("skips a local-key row rather than guessing a field for it", () => {
    // A readiness question has no BWS field, and a drawing has no way to reach
    // one: a callout carries a `spec_fields.id` and nothing else.
    const byField = palettesByFieldJsonId(register);
    expect([...byField.keys()]).toEqual([4, 31, 143, 5, 35]);
  });

  it("gives nothing for a field with no link — COM 1 is free text in BWS", () => {
    expect(palettesByFieldJsonId(register).get(1)).toBeUndefined();
  });

  it("drops a link whose palette is not in the register", () => {
    // A key with no row behind it is a seed that has not landed, not a reason
    // to render half a control.
    const short: PaletteRegister = {
      palettes: [],
      paletteByQuestion: register.paletteByQuestion,
    };
    expect(palettesByFieldJsonId(short).size).toBe(0);
  });
});

describe("withPalettes", () => {
  const fields = [
    { id: "field-timber", json_id: 4, name: "Main timber finish" },
    { id: "field-com1", json_id: 1, name: "COM 1" },
    { id: "field-metal", json_id: 5, name: "Main metal finish" },
  ];

  it("attaches the list to the field register the screens already thread", () => {
    const out = withPalettes(fields, register);
    expect(out.map((field) => field.palette?.key ?? null)).toEqual([
      "bws_timber_finish",
      null,
      "bws_metal_finish",
    ]);
  });

  it("keeps every column the caller selected", () => {
    const out = withPalettes(fields, register);
    expect(out[0]).toMatchObject({ id: "field-timber", json_id: 4, name: "Main timber finish" });
  });

  it("writes null on every field when the register is empty", () => {
    // The register unavailable is not a reason to render differently from the
    // confirm: the row goes back to what it was before palettes existed.
    const out = withPalettes(fields, { palettes: [], paletteByQuestion: [] });
    expect(out.every((field) => field.palette === null)).toBe(true);
  });

  it("carries an UNHELD palette through rather than dropping it", () => {
    // Zero options is a state a screen has to say out loud. Dropping it here
    // would make the row look like one with no list at all, which is a
    // different and quieter thing.
    const out = withPalettes([{ id: "field-glass", json_id: 99 }], {
      palettes: [unheld],
      paletteByQuestion: [{ json_id: 99, local_key: null, palette_key: "bws_glass_mirror" }],
    });
    expect(out[0]?.palette?.key).toBe("bws_glass_mirror");
    expect(out[0]?.palette?.options).toEqual([]);
  });
});
