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
  // MOST RECORDS CARRY ONE REF AND IT IS THEIR BOQ CODE, which is what the
  // export's Client Code reads and what the Code column now prints. So
  // `client_code` follows `refs` unless a test sets them APART, which is the
  // case the column exists for: a record holding only a `bws_job` ref.
  return over.client_code === undefined ? { ...row, client_code: row.refs } : row;
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

/**
 * The LAST row bearing this description, which is the configuration where a
 * bill line and its configuration share one. `noUncheckedIndexedAccess` is on,
 * so the lookup is asserted here once rather than at every call.
 */
async function lastRowFor(description: string): Promise<HTMLElement> {
  const found = await screen.findAllByText(description);
  const row = found[found.length - 1]?.closest("tr");
  if (!row) throw new Error(`No row for ${description}`);
  return row as HTMLElement;
}

/** The FIRST such row: the bill line the configurations sit under. */
async function firstRowFor(description: string): Promise<HTMLElement> {
  const found = await screen.findAllByText(description);
  const row = found[0]?.closest("tr");
  if (!row) throw new Error(`No row for ${description}`);
  return row as HTMLElement;
}

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

describe("a levelless record on the fallback half of TGQ (row d2)", () => {
  // `/api/records` sends `to_quote_outstanding: null` for it, which is not a
  // zero: "nothing is blocking the quote" and "nobody has said what kind of
  // item this is" are different answers. The cell prints a dash that OPENS,
  // because a row with no control on it is a row whose silence nobody can
  // explain.
  it("prints a dash rather than a zero, and the dash opens", async () => {
    mountWith([record({ item_description: "Untiered sofa", level: null, to_quote_outstanding: null })]);
    const row = await rowFor("Untiered sofa");
    expect(within(row).queryByText("Can quote")).toBeNull();
    // The dash itself, not a zero. (The Waiting column beside it does print a
    // real 0, which is why this asks for the control rather than for the
    // absence of the character.)
    const control = within(row).getByRole("button", { expanded: false });
    expect(control.textContent).toContain("—");
    await userEvent.click(control);
    expect(screen.getByText(/simple, complex or hero/i)).toBeTruthy();
  });

  it("says what the level is needed FOR, not merely that it is missing", async () => {
    // Both reasons, because both are true and each answers a different
    // objection to filling it in: it decides which questions block a quote,
    // and it picks the BWS boilerplate the item is priced against.
    mountWith([record({ item_description: "Untiered sofa", level: null, to_quote_outstanding: null })]);
    const row = await rowFor("Untiered sofa");
    await userEvent.click(within(row).getByRole("button", { expanded: false }));
    expect(screen.getByText(/which questions block a quote/i)).toBeTruthy();
    expect(screen.getByText(/boilerplate/i)).toBeTruthy();
    // And the Level column offers the decision on the row itself.
    expect(within(row).getByText("not set")).toBeTruthy();
  });
});

describe("a record with no client ref (row d3)", () => {
  // The export ships a blank Client Code for it — correct, and invisible in a
  // 109-column file. The phase table is where a person would notice, and an em
  // dash there reads as "nothing to say" beside the columns that genuinely
  // have nothing to say.
  it("says so in words rather than printing an em dash", async () => {
    mountWith([record({ item_description: "Typed by hand", refs: null })]);
    const row = await rowFor("Typed by hand");
    expect(within(row).getByText("no client ref")).toBeTruthy();
    expect(within(row).getByTitle(/blank Client Code/i)).toBeTruthy();
  });

  it("leaves a record that has one alone", async () => {
    mountWith([record({ item_description: "Bench", refs: "S-402" })]);
    const row = await rowFor("Bench");
    expect(within(row).getByText("S-402")).toBeTruthy();
    expect(within(row).queryByText("no client ref")).toBeNull();
  });

  // A `bws_job` NUMBER IS NOT A CLIENT CODE. `refs` is every ref system and
  // the export's Client Code is the boq code alone, so this row used to print
  // the job number in the Code column and ship a blank code — the one row
  // `NoClientRef` exists for, and the one row it never fired on.
  it("does not let another ref system stand in for the client code", async () => {
    mountWith([record({ item_description: "Job-numbered bench", refs: "J-4471", client_code: null })]);
    const row = await rowFor("Job-numbered bench");
    expect(within(row).getByText("no client ref")).toBeTruthy();
    // And the job number is not lost — it is printed apart, named as other.
    expect(within(row).getByText(/also J-4471/)).toBeTruthy();
  });

  it("prints no 'also' line where the only ref IS the client code", async () => {
    mountWith([record({ item_description: "Plain bench", refs: "S-402", client_code: "S-402" })]);
    const row = await rowFor("Plain bench");
    expect(within(row).getByText("S-402")).toBeTruthy();
    expect(within(row).queryByText(/also /)).toBeNull();
  });

  it("says it on a configuration too, whose ref is read through its bill line", async () => {
    // A configuration carries no ref of its own, deliberately — it shows the
    // parent's. If the parent has none either, the line has none, and the
    // export reads through the parent for exactly the same reason.
    mountWith([
      record({ item_description: "Armchair", refs: null, variant_count: "1", id: "parent-1" }),
      record({
        item_description: "Armchair",
        refs: null,
        parent_refs: null,
        parent_id: "parent-1",
        variant_label: "A",
        qty: null,
      }),
    ]);
    const configuration = await lastRowFor("Armchair");
    expect(within(configuration).getByText("no client ref")).toBeTruthy();
  });
});

describe("a configuration with no quantity (row d4)", () => {
  // The bill says 45 of S-201 and never says how many are fabric A. Nothing
  // divides it — `unallocatedQty` does not even clamp an over-allocation away,
  // because variants adding up to more than the bill line is a real mistake.
  const family = () => [
    record({ item_description: "Armchair", id: "parent-2", refs: "S-201", qty: 45, variant_count: "2", variant_qty: "0" }),
    record({ item_description: "Armchair", parent_id: "parent-2", parent_refs: "S-201", variant_label: "A", qty: null }),
  ];

  it("says not allocated, in the words the infill and chase lines use", async () => {
    // Three screens describing one state in two ways is how a reader comes to
    // believe they are two states. This cell said "qty not set", which reads as
    // a field somebody forgot to fill in.
    mountWith(family());
    const configuration = await lastRowFor("Armchair");
    expect(within(configuration).getByText("not allocated")).toBeTruthy();
    expect(within(configuration).queryByText("quantity not given")).toBeNull();
  });

  it("keeps the bill line's own quantity on the bill line, and says what is unaccounted for", async () => {
    mountWith(family());
    const billLine = await firstRowFor("Armchair");
    expect(within(billLine).getByText("45")).toBeTruthy();
    expect(within(billLine).getByText(/45 not allocated/)).toBeTruthy();
  });

  it("does not confuse it with a bill line the bill gave no quantity for", async () => {
    // A different statement, and the matrix's row 2: the bill had no quantity
    // column at all, so nothing was ever said. Never a 1.
    mountWith([record({ item_description: "Unquantified bench", qty: null })]);
    const row = await rowFor("Unquantified bench");
    expect(within(row).getByText("quantity not given")).toBeTruthy();
    expect(within(row).queryByText("not allocated")).toBeNull();
  });
});
