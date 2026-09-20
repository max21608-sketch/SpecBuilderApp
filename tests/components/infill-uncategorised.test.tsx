// The items a meeting cannot fill in yet.
//
// A record with no category has no questions, so it contributes nothing to any
// outstanding count and would simply not appear. These assert that it appears,
// that the control that unblocks it is beside it, and that ninety-six of them
// do not bury the table below.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UncategorisedBlock, { type UncategorisedRecord } from "@/components/infill/UncategorisedBlock";

const CATEGORIES = [
  { id: "cat-1", family: "upholstery", name: "Armchairs, Benches, Stools, Sofas" },
  { id: "cat-2", family: "cabinetry", name: "Desks" },
];

function records(n: number): UncategorisedRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    recordId: `rec-${i}`,
    recordLabel: `DEMO-300-${String(i + 1).padStart(3, "0")}`,
    itemDescription: "Ottoman @ bed end",
    version: 1,
  }));
}

describe("UncategorisedBlock", () => {
  it("lists the item with a category picker beside it", () => {
    render(<UncategorisedBlock records={records(1)} categories={CATEGORIES} onChanged={vi.fn()} />);
    expect(screen.getByText(/1 item cannot be filled in until categorised/)).toBeInTheDocument();
    expect(screen.getByLabelText("Category for DEMO-300-001")).toBeInTheDocument();
  });

  it("the picker starts empty, so choosing always fires", () => {
    render(<UncategorisedBlock records={records(1)} categories={CATEGORIES} onChanged={vi.fn()} />);
    expect(screen.getByLabelText("Category for DEMO-300-001")).toHaveValue("");
  });

  it("folds a long list and says how many there are", async () => {
    const user = userEvent.setup();
    render(<UncategorisedBlock records={records(96)} categories={CATEGORIES} onChanged={vi.fn()} />);
    expect(screen.getByText(/96 items cannot be filled in until categorised/)).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /Show all 96/ }));
    expect(screen.getAllByRole("combobox")).toHaveLength(96);
  });
});
