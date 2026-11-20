// The phase table's status dot for an item with NO CATEGORY (2026-11-20, G2).
//
// An uncategorised item has no checklist, so nothing on it is outstanding and
// `recordUrgency` reads it as `complete` -- and the dot was the same green as a
// finished item, on the least-specified row of the page. Green is SETTLED; an
// item with nothing to measure it against is grey, and says why on hover.
//
// Component tier: no database, `apiFetch` stubbed with `/api/records`' payload.
// The phase table is the only screen that draws this per-item dot: the
// record header has none, and the fill-in and chase rows draw a QUESTION's
// tier, which an item with no category has none of.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecTable, { NO_CATEGORY_DOT_TITLE, type PhaseInfo, type SpecRecord } from "@/components/records/SpecTable";

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
    spec_settled: "10",
    spec_tbc: "0",
    spec_missing: "0",
    ready_total: "0",
    ready_settled: "0",
    ready_tbc: "0",
    ready_missing: "0",
    level: "simple",
    level_suggested: null,
    level_suggested_reason: null,
    version: 1,
    waiting: 0,
    to_quote_outstanding: 0,
    to_quote_waiting: 0,
    gates: null,
    ...over,
  };
}

const PHASE: PhaseInfo = { id: "run-1", name: "Guest Suites", isMockup: false };

function serve(records: SpecRecord[]) {
  apiFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: {
      records,
      // A programme whose date has passed: an uncategorised item must not be
      // painted overdue either, because nothing on it can be late.
      programme: { orderDate: null, specsAgreedBy: "2020-01-01", deliveryDate: null },
      retiredCount: 0,
      categories: [],
      phase: PHASE,
    },
  }));
}

beforeEach(() => {
  apiFetch.mockReset();
  n = 0;
});

describe("the status dot of an item with no category", () => {
  it("is grey and says there is nothing to measure it against, where a finished item is green", async () => {
    const finished = record({ item_description: "Finished stool" });
    const bare = record({
      item_description: "Uncategorised lamp",
      category_name: null,
      category_family: null,
      spec_total: "0",
      spec_settled: "0",
      to_quote_outstanding: null,
      level: null,
    });
    serve([finished, bare]);
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Uncategorised lamp");

    const grey = screen.getByTitle(NO_CATEGORY_DOT_TITLE);
    expect(NO_CATEGORY_DOT_TITLE).toBe("No category — nothing to measure it against yet");
    expect(grey.className).toContain("bg-neutral-400");
    expect(grey.className).not.toMatch(/bg-green|bg-red/);
    // One grey dot: the finished item is not caught by the rule.
    expect(screen.getAllByTitle(NO_CATEGORY_DOT_TITLE)).toHaveLength(1);

    const green = screen.getByTitle("Complete");
    expect(green.className).toContain("bg-green-500");
  });

  it("stays grey with nothing outstanding even when the specs-agreed date has passed", async () => {
    serve([record({ item_description: "Uncategorised lamp", category_name: null, spec_total: "0", spec_settled: "0" })]);
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Uncategorised lamp");
    expect(screen.getByTitle(NO_CATEGORY_DOT_TITLE).className).toContain("bg-neutral-400");
    expect(screen.queryByTitle("Complete")).toBeNull();
  });
});
