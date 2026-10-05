// The bill review reads as line items (2026-10-05): a gap between groups, a
// fabric line hanging off its item with its swatch and nothing a record would
// carry, a family of one code bracketed rather than split by a gap, and a kind
// that is quiet until clicked — except where it has a problem.
//
// No database, no model: `apiFetch` and `next/navigation` are stubbed, and the
// bill is the SYNTHETIC pricing-document layout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import BoqRowKindCell, { type KindCellLine } from "@/components/imports/BoqRowKindCell";
import { pricingDoc } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-layout";
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

const rowOf = (lineNo: number, kind: "Item" | "Fabric") =>
  screen.getByRole("button", { name: `Row ${lineNo} is ${kind} — change` }).closest("tr")!;

describe("the bill review's groups", () => {
  it("shows a fabric line's swatch, and no area, quantity or record sentence", async () => {
    mountReview([settledSheet()]);
    await screen.findByRole("button", { name: "Row 10 is Fabric — change" });
    const fabric = rowOf(10, "Fabric");
    const swatch = within(fabric).getByRole("img", { name: "The swatch on row 10 of the bill" });
    expect(swatch.getAttribute("src")).toBe(`/api/imports/${IMPORT}/row-image?sheet=0&row=10`);
    expect(swatch.getAttribute("width")).toBe("36");
    expect(within(fabric).getByText("ZZ-FAB-13 → next free COM")).toBeInTheDocument();
    expect(within(fabric).queryByText("not given")).toBeNull();
    expect(within(fabric).queryByText(/Example Suites/)).toBeNull();
    expect(within(fabric).queryByText(/Not a record/)).toBeNull();
    // A fabric line with no picture says so in an empty frame.
    expect(within(rowOf(14, "Fabric")).getByTitle("The bill has no picture on this row")).toBeInTheDocument();
    // The item's own thumbnail is the larger, fixed size.
    const thumb = within(rowOf(9, "Item")).getByRole("img", { name: "The picture on row 9 of the bill" });
    expect(thumb.getAttribute("width")).toBe("52");
  });

  it("shows one number per row, the bill's own line in the title", async () => {
    mountReview([settledSheet()]);
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    const cell = rowOf(9, "Item").querySelector("td")!;
    expect(cell.textContent).toBe("9");
  });

  it("puts the area and the sub-area on their own lines, the stored value as the title", async () => {
    mountReview([settledSheet()]);
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    const area = within(rowOf(9, "Item")).getByTitle("Example Suites / Example Corridor");
    expect(within(area).getByText("Example Corridor").className).toContain("block");
  });

  it("puts a gap between groups and none inside a family of one code", async () => {
    const { container } = mountReview([settledSheet()]);
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    // Groups: 9+10 · 11 · the ZZ-FUR-03 family (12, 13+14+15) · 16.
    expect(container.querySelectorAll("tr[data-bill-gap]")).toHaveLength(3);
    const heading = container.querySelector('tr[data-bill-family="ZZ-FUR-03"]')!;
    expect(heading.textContent).toContain("2 options");
    expect(heading.previousElementSibling?.hasAttribute("data-bill-gap")).toBe(true);
    // Option 2 follows option 1 with no gap between them, and neither is amber:
    // the heading explains the shared code.
    const second = rowOf(13, "Item");
    expect(second.previousElementSibling?.hasAttribute("data-bill-gap")).toBe(false);
    expect(second.className).not.toContain("bg-amber-50");
    expect(rowOf(12, "Item").className).not.toContain("bg-amber-50");
    // Nothing between an item and its fabrics either.
    expect(rowOf(10, "Fabric").previousElementSibling).toBe(rowOf(9, "Item"));
  });
});

describe("the quiet kind", () => {
  const lines: KindCellLine[] = [
    { index: 0, lineNo: 11, code: "ZZ-FUR-03", itemDescription: "Sofa", ignored: true, rowKind: "item" },
    {
      index: 1,
      lineNo: 12,
      code: "ZZ-FAB-13",
      itemDescription: "Fabric @ Sofa",
      ignored: false,
      rowKind: "finish_for",
      rowKindSource: "person",
      finishFor: { row: 11, code: "ZZ-FUR-03" },
    },
  ];

  it("says Fabric and the row it belongs to before any click", () => {
    render(<BoqRowKindCell line={lines[1]!} lines={lines} editable busy={false} onSet={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Row 12 is Fabric — change" })).toBeInTheDocument();
    expect(screen.getByText(/for 11/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens the which-item select from change", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BoqRowKindCell line={lines[1]!} lines={lines} editable busy={false} onSet={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Change which item row 12 is the fabric of" }));
    expect(screen.getByRole("combobox", { name: "Row 12 is the fabric of" })).toHaveValue("11");
  });

  it("never hides a problem behind a click", () => {
    render(
      <BoqRowKindCell
        line={lines[1]!}
        lines={lines}
        editable
        busy={false}
        problem="Row 11, the item this fabric belongs to, is not included."
        onSet={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Row 12 is" })).toHaveValue("finish_for");
    expect(screen.getByRole("combobox", { name: "Row 12 is the fabric of" })).toBeInTheDocument();
    expect(screen.getByText(/is not included/)).toBeInTheDocument();
  });
});
