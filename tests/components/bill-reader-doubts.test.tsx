// The bill reader's own doubts, on the review (2026-11-16): a sheet whose
// columns the reader doubts opens its Columns panel with the reason and holds
// the Confirm (audit C6/C7); a PDF bill's line the reader doubts says "check
// against the PDF" beside its page (C10).
//
// No database, no model: `apiFetch` and `next/navigation` are stubbed, and the
// bill is the SYNTHETIC pricing-document layout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import { pricingDoc } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-doubts";
const SHEET = "CASEGOODS+SEATING+TABLES";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = routes.current[method === "GET" ? path : `${method} ${path}`];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

beforeEach(() => {
  routes.current = {};
});

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

/**
 * The pricing document read by its columns, with its kinds settled: row 10 is
 * the stool's fabric (the bracket), rows 14 and 15 the second sofa option's.
 * Rows 12 and 13 carry one code and say OPTION 1 / OPTION 2.
 */
function settledSheet(): StagedBoqSheet {
  const read = parseBoqSheets([{ sheet: SHEET, data: pricingDoc({ titled: true }) }], {
    aliases: [
      { role: "code", term: "spec code" },
      { role: "itemDescription", term: "item description" },
      { role: "qty", term: "total qty" },
      { role: "area", term: "area" },
      { role: "subArea", term: "sub-area" },
      { role: "notes", term: "notes" },
    ],
  });
  if (!read.ok) throw new Error(read.error);
  const sheet = read.sheets[0]!;
  const lines = sheet.lines.map((line, index) => {
    const base = { ...line, index, categoryId: null, categoryStatus: "none", ignored: false };
    if (line.lineNo === 10) {
      return {
        ...base,
        rowKind: "finish_for" as const,
        rowKindSource: "bill" as const,
        rowKindEvidence: "The code names ZZ-FUR-10 in brackets, and row 9 carries it.",
        finishFor: { row: 9, code: "ZZ-FUR-10" },
      };
    }
    if (line.lineNo === 14 || line.lineNo === 15) {
      return {
        ...base,
        rowKind: "finish_for" as const,
        rowKindSource: "person" as const,
        finishFor: { row: 13, code: "ZZ-FUR-03" },
      };
    }
    return { ...base, rowKind: "item" as const };
  });
  return { ...sheet, lines, replacesRunId: null, columnsChecked: true };
}

function mountReview(sheets: unknown[], extra: Record<string, unknown> = {}) {
  routes.current[`/api/imports/${IMPORT}`] = {
    ok: true,
    import: {
      id: IMPORT,
      status: "parsed",
      version: 7,
      error: null,
      source_kind: "boq_xlsx",
      document_kind: null,
      project_id: "project-layout",
      bws_project_number: "ZZ001",
      project_name: "Example",
      filename: "pricing.xlsx",
      has_source: true,
      model_metadata: null,
      parsed: {
        schemaVersion: 4,
        filename: "pricing.xlsx",
        sourcePreserved: true,
        sheets,
        ...extra,
        rowImages: {
          [SHEET]: {
            "9": { pathname: "projects/p/row-9.png", contentType: "image/png", size: 10, width: 10, height: 10, pictures: 1 },
            "10": { pathname: "projects/p/row-10.png", contentType: "image/png", size: 10, width: 10, height: 10, pictures: 1 },
          },
        },
      },
    },
    categories: [],
    runs: [],
    reconciliation: {},
    billSpecs: null,
  };
  return render(<ReviewImportPage />);
}


describe("the reader's doubts, where they are", () => {
  it("opens the Columns panel with the reason, and holds the Confirm, on a sheet whose columns it doubts", async () => {
    const doubt = "Columns A (“Item”) and C (“Description”) are all headings this reader takes as the description.";
    mountReview([{ ...settledSheet(), columnsChecked: false, columnsDoubt: doubt }]);
    expect(await screen.findByText(doubt)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "The columns are right — close" })).toBeInTheDocument();
    const confirm = screen.getAllByRole("button").find((button) => /^Confirm/.test(button.textContent ?? ""));
    expect(confirm).toBeDefined();
    expect(confirm).toBeDisabled();
  });

  it("says “check against the PDF” on a PDF bill's line the reader doubts, with the reason on hover", async () => {
    const reason = "The description holds text from two bands of the page — perhaps two lines of the bill joined.";
    const sheet = settledSheet();
    const firstRow = sheet.lines[0]!.lineNo;
    const pages = sheet.lines.map(() => 1);
    const flags = sheet.lines.map((line) => (line.lineNo === 9 ? [reason] : []));
    mountReview([sheet], {
      pdfSource: { attachmentId: "pdf-1", filename: "bill.pdf", sheet: SHEET, firstRow, pages, flags },
    });
    const note = await screen.findByText("check against the PDF");
    expect(note.getAttribute("title")).toBe(reason);
    expect(note.closest("tr")?.getAttribute("id")).toMatch(/9$/);
    expect(within(note.closest("tr")!).getByRole("link", { name: /p\.\s1/ })).toBeInTheDocument();
  });
});
