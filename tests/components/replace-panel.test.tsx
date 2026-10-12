// The drawings card's replace acknowledgement names the LINE it would replace
// (pilot walk, 2026-10-12): a drawing on two bill lines of one phase printed
// two identical "this phase: replace …" lines.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
