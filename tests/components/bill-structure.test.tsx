// A model reads a bill's structure; a fabric line is a spec on its item — the
// screens (plan any-bill, Step 2).
//
// The review screen's automatic structure read (once, and never on a bill
// already read), the yellow banner and the "The columns are right" gate a
// model's columns wait behind, the Kind select on each line and the items a
// fabric line is offered, and the Confirm label that counts fabric specs. No
// database, no model, no money: `apiFetch` and `next/navigation` are stubbed,
// and every bill is the SYNTHETIC pricing-document layout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import { StructureOutput, validateStructure } from "@/lib/boq-structure";
import BoqRowKindCell, { type KindCellLine } from "@/components/imports/BoqRowKindCell";
import BillColumnsAction from "@/components/imports/BillColumnsAction";
import { pricingDoc, tenderSummarySheet } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-structure";
const PROJECT = "project-structure";

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
    if (typeof body === "object" && body && (body as { ok?: boolean }).ok === false) {
      return { ok: false, status: 400, error: String((body as { error?: string }).error), data: body };
    }
    return { ok: true, status: 200, data: body };
  },
}));

beforeEach(() => {
  routes.current = {};
  routes.calls.length = 0;
});

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

/** The pricing document as registration stages it: nobody could read either sheet. */
function unreadSheets(): StagedBoqSheet[] {
  const result = parseBoqSheets([
    { sheet: "CASEGOODS+SEATING+TABLES", data: pricingDoc({ titled: true }) },
    { sheet: "LOGISTICS", data: tenderSummarySheet() },
  ]);
  if (result.ok || !result.sheets) throw new Error("expected the bill to need its columns");
  return result.sheets.map((sheet) => ({ ...sheet, replacesRunId: null, lines: [] }));
}

/** The same bill after a model read its columns — every cell read by code. */
function modelReadSheet(): StagedBoqSheet {
  const data = pricingDoc({ titled: true });
  const reading = validateStructure(
    StructureOutput.parse({
      notABill: false,
      notABillEvidence: null,
      headerRow: 8,
      headerRows: 1,
      columns: [
        { column: "E", role: "code", heading: "Spec Code", evidence: "codes like ZZ-FUR-10" },
        { column: "H", role: "itemDescription", heading: "Item Description", evidence: "descriptions" },
        { column: "M", role: "qty", heading: "Total QTY", evidence: "counts" },
      ],
      rows: [{ row: 14, kind: "finish_for", parentRow: 13, evidence: "Fabric @ Sofa under OPTION 2" }],
    }),
    data,
  );
  // Staged by hand here rather than through `stageStructureReading`, which
  // needs the server's suggester: the columns and kinds are what the screen reads.
  const read = parseBoqSheets([{ sheet: "CASEGOODS+SEATING+TABLES", data }], {
    aliases: [
      { role: "code", term: "spec code" },
      { role: "itemDescription", term: "item description" },
      { role: "qty", term: "total qty" },
    ],
  });
  if (!read.ok) throw new Error(read.error);
  const sheet = read.sheets[0]!;
  const lines = sheet.lines.map((line, index) => ({ ...line, index, categoryId: null, categoryStatus: "none", ignored: false }));
  const withKinds = lines.map((line) =>
    line.lineNo === 14
      ? { ...line, rowKind: "finish_for" as const, rowKindSource: "model" as const, rowKindEvidence: "Fabric @ Sofa under OPTION 2", finishFor: { row: 13, code: "ZZ-FUR-03" } }
      : line,
  );
  return {
    ...sheet,
    lines: withKinds,
    replacesRunId: null,
    mappingSource: "model",
    mappingEvidence: reading.evidence,
    columnsChecked: false,
    structure: { headerRow: 8, rows: reading.rows, notes: reading.notes },
  };
}

function mountReview(over: Record<string, unknown>, sheets: unknown[]) {
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
      model_metadata: null,
      parsed: { schemaVersion: 4, filename: "pricing.xlsx", sourcePreserved: true, sheets },
      ...over,
    },
    categories: [],
    runs: [],
    reconciliation: {},
    billSpecs: null,
  };
  return render(<ReviewImportPage />);
}

const structureCalls = () => routes.calls.filter((call) => call.url === `/api/imports/${IMPORT}/suggest-columns`);

describe("the automatic structure read", () => {
  it("asks the model ONCE when the review first opens a bill nobody could map", async () => {
    routes.current[`POST /api/imports/${IMPORT}/suggest-columns`] = { ok: true, version: 9, charged: 2 };
    mountReview({}, unreadSheets());
    await waitFor(() => expect(structureCalls()).toHaveLength(1));
    const body = structureCalls()[0]!.body as { version: number; requestId: string; sheetIndex?: number };
    expect(body.version).toBe(7);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.sheetIndex).toBeUndefined();
    // A successful read reports itself through the reload — the yellow banner
    // over a model's columns — and not through a second notice; it is not a
    // failure either.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Ask again/ })).toBeNull());
    // Reloads do not ask again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(structureCalls()).toHaveLength(1);
  });

  it("never asks about a bill whose sheets have had their reading", async () => {
    mountReview(
      {
        model_metadata: {
          structureRead: {
            sheets: {
              "CASEGOODS+SEATING+TABLES": { at: "2026-09-23T10:00:00Z", ok: false, outcome: "failed" },
              LOGISTICS: { at: "2026-09-23T10:00:00Z", ok: true, outcome: "not a bill" },
            },
          },
        },
      },
      unreadSheets(),
    );
    expect(await screen.findByRole("region", { name: "Columns of CASEGOODS+SEATING+TABLES" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(structureCalls()).toHaveLength(0);
  });

  it("says in words when the read failed, with a retry, and the panel still works by hand", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/suggest-columns`] = {
      ok: false,
      error: "The model is overloaded right now. Nothing was applied — set them by hand, or ask again.",
    };
    mountReview({}, unreadSheets());
    expect(await screen.findByText("The model did not read the columns.")).toBeInTheDocument();
    expect(screen.getByText(/The Columns panel still works by hand, and that is free/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Column E is read as" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() => expect(structureCalls()).toHaveLength(2));
  });

  it("offers Ask the model and the primary read in the panel's header row", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/suggest-columns`] = { ok: true, version: 9 };
    mountReview({ model_metadata: { structureRead: { sheets: { "CASEGOODS+SEATING+TABLES": { at: "x", ok: false, outcome: "" }, LOGISTICS: { at: "x", ok: true, outcome: "" } } } } }, unreadSheets());
    const region = await screen.findByRole("region", { name: "Columns of CASEGOODS+SEATING+TABLES" });
    const header = within(region).getAllByRole("heading")[0]!;
    expect(within(header).getByRole("button", { name: "Read the bill with these columns" })).toBeInTheDocument();
    await user.click(within(header).getByRole("button", { name: "Ask the model to read the columns" }));
    await waitFor(() => expect(structureCalls()).toHaveLength(1));
    expect((structureCalls()[0]!.body as { sheetIndex: number }).sheetIndex).toBe(0);
  });
});

describe("a model's columns wait for a person", () => {
  it("shows the yellow banner and refuses the confirm until the columns are checked", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/columns`] = { ok: true, version: 8 };
    mountReview({}, [modelReadSheet()]);
    expect(await screen.findByText("Columns and row kinds read by the model — check them.")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /^Confirm · creates/ });
    expect(confirm).toBeDisabled();
    // The label counts the fabric line as a spec, not a record.
    // Row 10 by the bill's bracket, row 14 by the model: two fabric specs.
    expect(confirm.textContent).toBe("Confirm · creates 6 records and 2 fabric specs on 1 phase");
    const region = screen.getByRole("region", { name: "Columns of CASEGOODS+SEATING+TABLES" });
    expect(within(region).getAllByText("read by the model").length).toBeGreaterThan(0);
    expect(within(region).getByText("codes like ZZ-FUR-10")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "The columns are right — close" }));
    await waitFor(() =>
      expect(routes.calls.find((call) => call.url === `/api/imports/${IMPORT}/columns`)?.body).toEqual({
        action: "checked",
        sheetIndex: 0,
        version: 7,
      }),
    );
  });

  it("lets the confirm through once the columns are checked", async () => {
    mountReview({}, [{ ...modelReadSheet(), columnsChecked: true }]);
    const confirm = await screen.findByRole("button", { name: /^Confirm · creates/ });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText("Columns and row kinds read by the model — check them.")).toBeNull();
  });
});

describe("a line's kind", () => {
  const lines: KindCellLine[] = [
    { index: 0, lineNo: 9, code: "ZZ-FUR-10", itemDescription: "Stool Model Ref: Bespoke", ignored: false },
    { index: 1, lineNo: 10, code: "ZZ-FUR-26", itemDescription: "Drawers", ignored: true },
    { index: 2, lineNo: 11, code: "ZZ-FUR-03", itemDescription: "Sofa", ignored: false },
    { index: 3, lineNo: 12, code: "ZZ-FAB-13", itemDescription: "Fabric @ Sofa", ignored: false },
    { index: 4, lineNo: 13, code: "ZZ-FUR-40", itemDescription: "Lounger", ignored: false },
  ];

  it("sets a section in one press", async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<BoqRowKindCell line={lines[3]!} lines={lines} editable busy={false} onSet={onSet} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Row 12 is" }), "section");
    expect(onSet).toHaveBeenCalledWith("section", null);
  });

  it("offers the live item lines ABOVE a fabric line, nearest first, and writes nothing until one is chosen", async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<BoqRowKindCell line={lines[3]!} lines={lines} editable busy={false} onSet={onSet} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Row 12 is" }), "finish_for");
    expect(onSet).not.toHaveBeenCalled();
    const parent = screen.getByRole("combobox", { name: "Row 12 is the fabric of" });
    const options = within(parent).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["— which item? —", "row 11 · ZZ-FUR-03 · Sofa", "row 9 · ZZ-FUR-10 · Stool Model Ref: Bespoke"]);
    await user.selectOptions(parent, "9");
    expect(onSet).toHaveBeenCalledWith("finish_for", 9);
  });

  it("shows who said so, and a flagged reading in amber words", () => {
    const flagged: KindCellLine = {
      ...lines[3]!,
      rowKind: "finish_for",
      rowKindSource: "bill",
      rowKindFlag: "2 lines carry ZZ-FUR-03 — this is the nearer one above (row 11); check it.",
      finishFor: { row: 11, code: "ZZ-FUR-03" },
    };
    render(<BoqRowKindCell line={flagged} lines={lines} editable busy={false} onSet={vi.fn()} />);
    expect(screen.getByText("the bill's bracket")).toBeInTheDocument();
    expect(screen.getByText(/this is the nearer one above \(row 11\); check it/)).toBeInTheDocument();
    expect(screen.getByText("written as the next free COM on row 11")).toBeInTheDocument();
    expect((screen.getByRole("combobox", { name: "Row 12 is the fabric of" }) as HTMLSelectElement).value).toBe("11");
  });

  it("puts a Kind select on every line of the review, and a fabric line's category is its item", async () => {
    mountReview({}, [{ ...modelReadSheet(), columnsChecked: true }]);
    expect(await screen.findByRole("combobox", { name: "Row 14 is" })).toHaveValue("finish_for");
    expect(screen.getByRole("combobox", { name: "Row 9 is" })).toHaveValue("item");
    expect(screen.getByText(/Not a record — its description is written as a fabric spec on row 13/)).toBeInTheDocument();
  });
});

describe("the Documents row", () => {
  it("says before the press that opening an unread bill reads its columns, and only then", () => {
    const { rerender } = render(
      <BillColumnsAction run={{ id: "b1", sourceKind: "boq_xlsx", status: "parsed", needsColumns: true, sourcePreserved: true, structureRead: false }} />,
    );
    expect(screen.getByText("opening it reads the columns: one small read, charged")).toBeInTheDocument();
    rerender(
      <BillColumnsAction run={{ id: "b1", sourceKind: "boq_xlsx", status: "parsed", needsColumns: true, sourcePreserved: true, structureRead: true }} />,
    );
    expect(screen.queryByText(/one small read, charged/)).toBeNull();
  });
});
