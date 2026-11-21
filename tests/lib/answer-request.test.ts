// Where one checklist answer is sent (review 1, finding 1): the row's PATCH,
// or — where the question has no row yet — the record's POST, which creates
// it. Both screens build their request here.
import { describe, expect, it } from "vitest";
import { answerRequest } from "@/lib/answer-request";

describe("answerRequest", () => {
  it("PATCHes the row, with the version the screen read", () => {
    const { url, init } = answerRequest(
      { recordId: "rec-1", requirementId: "req-1", answerId: "ans-1", answerVersion: 4 },
      { value: "Oak", state: "confirmed" },
    );
    expect(url).toBe("/api/answers/ans-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ value: "Oak", state: "confirmed", version: 4 });
  });

  it("POSTs to the record with the question where there is no row, and sends no version", () => {
    const { url, init } = answerRequest(
      { recordId: "rec-1", requirementId: "req-9", answerId: null, answerVersion: null },
      { value: "Yes", state: "confirmed", reason: "Client said so", qualifier: null },
    );
    expect(url).toBe("/api/records/rec-1/answers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      value: "Yes",
      state: "confirmed",
      reason: "Client said so",
      qualifier: null,
      requirementId: "req-9",
    });
  });

  it("leaves the qualifier out where the screen did not send one, so the route keeps it", () => {
    const { init } = answerRequest(
      { recordId: "rec-1", requirementId: "req-1", answerId: "ans-1", answerVersion: 1 },
      { value: "Oak", state: "confirmed" },
    );
    expect(JSON.parse(String(init.body))).not.toHaveProperty("qualifier");
  });
});
