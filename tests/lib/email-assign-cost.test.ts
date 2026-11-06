// The sentence under the inbox's Assign button (audit A1). A message taken
// off a project and put back there re-links the run it has and reads nothing;
// on any other project it is a new charged read.
import { describe, expect, it } from "vitest";
import { assignCost } from "@/lib/email-assign-cost";

const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", bws_project_number: "P18181" };
const B = { id: "bbbbbbbb-0000-0000-0000-000000000002", bws_project_number: "P16717" };

describe("assignCost", () => {
  it("is free on a project that already read the message", () => {
    const cost = assignCost([A.id], A);
    expect(cost.free).toBe(true);
    expect(cost.label).toBe("Put it back");
    expect(cost.sentence).toBe("Already read on P18181: putting it back there reads nothing.");
  });

  it("names the charge when the message moves to a project that never read it", () => {
    const cost = assignCost([A.id], B);
    expect(cost.free).toBe(false);
    expect(cost.sentence).toBe("Reading it again on P16717 is a charged read.");
  });

  it("is the ordinary charge for a message never read anywhere", () => {
    expect(assignCost([], B)).toEqual({ free: false, label: "Assign & read", sentence: "One charged model call." });
    expect(assignCost(null, null).sentence).toBe("One charged model call.");
  });
});
