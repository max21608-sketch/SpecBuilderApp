import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isIntakeRunInFlight } from "@/lib/intake-status";

describe("isIntakeRunInFlight — the polling predicate", () => {
  it("polls while a document is being read", () => {
    expect(isIntakeRunInFlight({ status: "queued" })).toBe(true);
    expect(isIntakeRunInFlight({ status: "parsing" })).toBe(true);
  });

  it("polls while a document is WAITING FOR A SLOT, because it starts on its own", () => {
    // The pack screen stopped polling here, and a waiting read that then ran
    // was only seen after a reload (found-in-use, 2026-09-23).
    expect(isIntakeRunInFlight({ status: "pending", waitingForSlot: true })).toBe(true);
  });

  it("does not poll a document nobody has asked to read, or one that has settled", () => {
    expect(isIntakeRunInFlight({ status: "pending", waitingForSlot: false })).toBe(false);
    expect(isIntakeRunInFlight({ status: "pending" })).toBe(false);
    for (const status of ["parsed", "confirmed", "failed"]) {
      expect(isIntakeRunInFlight({ status, waitingForSlot: true })).toBe(false);
    }
  });
});

describe("the waiting-for-a-slot expression", () => {
  // Three copies, because the HTTP driver cannot share a SQL fragment. If they
  // drift, the overview, the pack screen and the drawings step disagree about
  // which documents are waiting, and one of them stops polling.
  const fold = (text: string) => text.replace(/\s+/g, " ");
  const expression = "(r.status = 'pending' and r.attempt_id is null and r.attempt_deadline_at > now())";
  for (const file of [
    "src/app/api/projects/[id]/route.ts",
    "src/app/api/projects/[id]/batches/route.ts",
    "src/lib/drawing-resolution.ts",
  ]) {
    it(`is the same in ${file}`, () => {
      expect(fold(readFileSync(file, "utf8"))).toContain(expression);
    });
  }
});
