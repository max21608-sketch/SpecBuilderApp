// The phase table's "Set designer…" (2026-11-20, U2).
//
// A bill with no designer column leaves every item unchaseable, and the only
// fix was each record's Edit panel. Component tier: `apiFetch` stubbed with
// what `/api/records`, `/api/projects/[id]/contacts` and
// `/api/projects/[id]/designer` return. What only the screen can show: the
// box offers the contacts' codes and the phase's own, the press sends each
// ticked item with the version it was loaded at, and what the server set and
// refused is what the reader is left with, after the reload.
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

beforeEach(() => {
  apiFetch.mockReset();
  n = 0;
});

const OUTCOME = {
  designer: "LCS",
  set: 1,
  unchanged: 0,
  configurations: 2,
  keptOwn: [],
  refused: [
    {
      recordId: "rec-2",
      label: "P90410-002",
      code: "record_version_stale",
      error: "P90410-002: This item changed since this screen loaded. Reload before saving.",
    },
  ],
  message: "LCS set on 1 item and 2 configurations of theirs. 1 item not changed — listed below.",
};

function serve(records: SpecRecord[], designer: () => unknown) {
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/projects/p1/designer")) return designer();
    if (url.startsWith("/api/projects/p1/contacts")) {
      return {
        ok: true,
        status: 200,
        data: { contacts: [{ designer_code: "LCS" }, { designer_code: null }, { designer_code: "TH" }] },
      };
    }
    void init;
    return recordsPayload(records, GUEST);
  });
}

describe("Set designer… on the selection bar", () => {
  it("offers the contacts' codes and the phase's own, and sends each ticked item at the version it was loaded", async () => {
    const stool = record({ item_description: "Dresser stool", version: 4 });
    const desk = record({ item_description: "Desk", version: 9 });
    const named = record({ item_description: "Bench", designer: "PDS" });
    serve([stool, desk, named], () => ({ ok: true, status: 200, data: OUTCOME }));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Dresser stool");

    await userEvent.click(screen.getByRole("checkbox", { name: `Select ${stool.record_no}` }));
    await userEvent.click(screen.getByRole("checkbox", { name: `Select ${desk.record_no}` }));
    const bar = screen.getByRole("region", { name: "Selected items" });
    await userEvent.click(within(bar).getByRole("button", { name: "Set designer…" }));

    const box = await within(bar).findByLabelText("Designer code");
    const list = document.getElementById(box.getAttribute("list")!)!;
    await vi.waitFor(() =>
      expect([...list.querySelectorAll("option")].map((option) => option.getAttribute("value"))).toEqual([
        "LCS",
        "TH",
        "PDS",
      ]),
    );
    // Nothing to send until a code is typed.
    expect(within(bar).getByRole("button", { name: "Set on 2 items" })).toHaveProperty("disabled", true);

    await userEvent.type(box, "LCS");
    await userEvent.click(within(bar).getByRole("button", { name: "Set on 2 items" }));

    const post = apiFetch.mock.calls.find(([url]) => String(url).startsWith("/api/projects/p1/designer"));
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({
      designer: "LCS",
      records: [
        { id: stool.id, version: 4 },
        { id: desk.id, version: 9 },
      ],
    });

    // Reloaded, then reported: what was set, and each item refused, by name.
    expect(await screen.findByText(/LCS set on 1 item and 2 configurations of theirs/)).toBeTruthy();
    expect(screen.getByText("P90410-002: This item changed since this screen loaded. Reload before saving.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Selected items" })).toBeNull();
    const reloads = apiFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/records?"));
    expect(reloads.length).toBeGreaterThanOrEqual(2);
  });

  it("sends on Enter in the box, as a form does", async () => {
    const stool = record({ item_description: "Dresser stool", version: 2 });
    serve([stool], () => ({ ok: true, status: 200, data: { ...OUTCOME, refused: [], message: "LCS set on 1 item." } }));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Dresser stool");
    await userEvent.click(screen.getByRole("checkbox", { name: `Select ${stool.record_no}` }));
    await userEvent.click(screen.getByRole("button", { name: "Set designer…" }));
    await userEvent.type(await screen.findByLabelText("Designer code"), "LCS{Enter}");
    expect(await screen.findByText("LCS set on 1 item.")).toBeTruthy();
  });

  it("puts a refusal of the whole press on the screen, and keeps the selection", async () => {
    const stool = record({ item_description: "Dresser stool" });
    serve([stool], () => ({ ok: false, status: 400, error: "Type the designer code to set." }));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findByText("Dresser stool");
    await userEvent.click(screen.getByRole("checkbox", { name: `Select ${stool.record_no}` }));
    await userEvent.click(screen.getByRole("button", { name: "Set designer…" }));
    await userEvent.type(await screen.findByLabelText("Designer code"), "X");
    await userEvent.click(screen.getByRole("button", { name: "Set on 1 item" }));
    expect(await screen.findByText("Type the designer code to set.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Selected items" })).toBeTruthy();
  });
});
