// The BOQ review's line under an item: what its description cell becomes.
//
// The plan is the pure function's own output over a SYNTHETIC cell (the Aman
// pricing document's shape, invented figures and codes), so what this renders
// is what the confirm writes — the component computes nothing.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BillDescriptionPanelRow, BillDescriptionSummary, type ReviewDescription } from "@/components/imports/BillDescription";
import { planBillDescription } from "@/lib/bill-description";
import type { SpecFieldEntry } from "@/lib/drawing-document";

const FIELDS: SpecFieldEntry[] = [
  { id: "f-com1", jsonId: 1, name: "COM 1" },
  { id: "f-tim1", jsonId: 4, name: "Main timber finish" },
  { id: "f-mtl1", jsonId: 5, name: "Main metal finish" },
];

const CELL = [
  "Coffee Table @ Example Lounge",
  "Model Ref: BESPOKE DESIGN",
  "Sizes (Inch): 20\"\" (1'-8\"\") H X 2'-6\"\" DIA",
  "Sizes (mm): Dia 760 x H 510",
  "Finish: ZZ-TIM-07 EXAMPLE OAK",
  "ZZ-MTL-01 EXAMPLE BRONZE",
  "Stone: ZZ-STN-04 EXAMPLE STONE",
].join("\r\n");

function Harness({ plan }: { plan: ReviewDescription }) {
  const [open, setOpen] = useState(false);
  return (
    <table>
      <tbody>
        <tr>
          <td>
            <BillDescriptionSummary plan={plan} open={open} onToggle={() => setOpen((value) => !value)} />
          </td>
        </tr>
        {open && <BillDescriptionPanelRow plan={plan} raw={CELL} colSpan={10} />}
      </tbody>
    </table>
  );
}

describe("a bill line's description on the review screen", () => {
  const plan = planBillDescription(CELL, { fields: FIELDS, hasFabricLine: false })!;

  it("shows the composed dimension cell, each finish code with its field, and the notes counted", () => {
    render(<Harness plan={plan} />);
    // `composeDimensionCell`'s own text, carried in the plan: Dia replaces W x D.
    expect(screen.getByText("Dia.760 x H510mm")).toBeInTheDocument();
    expect(screen.getByText("ZZ-TIM-07 → Main timber finish")).toBeInTheDocument();
    expect(screen.getByText("ZZ-MTL-01 → Main metal finish")).toBeInTheDocument();
    expect(screen.getByText("ZZ-STN-04 → no field")).toBeInTheDocument();
    expect(screen.getByText("2 notes")).toBeInTheDocument();
  });

  it("opens every statement verbatim beside what it becomes, and the cell as printed, in a row of its own", () => {
    render(<Harness plan={plan} />);
    fireEvent.click(screen.getByRole("button", { name: /Show all 6 statements/ }));
    const rows = screen.getAllByRole("row");
    // The summary's row, then the panel's own row: never a cell beside the data.
    const panel = rows.find((row) => within(row).queryByText("As printed"));
    expect(panel).toBeDefined();
    expect(within(panel!).getByText("Sizes (Inch): 20\"\" (1'-8\"\") H X 2'-6\"\" DIA")).toBeInTheDocument();
    expect(within(panel!).getByText(/is the size line placed/)).toBeInTheDocument();
    expect(within(panel!).getByText("Diameter 760mm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide all 6 statements/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("says in amber what needs a look: an unconverted size, and a revision that writes nothing", () => {
    const feet = planBillDescription("Desk\nSizes (ft-in): W 3'5\"\" X D TBC X H 2'-4\"\"", { fields: FIELDS, hasFabricLine: false })!;
    render(
      <Harness
        plan={{ ...feet, revisionRefusal: "The record this line continues already holds specifications from a bill." }}
      />,
    );
    expect(screen.getByText("no size placed")).toBeInTheDocument();
    expect(screen.getByText(/feet and inches that could not be read completely/)).toHaveClass("text-amber-700");
    expect(screen.getByText(/already holds specifications from a bill/)).toHaveClass("text-amber-700");
  });
});
