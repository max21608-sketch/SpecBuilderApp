// The "Say which record this is" picker, as found on pilot on 2026-10-05.
//
// AM-ID-MUR-FUR-13 is a mock-up drawing on a project with no mock-up phase, so
// its card resolved to nothing and the picker listed every record by OUR
// number. "13" then read as record 13 -- a coffee table -- where FUR-13 is the
// bathroom side table the bill lists as GR-FUR-13 and PL-FUR-13. And a record
// picked by hand was shown nowhere afterwards, so the pick looked as though it
// had not happened.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RunTargets, type RecordChoice } from "@/components/imports/ObservationRows";

const RECORDS: RecordChoice[] = [
  { id: "r-46", label: "P18181 v3-046", codes: ["GR-FUR-13"], itemDescription: "Side Table @ Bathroom", runName: "Main Phase" },
  { id: "r-49", label: "P18181 v3-049", codes: ["PL-FUR-13"], itemDescription: "Side Table @ Bathroom", runName: "Main Phase" },
  { id: "r-13", label: "P18181 v3-013", codes: ["GR-FUR-02"], itemDescription: "Coffee Table @ Lounge", runName: "Main Phase" },
];

function picker(ticked: string[] = [], codeMatches: string[] = ["r-46", "r-49"]) {
  const onToggle = vi.fn();
  render(
    <RunTargets
      runs={[]}
      ticked={new Set(ticked)}
      itemCodeRaw="FUR-13"
      records={RECORDS}
      busy={false}
      onToggle={onToggle}
      onPick={vi.fn()}
      codeMatches={codeMatches}
      mockup={{ message: "This is a mock-up drawing, and no mock-up record carries FUR-13 yet." }}
    />,
  );
  return { onToggle };
}

describe("the hand picker on a card that resolved to nothing", () => {
  it("names each record by the client's code first and our number last", () => {
    picker();
    expect(screen.getByRole("option", { name: /^GR-FUR-13 · Side Table @ Bathroom \(Main Phase\) · P18181 v3-046$/ })).toBeTruthy();
  });

  it("lists the records carrying the page's code first, in their own group", () => {
    picker();
    const groups = screen.getAllByRole("group");
    expect(groups[0]!.getAttribute("label")).toBe("Carrying FUR-13");
    expect(within(groups[0]!).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "GR-FUR-13 · Side Table @ Bathroom (Main Phase) · P18181 v3-046",
      "PL-FUR-13 · Side Table @ Bathroom (Main Phase) · P18181 v3-049",
    ]);
    expect(within(groups[1]!).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "GR-FUR-02 · Coffee Table @ Lounge (Main Phase) · P18181 v3-013",
    ]);
    expect(screen.getByText(/2 records carry FUR-13; they are at the top of the list/)).toBeTruthy();
  });

  it("uses no groups where nothing carries the code", () => {
    picker([], []);
    expect(screen.queryAllByRole("group")).toEqual([]);
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("shows a record picked by hand, ticked, and unticks it on a click", () => {
    const { onToggle } = picker(["r-46"]);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(screen.getByText(/^GR-FUR-13 · Side Table @ Bathroom · P18181 v3-046 · picked by hand$/)).toBeTruthy();
    box.click();
    expect(onToggle).toHaveBeenCalledWith("r-46", false);
  });
});
