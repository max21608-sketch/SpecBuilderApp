// Reading a finish out of an email. Every case is from the real Panther email
// of 16 Sept 2026, or is the misreading the code gate exists to prevent.
import { describe, expect, it } from "vitest";
import { readFinish, readFinishes, leadingFinishCode } from "@/lib/spec-finishes";

describe("leadingFinishCode", () => {
  it("reads the client's own code off the front of a value", () => {
    expect(leadingFinishCode("UPH-07")).toBe("UPH-07");
    expect(leadingFinishCode("WD-05 ceruse finish oak")).toBe("WD-05");
    expect(leadingFinishCode("CLO003 A (Tibor Blob Amber Fern)")).toBe("CLO003");
    expect(leadingFinishCode("CH-01.1 boucle")).toBe("CH-01.1");
  });

  it("ignores a code mentioned in passing", () => {
    // A cross-reference is not this row's subject. Anchored on purpose.
    expect(leadingFinishCode("oak, see UPH-07 for the seat")).toBeNull();
    expect(leadingFinishCode("as the sofa")).toBeNull();
    expect(leadingFinishCode("445mm")).toBeNull();
  });
});

describe("readFinish", () => {
  it("reads a fabric from the client's code where the words say nothing", () => {
    const reading = readFinish("Outside back", "UPH-07");
    expect(reading?.kind).toBe("fabric");
    expect(reading?.group).toBe("material");
    expect(reading?.codeRaw).toBe("UPH-07");
  });

  it("reads a timber", () => {
    const reading = readFinish("Timber (legs and front rail)", "WD-05 ceruse finish oak");
    expect(reading?.kind).toBe("timber");
    expect(reading?.group).toBe("finish");
    expect(reading?.codeRaw).toBe("WD-05");
  });

  it("reads a fabric whose code prefix nothing maps, from the label's own word", () => {
    // CLO is not a mapped prefix and deliberately is not guessed at; the label
    // saying "Fabric" is what decides.
    const reading = readFinish("Fabric (A configuration)", "CLO003 A (Tibor Blob Amber Fern)");
    expect(reading?.kind).toBe("fabric");
    expect(reading?.codeRaw).toBe("CLO003");
  });

  it("records an undecided fabric rather than losing it", () => {
    const reading = readFinish("Fabric (B configuration)", "TBC");
    expect(reading?.kind).toBe("fabric");
    expect(reading?.tbc).toBe(true);
    expect(reading?.codeRaw).toBeNull();
  });

  it("REFUSES prose with no code, which is the whole point of the gate", () => {
    // An email is prose. One fabric word in a build instruction would put that
    // instruction in COM 1.
    expect(readFinish("Seat upholstery build", "loose cushions, feather wrap")).toBeNull();
    expect(readFinish("Back cushion type", "two scatter cushions")).toBeNull();
    expect(readFinish("Purchasing notes", "order the fabric early")).toBeNull();
  });

  it("refuses anything that is not a material at all", () => {
    expect(readFinish("Seat height", "445mm")).toBeNull();
    expect(readFinish("Arm height", "520mm from FFL")).toBeNull();
    expect(readFinish("Delivery", "TBC")).toBeNull();
    expect(readFinish(null, null)).toBeNull();
  });
});

// ============================================================================
// A BILL'S FINISH LINES (plan any-bill, Step 8). Invented codes, in the shapes
// a pricing document prints them.
// ============================================================================
describe("readFinishes — a bill's finish lines", () => {
  it("reads a code under the document's own zone by its material", () => {
    expect(leadingFinishCode("ZZ-TIM-04 LIMED OAK")).toBe("ZZ-TIM-04");
    const timber = readFinish("Wood", "ZZ-TIM-04 LIMED OAK");
    expect(timber).toMatchObject({ kind: "timber", codeRaw: "ZZ-TIM-04", kindCodeRaw: "TIM-04" });
    expect(readFinish("Base", "ZZ-MTL-02 DARK BRONZE")).toMatchObject({ kind: "metal", codeRaw: "ZZ-MTL-02" });
    expect(readFinish("Finish", "TIM-21")).toMatchObject({ kind: "timber", codeRaw: "TIM-21" });
  });

  it("reads a code run together with its description", () => {
    expect(leadingFinishCode("ZZ-MTL-02DARK BRONZE")).toBe("ZZ-MTL-02");
  });

  it("reads several codes in one value as several statements", () => {
    const readings = readFinishes("Finish", "STN-07, MTL-02, TIM-21");
    expect(readings.map((reading) => [reading.codeRaw, reading.kind, reading.value])).toEqual([
      ["STN-07", null, "STN-07"],
      ["MTL-02", "metal", "MTL-02"],
      ["TIM-21", "timber", "TIM-21"],
    ]);
    // One per line, where the cell writes them over two lines. Read as one
    // value, "bronze" made the timber a metal.
    const lines = readFinishes("Finish", "ZZ-TIM-04 LIMED OAK\nZZ-MTL-02 DARK BRONZE");
    expect(lines.map((reading) => [reading.codeRaw, reading.kind])).toEqual([
      ["ZZ-TIM-04", "timber"],
      ["ZZ-MTL-02", "metal"],
    ]);
  });

  it("does not split a value whose pieces are not all codes", () => {
    expect(readFinishes("Wood", "TIM-21 oak, limed").map((reading) => reading.value)).toEqual(["TIM-21 oak, limed"]);
  });

  it("keeps a stone code against the item and places it in no field", () => {
    const stone = readFinish("Top", "ZZ-STN-03 COMPOSITE");
    expect(stone).toMatchObject({ kind: null, group: "finish", codeRaw: "ZZ-STN-03" });
    expect(stone?.noField).toMatch(/stone code and no BWS field holds it/);
    expect(readFinish("Finish", "SPF-08 RAKU")?.noField).toMatch(/no BWS field holds it/);
  });

  it("reads COM as customer's own material, never as a fabric that claims COM 1", () => {
    for (const value of ["COM", "com", "C.O.M.", "Customer's own material"]) {
      const reading = readFinish("Fabric", value);
      expect(reading).toMatchObject({ kind: null, group: "note", codeRaw: null });
      expect(reading?.noField).toMatch(/customer's own material/);
    }
    // A COM LABEL over a real fabric code is still that fabric.
    expect(readFinish("COM", "FAB-31")).toMatchObject({ kind: "fabric", codeRaw: "FAB-31" });
  });
});
