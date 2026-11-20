// The bill review SUGGESTS a section heading and a finish line, and opens on
// the first sheet that is not dropped (2026-11-20, R2, R3 and R5).
//
// A bill read by its known headings stages every row as an Item. A heading in
// the code column ("GUEST ROOM TYPE A") is offered "Section heading?", and a
// finish code with no quantity under an item is offered "Finish for <item>?",
// each with its evidence; accepting sends the Kind control's own PATCH at the
// document's version; one press per tab accepts every suggestion of a kind.
// Nothing is set on its own. And a bill whose first tab is a dropped cover
// opens on the bill, not the cover.
//
// No database, no model: `apiFetch` and `next/navigation` are stubbed. The bill
// is INVENTED (an invented specifier's layout and words).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-kinds";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  patches: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH" && path === `/api/imports/${IMPORT}`) {
      routes.patches.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, data: { ok: true, version: 3 + routes.patches.length } };
    }
    const body = routes.current[method === "GET" ? path : `${method} ${path}`];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

beforeEach(() => {
  routes.current = {};
  routes.patches = [];
});

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

function sheets(): StagedBoqSheet[] {
  const read = parseBoqSheets(
    [
      { sheet: "Cover", data: [["EXAMPLE INTERIORS"], ["An invented hotel — bill of quantities"]] },
      {
        sheet: "Guest Rooms",
        data: [
          ["Ref", "Location", "Description", "Unit", "Qty"],
          ["GUEST ROOM TYPE A", null, null, null, null],
          ["ZZ-SF-01", "Room A", "Example sofa", "nr", 24],
          ["FAB-01", null, "Finish: Example cloth, col. 130", null, null],
          ["FAB-02", null, "Finish: Example linen", null, null],
          ["MTL-01", null, "Finish: Example brass", null, null],
          ["ZZ-CH-02", "Room A", "Example lounge chair", "nr", 48],
        ],
      },
    ],
    {
      aliases: [
        { role: "code", term: "ref" },
        { role: "area", term: "location" },
        { role: "itemDescription", term: "description" },
        { role: "qtyUnit", term: "unit" },
        { role: "qty", term: "qty" },
      ],
    },
  );
  if (!read.ok) throw new Error(read.error);
  return read.sheets.map((sheet) => ({
    ...sheet,
    ignored: sheet.sheetName === "Cover" ? true : sheet.ignored,
    lines: sheet.lines.map((line, index) => ({ ...line, index, categoryId: null, categoryStatus: "none", ignored: false })),
    replacesRunId: null,
    columnsChecked: true,
  })) as StagedBoqSheet[];
}

function mount() {
  const staged = sheets();
  routes.current[`/api/imports/${IMPORT}`] = {
    ok: true,
    import: {
      id: IMPORT,
      status: "parsed",
      version: 3,
      error: null,
      source_kind: "boq_xlsx",
      document_kind: null,
      project_id: "project-kinds",
      bws_project_number: "ZZ004",
      project_name: "Example",
      filename: "kinds.xlsx",
      has_source: true,
      model_metadata: null,
      parsed: { schemaVersion: 4, filename: "kinds.xlsx", sourcePreserved: true, sheets: staged },
    },
    categories: [],
    runs: [],
    reconciliation: {},
    billSpecs: null,
  };
  render(<ReviewImportPage />);
  return staged[1]!;
}

describe("a bill's kind suggestions", () => {
  it("opens on the first sheet that is not dropped, not on the cover", async () => {
    mount();
    expect(await screen.findByText("Example sofa")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Guest Rooms/ })).toHaveAttribute("aria-selected", "true");
  });

  it("asks about the heading, with its evidence, and nothing else", async () => {
    mount();
    const offers = await screen.findAllByRole("button", { name: /^(Section heading|Finish for .+)$/ });
    expect(offers.map((offer) => offer.textContent)).toEqual(["Section heading?"]);
    expect(screen.getByText("text in the code column only — no quantity, unit or anything else on the row")).toBeInTheDocument();
  });

  it("accepts one as the Kind control would, at the document's version", async () => {
    const sheet = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Section heading" }));
    await waitFor(() => expect(routes.patches).toHaveLength(1));
    const heading = sheet.lines.find((line) => line.lineNo === 2)!;
    expect(routes.patches[0]).toEqual({ sheetIndex: 1, index: heading.index, rowKind: "section", version: 3 });
  });

  it("accepts every heading on the tab in one press", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Accept all 1 suggested section heading$/ }));
    await waitFor(() => expect(routes.patches).toHaveLength(1));
    expect(routes.patches[0]).toMatchObject({ sheetIndex: 1, rowKind: "section" });
  });
});
