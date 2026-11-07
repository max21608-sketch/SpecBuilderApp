// The chase screen's inventory ships each question ONCE (audit F13).
import { describe, expect, it } from "vitest";
import { packContactGroups, unpackContactGroups } from "@/lib/chase-inventory";

const contact = (id: string) => ({ id, name: id });
const q = (recordId: string, requirementId: string) => ({ recordId, requirementId, prompt: `${recordId}/${requirementId}` });

describe("packContactGroups", () => {
  // Every colleague's group holds EVERY question on the project, so three
  // colleagues shipped the project's questions three times: 62.9 MB for a
  // 440-record project measured on 2026-11-06.
  const a = q("r1", "q1");
  const b = q("r1", "q2");
  const c = q("r2", "q1");
  const groups = [
    { contact: contact("designer"), questions: [a, c] },
    { contact: contact("colleague-1"), questions: [a, b, c] },
    { contact: contact("colleague-2"), questions: [a, b, c] },
  ];

  it("lists each question once, and each group by position in that list", () => {
    const packed = packContactGroups(groups);
    expect(packed.questions).toEqual([a, c, b]);
    expect(packed.groups.map((group) => group.questionIndexes)).toEqual([[0, 1], [0, 2, 1], [0, 2, 1]]);
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(groups).length);
  });

  it("unpacks to exactly the groups it was given, in order", () => {
    expect(unpackContactGroups(packContactGroups(groups))).toEqual(groups);
  });

  it("refuses an index that names no question rather than inventing an empty one", () => {
    expect(() => unpackContactGroups({ questions: [a], groups: [{ contact: contact("x"), questionIndexes: [0, 3] }] })).toThrow();
  });
});
