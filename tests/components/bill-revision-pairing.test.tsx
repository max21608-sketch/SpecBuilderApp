// The bill review's revision panel: what is shown as paired is what the
// confirm writes (audit 2026-11-06, item 1.2, and a defect found building it).
//
// ============================================================================
// THE DEFECTS THIS FILE HOLDS.
//
// * A SUGGESTED pairing rendered as the select's chosen value. The confirm
//   writes only the stored `replaces`, and a select already showing the
//   record fires no change when somebody agrees with it, so the line
//   confirmed as a NEW item and the record the screen said it continued was
//   retired, taking its drawings and specs out of the export.
// * A line's configurations (12.1–12.5) are named beside it, and named with it
//   in the retired list, because they follow it either way (C1).
// * A retired line whose code returns is OFFERED back, never chosen (C14).
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewImportPage from "@/app/dashboard/imports/[id]/page";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const PROJECT = "project-revision";
const IMPORT = "import-revision";
const RUN = "run-main";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/dashboard/imports/${IMPORT}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  calls: [] as { url: string; method: string; body: unknown }[],
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    routes.calls.push({
      url: path,
      method: (init?.method ?? "GET").toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if ((init?.method ?? "GET").toUpperCase() === "PATCH") return { ok: true, status: 200, data: { version: 2 } };
    const body = routes.current[path];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

/** Invented codes, invented rooms. */
const line = (index: number, code: string, replaces: unknown = null) => ({
  index,
  lineNo: index + 2,
  designer: null,
  boqCategory: null,
  area: "Example room",
  code,
  itemDescription: `Item ${code}`,
  productReference: null,
  qty: 4,
  qtyUnit: "nr",
  categoryId: null,
  categoryStatus: "none",
  level: null,
  levelStatus: "suggested",
  levelReason: null,
  ignored: false,
  replaces,
});

const record = (id: string, label: string, over: Record<string, unknown> = {}) => ({
  id,
  version: 5,
  recordNo: 12,
  label,
  itemDescription: `Record ${label}`,
  productReference: null,
  qty: 4,
  designer: null,
  area: "Example room",
  boqCategory: null,
  codes: [],
  attributeCount: 3,
  hasImage: false,
  settledAnswers: 0,
  ...over,
});

function mount(lines: unknown[], reconciliation: unknown) {
  routes.current = {
    [`/api/imports/${IMPORT}`]: {
      ok: true,
      import: {
        id: IMPORT,
        status: "parsed",
        version: 1,
        error: null,
        source_kind: "boq_xlsx",
        document_kind: null,
        project_id: PROJECT,
        bws_project_number: "ZZ001",
        project_name: "Example",
        filename: "bill.xlsx",
        parsed: {
          schemaVersion: 3,
          filename: "bill.xlsx",
          sourcePreserved: true,
          sheets: [
            {
              sheetName: "Bill",
              proposedRunName: "Bill",
              headerRow: 1,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId: RUN,
              metadata: { revision: "B", date: null, notes: [] },
              lines,
            },
          ],
        },
      },
      categories: [],
      runs: [{ id: RUN, name: "MAIN", status: "active", boq_revision: "A", boq_date: null, record_count: 3 }],
      reconciliation: { 0: reconciliation },
    },
  };
  return render(<ReviewImportPage />);
}

const chair = record("rec-chair", "ZZ001-012", { configurations: ["12.1", "12.2", "12.3"] });
const stool = record("rec-stool", "ZZ001-020", { recordNo: 20, configurations: ["20.1", "20.2"] });
const bench = record("rec-bench", "ZZ001-009", { recordNo: 9, version: 8 });

const reconciliation = {
  lines: [
    { index: 0, lineNo: 2, code: "ZZ-12", status: "paired", accepted: false, suggestedRecordId: "rec-chair", candidates: [], restoreCandidates: [], deltas: [] },
    { index: 1, lineNo: 3, code: "ZZ-09", status: "new", accepted: false, suggestedRecordId: null, candidates: [], restoreCandidates: ["rec-bench"], deltas: [] },
  ],
  missing: [
    { recordId: "rec-chair", label: "ZZ001-012", itemDescription: "Record ZZ001-012", codes: ["ZZ-12"], attributeCount: 3, hasImage: false, settledAnswers: 0, configurations: ["12.1", "12.2", "12.3"], suggestedFor: 2 },
    { recordId: "rec-stool", label: "ZZ001-020", itemDescription: "Record ZZ001-020", codes: ["ZZ-20"], attributeCount: 3, hasImage: false, settledAnswers: 0, configurations: ["20.1", "20.2"] },
  ],
  counts: { paired: 1, changed: 0, new: 1, ambiguous: 0, missing: 1, restored: 0, suggested: 1 },
  records: [chair, stool],
  retired: [bench],
};

beforeEach(() => {
  routes.current = {};
  routes.calls.length = 0;
});

const patches = () => routes.calls.filter((call) => call.method === "PATCH").map((call) => call.body);

describe("the revision panel says what the confirm will write", () => {
  it("never shows a suggested pairing as chosen, and offers it as a suggestion", async () => {
    mount([line(0, "ZZ-12"), line(1, "ZZ-09")], reconciliation);
    const row = (await screen.findByText("Item ZZ-12")).closest("tr")!;
    const pairing = within(row)
      .getAllByRole("combobox")
      .find((select) => within(select).queryByRole("option", { name: "new item" })) as HTMLSelectElement;
    expect(pairing.value).toBe("");
    await userEvent.click(within(row).getByRole("button", { name: /Pair with ZZ001-012/ }));
    expect(patches()).toEqual([
      { sheetIndex: 0, index: 0, replaces: { recordId: "rec-chair", recordVersion: 5 } },
    ]);
  });

  it("pairs every suggestion on the tab in one press", async () => {
    mount([line(0, "ZZ-12"), line(1, "ZZ-09")], reconciliation);
    await userEvent.click(await screen.findByRole("button", { name: /Pair the 1 suggested/ }));
    expect(patches()).toEqual([
      { sheetIndex: 0, index: 0, replaces: { recordId: "rec-chair", recordVersion: 5 } },
    ]);
  });

  it("names a retired line's configurations, and lists a suggested record apart", async () => {
    mount([line(0, "ZZ-12"), line(1, "ZZ-09")], reconciliation);
    const retiredItem = (await screen.findByText("ZZ001-020")).closest("li")!;
    expect(retiredItem.textContent).toContain("and its 2 configurations (20.1 and 20.2)");
    // The chair is offered to line 2, not listed as no longer listed.
    expect(screen.queryByText("ZZ001-012", { selector: "li span" })).toBeNull();
  });

  it("says a paired line's configurations follow it", async () => {
    mount(
      [line(0, "ZZ-12", { recordId: "rec-chair", recordVersion: 5 }), line(1, "ZZ-09")],
      { ...reconciliation, lines: [{ ...reconciliation.lines[0], accepted: true }, reconciliation.lines[1]] },
    );
    expect(await screen.findByText(/12\.1–12\.3\s+follow it$/)).toBeTruthy();
  });

  it("offers a retired line back and stores the choice as a restore", async () => {
    mount([line(0, "ZZ-12"), line(1, "ZZ-09")], reconciliation);
    await userEvent.click(await screen.findByRole("button", { name: /Bring back ZZ001-009/ }));
    expect(patches()).toEqual([
      { sheetIndex: 0, index: 1, replaces: { recordId: "rec-bench", recordVersion: 8, restore: true } },
    ]);
  });
});
