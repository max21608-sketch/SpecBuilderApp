// The drawings card's replace acknowledgement names the LINE it would replace
// (pilot walk, 2026-10-12): a drawing on two bill lines of one phase printed
// two identical "this phase: replace …" lines.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplacePanel, type Occupant, type RunResolution } from "@/components/imports/ObservationRows";

const occupant = (attributeId: string): Occupant => ({
  attributeId,
  attributeVersion: 1,
  label: "Sizes (mm)",
  value: "400",
  unit: "mm",
  sourceFilename: "bill.xlsx",
  sourcePage: null,
});

const record = (id: string, label: string) => ({ id, label, itemDescription: "Stool" });

function mount(runs: RunResolution[], recordIds: string[]) {
  render(
    <table>
      <tbody>
        <ReplacePanel
          observation={{ id: "obs-1", replaces: [] } as never}
          occupants={recordIds.map((recordId, index) => ({ recordId, occupant: occupant(`att-${index}`) }))}
          runs={runs}
          busy={false}
          blocked={false}
          onChange={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

describe("ReplacePanel", () => {
  it("names each of two lines in one phase by its record label", () => {
    mount(
      [{ runId: "r1", runName: "Main Phase", status: "ambiguous", candidates: [record("a", "ZZ-048"), record("b", "ZZ-066")] }],
      ["a", "b"],
    );
    expect(screen.getByText("Main Phase · ZZ-048")).toBeInTheDocument();
    expect(screen.getByText("Main Phase · ZZ-066")).toBeInTheDocument();
    expect(screen.queryByText("this phase")).toBeNull();
  });

  it("still names a matched record by its phase", () => {
    mount([{ runId: "r1", runName: "Main Phase", status: "matched", record: record("a", "ZZ-048") }], ["a"]);
    expect(screen.getByText("Main Phase")).toBeInTheDocument();
  });
});

// THE BOX SAYS WHICH DOCUMENT HOLDS WHAT (2026-10-15, part 2, 36:36–44:38).
// Matthew read "This item already holds a value here. Tick to replace it"
// backwards for eight minutes on TB-08: the bill held W 900, the drawing gave
// W 3500, and nothing said which was which. The tick and its keys are
// unchanged; these hold the words.
describe("ReplacePanel names the bill and the drawing", () => {
  const tb08 = {
    id: "obs-w",
    attrGroup: "dimension",
    dimensionSlot: "W",
    value: "3500",
    valueRaw: "3500MM",
    unit: "mm",
    replaces: [] as never[],
  };
  const billWidth: Occupant = {
    attributeId: "att-w",
    attributeVersion: 3,
    label: "DIMENSIONS CM / MM L X W X H",
    value: "900",
    unit: "mm",
    sourceFilename: "RONNIE SCOTTS ST4 (converted).xlsx",
    sourcePage: null,
    sourceIsBill: true,
  };
  const run: RunResolution = { runId: "r1", runName: "UPHOLSTERED", status: "matched", record: record("a", "TB-08") };

  function mountOne(onChange = vi.fn(), replaces: unknown[] = []) {
    render(
      <table>
        <tbody>
          <ReplacePanel
            observation={{ ...tb08, replaces } as never}
            occupants={[{ recordId: "a", occupant: billWidth }]}
            runs={[run]}
            busy={false}
            blocked
            onChange={onChange}
          />
        </tbody>
      </table>,
    );
    return onChange;
  }

  it("says the bill's figure and this drawing's, side by side, with the slot on both", () => {
    mountOne();
    expect(screen.getByText("The bill says W 900mm · this drawing says W 3500mm")).toBeInTheDocument();
    // The bill's column heading is not what the reviewer is asked about.
    expect(screen.queryByText(/DIMENSIONS CM/)).toBeNull();
    expect(screen.queryByText(/another page/)).toBeNull();
  });

  it("names the tick for what it does, and says how to keep the bill's instead", () => {
    mountOne();
    expect(screen.getByRole("checkbox", { name: "Use this drawing's" })).not.toBeChecked();
    expect(screen.getByText("To keep the bill's, ignore this row or make it a note.")).toBeInTheDocument();
  });

  it("writes the same acknowledgement it always did when ticked", async () => {
    const onChange = mountOne();
    await userEvent.click(screen.getByRole("checkbox", { name: "Use this drawing's" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "obs-w" }), {
      replaces: [{ recordId: "a", attributeId: "att-w", attributeVersion: 3 }],
    });
  });

  it("keeps the old explanation one click away, never deleted", async () => {
    mountOne();
    expect(screen.queryByText(/marked retired/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "What replacing does" }));
    expect(screen.getByText(/the old one is kept, marked retired, and linked to this as its replacement/)).toBeInTheDocument();
    expect(screen.getByText(/DIMENSIONS CM \/ MM L X W X H: 900mm/)).toBeInTheDocument();
  });

  it("says what confirming does once ticked", () => {
    mountOne(vi.fn(), [{ recordId: "a", attributeId: "att-w", attributeVersion: 3 }]);
    expect(screen.getByRole("checkbox", { name: "Use this drawing's" })).toBeChecked();
    expect(screen.getByText("Confirming replaces the bill's.")).toBeInTheDocument();
  });
});
