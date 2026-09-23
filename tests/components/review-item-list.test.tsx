// The item list on a long drawings review: one line per card, a jump, and a
// "pending only" filter that narrows what is listed and never what is asked.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewItemList, { type ReviewItemLine } from "@/components/imports/ReviewItemList";

const lines = (n: number): ReviewItemLine[] =>
  Array.from({ length: n }, (_, index) => ({
    key: `card-${index}`,
    code: `Q-${100 + index}`,
    name: index % 2 ? "Armchair" : null,
    pending: index % 5 === 0 ? 0 : index,
    blocked: index === 7 ? "No record carries this item code yet." : null,
  }));

describe("the review item list", () => {
  it("holds sixty-five items, collapsed until asked for, in a box that scrolls on its own", async () => {
    render(<ReviewItemList lines={lines(65)} current={0} onJump={() => undefined} pendingOnly onPendingOnly={() => undefined} settledHidden={0} />);
    expect(screen.queryByRole("list", { name: "Items on this screen" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All 65 items" }));
    const list = screen.getByRole("list", { name: "Items on this screen" });
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("max-h-80");
    expect(within(list).getAllByRole("button")).toHaveLength(65);
  });

  it("says, per line, the code, the name, what is left, and when it is blocked", async () => {
    render(<ReviewItemList lines={lines(10)} current={3} onJump={() => undefined} pendingOnly={false} onPendingOnly={() => undefined} settledHidden={0} />);
    await userEvent.click(screen.getByRole("button", { name: "All 10 items" }));
    const rows = within(screen.getByRole("list", { name: "Items on this screen" })).getAllByRole("button");
    expect(rows[1]!.textContent).toContain("Q-101");
    expect(rows[1]!.textContent).toContain("Armchair");
    expect(rows[1]!.textContent).toContain("1 to review");
    expect(rows[5]!.textContent).toContain("settled");
    expect(rows[7]!.textContent).toContain("blocked");
    expect(rows[3]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("1 cannot confirm yet")).toBeInTheDocument();
  });

  it("jumps to the card a line names", async () => {
    const onJump = vi.fn();
    render(<ReviewItemList lines={lines(65)} current={0} onJump={onJump} pendingOnly onPendingOnly={() => undefined} settledHidden={0} />);
    await userEvent.click(screen.getByRole("button", { name: "All 65 items" }));
    await userEvent.click(screen.getByRole("button", { name: /Q-140/ }));
    expect(onJump).toHaveBeenCalledWith(40);
  });

  it("filters to pending only, saying how many settled cards it hides", async () => {
    const onPendingOnly = vi.fn();
    render(<ReviewItemList lines={lines(4)} current={0} onJump={() => undefined} pendingOnly onPendingOnly={onPendingOnly} settledHidden={3} />);
    expect(screen.getByText("(3 settled hidden)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Pending only/ }));
    expect(onPendingOnly).toHaveBeenCalledWith(false);
  });
});
