// A bill row's picture opened under its row on the review (2026-10-05): the
// panel is its OWN `<tr>` straight under the row, it crops the bill's own
// picture, shows the crop before anything is stored, and offers the three
// actions — Use this crop, The whole picture, No picture. The thumbnail shows
// what the row will give (`effectiveRowImage`), never the bill's picture over
// a person's choice.
//
// No database, no model, no store: `apiFetch`, the crop and the upload are
// stubbed, and the bill is the SYNTHETIC pricing-document layout.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseBoqSheets, type StagedBoqSheet } from "@/lib/boq-import";
import { pricingDoc } from "../fixtures/boq-shapes";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const IMPORT = "import-picture";
const PROJECT = "project-picture";
const SHEET = "CASEGOODS+SEATING+TABLES";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  sent: [] as { method: string; path: string; body: unknown }[],
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") routes.sent.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const body = routes.current[method === "GET" ? path : `${method} ${path}`];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

const crops = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/pdf-crop", () => ({
  cropImageRegion: async (...args: unknown[]) => {
    crops.calls.push(args);
    return { blob: new Blob(["crop"], { type: "image/png" }), width: 30, height: 20 };
  },
}));
const uploads = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@vercel/blob/client", () => ({
  upload: async (...args: unknown[]) => {
    uploads.calls.push(args);
    return { pathname: `${String(args[0]).replace(/\.png$/, "")}-RANDOM.png` };
  },
}));

beforeEach(() => {
  routes.current = {};
  routes.sent = [];
  crops.calls = [];
  uploads.calls = [];
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
});

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

/** The pricing document by its columns: row 10 the stool's fabric, everything else an item. */
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
        finishFor: { row: 9, code: "ZZ-FUR-10" },
      };
    }
    return { ...base, rowKind: "item" as const };
  });
  return { ...sheet, lines, replacesRunId: null, columnsChecked: true };
}

const picture = (row: number) => ({
  pathname: `projects/${PROJECT}/bill-images/${IMPORT}/row-${row}.png`,
  contentType: "image/png",
  size: 10,
  width: 10,
  height: 10,
  pictures: 1,
});

function mountReview(sheet: StagedBoqSheet, status = "parsed") {
  routes.current[`/api/imports/${IMPORT}`] = {
    ok: true,
    import: {
      id: IMPORT,
      status,
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
      parsed: {
        schemaVersion: 4,
        filename: "pricing.xlsx",
        sourcePreserved: true,
        sheets: [sheet],
        rowImages: { [SHEET]: { "9": picture(9), "10": picture(10), "11": picture(11) } },
      },
    },
    categories: [],
    runs: [],
    reconciliation: {},
    billSpecs: null,
  };
  routes.current[`PATCH /api/imports/${IMPORT}`] = { ok: true, version: 8, pictureVersion: 1 };
  return render(<ReviewImportPage />);
}

const rowOf = (lineNo: number, kind: "Item" | "Fabric") =>
  screen.getByRole("button", { name: `Row ${lineNo} is ${kind} — change` }).closest("tr")!;

/** jsdom lays nothing out; a 100x100 box makes the drag's fractions readable. */
function dragACrop(panel: HTMLElement) {
  const box = within(panel).getByAltText("").parentElement!;
  box.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  fireEvent.mouseDown(box, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(box, { clientX: 60, clientY: 60 });
  fireEvent.mouseUp(box, { clientX: 60, clientY: 60 });
}

describe("a bill row's picture, opened under its row", () => {
  it("opens as its own row straight under the item, cropping the bill's own picture", async () => {
    const user = userEvent.setup();
    mountReview(settledSheet());
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    const opener = within(rowOf(9, "Item")).getByRole("button", { name: "Change the picture on row 9" });
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    await user.click(opener);

    const panel = document.querySelector('tr[data-bill-picture-panel="9"]') as HTMLTableRowElement;
    expect(panel).not.toBeNull();
    expect(panel.previousElementSibling).toBe(rowOf(9, "Item"));
    // One spanning cell, never extra cells beside the data.
    expect(panel.children).toHaveLength(1);
    expect(Number((panel.children[0] as HTMLTableCellElement).colSpan)).toBeGreaterThan(1);
    // The panel crops the BILL'S picture, not whatever the row shows now.
    expect(within(panel).getByAltText("").getAttribute("src")).toBe(
      `/api/imports/${IMPORT}/row-image?sheet=0&row=9&original=1`,
    );
    expect(within(panel).getByRole("button", { name: "Use this crop" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "The whole picture" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "No picture" })).toBeEnabled();
  });

  it("shows the crop before storing it, then stores it under the bill and records it on the line", async () => {
    const user = userEvent.setup();
    mountReview(settledSheet());
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    await user.click(within(rowOf(9, "Item")).getByRole("button", { name: "Change the picture on row 9" }));
    const panel = document.querySelector('tr[data-bill-picture-panel="9"]') as HTMLElement;

    dragACrop(panel);
    await act(async () => undefined);
    expect(crops.calls).toHaveLength(1);
    expect(crops.calls[0]![0]).toBe(`/api/imports/${IMPORT}/row-image?sheet=0&row=9&original=1`);
    expect(crops.calls[0]![1]).toEqual([0.1, 0.1, 0.6, 0.6]);
    expect(within(panel).getByAltText("The crop of row 9's picture").getAttribute("src")).toBe("blob:test");
    // Nothing stored yet.
    expect(uploads.calls).toHaveLength(0);
    expect(routes.sent).toHaveLength(0);

    await user.click(within(panel).getByRole("button", { name: "Use this crop" }));
    expect(uploads.calls).toHaveLength(1);
    expect(String(uploads.calls[0]![0])).toMatch(new RegExp(`^projects/${PROJECT}/bill-images/${IMPORT}/crop-0-9-\\d+\\.png$`));
    expect(uploads.calls[0]![2]).toMatchObject({ access: "private", clientPayload: PROJECT, handleUploadUrl: "/api/uploads/token" });
    const line = settledSheet().lines.find((entry) => entry.lineNo === 9)!;
    expect(routes.sent).toEqual([
      {
        method: "PATCH",
        path: `/api/imports/${IMPORT}`,
        body: {
          sheetIndex: 0,
          index: line.index,
          picture: { pathname: expect.stringMatching(/-RANDOM\.png$/), width: 30, height: 20 },
          pictureVersion: 0,
        },
      },
    ]);
  });

  it("sends No picture and The whole picture with the version it was drawn with", async () => {
    const user = userEvent.setup();
    const sheet = settledSheet();
    const crop = { pathname: `projects/${PROJECT}/bill-images/${IMPORT}/crop-0-9-1.png`, contentType: "image/png", size: 5, width: 3, height: 2 };
    sheet.lines = sheet.lines.map((line) => (line.lineNo === 9 ? { ...line, picture: crop, pictureVersion: 2 } : line));
    mountReview(sheet);
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    await user.click(within(rowOf(9, "Item")).getByRole("button", { name: "Change the picture on row 9" }));
    const panel = () => document.querySelector('tr[data-bill-picture-panel="9"]') as HTMLElement;
    await user.click(within(panel()).getByRole("button", { name: "The whole picture" }));
    expect(routes.sent.at(-1)?.body).toMatchObject({ picture: null, pictureVersion: 2 });

    await user.click(within(rowOf(9, "Item")).getByRole("button", { name: "Change the picture on row 9" }));
    await user.click(within(panel()).getByRole("button", { name: "No picture" }));
    expect(routes.sent.at(-1)?.body).toMatchObject({ picture: { none: true }, pictureVersion: 2 });
  });

  it("shows what the row will give: the crop, versioned past the cache, or a box saying no picture", async () => {
    const sheet = settledSheet();
    const crop = { pathname: `projects/${PROJECT}/bill-images/${IMPORT}/crop-0-9-1.png`, contentType: "image/png", size: 5, width: 3, height: 2 };
    sheet.lines = sheet.lines.map((line) =>
      line.lineNo === 9
        ? { ...line, picture: crop, pictureVersion: 2 }
        : line.lineNo === 11
          ? { ...line, picture: { none: true as const }, pictureVersion: 1 }
          : line,
    );
    mountReview(sheet);
    await screen.findByRole("button", { name: "Row 9 is Item — change" });
    const thumb = within(rowOf(9, "Item")).getByRole("img", { name: "The picture on row 9 of the bill" });
    expect(thumb.getAttribute("src")).toBe(`/api/imports/${IMPORT}/row-image?sheet=0&row=9&v=2`);
    expect(within(rowOf(9, "Item")).getByText("cropped on this review")).toBeInTheDocument();
    const refused = within(rowOf(11, "Item"));
    expect(refused.queryByRole("img")).toBeNull();
    expect(refused.getByRole("button", { name: "Change the picture on row 11" })).toHaveTextContent("no picture");
  });

  it("opens a fabric's swatch the same way", async () => {
    const user = userEvent.setup();
    mountReview(settledSheet());
    await screen.findByRole("button", { name: "Row 10 is Fabric — change" });
    await user.click(within(rowOf(10, "Fabric")).getByRole("button", { name: "Change the swatch on row 10" }));
    const panel = document.querySelector('tr[data-bill-picture-panel="10"]') as HTMLElement;
    expect(panel.previousElementSibling).toBe(rowOf(10, "Fabric"));
    expect(panel.textContent).toContain("Row 10's swatch.");
    expect(panel.textContent).toContain("as the fabric's swatch");
  });

  it("offers nothing to open once the bill is confirmed", async () => {
    mountReview(settledSheet(), "confirmed");
    await screen.findByRole("img", { name: "The picture on row 9 of the bill" });
    expect(screen.queryByRole("button", { name: "Change the picture on row 9" })).toBeNull();
  });
});
