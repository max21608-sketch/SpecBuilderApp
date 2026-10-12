// Max, 2026-10-12: on the drawings card a figure printed in inches or feet and
// inches shows its millimetres right beside it — `1'-3"` (381mm) — live off the
// box and the unit, through the one conversion, and never where it would be a
// guess. Display only.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, figure, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

/** A card whose drafts and saved unit behave as the screen's do. */
function Harness({ initial }: { initial: DrawingItem }) {
  const [staged, setStaged] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, Partial<DrawingObservation>>>({});
  const spies = callbacks();
  return (
    <ItemCard
      item={staged}
      importId="import-1"
      resolution={resolution({})}
      specFields={specFields}
      records={records}
      drafts={drafts}
      setDrafts={setDrafts}
      busy={false}
      onSaveObservation={async (_item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) => {
        setStaged((current) => ({
          ...current,
          observations: current.observations.map((row) => (row.id === observation.id ? { ...row, ...changes } : row)),
        }));
      }}
      onSaveTargets={spies.onSaveTargets}
      onSetBulkUnit={spies.onSetBulkUnit}
      onReview={spies.onReview}
      onImage={spies.onImage}
      onSwatch={spies.onSwatch}
      onSetLevel={spies.onSetLevel}
      onSaveItem={vi.fn(async () => undefined)}
    />
  );
}

function rowFor(value: string): HTMLElement {
  const found = screen.getAllByRole("row").find((row) => within(row).queryByDisplayValue(value) !== null);
  if (!found) throw new Error(`No row holds the value ${value}`);
  return found;
}

const beside = (value: string) => within(rowFor(value)).queryByTestId("mm-beside")?.textContent ?? null;

function stool() {
  resetIds();
  return item({
    observations: [
      figure("Height", `1'-3"`, { attrGroup: "dimension", dimensionSlot: "H", unit: "in", isOverall: true }),
      figure("Diameter", `1'-9 5/8"`, { attrGroup: "dimension", dimensionSlot: "DIA", unit: "in", isOverall: true }),
      figure("Seat height", "18", { attrGroup: "dimension", dimensionSlot: "SH", unit: "in", isOverall: true }),
      figure("Width", "84", { attrGroup: "dimension", dimensionSlot: "W", unit: "cm", isOverall: true }),
      figure("Depth", "640", { attrGroup: "dimension", dimensionSlot: "D", unit: "mm", isOverall: true }),
    ],
  });
}

describe("the millimetres beside a figure", () => {
  it("brackets ft-in, plain inches and cm in whole mm, and leaves mm alone", () => {
    render(<Harness initial={stool()} />);
    expect(beside(`1'-3"`)).toBe("(381mm)");
    expect(beside(`1'-9 5/8"`)).toBe("(549mm)");
    expect(beside("18")).toBe("(457mm)");
    expect(beside("84")).toBe("(840mm)");
    expect(beside("640")).toBeNull();
    // The box keeps the page's own figure.
    expect(within(rowFor(`1'-3"`)).getByDisplayValue(`1'-3"`)).toBeInTheDocument();
  });

  it("shows nothing for a figure that does not read completely, or has no unit", () => {
    resetIds();
    render(
      <Harness
        initial={item({
          observations: [
            figure("Height", `2'-5`, { attrGroup: "dimension", dimensionSlot: "H", unit: "in", isOverall: true }),
            figure("Width", "720-740", { attrGroup: "dimension", dimensionSlot: "W", unit: "cm", isOverall: true }),
            figure("Depth", "640", { attrGroup: "dimension", dimensionSlot: "D", unit: null, isOverall: true }),
          ],
        })}
      />,
    );
    expect(beside(`2'-5`)).toBeNull();
    expect(beside("720-740")).toBeNull();
    expect(beside("640")).toBeNull();
  });

  it("follows the box as it is typed and the unit as it is changed", async () => {
    render(<Harness initial={stool()} />);
    const box = within(rowFor("18")).getByDisplayValue("18");
    await userEvent.clear(box);
    await userEvent.type(box, "20");
    expect(beside("20")).toBe("(508mm)");
    await userEvent.selectOptions(within(rowFor("20")).getByLabelText("printed in"), "cm");
    expect(beside("20")).toBe("(200mm)");
    await userEvent.selectOptions(within(rowFor("20")).getByLabelText("printed in"), "mm");
    expect(beside("20")).toBeNull();
  });
});
