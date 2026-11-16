// The phase table's "Accept all N" says what it showed (review 3, 2026-11-16).
//
// `POST /api/projects/[id]/levels/accept` refuses with 409 `levels_stale` when
// the count it finds under the lock differs from `expectedCount`. The phase
// table sent no count, so a set that changed underneath it was accepted unseen.
// It now sends the number the button printed, counted over the route's own
// scope — a live record, not a split line's heading — so a correct press is
// never refused for counting a retired row or a heading the route skips.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecTable, { acceptableSuggestions, type PhaseInfo, type SpecRecord } from "@/components/records/SpecTable";

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
    level: null,
    level_suggested: "simple",
    level_suggested_reason: "the bill names no metal",
    version: 1,
    waiting: 0,
    to_quote_outstanding: 3,
    to_quote_waiting: 0,
    gates: null,
    ...over,
  };
}

const GUEST: PhaseInfo = { id: "run-1", name: "Guest Suites", isMockup: false };

function recordsPayload(records: SpecRecord[]) {
  return {
    ok: true,
    status: 200,
    data: {
      records,
      programme: { orderDate: null, specsAgreedBy: null, deliveryDate: "2027-01-01" },
      retiredCount: 0,
      categories: [],
      phase: GUEST,
    },
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  n = 0;
});

describe("the suggestions Accept all counts", () => {
  it("are the route's scope: live, not a split heading, no level, a suggestion", () => {
    const plain = record();
    const decided = record({ level: "hero" });
    const retired = record({ status: "retired" });
    const heading = record({ variant_count: "2" });
    const configuration = record({ parent_id: heading.id, variant_label: "A" });
    const none = record({ level_suggested: null });
    expect(acceptableSuggestions([plain, decided, retired, heading, configuration, none]).map((r) => r.id)).toEqual([
      plain.id,
      configuration.id,
    ]);
  });
});

describe("Accept all on the phase table", () => {
  it("sends the count the button printed", async () => {
    const records = [record(), record(), record({ variant_count: "1" }), record({ status: "retired" })];
    apiFetch.mockImplementation(async (url: string) =>
      url.includes("/levels/accept") ? { ok: true, status: 200, data: { accepted: 2 } } : recordsPayload(records),
    );
    render(<SpecTable projectId="p1" runId="run-1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Accept all 2/ }));
    const post = apiFetch.mock.calls.find(([url]) => String(url).includes("/levels/accept"));
    expect(JSON.parse(String(post![1].body))).toEqual({ runId: "run-1", expectedCount: 2 });
  });

  it("reloads after a stale refusal, then shows the server's sentence", async () => {
    const sentence =
      "The suggested levels changed since this screen loaded: it showed 1, there are now 2. Nothing was accepted. Check them, then accept again.";
    const order: string[] = [];
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/levels/accept")) {
        order.push("accept");
        return { ok: false, status: 409, error: sentence, data: null };
      }
      order.push("load");
      return recordsPayload([record()]);
    });
    render(<SpecTable projectId="p1" runId="run-1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Accept all 1/ }));
    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(order).toEqual(["load", "accept", "load"]);
  });
});
