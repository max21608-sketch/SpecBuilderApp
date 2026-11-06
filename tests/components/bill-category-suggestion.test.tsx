// A bill line's category is a SUGGESTION until a person accepts it (audit
// 2026-11-06, G8; Max: "follow the rule").
//
// The review used to pre-fill the category select with the staging's guess, so
// agreeing with it fired no change event and the confirm wrote the guess
// anyway. Here: a suggested category renders as a `SuggestButton` with the
// words it matched and no select showing it; accepting sends the per-line
// PATCH that makes it `chosen`; a chosen one is a chip; and one press accepts
// a whole tab's suggestions, saying how many.
//
// No database, no model: `apiFetch` and `next/navigation` are stubbed and the
// bill is the synthetic pricing-document layout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import { pricingDoc } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-category";
const SHEET = "CASEGOODS+SEATING+TABLES";

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
      return { ok: true, status: 200, data: { ok: true } };
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

const CATEGORIES = [
  { id: "cat-seat", slug: "seat", family: "upholstery", name: "Armchairs Benches Stools Sofas", requirements_authored: true },
  { id: "cat-table", slug: "table", family: "cabinetry", name: "Dining tables", requirements_authored: true },
];

/** Every item line suggested as seating, except the first, which a person chose as a table. */
function sheet(): StagedBoqSheet {
  const read = parseBoqSheets([{ sheet: SHEET, data: pricingDoc({ titled: true }) }], {
    aliases: [
      { role: "code", term: "spec code" },
      { role: "itemDescription", term: "item description" },
      { role: "qty", term: "total qty" },
      { role: "area", term: "area" },
    ],
  });
  if (!read.ok) throw new Error(read.error);
  const first = read.sheets[0]!;
  const lines = first.lines.map((line, index) =>
    index === 0
      ? { ...line, index, rowKind: "item" as const, categoryId: "cat-table", categoryStatus: "chosen", ignored: false }
      : {
          ...line,
          index,
          rowKind: "item" as const,
          categoryId: "cat-seat",
          categoryStatus: "suggested",
          categoryReason: "name matches “Sofa”",
          ignored: false,
        },
  );
  return { ...first, lines, replacesRunId: null, columnsChecked: true };
}

function mount() {
  const staged = sheet();
  routes.current[`/api/imports/${IMPORT}`] = {
    ok: true,
    import: {
      id: IMPORT,
      status: "parsed",
      version: 3,
      error: null,
      source_kind: "boq_xlsx",
      document_kind: null,
      project_id: "project-category",
      bws_project_number: "ZZ002",
      project_name: "Example",
      filename: "pricing.xlsx",
      has_source: true,
      model_metadata: null,
      parsed: { schemaVersion: 4, filename: "pricing.xlsx", sourcePreserved: true, sheets: [staged] },
    },
    categories: CATEGORIES,
    runs: [],
    reconciliation: {},
    billSpecs: null,
  };
  render(<ReviewImportPage />);
  return staged;
}

describe("a bill line's category", () => {
  it("is a SuggestButton with what it matched, and no select showing the guess", async () => {
    const staged = mount();
    const second = staged.lines[1]!;
    const offers = await screen.findAllByRole("button", { name: /Uph · Armchairs Benches Stools Sofas/ });
    expect(offers.length).toBe(staged.lines.length - 1);
    expect(screen.getAllByText("name matches “Sofa”").length).toBe(staged.lines.length - 1);
    // No category select is on screen at all until somebody asks for one, so
    // no select can be showing the guess as though it were chosen.
    expect(screen.queryByRole("combobox", { name: `Category for row ${second.lineNo}` })).toBeNull();

    fireEvent.click(offers[0]!);
    await waitFor(() => expect(routes.patches).toHaveLength(1));
    expect(routes.patches[0]).toEqual({ sheetIndex: 0, index: second.index, categoryId: "cat-seat" });
  });

  it("shows a chosen category as a decision, not a suggestion", async () => {
    const staged = mount();
    await screen.findAllByRole("button", { name: /Uph · Armchairs/ });
    const row = screen.getByText("Cab · Dining tables").closest("tr")!;
    expect(within(row).queryByRole("button", { name: /Cab · Dining tables/ })).toBeNull();
    expect(within(row).getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(staged.lines[0]!.categoryStatus).toBe("chosen");
  });

  it("opens an EMPTY select on Choose another, so picking the suggested sheet is a change", async () => {
    const staged = mount();
    const second = staged.lines[1]!;
    await screen.findAllByRole("button", { name: /Uph · Armchairs/ });
    const row = screen.getAllByRole("button", { name: /Uph · Armchairs/ })[0]!.closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Choose another" }));
    const select = within(row).getByRole("combobox", { name: `Category for row ${second.lineNo}` }) as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "cat-seat" } });
    await waitFor(() => expect(routes.patches).toHaveLength(1));
    expect(routes.patches[0]).toMatchObject({ index: second.index, categoryId: "cat-seat" });
  });

  it("accepts a whole tab's suggestions in one press, and says how many", async () => {
    const staged = mount();
    const expected = staged.lines.length - 1;
    const all = await screen.findByRole("button", { name: /Accept all suggested categories on this tab/ });
    expect(screen.getByText(new RegExp(`accepts ${expected} suggestions`))).toBeInTheDocument();
    fireEvent.click(all);
    await waitFor(() => expect(routes.patches).toHaveLength(expected));
    // Every suggested line, and never the one a person already chose.
    expect(routes.patches.map((patch) => patch.index)).toEqual(staged.lines.slice(1).map((line) => line.index));
    expect(routes.patches.every((patch) => patch.categoryId === "cat-seat")).toBe(true);
  });
});
