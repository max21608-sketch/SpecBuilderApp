// Reading a finish out of an email. Every case is from the real Panther email
// of 16 Sept 2026, or is the misreading the code gate exists to prevent.
import { describe, expect, it } from "vitest";
import { readFinish, leadingFinishCode } from "@/lib/spec-finishes";

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
