// The finishes library's search and filters, rendered.
//
// ============================================================================
// THE RULE WORTH A TEST
//
// A phase filter narrows which finishes are LISTED. It must never narrow what
// an edit is claimed to touch: a finish is project-scoped, so correcting one
// while looking at a single phase still corrects it on every phase that quotes
// it. The used-on count stays the TOTAL with the phase's share beside it, and
// the edit panel goes on quoting the total. Showing the filtered number as
// though it were the blast radius is how somebody changes a confirmed fabric
// believing it reaches one item when it reaches three.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinishesLibrary from "@/components/finishes/FinishesLibrary";

const RUN_MAIN = "run-main";
const RUN_VE = "run-ve";

function usedOn(over: Partial<{ recordId: string; label: string; itemDescription: string; runId: string; runName: string; attributeLabel: string }> = {}) {
  return {
    recordId: "rec-1",
    label: "AP364-001",
    itemDescription: "Armchair",
    runId: RUN_MAIN,
    runName: "MAIN RUN",
    attributeLabel: "COM 1",
    ...over,
  };
}

function finish(over: Record<string, unknown> = {}) {
  return {
    id: "fin-1",
    code: "MOR005",
    code_norm: "MOR005",
    kind: "fabric",
    description: "Yarn Collective Tessarae",
    supplier_raw: null,
    reference: null,
    colour: null,
    notes: null,
    state: "confirmed",
    status: "active",
    version: 1,
    retired_at: null,
    retired_by: null,
    updated_at: "2026-09-17T00:00:00.000Z",
    updated_by: null,
    swatch_attachment_id: null,
    used_on: [usedOn()],
    ...over,
  };
}

const PAYLOAD = {
  ok: true,
  project: { id: "proj-1", number: "AP364", name: "Panther" },
  runs: [
    { id: RUN_MAIN, name: "MAIN RUN" },
    { id: RUN_VE, name: "MAIN RUN - VE" },
  ],
  unlinked: [],
  finishes: [
    // On both runs: three uses, one of them on the VE.
    finish({
      id: "fin-1",
      code: "MOR005",
      kind: "fabric",
      used_on: [
        usedOn({ recordId: "rec-1", label: "AP364-001" }),
        usedOn({ recordId: "rec-2", label: "AP364-002", itemDescription: "Sofa" }),
        usedOn({ recordId: "rec-3", label: "AP364-003", itemDescription: "Sofa", runId: RUN_VE, runName: "MAIN RUN - VE" }),
      ],
    }),
    // Timber, main run only.
    finish({
      id: "fin-2",
      code: "WD-05",
      code_norm: "WD-05",
      kind: "timber",
      description: "Stained oak",
      supplier_raw: "Aissa Dione",
      reference: "YC04158 - 01",
      state: "tbc",
      used_on: [usedOn({ recordId: "rec-4", label: "AP364-004", itemDescription: "Desk chair", attributeLabel: "Timber" })],
    }),
    // Kind not said, used by nothing.
    finish({ id: "fin-3", code: "ST-11", code_norm: "ST-11", kind: null, description: null, used_on: [] }),
  ],
};

/**
 * The finish rows on screen, in order.
 *
 * The library is a `Table` rather than a bordered list, so a row is a `<tr>`
 * carrying `data-finish` — the marker is there so an open expansion panel or
 * edit panel, which are rows of their own, cannot be mistaken for a finish.
 * The CODE is still a `span.font-mono` inside its cell, which is what makes a
 * value checkable against a page, and what this test goes on pinning.
 */
function rows(): HTMLElement[] {
  return screen.getAllByRole("row").filter((row) => row.hasAttribute("data-finish"));
}

/** The first finish row on screen. */
function firstRow(): HTMLElement {
  const row = rows()[0];
  if (!row) throw new Error("No finish is listed");
  return row;
}

/** The finish codes currently listed, in order. */
function codes(): string[] {
  return rows()
    .map((row) => row.querySelector("span.font-mono")?.textContent?.trim() ?? "")
    .filter(Boolean);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.method === "PATCH" ? { ok: true, recordsTouched: 1, recordsWithManualAnswers: [] } : PAYLOAD;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

/** The body of the one PATCH this test made. */
function patched(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
  if (!call) throw new Error("Nothing was patched");
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("the finishes library", () => {
  it("lists every active finish before anything is filtered", async () => {
    render(<FinishesLibrary projectId="proj-1" />);
    expect(await screen.findByText("MOR005")).toBeInTheDocument();
    expect(codes()).toEqual(["MOR005", "WD-05", "ST-11"]);
  });

  it("searches the code, what the library records, and the items carrying it", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");
    const box = screen.getByLabelText("Search the finishes library");

    await user.type(box, "oak");
    expect(codes()).toEqual(["WD-05"]);

    await user.clear(box);
    // The item is what a person remembers, not the code.
    await user.type(box, "desk chair");
    expect(codes()).toEqual(["WD-05"]);

    await user.clear(box);
    await user.type(box, "mor");
    expect(codes()).toEqual(["MOR005"]);
  });

  it("filters by kind, and offers 'not said' as its own answer", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");
    const kinds = screen.getByLabelText("Filter by kind");

    await user.selectOptions(kinds, "timber");
    expect(codes()).toEqual(["WD-05"]);

    await user.selectOptions(kinds, "__none__");
    expect(codes()).toEqual(["ST-11"]);
  });

  it("filters by phase, listing only the finishes that phase uses", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");

    await user.selectOptions(screen.getByLabelText("Filter by phase"), RUN_VE);
    // WD-05 is on the main phase only; ST-11 is on nothing.
    expect(codes()).toEqual(["MOR005"]);
  });

  it("keeps the used-on count at the TOTAL when a phase is filtered", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");

    await user.selectOptions(screen.getByLabelText("Filter by phase"), RUN_VE);
    const row = firstRow();
    // Three items in total, one of them on the phase being looked at.
    expect(within(row).getByRole("button", { name: /used on 3 items/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /1 on MAIN RUN - VE/ })).toBeInTheDocument();
  });

  it("says in words that an edit still reaches the other phases", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");

    await user.selectOptions(screen.getByLabelText("Filter by phase"), RUN_VE);
    expect(screen.getByText(/editing one still changes it on every phase that uses it/i)).toBeInTheDocument();

    await user.click(within(firstRow()).getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/all 3 linked items/)).toBeInTheDocument();
    expect(screen.getByText(/on every phase, not only the one being shown/)).toBeInTheDocument();
  });

  it("expands to every use, including the phases the filter is hiding", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");

    await user.selectOptions(screen.getByLabelText("Filter by phase"), RUN_VE);
    await user.click(screen.getByRole("button", { name: /used on 3 items/ }));
    expect(screen.getByText("AP364-001")).toBeInTheDocument();
    expect(screen.getByText("AP364-003")).toBeInTheDocument();
  });

  it("clears back to the whole library", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");

    await user.selectOptions(screen.getByLabelText("Filter by kind"), "timber");
    expect(codes()).toEqual(["WD-05"]);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(codes()).toEqual(["MOR005", "WD-05", "ST-11"]);
  });

  // ==========================================================================
  // FILING A KIND FROM THE ROW
  //
  // `editFinish` REPLACES the row: a field the patch omits is written as null.
  // So the one-click picker has to send everything the finish already holds,
  // or filing WD-05 as a timber silently deletes its description, supplier and
  // reference. That is the assertion here, not that the kind arrives.
  // ==========================================================================
  it("sends every field when a kind is set from the row, not just the kind", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("WD-05");

    await user.selectOptions(screen.getByLabelText("Kind of WD-05"), "timber");
    expect(patched()).toMatchObject({
      version: 1,
      code: "WD-05",
      kind: "timber",
      description: "Stained oak",
      supplierRaw: "Aissa Dione",
      reference: "YC04158 - 01",
      state: "tbc",
    });
  });

  it("does not offer the one-click picker on a confirmed finish", async () => {
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");
    // MOR005 is confirmed: changing it is a decision and needs a reason, which
    // is what the Edit panel collects.
    expect(screen.queryByLabelText("Kind of MOR005")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Kind of WD-05")).toBeInTheDocument();
  });

  // ==========================================================================
  // A GUESS IS ONE CLICK FROM A DECISION, AND NEVER WEARS ITS AUTHORITY
  //
  // Where the app can read a kind off the client's own code it offers one with
  // the evidence beside it. Where it cannot, the row says what it could not
  // read — "no page says what CH means" — and groups at the bottom, rather
  // than showing an empty control that looks like a question nobody answered.
  // ==========================================================================
  it("offers the kind it can read, with the evidence it read it from", async () => {
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");
    // ST-11 carries no kind and no description, so nothing can be suggested.
    expect(screen.getByText(/Nothing to suggest/)).toBeInTheDocument();
    expect(screen.getByText(/no page says what ST means/)).toBeInTheDocument();
  });

  it("never pre-fills the kind picker with the kind the row already holds", async () => {
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("WD-05");
    // WD-05 is filed as a timber and still TBC, so it is correctable — but the
    // control starts empty. A select already reading "Timber" fires no change
    // event when somebody chooses Timber, which is the level picker's trap.
    const picker = screen.getByLabelText("Kind of WD-05") as HTMLSelectElement;
    expect(picker.value).toBe("");
  });

  it("says nothing matched rather than looking like an empty library", async () => {
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" />);
    await screen.findByText("MOR005");

    await user.type(screen.getByLabelText("Search the finishes library"), "velvet");
    expect(screen.getByText(/Nothing in the library matches/)).toBeInTheDocument();
    expect(screen.queryByText("MOR005")).not.toBeInTheDocument();
  });
});
