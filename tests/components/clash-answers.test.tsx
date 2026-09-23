// The three answers to a cross-page clash, pressed on the review screen.
//
// ============================================================================
// Plan any-bill, step 4. Two pages give one configuration COM 1 in different
// words, and the row asks the real question: the same fabric (keep one page's
// wording) or two (move the later page to the next free slot). What is proved
// here is what each button SENDS — ordinary autosaves, one per row, under the
// version the screen showed — and that a swatch cropped on the row being
// ignored is carried to the kept row and uploaded against IT at confirm,
// because an ignored row's crop is never uploaded.
//
// The server is a small stateful stand-in: a PATCH is applied to the staged
// rows it holds, and the clash goes when either row stops being pending.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrawingsReview from "@/components/imports/DrawingsReview";
import { callout, item, records, resetIds, resolution } from "./fixtures";
import type { DrawingItem, FieldClash } from "@/lib/drawing-document";

vi.mock("@/lib/pdf-crop", () => ({
  cropPdfRegion: async () => ({ blob: new Blob(["x"], { type: "image/png" }), width: 10, height: 10 }),
  countPdfPagesInBrowser: async () => null,
}));

const uploads = vi.hoisted(() => [] as string[]);
vi.mock("@vercel/blob/client", () => ({
  upload: async (path: string) => {
    uploads.push(path);
    return { pathname: path };
  },
}));

const SPEC_FIELDS = [
  { id: "field-com1", json_id: 1, name: "COM 1", field_category: "Upholstery" },
  { id: "field-com2", json_id: 2, name: "COM 2", field_category: "Upholstery" },
];

const server = vi.hoisted(() => ({
  items: [] as DrawingItem[],
  patches: [] as { observationId: string; expectedVersion: number; changes: Record<string, unknown> }[],
  confirms: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: { method?: string; body?: string }) => {
    if (url.startsWith("/api/projects/")) return { ok: false, status: 500, error: "no", data: null };
    if (url.endsWith("/confirm")) {
      server.confirms.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, data: {} };
    }
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as {
        observationId: string;
        expectedVersion: number;
        changes: Record<string, unknown>;
      };
      server.patches.push(body);
      server.items = server.items.map((entry) => ({
        ...entry,
        observations: entry.observations.map((o) => {
          if (o.id !== body.observationId) return o;
          const next = { ...o, version: o.version + 1 };
          if ("materialCode" in body.changes) next.materialCodeRaw = String(body.changes.materialCode);
          if ("specFieldId" in body.changes) next.specFieldId = String(body.changes.specFieldId);
          if ("ignoreBecause" in body.changes) {
            next.reviewStatus = "ignored";
            next.ignoredReason = String(body.changes.ignoreBecause);
          }
          return next;
        }),
      }));
      return { ok: true, status: 200, data: { version: 2 } };
    }
    return { ok: true, status: 200, data: payload() };
  },
}));

const SHEET = "Maker A, Ref. Pattern X - Raffia";
const DRAWING = "Maker A, raffia, Pattern X";

function clash(): FieldClash {
  const [sheet, drawing] = server.items;
  return {
    fieldName: "COM 1",
    fabric: true,
    rows: [
      { observationId: sheet!.observations[0]!.id, itemId: sheet!.id, page: 1 },
      { observationId: drawing!.observations[0]!.id, itemId: drawing!.id, page: 2 },
    ],
    move: {
      observationId: drawing!.observations[0]!.id,
      page: 2,
      fieldId: "field-com2",
      fieldName: "COM 2",
      candidates: [{ fieldId: "field-com2", fieldName: "COM 2" }],
    },
  };
}

function payload() {
  const pending = server.items.every((entry) => entry.observations[0]!.reviewStatus === "pending");
  const message =
    "Page 1 and page 2 both give COM 1. If they are the same fabric, keep one wording; if they are two fabrics, give page 2 its own field.";
  return {
    import: {
      id: "import-1",
      project_id: "project-9",
      status: "parsed",
      version: 3,
      error: null,
      document_kind: "shop_drawings",
      filename: "Q-301.pdf",
      claim_live: null,
      within_deadline: null,
      claim_count: 1,
      parsed: { schemaVersion: 1, kind: "shop_drawings", filename: "Q-301.pdf", documentNotes: null, items: server.items },
    },
    resolution: server.items.map((entry) =>
      resolution({
        id: entry.id,
        blockers:
          pending && entry.observations[0]!.reviewStatus === "pending"
            ? [
                {
                  code: "field_conflict",
                  message,
                  observationId: entry.observations[0]!.id,
                  pairKey: "pair",
                  clash: clash(),
                },
              ]
            : [],
      }),
    ),
    specFields: SPEC_FIELDS,
    records,
  };
}

function stagePair() {
  resetIds();
  server.items = [
    item({
      id: "item-p1",
      page: 1,
      itemCodeRaw: "Q-301",
      observations: [callout("FABRIC REFERENCE", SHEET, null, { attrGroup: "material", specFieldId: "field-com1" })],
    }),
    item({
      id: "item-p2",
      page: 2,
      itemCodeRaw: "Q-301 MUR",
      observations: [callout("FABRIC", DRAWING, "QQ-01.1", { attrGroup: "material", specFieldId: "field-com1" })],
    }),
  ];
}

const sheetId = () => server.items[0]!.observations[0]!.id;
const drawingId = () => server.items[1]!.observations[0]!.id;
const rowFor = (value: string) => screen.getByDisplayValue(value).closest("tr") as HTMLElement;

beforeEach(() => {
  server.patches = [];
  server.confirms = [];
  uploads.length = 0;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
  stagePair();
});

describe("the three answers", () => {
  it("are offered on the clashing row, as buttons", async () => {
    render(<DrawingsReview importId="import-1" />);
    expect((await screen.findAllByRole("button", { name: "Same fabric — keep page 1’s wording" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Same fabric — keep page 2’s wording" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Two fabrics — move page 2 to COM 2" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/move one to another field/)).toBeNull();
  });

  it("keeping page 1 gives it page 2's code, then ignores page 2 'same as page 1'", async () => {
    render(<DrawingsReview importId="import-1" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Same fabric — keep page 1’s wording" }))[0]!);
    await waitFor(() => expect(server.patches).toHaveLength(2));
    expect(server.patches).toEqual([
      { itemId: "item-p1", observationId: sheetId(), expectedVersion: 1, changes: { materialCode: "QQ-01.1" } },
      { itemId: "item-p2", observationId: drawingId(), expectedVersion: 1, changes: { ignoreBecause: "same as page 1" } },
    ]);
    // The clash goes with the reload.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Same fabric/ })).toBeNull());
  });

  it("keeping page 2 ignores page 1 and carries nothing page 2 already has", async () => {
    render(<DrawingsReview importId="import-1" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Same fabric — keep page 2’s wording" }))[0]!);
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0]).toMatchObject({ observationId: sheetId(), changes: { ignoreBecause: "same as page 2" } });
  });

  it("two fabrics moves page 2 to COM 2 and touches nothing else", async () => {
    render(<DrawingsReview importId="import-1" />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Two fabrics — move page 2 to COM 2" }))[0]!);
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0]).toMatchObject({ observationId: drawingId(), expectedVersion: 1, changes: { specFieldId: "field-com2" } });
  });
});

describe("a swatch cropped on the row that is ignored", () => {
  it("moves to the kept row, is shown there, and is uploaded against it at confirm", async () => {
    render(<DrawingsReview importId="import-1" />);
    // Crop the chip on page 2's row — the only one with a code, so the only
    // one offered a crop before the answer.
    await screen.findByDisplayValue(DRAWING);
    const drawingRow = rowFor(DRAWING);
    await userEvent.click(await within(drawingRow).findByRole("button", { name: "Crop the swatch" }));
    const image = await within(rowFor(DRAWING)).findByAltText("");
    const box = image.parentElement!;
    box.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.mouseDown(box, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(box, { clientX: 60, clientY: 60 });
    fireEvent.mouseUp(box, { clientX: 60, clientY: 60 });
    await act(async () => undefined);
    const use = screen.queryByRole("button", { name: /Use this|Keep this|Save/ });
    if (use) await userEvent.click(use);
    await waitFor(() => expect(within(rowFor(DRAWING)).queryByAltText("Swatch for QQ-01.1")).toBeTruthy());

    await userEvent.click(screen.getAllByRole("button", { name: "Same fabric — keep page 1’s wording" })[0]!);
    await waitFor(() => expect(server.patches).toHaveLength(2));

    // Page 1's row now carries QQ-01.1, so it is offered a crop — and shows the
    // one carried to it rather than reading empty.
    await waitFor(() => expect(within(rowFor(SHEET)).queryByAltText("Swatch for QQ-01.1")).toBeTruthy());

    const confirm = screen.getAllByRole("button", { name: /^Confirm/ })[0]!;
    await userEvent.click(confirm);
    await waitFor(() => expect(server.confirms.length).toBeGreaterThan(0));
    const sent = server.confirms[0] as { itemId: string; swatches?: { observationId: string }[] };
    expect(sent.itemId).toBe("item-p1");
    expect(sent.swatches?.map((swatch) => swatch.observationId)).toEqual([sheetId()]);
    expect(uploads.some((path) => path.includes(`finish-swatches/${sheetId()}-`))).toBe(true);
  });
});
