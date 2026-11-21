// Pure tier. The fill-in's sentence after "Ask the client" says where the
// question WENT (chase review A3): it read "Moved to the chase" while the
// chase ticked nothing.
import { describe, expect, it } from "vitest";
import { questionRouteSentence } from "@/lib/question-route-words";

describe("the sentence after Ask the client", () => {
  it("names whose next chase lists it, ticked", () => {
    expect(questionRouteSentence(true, { audience: "client", chasedTo: [{ contactName: "Claire Beaumont", items: 3 }], unassigned: 0 })).toBe(
      "Moved to the client on this project. The next chase to Claire Beaumont (3 items) lists it, ticked.",
    );
  });

  it("says so when an item asking it has nobody to ask", () => {
    const sentence = questionRouteSentence(true, { audience: "client", chasedTo: [{ contactName: "Claire", items: 1 }], unassigned: 2 });
    expect(sentence).toMatch(/2 items asking it have no designer to ask/);
    expect(sentence).toMatch(/Nobody assigned/);
  });

  it("never claims a chase when nobody can be asked", () => {
    const sentence = questionRouteSentence(true, { audience: "client", chasedTo: [], unassigned: 4 });
    expect(sentence).not.toMatch(/The next chase/);
    expect(sentence).toMatch(/no chase lists it yet/);
  });

  it("says a question put back is no longer chased", () => {
    expect(questionRouteSentence(false, { audience: "cam" })).toMatch(/no chase will ask it/);
  });
});
