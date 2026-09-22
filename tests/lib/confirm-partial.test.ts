// A card that confirmed A and was refused on B has not failed.
//
// Source: found-in-use 2026-09-20, observation 2 — the configuration card's
// second confirm returns 409 every run, which is the design ("a refusal on B
// leaves A applied") and which a person reads as an error because the whole
// sentence went into the red banner.
import { describe, it, expect } from "vitest";
import { describePartialConfirm } from "@/lib/confirm-partial";

describe("describePartialConfirm", () => {
  it("is a FAILURE when nothing was confirmed", () => {
    const said = describePartialConfirm({
      done: [],
      refused: { label: "S-201 A", reason: "The targets changed." },
      notAttempted: ["S-201 B"],
    });
    expect(said.notice).toBeNull();
    expect(said.failure).toContain("S-201 A refused: The targets changed.");
    expect(said.failure).toContain("Nothing was written for it.");
    expect(said.failure).toContain("S-201 B was not attempted.");
  });

  it("is a NOTICE when something was confirmed, and names what to press again", () => {
    const said = describePartialConfirm({
      done: ["S-201 A"],
      refused: { label: "S-201 B", reason: "The targets changed." },
      notAttempted: [],
    });
    expect(said.failure).toBeNull();
    expect(said.notice).toContain("S-201 A confirmed.");
    expect(said.notice).toContain("S-201 B refused");
    // The half that was missing: what is left to do.
    expect(said.notice).toContain("S-201 B can be confirmed again from here");
  });

  it("names every configuration still to confirm, not only the refused one", () => {
    const said = describePartialConfirm({
      done: ["S-301 A"],
      refused: { label: "S-301 B", reason: "Stale." },
      notAttempted: ["S-301 C", "S-301 D"],
    });
    expect(said.notice).toContain("S-301 C and S-301 D were not attempted.");
    expect(said.notice).toContain("S-301 B and S-301 C and S-301 D can be confirmed again");
  });

  it("sets exactly one of the two channels, always", () => {
    for (const done of [[], ["A"]]) {
      const said = describePartialConfirm({
        done,
        refused: { label: "B", reason: "x" },
        notAttempted: [],
      });
      expect([said.failure, said.notice].filter(Boolean)).toHaveLength(1);
    }
  });
});
