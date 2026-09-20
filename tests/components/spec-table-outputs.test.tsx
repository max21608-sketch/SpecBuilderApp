// Component tier — the run's outputs, rendered.
//
// ============================================================================
// THE RULE WORTH A TEST: THERE ARE THREE OUTPUTS.
//
// Asked for directly on 2026-09-18, on sight of the row: "surely we only
// should have three". There are — the spec upload, the quote lines and the
// costing block — and the row was showing five buttons, because a FORMAT
// (.csv) and a VERIFICATION TOOL (Check sheet) sat as their peers.
//
// A format belongs inside the output it is a format of, and the check sheet
// produces no deliverable. Nothing but a test stops a fourth button appearing
// here the next time an output grows a format or somebody adds a tool: the
// count is the thing a person reads off this row, and it has to stay honest.
// ============================================================================
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExportMenu from "@/components/records/ExportMenu";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const RUN = "22222222-2222-2222-2222-222222222222";

/**
 * The block holding the download controls, found from the check sheet's own
 * link. The cluster used to carry a caption row ("Checking the spec upload
 * against the pack:") and the finder hung off it; the caption became a Tip
 * when the cluster moved into the header band, where a second line made it
 * too tall to sit beside a title.
 */
async function outputs(): Promise<HTMLElement> {
  const checkSheet = await screen.findByText("Check sheet");
  return checkSheet.closest("div") as HTMLElement;
}

describe("the run's outputs", () => {
  beforeEach(() => {
    render(<ExportMenu projectId={PROJECT} runId={RUN} />);
  });

  it("offers exactly three, named for what they are", async () => {
    const block = await outputs();
    for (const name of ["Spec upload", "Quote lines", "Costing block"]) {
      expect(within(block).getByText(name)).toBeTruthy();
    }
  });

  it("puts a format INSIDE its output, never beside it as a fourth", async () => {
    const block = await outputs();
    // Three outputs carry five format links between them: the spec upload and
    // the costing block come both ways, the quote is csv only. A bare ".csv"
    // sitting on its own was the button that made the row read as five
    // deliverables.
    const downloads = within(block)
      .getAllByRole("link")
      .map((node) => node.textContent?.trim());
    expect(downloads.filter((text) => text === ".xlsx")).toHaveLength(2);
    expect(downloads.filter((text) => text === ".csv")).toHaveLength(3);
  });

  it("sends each format to its own route", async () => {
    const block = await outputs();
    const hrefs = within(block)
      .getAllByRole("link")
      .map((node) => node.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export?runId=${RUN}`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export?runId=${RUN}&format=csv`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export/quote?runId=${RUN}`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export/costing?runId=${RUN}`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export/costing?runId=${RUN}&format=csv`)).toBe(true);
  });

  it("keeps the check sheet out of the three and says what it is for", async () => {
    const block = await outputs();
    // Its purpose is a hover beside it, not a caption under it — and it is
    // still there, because "Check sheet" alone reads as a fourth deliverable.
    expect(within(block).getByTitle(/checking the spec upload against the pack/i)).toBeTruthy();
    const checkSheet = within(block).getByText("Check sheet");
    expect(checkSheet.getAttribute("href")).toBe(
      `/api/projects/${PROJECT}/export/check-sheet?runId=${RUN}`,
    );
  });
});

// THE SAME THREE, PROJECT-WIDE. The Overview has no run selected, and the
// export is never filtered — so the scope parameter simply goes, rather than
// the cluster shrinking to the one file somebody might think is safe.
describe("the project's outputs", () => {
  beforeEach(() => {
    render(<ExportMenu projectId={PROJECT} />);
  });

  it("drops the run scope and keeps all three", async () => {
    const block = await outputs();
    for (const name of ["Spec upload", "Quote lines", "Costing block"]) {
      expect(within(block).getByText(name)).toBeTruthy();
    }
    const hrefs = within(block)
      .getAllByRole("link")
      .map((node) => node.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export?format=csv`)).toBe(true);
    expect(hrefs.every((href) => !href.includes("runId"))).toBe(true);
  });
});

// ============================================================================
// THE PHASE TABLE SAYS WHAT IS MISSING, NOT THAT SOMETHING IS.
//
// Matthew, on this screen: "On this page, you can't see what's missing? There's
// a button to go and see them." The count was a link to the record, so the
// answer to WHAT was a page away and a phase of 22 items was 22 visits. It is
// now a disclosure, and what it opens is the same set of questions the count
// was made from.
//
// Four things are asserted, because each is a way the row could lie: the names
// and where each one goes; that a row of 48 folds rather than either scrolling
// for ever or silently stopping; that the table's own filters never touch the
// list; and that a row with no level EXPLAINS instead of opening onto nothing,
// which would read as an item with nothing outstanding.
// ============================================================================
import SpecTable from "@/components/records/SpecTable";

const fetched = vi.hoisted(() => ({ records: [] as Record<string, unknown>[] }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    const named = url.includes("withToQuote=1");
    return {
      ok: true,
      status: 200,
      data: {
        programme: { orderDate: null, specsAgreedBy: null, deliveryDate: null },
        retiredCount: 0,
        categories: [],
        // The server omits the list entirely unless it was asked for, and the
        // table has to tell "never asked" from "none outstanding".
        records: fetched.records.map((record) =>
          named ? record : { ...record, to_quote_questions: undefined },
        ),
      },
    };
  },
}));

function question(label: string, over: Record<string, unknown> = {}) {
  return {
    requirementId: `req-${label.replace(/\W+/g, "-").toLowerCase()}`,
    label,
    section: "Upholstery",
    state: "missing",
    waiting: false,
    ...over,
  };
}

function record(over: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    record_no: 11,
    item_description: "Armchair",
    product_reference: null,
    status: "active",
    retired_at: null,
    retired_by: null,
    qty: 14,
    designer: "LCS",
    area: "Signature Suite",
    boq_category: null,
    refs: "S-201",
    run_id: RUN,
    run_name: "MAIN RUN",
    attribute_count: "0",
    parent_id: null,
    variant_label: null,
    parent_refs: null,
    variant_count: "0",
    variant_qty: "0",
    category_name: "Armchairs, Benches, Stools, Sofas",
    category_family: "Seating",
    requirements_authored: true,
    spec_total: "10",
    spec_settled: "5",
    spec_tbc: "2",
    spec_missing: "3",
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
    to_quote_questions: [question("COM 1"), question("Seat height"), question("Stitching spec")],
    ...over,
  };
}

function table(records: Record<string, unknown>[]) {
  fetched.records = records;
  return render(<SpecTable projectId={PROJECT} runId={RUN} />);
}

describe("what is missing on a phase table row", () => {
  it("opens the count into the field names, each on its own question", async () => {
    table([record()]);
    const count = await screen.findByRole("button", { name: /^3/ });
    await userEvent.click(count);
    const link = await screen.findByRole("link", { name: "Seat height" });
    expect(link.getAttribute("href")).toBe("/dashboard/records/rec-1?tab=checklist#q-req-seat-height");
    expect(screen.getByRole("link", { name: "COM 1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stitching spec" })).toBeTruthy();
  });

  // A CABINETRY ITEM FALLS TO THE 0019 PLACEHOLDER, where all 48 of its
  // questions block a quote. Six say what kind of thing is missing; the rest
  // are one click and are never dropped — a list that silently stopped would
  // be a row claiming its item needs less than it does.
  it("folds a long list to six and keeps the other 42 one click away", async () => {
    const many = Array.from({ length: 48 }, (_, index) => question(`Question ${index + 1}`));
    table([record({ to_quote_outstanding: 48, to_quote_questions: many })]);
    await userEvent.click(await screen.findByRole("button", { name: /^48/ }));
    expect(await screen.findByRole("link", { name: "Question 6" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Question 7" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "and 42 more" }));
    expect(await screen.findByRole("link", { name: "Question 48" })).toBeTruthy();
  });

  // THE CHASE SCREEN'S RULE, IN A SECOND PLACE. A filter narrows what is
  // LISTED, never what is outstanding: the panel is the RECORD'S own questions,
  // and the search box above the table has no business reaching into it.
  it("lists the record's own questions whatever the table is filtered to", async () => {
    table([
      record(),
      record({ id: "rec-2", record_no: 12, refs: "S-203", item_description: "Bench", to_quote_outstanding: 1 }),
    ]);
    await userEvent.click(await screen.findByRole("button", { name: /^3/ }));
    await screen.findByRole("link", { name: "Seat height" });
    await userEvent.type(screen.getByPlaceholderText(/search/i), "S-201");
    expect(screen.getByRole("link", { name: "Seat height" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "COM 1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Stitching spec" })).toBeTruthy();
  });

  // A DASH IS NOT A ZERO AND AN EMPTY PANEL WOULD READ AS ONE. Nothing on a
  // level-less record is tiered, so the panel says what is in the way and where
  // the control is, rather than opening onto nothing.
  it("explains a level-less row instead of listing nothing", async () => {
    table([record({ level: null, to_quote_outstanding: null, to_quote_questions: [] })]);
    const dash = await screen.findByRole("button", { name: /—/ });
    await userEvent.click(dash);
    expect(await screen.findByText(/Nothing on this item is tiered yet/)).toBeTruthy();
    expect(screen.getByText(/decides which questions block a quote/)).toBeTruthy();
  });

  // NOTHING OUTSTANDING, NOTHING TO OPEN. A disclosure over an empty list is a
  // control that teaches people it is not worth pressing.
  it("offers no disclosure on a row with nothing outstanding", async () => {
    table([record({ to_quote_outstanding: 0, to_quote_questions: [] })]);
    expect(await screen.findByText("Can quote")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^0/ })).toBeNull();
  });
});
