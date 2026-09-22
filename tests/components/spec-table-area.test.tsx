// The phase table's area filter.
//
// ===========================================================================
// WHAT THIS IS FOR
//
// `spec_records.area` is the BOQ's fourth column, and until now the only way
// to narrow by it was to type it into the search box. Sebastian, on sight of
// the column on 2026-09-18: "if you could filter by that, that'd be quite
// handy."
//
// The rule it has to obey is the one this screen already states about its
// tiles: A FILTER NARROWS WHAT IS LISTED AND NOTHING ELSE. The tally handed up
// to the header band and the counts on the five tiles are the PHASE'S OWN, so
// narrowing to one floor can never make a phase look finished — which is the
// half of this a reasonable-looking change would break silently.
// ===========================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecTable, { type RunTally, type SpecRecord } from "@/components/records/SpecTable";

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

const RECORDS = () => [
  record({ area: "Dressing area", item_description: "Desk chair" }),
  record({ area: "dressing  AREA", item_description: "Bench" }),
  record({ area: "Living room", item_description: "Sofa" }),
  record({ area: null, item_description: "Stool" }),
];

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

const rowFor = (description: string) => screen.getByText(description).closest("tr")!;

beforeEach(() => {
  replace.mockClear();
  apiFetch.mockReset();
  search = "";
});

describe("the area select", () => {
  it("offers one option per area, spelled as the bill wrote it, with no-area last", async () => {
    mountWith(RECORDS());
    const select = (await screen.findByLabelText("Filter by area")) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "All areas (4)",
      "Dressing area (2)",
      "Living room (1)",
      "No area given (1)",
    ]);
  });

  it("lists only that area's records, merging the two spellings of one room", async () => {
    mountWith(RECORDS());
    await userEvent.selectOptions(await screen.findByLabelText("Filter by area"), "dressing area");
    expect(screen.getByText("Desk chair")).toBeTruthy();
    expect(screen.getByText("Bench")).toBeTruthy();
    expect(screen.queryByText("Sofa")).toBeNull();
    expect(screen.getByText("2 of 4 shown")).toBeTruthy();
  });

  it("finds a record nobody has placed, rather than dropping it", async () => {
    mountWith(RECORDS());
    await userEvent.selectOptions(await screen.findByLabelText("Filter by area"), "__none__");
    expect(screen.getByText("Stool")).toBeTruthy();
    expect(screen.queryByText("Desk chair")).toBeNull();
  });

  it("leaves the phase's own numbers alone — the tiles and the header band", async () => {
    // The trap: a tally computed over the filtered list lets somebody narrow
    // the screen until a phase looks finished.
    const summaries: RunTally[] = [];
    mountWith(RECORDS(), (tally) => summaries.push(tally));
    await screen.findByLabelText("Filter by area");
    // The tile, not the table's TGQ column header, which carries the same word.
    const tgq = screen
      .getAllByRole("button")
      .find((button) => (button.textContent ?? "").startsWith("TGQ"))!;
    expect(within(tgq).getByText("12")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Filter by area"), "living room");
    expect(within(tgq).getByText("12")).toBeTruthy();
    // And nothing was reported up a second time with a narrower number.
    expect(summaries.every((tally) => tally.records === 4 && tally.toQuote === 12)).toBe(true);
  });

  it("still finds an area by typing it in the search box", async () => {
    // What makes thirty-five areas usable without a custom combobox.
    mountWith(RECORDS());
    await userEvent.type(await screen.findByPlaceholderText(/Search a code/), "living");
    expect(screen.getByText("Sofa")).toBeTruthy();
    expect(screen.queryByText("Desk chair")).toBeNull();
  });

  // ===========================================================================
  // A 15s WAIT INSIDE A 5s TEST CAN NEVER SPEND ITS BUDGET.
  //
  // The `findByLabelText` below already asks for 15s, and the test itself was
  // still on vitest's 5s default — so under a full concurrent run the bound
  // that fired was the one nobody had thought about. Measured: ~3.0s alone
  // (found-in-use 2026-09-20), and it timed out on two of this repo's shared
  // runs.
  //
  // 30s, deliberately, and the same number and the same reasoning as
  // `boq-review-variance.test.tsx` and `tests/db/db-tier.ts`: a bound here
  // exists to catch a hang or an accidental O(n squared) blow-up, not to police
  // a machine that is busy. It is ON THIS TEST and not on the tier, because
  // every other test in this file paints a handful of rows and should still say
  // so in five seconds.
  // ===========================================================================
  it("renders every area on a 300-line phase", { timeout: 30_000 }, async () => {
    const many = Array.from({ length: 300 }, (_, index) =>
      record({ area: `Area ${String(index % 35).padStart(2, "0")}`, item_description: `Line ${index}` }),
    );
    mountWith(many);
    // Three hundred rows take longer than the one-second default to paint when
    // the whole suite is running, which is a slow machine rather than a defect.
    const select = (await screen.findByLabelText("Filter by area", {}, { timeout: 15000 })) as HTMLSelectElement;
    // 35 areas plus "All areas".
    expect(select.options.length).toBe(36);
  });
});

describe("the chosen area in the URL", () => {
  it("replaces rather than pushes", async () => {
    mountWith(RECORDS());
    await userEvent.selectOptions(await screen.findByLabelText("Filter by area"), "living room");
    expect(replace).toHaveBeenCalledWith("/dashboard/projects/p1?area=living+room");
  });

  it("renders what a pasted link says, and never corrects one it cannot resolve", async () => {
    search = "area=living room";
    mountWith(RECORDS());
    expect(await screen.findByText("Sofa")).toBeTruthy();
    expect(screen.queryByText("Desk chair")).toBeNull();

    cleanup();
    apiFetch.mockReset();
    // An area this phase does not carry. Every record is listed and the URL is
    // left exactly as it is — the records may still be arriving, and rewriting
    // it would destroy the deep link a moment before it became valid.
    search = "area=basement";
    mountWith(RECORDS());
    expect(await screen.findByText("Desk chair")).toBeTruthy();
    await waitFor(() => expect(rowFor("Sofa")).toBeTruthy());
    expect(replace).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// VARIANCE MATRIX §6.10.a ROW 2 — a bill line with NO QUANTITY.
//
// EXPECTED: FLAGS. It used to print an em dash, which on this table means
// "nothing to say" — and a bill with no `TOTAL Q-ty` column produces a whole
// phase of lines that have something to say. A configuration is a DIFFERENT
// statement and keeps its own: the bill said 45 and never said how many are
// fabric A.
// ===========================================================================
describe("a record the bill gave no quantity for", () => {
  it("says quantity not given, rather than printing a dash", async () => {
    mountWith([record({ item_description: "Sofa", qty: null })]);
    expect(await screen.findByText("Sofa")).toBeTruthy();
    const cell = within(rowFor("Sofa")).getByText("quantity not given");
    expect(cell).toBeTruthy();
    expect(cell.className).toContain("text-amber-800");
  });

  it("leaves a configuration saying its quantity is not ALLOCATED", async () => {
    // Two different facts: nobody gave one, versus the bill gave one to the
    // line above and never said how it splits.
    mountWith([
      record({ item_description: "Armchair A", qty: null, parent_id: "rec-parent", variant_label: "A" }),
    ]);
    expect(await screen.findByText("Armchair A")).toBeTruthy();
    // "not allocated", which is what the infill line and the chase line have
    // always said. This cell read "qty not set" — the words this test's own
    // name already disagreed with — until variance row d4.
    expect(within(rowFor("Armchair A")).getByText("not allocated")).toBeTruthy();
    expect(within(rowFor("Armchair A")).queryByText("quantity not given")).toBeNull();
  });

  it("still prints a quantity the bill did give", async () => {
    mountWith([record({ item_description: "Bench", qty: 14 })]);
    expect(await screen.findByText("Bench")).toBeTruthy();
    expect(within(rowFor("Bench")).getByText("14")).toBeTruthy();
    expect(within(rowFor("Bench")).queryByText("quantity not given")).toBeNull();
  });
});
