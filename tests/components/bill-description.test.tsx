// The BOQ review's line under an item: what its description cell becomes.
//
// The plan is the pure function's own output over a SYNTHETIC cell (the Aman
// pricing document's shape, invented figures and codes), so what this renders
// is what the confirm writes — the component computes nothing.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BillDescriptionPanelRow, BillDescriptionSummary, type ReviewDescription } from "@/components/imports/BillDescription";
import { planBillDescription, type SlotOverride } from "@/lib/bill-description";
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

describe("a size part's slot, set on the review", () => {
  const STOOL = "Stool\r\nSpec size: D 400 X H 420 mm";
  const planFor = (slotOverrides?: Record<string, SlotOverride>) =>
    planBillDescription(STOOL, { fields: FIELDS, hasFabricLine: false, slotOverrides })!;

  function Editable({ plan, onSetSlot }: { plan: ReviewDescription; onSetSlot?: (key: string, slot: SlotOverride | null) => void }) {
    return (
      <table>
        <tbody>
          <tr>
            <td>
              <BillDescriptionSummary plan={plan} open onToggle={() => {}} onSetSlot={onSetSlot} />
            </td>
          </tr>
          <BillDescriptionPanelRow plan={plan} raw={STOOL} colSpan={10} onSetSlot={onSetSlot} />
        </tbody>
      </table>
    );
  }

  it("answers the D-without-W caution with the part's own key", () => {
    const onSetSlot = vi.fn();
    render(<Editable plan={planFor()} onSetSlot={onSetSlot} />);
    expect(screen.getByText(/gives a D and no W/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "It's the diameter" }));
    expect(onSetSlot).toHaveBeenLastCalledWith("D 400", "DIA");
    fireEvent.click(screen.getByRole("button", { name: "It's the width" }));
    expect(onSetSlot).toHaveBeenLastCalledWith("D 400", "W");
    fireEvent.click(screen.getByRole("button", { name: "It's a depth" }));
    expect(onSetSlot).toHaveBeenLastCalledWith("D 400", "D");
  });

  it("offers each size part W · D · H · SH · Dia · note, with its current slot pressed", () => {
    const onSetSlot = vi.fn();
    render(<Editable plan={planFor()} onSetSlot={onSetSlot} />);
    const height = screen.getByRole("group", { name: "What H 420 is" });
    expect(within(height).getByRole("button", { name: "H" })).toHaveAttribute("aria-pressed", "true");
    expect(within(height).getAllByRole("button").map((button) => button.textContent)).toEqual(["W", "D", "H", "SH", "Dia", "note"]);
    fireEvent.click(within(height).getByRole("button", { name: "note" }));
    expect(onSetSlot).toHaveBeenLastCalledWith("H 420", "note");
  });

  it("says which parts a reviewer changed, recomposed, and puts one back as printed", () => {
    const onSetSlot = vi.fn();
    render(<Editable plan={planFor({ "D 400": "DIA" })} onSetSlot={onSetSlot} />);
    expect(screen.getByText("Dia.400 x H420mm")).toBeInTheDocument();
    expect(screen.queryByText(/gives a D and no W/)).toBeNull();
    expect(screen.getByText("changed on review")).toBeInTheDocument();
    const depth = screen.getByRole("group", { name: "What D 400 is" });
    expect(within(depth).getByRole("button", { name: "Dia" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(depth).getByRole("button", { name: "As printed" }));
    expect(onSetSlot).toHaveBeenLastCalledWith("D 400", null);
  });

  it("offers no control where the line cannot change", () => {
    render(<Editable plan={planFor()} />);
    expect(screen.queryByRole("group", { name: /What D 400 is/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "It's the diameter" })).toBeNull();
  });
});
