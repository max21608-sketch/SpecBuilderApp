// Pure tier: who a chase may ask what (0062, decision D).
import { describe, expect, it } from "vitest";
import { audienceRefusal } from "@/lib/chase-audience";

describe("audienceRefusal", () => {
  it("lets a designer or a client be asked a client question", () => {
    expect(audienceRefusal({ audience: "client" }, "designer")).toBeNull();
    expect(audienceRefusal({ audience: "client" }, "client")).toBeNull();
  });

  it("refuses an in-house or a CAM question to a designer or a client, in words", () => {
    expect(audienceRefusal({ audience: "in_house" }, "designer")).toMatch(/in-house/);
    expect(audienceRefusal({ audience: "cam" }, "client")).toMatch(/CAM/);
  });

  it("lets a colleague be sent anything", () => {
    for (const audience of ["in_house", "cam", "client"] as const) {
      expect(audienceRefusal({ audience }, "internal")).toBeNull();
    }
  });

  it("refuses where the recipient's role is not known, which is the direction that never sends", () => {
    expect(audienceRefusal({ audience: "in_house" }, undefined)).not.toBeNull();
  });
});
