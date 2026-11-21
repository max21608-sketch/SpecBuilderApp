// The phase table's TYPE suggestions and the provisional model's note (0061,
// decision B, seed 0014).
//
// A sheet covering several of Matthew's types answers for their union. Each
// row shows the app's SUGGESTED type with its reason — so nothing is accepted
// unseen — and "Accept n suggested types" accepts exactly those rows, with
// the version each was drawn at and the type it showed. A row whose gates come
// from a provisional model makes the table print the seed's sentence.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const SENTENCE = "Provisional cabinetry gate model, drafted by AI on 20 Nov 2026, not yet confirmed by Matthew";

describe("suggested types on the phase table", () => {
  it("shows each suggestion with its reason, and Accept n sends exactly those rows", async () => {
    const sofa = record({
      item_description: "Three seat sofa",
      version: 4,
      matrix_type_suggestion: { code: "S", name: "Sofas", reason: "The name says “sofa”." },
    });
    const chair = record({
      item_description: "Lobby armchair",
      version: 2,
      matrix_type_suggestion: { code: "A", name: "Armchairs", reason: "The name names no type." },
    });
    const typed = record({ matrix_type: "B", matrix_type_name: "Benches" });
    apiFetch.mockImplementation(async (url: string) =>
      url.includes("/matrix-types") ? { ok: true, status: 200, data: { set: 2 } } : recordsPayload([sofa, chair, typed]),
    );
    render(<SpecTable projectId="p1" runId="run-1" />);

    expect(await screen.findByText("The name says “sofa”.")).toBeInTheDocument();
    expect(screen.getByText("Benches")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Accept 2 suggested types/ }));
    const post = apiFetch.mock.calls.find(([url]) => String(url).includes("/matrix-types"));
    expect(String(post![0])).toBe("/api/projects/p1/matrix-types");
    expect(JSON.parse(String(post![1].body))).toEqual({
      mode: "accept",
      records: [
        { id: sofa.id, version: 4, matrixType: "S" },
        { id: chair.id, version: 2, matrixType: "A" },
      ],
    });
  });

  it("offers no bulk accept where nothing is suggested", async () => {
    apiFetch.mockImplementation(async () => recordsPayload([record()]));
    render(<SpecTable projectId="p1" runId="run-1" />);
    await screen.findAllByText(/Item 1/);
    expect(screen.queryByRole("button", { name: /suggested type/ })).not.toBeInTheDocument();
  });

  it("prints the provisional model's sentence once, from the rows' data", async () => {
    apiFetch.mockImplementation(async () =>
      recordsPayload([record({ provisional_note: SENTENCE }), record({ provisional_note: SENTENCE }), record()]),
    );
    render(<SpecTable projectId="p1" runId="run-1" />);
    expect(await screen.findByText(new RegExp(SENTENCE))).toBeInTheDocument();
    expect(screen.getByText(/2 items on this phase/)).toBeInTheDocument();
  });
});
