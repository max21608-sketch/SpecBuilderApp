// The phase table against the variance matrix's records rows (plan §6.10.d).
//
// ============================================================================
// WHY THIS TIER.
//
// Each row of the matrix is one of three words — proceeds, flags, refuses — and
// "flags" is a claim about a SCREEN. The loaders are pinned in
// `tests/db/records-phases-variance.test.ts`; what a database test cannot see
// is whether the consequence reaches a reader as a sentence or as an em dash,
// and an em dash is how every one of these rows goes wrong: a record nobody
// has categorised, a record with no client ref and a configuration with no
// quantity all render as "nothing to say" beside the columns that genuinely
// have nothing to say.
//
// No database, no model, no money: `apiFetch` is stubbed and the payload is the
// one `/api/records` returns.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecTable, { type SpecRecord } from "@/components/records/SpecTable";

// Reactive, for the reason the area test's is: the tiles and the search live in
// the URL, and a router mock that recorded the call and left the query alone
// would let a filter that never applies pass.
const replace = vi.fn();
let search = "";
const listeners = new Set<() => void>();

vi.mock("next/navigation", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useSearchParams: () => {
      const [, bump] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        listeners.add(bump);
        return () => {
          listeners.delete(bump);
        };
      }, []);
      return new URLSearchParams(search);
    },
    usePathname: () => "/dashboard/projects/p1",
    useRouter: () => ({
      replace: (url: string) => {
        replace(url);
        search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
        for (const listener of [...listeners]) listener();
      },
    }),
  };
});

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
    designer: "JG",
    area: "Dressing area",
    boq_category: null,
    refs: `S-${100 + n}`,
    run_id: "run-1",
    run_name: "MAIN PHASE",
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

function mountWith(records: SpecRecord[]) {
  apiFetch.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      records,
      programme: { orderDate: null, specsAgreedBy: null, deliveryDate: null },
      retiredCount: 0,
      categories: [],
    },
  });
  return render(<SpecTable projectId="p1" runId="run-1" />);
}

// Awaited, because the table paints after its first fetch resolves: a
// synchronous lookup finds the spinner.
const rowFor = async (description: string) => (await screen.findByText(description)).closest("tr")!;

beforeEach(() => {
  replace.mockClear();
  apiFetch.mockReset();
  search = "";
});

describe("an uncategorised record (row d1)", () => {
  // It has NO checklist, so every count on it is genuinely zero — which is why
  // this row of the matrix is about wording rather than arithmetic. A screen
  // printing "0" or "Can quote" there would be reporting an item as ready
  // because nobody has decided what to ask about it.
  const records = () => [
    record({ item_description: "Unknown thing", category_name: null, to_quote_outstanding: 0 }),
    record({ item_description: "Sofa" }),
  ];

  it("never says Can quote, and says what the decision is", async () => {
    mountWith(records());
    const row = await rowFor("Unknown thing");
    expect(within(row).queryByText("Can quote")).toBeNull();
    expect(within(row).getByText("not set")).toBeTruthy();
    expect(within(row).getByText("Set category")).toBeTruthy();
    // The only other row on the screen is the ordinary one, and it is
    // unaffected: this is a statement about the record, not about the table.
    expect(within(await rowFor("Sofa")).getByText("3")).toBeTruthy();
  });

  it("opens on the reason, and the reason is the category rather than a level", async () => {
    // The defect this fixes. An uncategorised record with no level came through
    // `/api/records` as `to_quote_outstanding: null`, and the panel then read
    // "a level is what decides which questions block a quote" — true, and about
    // the wrong decision: a level on a record with no checklist tiers nothing.
    mountWith([record({ item_description: "Unknown thing", category_name: null, level: null, to_quote_outstanding: null })]);
    const row = await rowFor("Unknown thing");
    await userEvent.click(within(row).getByTitle("No category, so there is no checklist to count"));
    expect(screen.getByText(/no checklist and nothing to count/i)).toBeTruthy();
    expect(screen.queryByText(/simple, complex or hero/i)).toBeNull();
  });

  it("gives the same answer whether or not a level has been set", async () => {
    // Two readings of one state is how a reader comes to believe they are two
    // states. With a level the cell used to be a plain em dash and could not be
    // opened at all — the one row on the screen with no control on it.
    mountWith([record({ item_description: "Levelled but unasked", category_name: null, to_quote_outstanding: 0 })]);
    const row = await rowFor("Levelled but unasked");
    await userEvent.click(within(row).getByTitle("No category, so there is no checklist to count"));
    expect(screen.getByText(/no checklist and nothing to count/i)).toBeTruthy();
  });
});
