// One number at the top of a screen, and what pressing it does.
//
// THE TILE NO LONGER SAYS IN WORDS THAT IT IS PRESSABLE (2026-09-21). The blue
// "filter to these →" line made every tile four rows tall and pushed a phase
// screen's own table header below the fold. What it had to keep doing is what
// these tests hold: the whole tile is still the control, and a filtering tile
// still reports its ACTIVE state -- which the words used to carry as "showing
// these" against "show these" and which is now `aria-pressed` and the ring.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatTile from "@/components/ui/StatTile";

describe("a summary tile", () => {
  it("renders a plain box when there is nowhere to go", () => {
    // `href: null` rather than absent, so a caller with nothing to link to says
    // so. A link that goes nowhere is worse than text.
    render(<StatTile label="Overdue" value={0} href={null} meaning="past specs-agreed-by" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("is a link when it goes to another screen", () => {
    render(<StatTile label="Unplaced mail" value={3} href="/dashboard/inbox" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/dashboard/inbox");
  });

  it("is a pressed-state button when it filters the list on this screen", async () => {
    // A tile is either a link somewhere or a filter here, never both —
    // `Button.tsx`'s rule cuts both ways, and changing what you are looking at
    // is not navigation.
    const onPress = vi.fn();
    render(<StatTile label="TGQ" value={167} onPress={onPress} active />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("says nothing about what pressing it does", () => {
    // The pointer, the focus ring and the hover shadow say it is pressable.
    // A sentence saying so as well is a fourth row on every tile in the app.
    render(<StatTile label="TGQ" value={167} href="/dashboard/records" meaning="blocking a quotation" />);
    expect(screen.getByRole("link").textContent).toBe("TGQ167blocking a quotation");
  });

  it("groups the number, because 1899 and 1,899 are not read at the same speed", () => {
    render(<StatTile label="TGQ" value={1899} href={null} />);
    expect(screen.getByText("1,899")).toBeInTheDocument();
  });
});
