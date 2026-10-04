// The phase table's "Also in a mock-up phase" (0043, brief E).
//
// Component tier: no database, `apiFetch` stubbed with the payloads
// `/api/records` and `/api/projects/[id]/mockup` return. What only a screen can
// show: which rows can be ticked, that the bar counts what the button sends,
// that the button sends exactly the ticked ids, and that the server's sentence
// is what the reader is left with -- after the reload, not before it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecTable, { type PhaseInfo, type SpecRecord } from "@/components/records/SpecTable";

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

function recordsPayload(records: SpecRecord[], phase: PhaseInfo) {
  return {
    ok: true,
    status: 200,
    data: {
      records,
      programme: { orderDate: null, specsAgreedBy: null, deliveryDate: null },
      retiredCount: 0,
      categories: [],
      phase,
    },
  };
}

const GUEST: PhaseInfo = { id: "run-1", name: "Guest Suites", isMockup: false };
const MOCKUP: PhaseInfo = { id: "run-mu", name: "Mock-up", isMockup: true };

beforeEach(() => {
  apiFetch.mockReset();
  n = 0;
});

describe("the selection bar", () => {
  it("ticks bill lines only, sends exactly the ticked ids, and leaves the server's sentence after the reload", async () => {
    const stool = record({ item_description: "Dresser stool" });
    const desk = record({ item_description: "Desk" });
    const configuration = record({ item_description: "Desk", parent_id: desk.id, variant_label: "A", qty: null });
    const records = [stool, desk, configuration];
    const sentence =
      "Added 1 item to Mock-up. The Mock-up phase was created. No specs were copied: each mock-up item takes its own from the mock-up drawings, which may differ.";

    apiFetch.mockImplementation(async (url: string) =>
      url.startsWith("/api/projects/p1/mockup")
        ? { ok: true, status: 201, data: { message: sentence } }
        : recordsPayload(records, GUEST),
    );
    render(<SpecTable projectId="p1" runId="run-1" />);

    await screen.findByText("Dresser stool");
    // No bar until something is ticked.
    expect(screen.queryByRole("region", { name: "Selected items" })).toBeNull();
    // A configuration has no tick box: its copy could never be matched.
    expect(screen.getAllByRole("checkbox", { name: /^Select \d+$/ })).toHaveLength(2);

    await userEvent.click(screen.getByRole("checkbox", { name: `Select ${stool.record_no}` }));
    const bar = screen.getByRole("region", { name: "Selected items" });
    expect(within(bar).getByText("1 item selected")).toBeTruthy();

    await userEvent.click(within(bar).getByRole("button", { name: "Also in a mock-up phase" }));

    const post = apiFetch.mock.calls.find(([url]) => String(url).startsWith("/api/projects/p1/mockup"));
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ recordIds: [stool.id] });

    // Reloaded, THEN reported: the sentence is on the screen and the bar is gone.
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Selected items" })).toBeNull();
    const reloads = apiFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/records?"));
    expect(reloads.length).toBeGreaterThanOrEqual(2);
  });

  it("puts a refusal on the screen rather than nothing", async () => {
    const stool = record({ item_description: "Dresser stool" });
    apiFetch.mockImplementation(async (url: string) =>
      url.startsWith("/api/projects/p1/mockup")
        ? { ok: false, status: 400, error: "One of the selected items is not on this project. Reload and select again." }
        : recordsPayload([stool], GUEST),
    );
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Dresser stool");
    await userEvent.click(screen.getByRole("checkbox", { name: `Select ${stool.record_no}` }));
    await userEvent.click(screen.getByRole("button", { name: "Also in a mock-up phase" }));
    expect(await screen.findByText(/not on this project/)).toBeTruthy();
  });
});

describe("the mock-up phase itself", () => {
  it("says what it is, offers no tick boxes, and names the line each item came from", async () => {
    const copy = record({
      item_description: "Dresser stool",
      qty: null,
      run_id: "run-mu",
      run_name: "Mock-up",
      mockup_of: "rec-source",
      mockup_of_no: 12,
      mockup_of_run_name: "Guest Suites",
    });
    apiFetch.mockResolvedValue(recordsPayload([copy], MOCKUP));
    render(<SpecTable projectId="p1" runId="run-mu" />);

    await screen.findByText("Dresser stool");
    expect(screen.getByText("This is the mock-up phase.")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const link = screen.getByRole("link", { name: "12 · Guest Suites" });
    expect(link.getAttribute("href")).toBe("/dashboard/records/rec-source");
    // Never 1: the bill never said how many are in the mock-up room.
    expect(screen.getByText("quantity not given")).toBeTruthy();
  });

  it("on the bill line's own phase, says it is also in the mock-up phase, with a link", async () => {
    const line = record({ item_description: "Dresser stool", mockup_copy_id: "rec-copy", mockup_copy_run_name: "Mock-up" });
    apiFetch.mockResolvedValue(recordsPayload([line], GUEST));
    render(<SpecTable projectId="p1" runId="run-1" />);
    const link = await screen.findByRole("link", { name: "Also in Mock-up" });
    expect(link.getAttribute("href")).toBe("/dashboard/records/rec-copy");
  });
});
