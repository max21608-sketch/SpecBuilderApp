// The one tab strip, and the two things about it that are decisions rather
// than styling: which counts render, and that a tab is a tab.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Tabs from "@/components/ui/Tabs";

function strip(props: Partial<Parameters<typeof Tabs<string>>[0]> = {}) {
  return render(
    <Tabs
      label="Sections"
      value="a"
      onChange={() => {}}
      items={[
        { id: "a", label: "First" },
        { id: "b", label: "Second" },
      ]}
      {...props}
    />,
  );
}

describe("the tab strip", () => {
  it("renders no bubble for a count that is absent or null", () => {
    strip({
      items: [
        { id: "a", label: "First" },
        { id: "b", label: "Second", count: null },
      ],
    });
    // Both tabs carry their label and nothing else. A `null` count is the
    // record screen's "Matthew's matrix does not reach this category", which
    // is a different answer from zero and must not render as one.
    expect(screen.getByRole("tab", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Second" })).toBeInTheDocument();
  });

  it("renders a bubble for a count of 0, because a count the caller supplied is a count", () => {
    strip({
      items: [
        { id: "a", label: "First", count: 0 },
        { id: "b", label: "Second", count: 4 },
      ],
    });
    const [first, second] = screen.getAllByRole("tab");
    expect(first).toHaveTextContent("First0");
    expect(second).toHaveTextContent("Second4");
  });

  it("marks the selected tab with aria-selected, not aria-current", () => {
    strip({ value: "b" });
    // `aria-current="page"` was what three of the four hand-rolled strips used,
    // and it says "this is the current PAGE" — which is wrong on every one of
    // them, because none of these tabs is a navigation.
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "First" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
  });

  it("reports the tab that was pressed", async () => {
    const onChange = vi.fn();
    strip({ onChange });
    await userEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("strikes through a muted tab and drops a hidden one", () => {
    strip({
      items: [
        { id: "a", label: "First" },
        { id: "b", label: "Second", muted: true },
        { id: "c", label: "Third", hidden: true },
      ],
    });
    // A BOQ sheet the reviewer has marked as not to be imported KEEPS its tab
    // rather than disappearing: dismissing it is a decision somebody has to be
    // able to undo.
    expect(screen.getByRole("tab", { name: "Second" }).className).toContain("line-through");
    expect(screen.queryByRole("tab", { name: "Third" })).not.toBeInTheDocument();
  });
});
