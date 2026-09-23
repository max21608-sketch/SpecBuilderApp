// A bill is never refused; it is mapped — the screens (staged BOQ v4, 0040).
//
// The Columns panel, the review screen that opens on it, and the "Set the
// columns" action a stuck bill offers on the Documents tab and the pack screen
// instead of a Try again that posted to /extract. No database, no model, no
// money: `apiFetch` and `next/navigation` are stubbed, and every bill is the
// SYNTHETIC pricing-document layout from tests/fixtures/boq-shapes.ts —
// headings copied from the real refused bill, every row invented.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseBoqSheets } from "@/lib/boq-import";
import BoqColumnsPanel, { type ColumnsPanelSheet } from "@/components/imports/BoqColumnsPanel";
import BillColumnsAction, { isStuckBill } from "@/components/imports/BillColumnsAction";
import { pricingDoc, tenderSummarySheet } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-cols";
const PROJECT = "project-cols";
const search = { current: "" };
const routeId = { current: IMPORT };

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: routeId.current }),
  useSearchParams: () => new URLSearchParams(search.current),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** Answers by PATH (GET) or "POST path"; every call recorded with its body. */
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
  search.current = "";
  routeId.current = IMPORT;
});

/** The pricing document, staged the way registration stages one nobody could read. */
function unreadSheets() {
  const result = parseBoqSheets([
    { sheet: "CASEGOODS+SEATING+TABLES", data: pricingDoc({ titled: true }) },
    { sheet: "LOGISTICS", data: tenderSummarySheet() },
  ]);
  if (result.ok || !result.sheets) throw new Error("expected the bill to need its columns");
  return result.sheets.map((sheet) => ({ ...sheet, replacesRunId: null, lines: [] }));
}

function panel(sheet: ColumnsPanelSheet, over: Partial<Parameters<typeof BoqColumnsPanel>[0]> = {}) {
  const onRead = vi.fn(async () => {});
  const onIgnoreSheet = vi.fn();
  render(
    <BoqColumnsPanel
      importId={IMPORT}
      sheetIndex={0}
      sheet={sheet}
      version={7}
      editable
      onRead={onRead}
      onIgnoreSheet={onIgnoreSheet}
      {...over}
    />,
  );
  return { onRead, onIgnoreSheet };
}

const select = (letter: string) => screen.getByRole("combobox", { name: `Column ${letter} is read as` });

describe("the Columns panel", () => {
  it("opens on the candidate header row, with the columns the reader knew pre-filled and badged", () => {
    panel(unreadSheets()[0]!);
    // Row 8 is the candidate: the closest the headings came.
    expect(screen.getByRole("button", { name: "Row 8 is the header" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Row 1 is the header" })).toHaveAttribute("aria-pressed", "false");
    expect(select("B")).toHaveValue("area");
    expect(select("H")).toHaveValue("itemDescription");
    expect(select("L")).toHaveValue("qtyUnit");
    expect(select("M")).toHaveValue("qty");
    // "Spec Code" was not known, and nothing pretends it was.
    expect(select("E")).toHaveValue("");
    expect(screen.getAllByText("known heading")).toHaveLength(4);
    // The explanation is the reader's own sentence, pointing at these controls.
    expect(screen.getByText(/Could not find a header row on this sheet/)).toBeInTheDocument();
  });

  it("makes a clicked row the header, and a shift-click beside it a two-row header", () => {
    panel(unreadSheets()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Row 3 is the header" }));
    expect(screen.getByRole("button", { name: "Row 3 is the header" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Row 8 is the header" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Row 4 is the header" }), { shiftKey: true });
    // Both rows are the header now, read as one.
    expect(screen.getByRole("button", { name: "Row 3 is the header" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Row 4 is the header" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says in words why a mapping cannot be read, and will not send it", async () => {
    const user = userEvent.setup();
    panel(unreadSheets()[0]!);
    const read = screen.getByRole("button", { name: "Read the bill with these columns" });

    // Two columns on one role.
    await user.selectOptions(select("E"), "itemDescription");
    expect(screen.getByRole("status").textContent).toMatch(/Columns E and H are both set as item description/);
    expect(read).toBeDisabled();

    // No code and no description at all.
    await user.selectOptions(select("E"), "");
    await user.selectOptions(select("H"), "");
    expect(screen.getByRole("status").textContent).toMatch(/code or the item description/);
    expect(read).toBeDisabled();
    expect(routes.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("reads the bill with the columns set, fenced on the version, and badges what changed", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/columns`] = { ok: true, version: 8, lines: 8 };
    const { onRead } = panel(unreadSheets()[0]!);
    await user.selectOptions(select("E"), "code");
    await user.selectOptions(select("C"), "subArea");
    await user.selectOptions(select("D"), "boqCategory");
    await user.selectOptions(select("A"), "sourceLine");
    await user.selectOptions(select("Q"), "notes");
    expect(screen.getAllByText("changed here").length).toBe(5);

    await user.click(screen.getByRole("button", { name: "Read the bill with these columns" }));
    const call = routes.calls.find((c) => c.method === "POST");
    expect(call?.url).toBe(`/api/imports/${IMPORT}/columns`);
    expect(call?.body).toEqual({
      sheetIndex: 0,
      headerRow: 8,
      headerRows: 1,
      version: 7,
      // Prices, cost and the picture column are not in it: not read.
      columns: {
        sourceLine: 0,
        area: 1,
        subArea: 2,
        boqCategory: 3,
        code: 4,
        itemDescription: 7,
        qtyUnit: 11,
        qty: 12,
        notes: 16,
      },
    });
    await waitFor(() => expect(onRead).toHaveBeenCalledWith(expect.stringMatching(/8 lines\. Nothing is confirmed yet/)));
  });

  it("shows a refusal from the route on the panel", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/columns`] = { ok: false, error: "Someone else changed this bill." };
    const { onRead } = panel(unreadSheets()[0]!);
    await user.selectOptions(select("E"), "code");
    await user.click(screen.getByRole("button", { name: "Read the bill with these columns" }));
    expect(await screen.findByText("Someone else changed this bill.")).toBeInTheDocument();
    expect(onRead).not.toHaveBeenCalled();
  });

  it("offers 'Not a bill — ignore this sheet'", async () => {
    const user = userEvent.setup();
    const { onIgnoreSheet } = panel(unreadSheets()[1]!);
    await user.click(screen.getByRole("button", { name: "Not a bill — ignore this sheet" }));
    expect(onIgnoreSheet).toHaveBeenCalledTimes(1);
  });

  it("names the layout that read a sheet, and records the look when it is closed", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/columns`] = { ok: true, version: 8 };
    const layoutName = "Example specifier — pricing document";
    const layouts = [
      {
        id: "l1",
        name: layoutName,
        headerRows: 1 as const,
        mapping: { code: "spec code", itemDescription: "item description", qty: "total qty" },
      },
    ];
    const read = parseBoqSheets([{ sheet: "BILL", data: pricingDoc({ titled: false }) }], { layouts });
    const onClose = vi.fn();
    panel({ ...read.sheets![0]! }, { onClose });
    expect(screen.getByText(layoutName)).toBeInTheDocument();
    expect(screen.getAllByText("saved layout")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "The columns are right — close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(routes.calls.find((call) => call.method === "POST")?.body).toEqual({
      action: "checked",
      sheetIndex: 0,
      version: 7,
    });
  });

  it("offers to remember the columns only once what the selects say is what was read", async () => {
    const user = userEvent.setup();
    routes.current["POST /api/boq-layouts"] = { ok: true, layout: { id: "l2", name: "Example — pricing" } };
    const read = parseBoqSheets([{ sheet: "BILL", data: pricingDoc({ titled: false }) }], {
      aliases: [
        { role: "code", term: "Spec Code" },
        { role: "itemDescription", term: "Item Description" },
      ],
    });
    panel({ ...read.sheets![0]! }, { onClose: vi.fn() });
    const name = screen.getByRole("textbox", { name: "Remember these columns as" });
    await user.type(name, "Example — pricing");
    await user.click(screen.getByRole("button", { name: "Remember" }));
    expect(await screen.findByText("Saved as “Example — pricing”.")).toBeInTheDocument();
    expect(routes.calls.find((call) => call.url === "/api/boq-layouts")?.body).toEqual({
      importId: IMPORT,
      sheetIndex: 0,
      name: "Example — pricing",
    });

    // Change a select: the mapping on screen is no longer what was read.
    await user.selectOptions(select("M"), "qty");
    expect(screen.getByRole("textbox", { name: "Remember these columns as" })).toBeDisabled();
    expect(screen.getByText(/Read the bill with these columns first/)).toBeInTheDocument();
  });
});

// ---- the review screen ------------------------------------------------------

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

function mountReview(over: Record<string, unknown>, sheets: unknown[] | null) {
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
      parsed: sheets === null ? null : { schemaVersion: 4, filename: "pricing.xlsx", sourcePreserved: true, sheets },
      ...over,
    },
    categories: [],
    runs: [],
    reconciliation: {},
  };
  return render(<ReviewImportPage />);
}

describe("the bill review", () => {
  it("opens on the Columns panel for a bill nobody could read, and will not confirm it", async () => {
    mountReview({}, unreadSheets());
    expect(await screen.findByRole("region", { name: "Columns of CASEGOODS+SEATING+TABLES" })).toBeInTheDocument();
    expect(screen.getByText("Say which column is which before confirming.")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /^Confirm/ });
    expect(confirm).toBeDisabled();
  });

  it("offers a free re-read on a bill that failed before its columns could be set", async () => {
    const user = userEvent.setup();
    routes.current[`POST /api/imports/${IMPORT}/columns`] = { ok: true, version: 8 };
    mountReview({ status: "failed", error: "Could not find a header row on any sheet.", parsed: null }, null);
    await user.click(await screen.findByRole("button", { name: "Read it again" }));
    await waitFor(() =>
      expect(routes.calls.find((call) => call.method === "POST")?.body).toEqual({ action: "reread", version: 7 }),
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Reading it again is free/);
  });

  it("asks for the file again where the original was not kept", async () => {
    mountReview({ status: "failed", error: "Could not find a header row.", parsed: null, has_source: false }, null);
    expect(await screen.findByText(/The original was not kept when it was uploaded/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read it again" })).toBeNull();
  });

  it("offers Change columns on a bill the synonyms read, and says which column each role came from", async () => {
    const user = userEvent.setup();
    const read = parseBoqSheets([{ sheet: "BILL", data: pricingDoc({ titled: false }) }], {
      aliases: [
        { role: "code", term: "Spec Code" },
        { role: "itemDescription", term: "Item Description" },
      ],
    });
    mountReview({}, [{ ...read.sheets![0]!, replacesRunId: null, lines: [] }]);
    expect(await screen.findByText(/Code \(client ref\) ← “Spec Code” \(E\)/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Columns of/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Change columns" }));
    expect(screen.getByRole("region", { name: "Columns of BILL" })).toBeInTheDocument();
  });
});

// ---- the stuck-bill action --------------------------------------------------

describe("a stuck bill goes to its review, never to /extract", () => {
  const bill = { id: "boq-1", sourceKind: "boq_xlsx", status: "failed", sourcePreserved: true };

  it("is a link to the review for a failed bill and for one waiting for its columns", () => {
    const { unmount } = render(<BillColumnsAction run={bill} />);
    expect(screen.getByRole("link", { name: "Set the columns" })).toHaveAttribute("href", "/dashboard/imports/boq-1");
    unmount();
    render(<BillColumnsAction run={{ ...bill, status: "parsed", needsColumns: true }} />);
    expect(screen.getByRole("link", { name: "Set the columns" })).toBeInTheDocument();
  });

  it("asks for the file where the original was not kept", () => {
    render(<BillColumnsAction run={{ ...bill, sourcePreserved: false }} />);
    expect(screen.getByText(/upload the file again/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is nothing for a bill that read, and for anything that is not a bill", () => {
    expect(isStuckBill({ ...bill, status: "parsed", needsColumns: false })).toBe(false);
    expect(isStuckBill({ ...bill, sourceKind: "spec_document" })).toBe(false);
    const { container } = render(<BillColumnsAction run={{ ...bill, status: "confirmed" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// ---- the project's Documents tab --------------------------------------------

import ProjectOverviewPage from "@/app/dashboard/projects/[id]/page";

function documentsTab(documents: unknown[]) {
  routeId.current = PROJECT;
  search.current = "tab=documents";
  routes.current[`/api/projects/${PROJECT}`] = {
    ok: true,
    project: {
      id: PROJECT,
      bws_project_number: "ZZ001",
      name: "Example",
      client: "Example Client",
      shared_inbox: null,
      order_date: null,
      specs_agreed_by: null,
      delivery_date: null,
      default_dimension_unit: null,
      status: "active",
      archived_at: null,
      archived_by: null,
      version: 1,
    },
    completion: { records: 0, outstanding: 0, uncategorised: 0 },
    summary: {
      records: 0, uncategorised: 0, noLevel: 0, levelSuggested: 0, toQuote: 0, missing: 0, tbc: 0, settled: 0,
      finishes: 0, finishesNoKind: 0, documentsReading: 0, documentsFailed: 1, tgqFromMatrix: 0, tgqFromFallback: 0,
    },
    state: "active",
    documents,
    runs: [],
    notes: [],
    contactsOutstanding: { byContact: [], unassigned: {}, noLevel: {} },
    unlinkedFinishCodes: [],
    failedDocuments: 1,
  };
  return render(<ProjectOverviewPage />);
}

const documentRow = (over: Record<string, unknown>) => ({
  id: "boq-9",
  source_kind: "boq_xlsx",
  document_kind: null,
  status: "failed",
  error: "Could not find a header row on any sheet.",
  created_at: "2026-09-23T15:00:00.000Z",
  created_by: null,
  filename: "Example pricing document.xlsx",
  source_preserved: true,
  needs_columns: false,
  batch_id: "batch-9",
  batch_label: null,
  batch_created_at: "2026-09-23T15:00:00.000Z",
  specs_applied: 0,
  runs_created: 0,
  records_created: 0,
  ...over,
});

// The documents card is rendered in more than one place on this page, so every
// query here is over ALL of them: each copy must say the same thing.
describe("the project's Documents tab", () => {
  it("offers Set the columns on a failed bill, and no Try again", async () => {
    documentsTab([documentRow({})]);
    const links = await screen.findAllByRole("link", { name: "Set the columns" });
    for (const link of links) expect(link).toHaveAttribute("href", "/dashboard/imports/boq-9");
    expect(screen.queryAllByRole("button", { name: "Try again" })).toHaveLength(0);
  });

  it("offers it on a parsed bill still waiting for its columns, in place of Review", async () => {
    documentsTab([documentRow({ status: "parsed", error: null, needs_columns: true })]);
    const links = await screen.findAllByRole("link", { name: "Set the columns" });
    for (const link of links) {
      expect(within(link.closest("tr")!).queryByRole("link", { name: "Review" })).toBeNull();
    }
  });

  it("still offers Try again on a failed specification document", async () => {
    documentsTab([
      documentRow({ id: "doc-1", source_kind: "spec_document", document_kind: "shop_drawings", filename: "S-100.pdf" }),
    ]);
    expect((await screen.findAllByRole("button", { name: "Try again" })).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: "Set the columns" })).toHaveLength(0);
  });
});
