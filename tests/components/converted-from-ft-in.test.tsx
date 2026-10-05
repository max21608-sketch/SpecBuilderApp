// Feet and inches on a screen: as printed, the millimetres beside, and a chip.
//
// Component tier. The bill review's line under an item and the drawings cards'
// "BWS Dimensions" box both read the composer's screen mode; where it converted,
// the box also prints what BWS RECEIVES, because its heading promises the file.
// Synthetic cells only.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillDescriptionSummary } from "@/components/imports/BillDescription";
import { ComposedDimensionText } from "@/components/records/ItemSpecChips";
import { planBillDescription } from "@/lib/bill-description";
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";

describe("the bill review's size chip", () => {
  it("reads the bill's feet and inches as printed, with the millimetres and the chip", () => {
    const plan = planBillDescription("Desk\nSizes (ft-in): W 3'5\"\" X D 1'-9 1/2\"\" X H 2'-4\"\"", {
      fields: [],
      hasFabricLine: false,
    })!;
    render(<BillDescriptionSummary plan={plan} open={false} onToggle={() => {}} />);
    const chip = screen.getByText('W 3\'5" (1041mm) x D 1\'-9 1/2" (546mm) x H 2\'-4" (711mm)');
    // What BWS receives is still the plan's millimetre cell, on the chip's title.
    expect(chip).toHaveAttribute("title", expect.stringContaining("W1041 x D546 x H711mm"));
    expect(screen.getByText("converted from ft-in")).toBeInTheDocument();
  });

  it("shows no chip on a metric size", () => {
    const plan = planBillDescription("Table\nSizes (mm): W 900 x D 900 x H 750", { fields: [], hasFabricLine: false })!;
    render(<BillDescriptionSummary plan={plan} open={false} onToggle={() => {}} />);
    expect(screen.getByText("W900 x D900 x H750mm")).toBeInTheDocument();
    expect(screen.queryByText("converted from ft-in")).toBeNull();
  });
});

describe("a composed cell that promises the file", () => {
  const rows: DimensionRow[] = [
    { slot: "W", value: '21"', unit: "in", state: "confirmed", sortOrder: 0 },
    { slot: "D", value: "610", unit: "mm", state: "confirmed", sortOrder: 1 },
  ];

  it("prints what BWS receives under a converted cell", () => {
    const shown = composeDimensionCell(rows, null, { mode: "screen" });
    const file = composeDimensionCell(rows);
    render(<ComposedDimensionText shown={shown} fileText={file.text} />);
    expect(screen.getByText(/W 21" \(533mm\) x D610mm/)).toBeInTheDocument();
    expect(screen.getByText("W533 x D610mm")).toBeInTheDocument();
    expect(screen.getByText("converted from ft-in")).toBeInTheDocument();
  });

  it("prints the one cell, and nothing under it, where nothing converted", () => {
    const metric: DimensionRow[] = [{ slot: "W", value: "540", unit: "mm", state: "confirmed", sortOrder: 0 }];
    const shown = composeDimensionCell(metric, null, { mode: "screen" });
    render(<ComposedDimensionText shown={shown} fileText={composeDimensionCell(metric).text} />);
    expect(screen.getByText("W540mm")).toBeInTheDocument();
    expect(screen.queryByText(/BWS receives/)).toBeNull();
  });
});
