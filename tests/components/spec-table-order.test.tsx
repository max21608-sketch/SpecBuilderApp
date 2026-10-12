// The phase table's order (F3, 2026-10-12): bill order, or the client
// reference. Harness copied from spec-table-area.test.tsx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecTable, { type RunTally, type SpecRecord } from "@/components/records/SpecTable";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

// This tier's 5s default is a bound about the MACHINE, and this file has gone
// red under a second concurrent suite while passing alone. See
// `tests/components/tier-timeout.ts` for the measurements and for why this is
// not the global default.
vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });


// The router, reactive, for the same reason the chase table's test carries
// one: the chosen area lives in the URL, and a mock that recorded the call
// and left the query alone would let a filter that never applies pass.
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
  const row: SpecRecord = {
    client_code: null,
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
    run_name: "MAIN RUN",
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
  // MOST RECORDS CARRY ONE REF AND IT IS THEIR BOQ CODE, which is what the
  // export's Client Code reads and what the Code column now prints. So
  // `client_code` follows `refs` unless a test sets them APART, which is the
  // case the column exists for: a record holding only a `bws_job` ref.
  return over.client_code === undefined ? { ...row, client_code: row.refs } : row;
}

function mountWith(records: SpecRecord[], onSummary?: (tally: RunTally) => void) {
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
  return render(<SpecTable projectId="p1" runId="run-1" onSummary={onSummary} />);
}

beforeEach(() => {
  replace.mockClear();
  apiFetch.mockReset();
  search = "";
});

// Bill order, as /api/records returns it: the configuration under its line.
const RECORDS = () => [
  record({ refs: "ZZ-FUR-22", item_description: "Lounge chair" }),
  record({ refs: "ZZ-FUR-13", item_description: "Desk chair", variant_count: "1" }),
  record({ refs: null, client_code: "ZZ-FUR-13", parent_id: "rec-2", parent_refs: "ZZ-FUR-13", variant_label: "A", item_description: "Desk chair A" }),
  record({ refs: "QQ-FUR-13", item_description: "Bench" }),
  record({ refs: "ZZ-FUR-22", item_description: "Bedroom chair" }),
];

const listed = () =>
  ["Lounge chair", "Desk chair", "Desk chair A", "Bench", "Bedroom chair"]
    .map((name) => ({ name, row: screen.getByText(name).closest("tr")! }))
    .sort((a, b) => (a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((entry) => entry.name);

describe("the order select", () => {
  it("lists bill order by default", async () => {
    n = 0;
    mountWith(RECORDS());
    const select = (await screen.findByLabelText("Order")) as HTMLSelectElement;
    expect(select.value).toBe("bill");
    expect(listed()).toEqual(["Lounge chair", "Desk chair", "Desk chair A", "Bench", "Bedroom chair"]);
  });

  it("sorts by client reference into the URL, a configuration still under its line, the counts unmoved", async () => {
    n = 0;
    const summaries: RunTally[] = [];
    mountWith(RECORDS(), (tally) => summaries.push(tally));
    await userEvent.selectOptions(await screen.findByLabelText("Order"), "ref");
    expect(replace).toHaveBeenLastCalledWith("/dashboard/projects/p1?order=ref");
    await waitFor(() =>
      expect(listed()).toEqual(["Bench", "Desk chair", "Desk chair A", "Lounge chair", "Bedroom chair"]),
    );
    // A sort is not a narrowing: no "n of m shown", and the header's tally unchanged.
    expect(screen.queryByText(/of 5 shown/)).toBeNull();
    expect(summaries.every((tally) => tally.records === 5)).toBe(true);
  });

  it("reads the order from a pasted link, and leaves an unknown value alone", async () => {
    n = 0;
    search = "order=ref";
    mountWith(RECORDS());
    await screen.findByLabelText("Order");
    expect(listed()[0]).toBe("Bench");
    cleanup();
    n = 0;
    search = "order=sideways";
    replace.mockClear();
    mountWith(RECORDS());
    expect(((await screen.findByLabelText("Order")) as HTMLSelectElement).value).toBe("bill");
    expect(replace).not.toHaveBeenCalled();
  });
});
