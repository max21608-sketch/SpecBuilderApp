// The per-project daily cap on reads the app starts by itself (audit A5).
// The count is the database's (tests/db/email-auto-assign.test.ts); this is
// the number in force and who counts as "by itself".
import { describe, expect, it } from "vitest";
import {
  AUTO_READ_DAILY_CAP_DEFAULT,
  autoReadCapSentence,
  autoReadDailyCap,
  isAutomaticActor,
} from "@/lib/auto-read-cap";
import { ROUTER_ACTOR } from "@/lib/email-routing";

describe("autoReadDailyCap", () => {
  it("is Max's twenty unless a deployment says otherwise", () => {
    expect(AUTO_READ_DAILY_CAP_DEFAULT).toBe(20);
    expect(autoReadDailyCap({})).toBe(20);
    expect(autoReadDailyCap({ AUTO_READ_DAILY_CAP: "5" })).toBe(5);
    expect(autoReadDailyCap({ AUTO_READ_DAILY_CAP: " 40 " })).toBe(40);
    // Zero is a real setting: no automatic reads at all, every one held.
    expect(autoReadDailyCap({ AUTO_READ_DAILY_CAP: "0" })).toBe(0);
  });

  it("ignores a value that is not a whole number rather than reading it as none or as no limit", () => {
    for (const typo of ["", "twenty", "-1", "2.5", "1e9", "Infinity"]) {
      expect(autoReadDailyCap({ AUTO_READ_DAILY_CAP: typo })).toBe(20);
    }
  });

  it("says the cap and the next step in one sentence", () => {
    expect(autoReadCapSentence(20)).toBe(
      "The automatic-read cap for this project (20 a day) is reached; a person starts this read.",
    );
  });
});

describe("isAutomaticActor", () => {
  it("counts the router, and never a person", () => {
    expect(isAutomaticActor(ROUTER_ACTOR)).toBe(true);
    expect(isAutomaticActor("system:microsoft-graph")).toBe(true);
    expect(isAutomaticActor("max@benwhistler.test")).toBe(false);
    expect(isAutomaticActor("qa-seed")).toBe(false);
  });
});
