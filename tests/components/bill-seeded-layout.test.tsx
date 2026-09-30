// A SEEDED bill layout reads like a known heading — the screens (2026-09-30).
//
// `db/seed/0013_boq_layouts.sql` makes the Aman pricing document's layout
// seed data (`created_by = 'seed'`), and a sheet it reads carries
// `layoutOrigin: "seed"`. The review must not hold that sheet's Columns panel
// open, must not ask the model to read it, and must still say which layout
// read it with "Change columns" beside it. A PERSON'S layout keeps its check.
// No database, no model: `apiFetch` and `next/navigation` are stubbed, and the
// bill is the SYNTHETIC pricing-document fixture (headings copied, rows
// invented).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseBoqSheets, type BoqLayout } from "@/lib/boq-import";
import { columnsAwaitingALook } from "@/lib/boq-roles";
import BoqColumnsPanel, { type ColumnsPanelSheet } from "@/components/imports/BoqColumnsPanel";
import ReviewImportPage from "@/app/dashboard/imports/[id]/page";
import { pricingDoc, tenderSummarySheet } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-seeded";
const PROJECT = "project-seeded";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  calls: [] as { url: string; method: string; body: unknown }[],
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    routes.calls.push({ url: path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const body = routes.current[method === "GET" ? path : `${method} ${path}`];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

beforeEach(() => {
  routes.current = {};
  routes.calls.length = 0;
});

const LAYOUT_NAME = "Example specifier — pricing document";
const MAPPING: BoqLayout["mapping"] = {
  sourceLine: "line",
  area: "area",
  subArea: "sub-area",
  boqCategory: "category code",
  code: "spec code",
  itemDescription: "item description",
  qtyUnit: "unit",
  qty: "total qty",
  notes: "notes",
};

/** The pricing document and its tender summary, read by a layout of the given origin. */
function readWith(origin: BoqLayout["origin"]) {
  const result = parseBoqSheets(
    [
      { sheet: "CASEGOODS+SEATING+TABLES", data: pricingDoc({ titled: true }) },
      { sheet: "LOGISTICS", data: tenderSummarySheet() },
    ],
    { layouts: [{ id: "l1", name: LAYOUT_NAME, headerRows: 1, mapping: MAPPING, origin }] },
  );
  if (!result.ok) throw new Error("expected the layout to read the bill");
  return result.sheets.map((sheet) => ({ ...sheet, replacesRunId: null, lines: [] }));
}

describe("what the reader stages", () => {
  it("stages whose layout it was, and only a person's waits for a look", () => {
    const [seeded, summary] = readWith("seed");
    expect(seeded).toMatchObject({ mappingSource: "layout", layoutOrigin: "seed" });
    expect(columnsAwaitingALook(seeded!)).toBe(false);
    // The tender summary is dropped beside a sheet that read, with its reason.
    expect(summary).toMatchObject({ ignored: true, needsColumns: true });

    const [person] = readWith("person");
    expect(person).toMatchObject({ mappingSource: "layout", layoutOrigin: "person" });
    expect(columnsAwaitingALook(person!)).toBe(true);
    // A layout with no origin is a person's: every one before 2026-09-30 was.
    const [legacy] = readWith(undefined);
    expect(columnsAwaitingALook({ ...legacy!, layoutOrigin: undefined })).toBe(true);
    expect(columnsAwaitingALook({ ...person!, columnsChecked: true })).toBe(false);
    expect(columnsAwaitingALook({ mappingSource: "model" })).toBe(true);
    expect(columnsAwaitingALook({ mappingSource: "synonym" })).toBe(false);
  });
});

function panel(sheet: ColumnsPanelSheet) {
  const onClose = vi.fn();
  render(
    <BoqColumnsPanel
      importId={IMPORT}
      sheetIndex={0}
      sheet={sheet}
      version={7}
      editable
      onRead={vi.fn(async () => {})}
      onIgnoreSheet={vi.fn()}
      onClose={onClose}
    />,
  );
  return { onClose };
}

describe("the Columns panel on a seeded layout", () => {
  it("names the standard layout, badges it plainly, and closes without recording a check", async () => {
    const user = userEvent.setup();
    const { onClose } = panel(readWith("seed")[0]!);
    expect(screen.getByText(LAYOUT_NAME)).toBeInTheDocument();
    expect(screen.getByText(/The standard layout for this specifier/)).toBeInTheDocument();
    expect(screen.getAllByText("standard layout")).toHaveLength(9);
    expect(screen.queryByText("saved layout")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(routes.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("keeps a person's layout's check", () => {
    panel(readWith("person")[0]!);
    expect(screen.getAllByText("saved layout")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "The columns are right — close" })).toBeInTheDocument();
  });
});

function mountReview(sheets: unknown[]) {
  routes.current[`/api/imports/${IMPORT}`] = {
    ok: true,
    import: {
      id: IMPORT,
      status: "parsed",
      version: 7,
      error: null,
      source_kind: "boq_xlsx",
      document_kind: null,
      project_id: PROJECT,
      bws_project_number: "ZZ001",
      project_name: "Example",
      filename: "pricing.xlsx",
      has_source: true,
      parsed: { schemaVersion: 4, filename: "pricing.xlsx", sourcePreserved: true, sheets },
    },
    categories: [],
    runs: [],
    reconciliation: {},
  };
  return render(<ReviewImportPage />);
}

describe("the bill review", () => {
  it("opens a seeded sheet with its panel shut, says which layout read it, and asks the model nothing", async () => {
    const user = userEvent.setup();
    mountReview(readWith("seed"));
    expect(await screen.findByText(/Read with the standard/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Columns of/ })).toBeNull();
    expect(screen.queryByText("Say which column is which before confirming.")).toBeNull();
    // The wrong match stays correctable.
    await user.click(screen.getByRole("button", { name: "Change columns" }));
    expect(screen.getByRole("region", { name: "Columns of CASEGOODS+SEATING+TABLES" })).toBeInTheDocument();
    // The tender summary is ignored, so the automatic structure read never fires.
    expect(routes.calls.filter((call) => call.url === `/api/imports/${IMPORT}/suggest-columns`)).toHaveLength(0);
  });

  it("holds a person's layout's panel open until somebody has looked", async () => {
    mountReview(readWith("person"));
    expect(await screen.findByRole("region", { name: "Columns of CASEGOODS+SEATING+TABLES" })).toBeInTheDocument();
    expect(routes.calls.filter((call) => call.url === `/api/imports/${IMPORT}/suggest-columns`)).toHaveLength(0);
  });
});
