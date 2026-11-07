// The bill review SUGGESTS twins (0060) and never stages one unseen.
//
// A line whose code is another's under a different zone (ZG-FUR-13 /
// ZP-FUR-13) is offered "Twin of row 2?" as a `SuggestButton` with the
// evidence; accepting posts that ONE line to the twins route at its own
// version; an accepted line is a chip with Take back; and one press accepts
// every suggestion on the tab. Nothing else on the sheet is offered.
//
// No database, no model: `apiFetch` and `next/navigation` are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-twins";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  posts: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && path === `/api/imports/${IMPORT}/twins`) {
      routes.posts.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, data: { ok: true, accepted: 1 } };
    }
    const body = routes.current[method === "GET" ? path : `${method} ${path}`];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

beforeEach(() => {
  routes.current = {};
  routes.posts = [];
});

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

function sheet(accepted = false): StagedBoqSheet {
  const read = parseBoqSheets(
    [
      {
        sheet: "Guestrooms",
        data: [
          ["Code", "Description", "Qty", "Area"],
          ["ZG-FUR-13", "Example stool", 40, "Example guest suites"],
          ["ZG-FUR-14", "Example desk", 40, "Example guest suites"],
          ["ZP-FUR-13", "Example stool", 2, "Example ambassador suite"],
          ["ZZ-FUR-11", "Example bench", 1, "Example bathroom"],
          ["ZZ-FUR-11", "Example bench", 1, "Example wardrobe"],
        ],
      },
    ],
    {
      aliases: [
        { role: "code", term: "code" },
        { role: "itemDescription", term: "description" },
        { role: "qty", term: "qty" },
        { role: "area", term: "area" },
      ],
    },
  );
  if (!read.ok) throw new Error(read.error);
  const first = read.sheets[0]!;
  const lines = first.lines.map((line, index) => ({
    ...line,
    index,
    rowKind: "item" as const,
    categoryId: null,
    categoryStatus: "none",
    ignored: false,
    ...(accepted && line.lineNo === 4
      ? { twinOf: { row: 2, evidence: "ZP-FUR-13 and ZG-FUR-13 (row 2) are one code" }, twinOfVersion: 1 }
      : {}),
  }));
  return { ...first, lines, replacesRunId: null, columnsChecked: true };
}

function mount(accepted = false) {
  const staged = sheet(accepted);
  routes.current[`/api/imports/${IMPORT}`] = {
    ok: true,
    import: {
      id: IMPORT,
      status: "parsed",
      version: 3,
      error: null,
      source_kind: "boq_xlsx",
      document_kind: null,
      project_id: "project-twins",
      bws_project_number: "ZZ003",
      project_name: "Example",
      filename: "twins.xlsx",
      has_source: true,
      model_metadata: null,
      parsed: { schemaVersion: 4, filename: "twins.xlsx", sourcePreserved: true, sheets: [staged] },
    },
    categories: [],
    runs: [],
    reconciliation: {},
    billSpecs: null,
  };
  render(<ReviewImportPage />);
  return staged;
}

describe("a bill's twin suggestions", () => {
  it("offers a zone twin and a repeated code, with the evidence, and nothing else", async () => {
    mount();
    const offers = await screen.findAllByRole("button", { name: /^Twin of row \d+$/ });
    expect(offers.map((offer) => offer.textContent)).toEqual(["Twin of row 2?", "Twin of row 5?"]);
    expect(screen.getByText("ZP-FUR-13 and ZG-FUR-13 (row 2) are one code, FUR-13, under two zones (ZP, ZG).")).toBeInTheDocument();
    expect(screen.getByText("Row 5 carries the same code, ZZ-FUR-11.")).toBeInTheDocument();
  });

  it("accepts one line at its own version", async () => {
    const staged = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Twin of row 2" }));
    await waitFor(() => expect(routes.posts).toHaveLength(1));
    const stool = staged.lines.find((line) => line.lineNo === 4)!;
    expect(routes.posts[0]).toEqual({ sheetIndex: 0, accept: [{ index: stool.index, version: 0 }], clear: [] });
  });

  it("accepts the whole tab in one press", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Accept the 2 suggested twins on this tab/ }));
    await waitFor(() => expect(routes.posts).toHaveLength(1));
    expect((routes.posts[0]!.accept as unknown[]).length).toBe(2);
  });

  it("shows an accepted twin as a chip with Take back, and offers it no more", async () => {
    const staged = mount(true);
    const chip = await screen.findByText("twin of row 2");
    const row = chip.closest("tr")!;
    expect(within(row).getByText("linked when the bill is confirmed")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Twin of row 2" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Take back" }));
    await waitFor(() => expect(routes.posts).toHaveLength(1));
    const stool = staged.lines.find((line) => line.lineNo === 4)!;
    expect(routes.posts[0]).toEqual({ sheetIndex: 0, accept: [], clear: [{ index: stool.index, version: 1 }] });
  });
});
