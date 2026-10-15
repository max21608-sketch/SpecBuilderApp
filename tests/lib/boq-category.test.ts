// The category a bill line's name suggests (`suggestCategory`), pure.
//
// One decision, two callers: the staging (`loadLineSuggester`) and
// `npm run boq:gap -- --categories`. The database tier holds the seeded words;
// this holds the rules around them.
import { describe, expect, it } from "vitest";
import { suggestCategory, type CategoryRegister } from "@/lib/boq-stage";

const register: CategoryRegister = {
  categories: [
    { id: "side", name: "Side Coffee Bedside Tables" },
    { id: "dining", name: "Dining tables" },
    { id: "seat", name: "Armchairs Benches Stools Sofas" },
  ],
  aliases: [
    { categoryId: "side", term: "Side table" },
    { categoryId: "dining", term: "Dining table" },
    { categoryId: "dining", term: "Lounge table" },
    { categoryId: "seat", term: "Pouf" },
  ],
};

describe("suggestCategory", () => {
  it("matches a name written `<item> @ <where>` on the item alone", () => {
    // Read whole, "Side Table @ Lounge" ties Side table with Lounge table.
    expect(suggestCategory("Side Table @ Lounge", register)).toEqual({ status: "suggested", categoryId: "side" });
    expect(suggestCategory("Pouf @ Bedroom", register)).toEqual({ status: "suggested", categoryId: "seat" });
    expect(suggestCategory("Pouf @", register)).toEqual({ status: "suggested", categoryId: "seat" });
  });

  it("reads a name that is only the @ part whole, as before", () => {
    expect(suggestCategory("@ Lounge table", register)).toEqual({ status: "suggested", categoryId: "dining" });
  });

  it("leaves a tie between two sheets to a person", () => {
    const tie = suggestCategory("Table", register);
    expect(tie.status).toBe("ambiguous");
    expect(tie.status === "ambiguous" ? tie.candidates.map((c) => c.id).sort() : []).toEqual(["dining", "side"]);
  });

  it("calls several terms naming ONE sheet agreement", () => {
    expect(suggestCategory("Dining table", register)).toEqual({ status: "suggested", categoryId: "dining" });
    expect(suggestCategory("Sofa", register)).toEqual({ status: "none", categoryId: null });
  });
});
