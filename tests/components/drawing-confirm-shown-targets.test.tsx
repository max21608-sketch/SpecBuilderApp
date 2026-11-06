// The drawings review screen sends what its card SHOWED (audit D3, 2026-11-06),
// and a move to a note leaves the replace tick to the server (audit D2).
//
// D3. The confirm used to send the item and its rows only, so the server took
// the LIVE suggestion for an untouched card and wrote to a record that had
// appeared after the page loaded. The request now carries `shownTargets`, the
// records the card listed, exactly as the review GET gave them.
//
// D2. Dropping a "Use this drawing's" tick when a row moves is the autosave's
// rule (`onRowRetargeted`), so the screen sends the move and nothing else: a
// screen that sent `replaces: []` with some moves and not others is how the
// tick came to survive a "Keep as a note".
//
// The component tier runs without a database and is scoped by PATH in
// vitest.config.ts. Invented codes throughout.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrawingsReview from "@/components/imports/DrawingsReview";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, figure, item, observation, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const calls = vi.hoisted(() => ({ list: [] as { url: string; init?: RequestInit }[], payload: null as unknown }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    calls.list.push({ url, init });
    if (url.startsWith("/api/projects/")) return { ok: false, status: 500, error: "no", data: null };
    if (url.endsWith("/confirm")) return { ok: true, data: {} };
    return { ok: true, data: calls.payload };
  },
}));

describe("the confirm request names the records the card showed", () => {
  beforeEach(() => {
    resetIds();
    calls.list = [];
  });

  it("an untouched card sends its displayed targets as shownTargets", async () => {
    const staged = item({
      id: "item-1",
      itemCodeRaw: "ZZ-201",
      observations: [observation({ attrGroup: "note", labelRaw: "REMARKS", value: "Kiln dried", valueRaw: "Kiln dried" })],
    });
    calls.payload = {
      import: {
        id: "import-1",
        project_id: "project-9",
        status: "parsed",
        version: 3,
        error: null,
        document_kind: "shop_drawings",
        filename: "ZZ-201.pdf",
        claim_live: null,
        within_deadline: null,
        claim_count: 1,
        parsed: { schemaVersion: 1, kind: "shop_drawings", filename: "ZZ-201.pdf", documentNotes: null, items: [staged] },
      },
      resolution: [resolution({ id: "item-1" })],
      specFields,
      records,
    };
    render(<DrawingsReview importId="import-1" />);
    const confirm = await screen.findByRole("button", { name: /^Confirm/ });
    await userEvent.click(confirm);
    const sent = calls.list.find((call) => call.url === "/api/imports/import-1/confirm");
    expect(sent, "the confirm was not sent").toBeTruthy();
    const body = JSON.parse(String(sent!.init!.body)) as Record<string, unknown>;
    expect(body.action).toBe("confirm");
    expect(body.shownTargets).toEqual(["rec-main", "rec-ve"]);
  });
});

describe("a move leaves the replace tick to the server", () => {
  beforeEach(() => resetIds());

  it("making a ticked width a note sends the move and nothing else", async () => {
    const width = figure("Width", "900", {
      attrGroup: "dimension",
      dimensionSlot: "W",
      unit: "mm",
      isOverall: true,
      page: 1,
      replaces: [{ recordId: "00000000-0000-4000-8000-000000000001", attributeId: "00000000-0000-4000-8000-0000000000b1", attributeVersion: 1 }],
    });
    const staged: DrawingItem = item({ observations: [width], pages: [1] });
    const spies = { ...callbacks(), onSaveItem: vi.fn(async () => undefined) };
    render(
      <ItemCard
        item={staged}
        importId="import-1"
        resolution={resolution()}
        specFields={specFields}
        records={records}
        drafts={{}}
        setDrafts={() => undefined}
        busy={false}
        onSaveObservation={spies.onSaveObservation}
        onSaveTargets={spies.onSaveTargets}
        onSetBulkUnit={spies.onSetBulkUnit}
        onReview={spies.onReview}
        onImage={spies.onImage}
        onSwatch={spies.onSwatch}
        onSetLevel={spies.onSetLevel}
        onSaveItem={spies.onSaveItem}
      />,
    );
    const row = [...document.querySelectorAll<HTMLElement>("[data-figure-row]")].find((candidate) =>
      [...candidate.querySelectorAll("span.font-mono")].some((span) => span.textContent === "900"),
    )!;
    await userEvent.click(within(row).getByRole("button", { name: "900 is a note, not a slot" }));
    const saves = spies.of("onSaveObservation");
    expect(saves).toHaveLength(1);
    const [, , changes] = saves[0]!.args as [DrawingItem, DrawingObservation, Record<string, unknown>];
    expect(changes).toEqual({ attrGroup: "note", dimensionSlot: null });
    expect("replaces" in changes).toBe(false);
  });
});
