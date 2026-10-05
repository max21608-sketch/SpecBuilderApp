// The phase table shows what each item IS, and where two documents disagree.
//
// Component tier: no database, `apiFetch` stubbed with the payload
// `/api/records` returns. What only a screen can show: the size line under the
// item's name reads feet and inches as printed with the millimetres beside them
// and says it converted; the finish codes are chips; an item two documents
// disagree about carries a red "n disagree" that goes to the record's Specs
// tab; and the Disagree tile narrows what is LISTED without moving a count.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecTable, { type PhaseInfo, type SpecRecord } from "@/components/records/SpecTable";
import { summariseSpecs } from "@/lib/record-spec-summary";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/projects/p1",
  useRouter: () => ({ replace: vi.fn() }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

let n = 0;
function record(over: Partial<SpecRecord> = {}): SpecRecord {
  n += 1;
  return {
    id: `rec-${n}`,
    record_no: n,
    item_description: `Item ${n}`,
    product_reference: null,
    status: "active",
    retired_at: null,
    retired_by: null,
    qty: 2,
    designer: null,
    area: null,
    boq_category: null,
    refs: `QZ-${100 + n}`,
    client_code: `QZ-${100 + n}`,
    run_id: "run-1",
    run_name: "Guest Suites",
    attribute_count: "0",
    parent_id: null,
    variant_label: null,
    parent_refs: null,
    variant_count: "0",
    variant_qty: "0",
    category_name: "Armchairs, benches, stools and sofas",
    category_family: "Seating",
    requirements_authored: true,
    spec_total: "10",
    spec_settled: "4",
    spec_tbc: "1",
    spec_missing: "5",
    ready_total: "0",
    ready_settled: "0",
    ready_tbc: "0",
    ready_missing: "0",
    level: "simple",
    level_suggested: null,
    level_suggested_reason: null,
    version: 1,
    waiting: 0,
    to_quote_outstanding: 3,
    to_quote_waiting: 0,
    gates: null,
    ...over,
  };
}

const GUEST: PhaseInfo = { id: "run-1", name: "Guest Suites", isMockup: false };

function payload(records: SpecRecord[]) {
  return {
    ok: true,
    status: 200,
    data: {
      records,
      programme: { orderDate: null, specsAgreedBy: null, deliveryDate: null },
      retiredCount: 0,
      categories: [],
      phase: GUEST,
    },
  };
}

// The summary the route sends is the pure function's own output, over rows in
// the shape the bill writes: a desk chair sized in inches, its fabric code.
const chair = summariseSpecs(
  [
    { recordId: "x", attrGroup: "dimension", dimensionSlot: "W", value: '21"', unit: "in", state: "confirmed", sortOrder: 0, materialCode: null, finishCode: null, fieldName: null },
    { recordId: "x", attrGroup: "dimension", dimensionSlot: "D", value: '24"', unit: "in", state: "confirmed", sortOrder: 1, materialCode: null, finishCode: null, fieldName: null },
    { recordId: "x", attrGroup: "dimension", dimensionSlot: "SH", value: '16"', unit: "in", state: "confirmed", sortOrder: 2, materialCode: null, finishCode: null, fieldName: null },
    { recordId: "x", attrGroup: "material", dimensionSlot: null, value: "Smoked oak", unit: null, state: "confirmed", sortOrder: 3, materialCode: "ZZ-TIM-09", finishCode: null, fieldName: "Main timber finish" },
  ],
  null,
);

beforeEach(() => {
  apiFetch.mockReset();
  n = 0;
});

describe("the phase table's item line", () => {
  it("shows the size as printed with millimetres, says it converted, and chips the finish code", async () => {
    const desk = record({ item_description: "Desk chair", spec_summary: chair, open_disagreements: 0 });
    apiFetch.mockResolvedValue(payload([desk]));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Desk chair");
    expect(screen.getByText('W 21" (533mm) x D 24" (610mm) x SH 16" (406mm)')).toBeInTheDocument();
    expect(screen.getByText("converted from ft-in")).toHaveClass("text-amber-800");
    expect(screen.getByText("ZZ-TIM-09")).toBeInTheDocument();
    // No disagreement, no red chip.
    expect(screen.queryByText(/disagree$/)).toBeNull();
  });

  it("carries a red 'n disagree' that goes to the record's Specs tab", async () => {
    const desk = record({ item_description: "Desk chair", spec_summary: chair, open_disagreements: 2 });
    apiFetch.mockResolvedValue(payload([desk]));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Desk chair");
    const chip = screen.getByText("2 disagree");
    expect(chip).toHaveClass("text-red-700");
    expect(chip.closest("a")).toHaveAttribute("href", `/dashboard/records/${desk.id}?tab=specs#disagreements`);
  });

  it("filters to the items that disagree without moving any count", async () => {
    const desk = record({ item_description: "Desk chair", spec_summary: chair, open_disagreements: 1 });
    const stool = record({ item_description: "Stool", open_disagreements: 0 });
    apiFetch.mockResolvedValue(payload([desk, stool]));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Stool");

    const tile = screen.getByRole("button", { name: /Disagree/ });
    expect(within(tile).getByText("1")).toBeInTheDocument();
    const tgqBefore = screen.getByRole("button", { name: /^TGQ/ }).textContent;

    await userEvent.click(tile);
    expect(screen.queryByText("Stool")).toBeNull();
    expect(screen.getByText("Desk chair")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
    // THE COUNTS ARE THE PHASE'S OWN, whatever the filter.
    expect(screen.getByRole("button", { name: /^TGQ/ }).textContent).toBe(tgqBefore);
    expect(screen.getByText("Documents disagree")).toBeInTheDocument();
  });

  it("offers no Disagree tile at all where nothing disagrees", async () => {
    apiFetch.mockResolvedValue(payload([record({ item_description: "Stool", open_disagreements: 0 })]));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Stool");
    expect(screen.queryByRole("button", { name: /Disagree/ })).toBeNull();
  });
});
