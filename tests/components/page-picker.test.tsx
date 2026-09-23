// A card's page list, which must stay one line however large the document is.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PagePicker, { MAX_PAGE_BUTTONS } from "@/components/imports/PagePicker";

describe("the page picker", () => {
  it("is a button per page up to eight", () => {
    render(<PagePicker pages={[1, 2, 3]} current={2} onPick={() => undefined} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["page 1", "page 2", "page 3"]);
  });

  it("offers nothing for one page", () => {
    const { container } = render(<PagePicker pages={[4]} current={4} onPick={() => undefined} />);
    expect(container.textContent).toBe("");
  });

  it("becomes previous / next with 'page n of N' beyond eight", async () => {
    const pages = Array.from({ length: MAX_PAGE_BUTTONS + 22 }, (_, index) => index + 3);
    const onPick = vi.fn();
    render(<PagePicker pages={pages} current={10} onPick={onPick} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText(`page 10 · 8 of ${pages.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onPick).toHaveBeenCalledWith(11);
    await userEvent.click(screen.getByRole("button", { name: /Previous/ }));
    expect(onPick).toHaveBeenLastCalledWith(9);
  });

  it("cannot step past either end", () => {
    const pages = Array.from({ length: 12 }, (_, index) => index + 1);
    render(<PagePicker pages={pages} current={1} onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });
});
