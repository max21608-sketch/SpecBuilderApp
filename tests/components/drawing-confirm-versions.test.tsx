// The drawings review sends the versions its saves PRODUCED, not the versions
// its click rendered with (audit G1, 2026-11-06), and a refused value leaves
// the row showing the server's (audit G10).
//
// G1. Type a corrected figure, press Confirm at once: the blur queues the
// save, the click waits for it, and then sent the row's version from BEFORE
// that save. The server refused with "edited in another tab" with nobody else
// in the document. Here the save is held open until after the click, so the
// test reproduces exactly that order.
//
// G10. A refused save left the typed words in the box, so the confirm
// committed the server's value under a row that said something else, and the
// next blur sent the typed words again against the fresh version.
//
// The component tier runs without a database. Invented codes throughout.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PackDrawingsReview from "@/components/imports/PackDrawingsReview";
import { callout, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingItem } from "@/lib/drawing-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

type Answer = { ok: boolean; status?: number; error?: string; data: unknown };

const server = vi.hoisted(() => ({
  calls: [] as { url: string; method: string; body: Record<string, unknown> | null }[],
  /** The staged item the GET returns, replaced as the "server" writes. */
  item: null as unknown,
  /** The next PATCH is held until the test releases it. */
  held: null as null | { release: (answer: Answer) => void },
}));
/** The pack screen reads its runs from the batch route instead of the import's. */
const packMode = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    server.calls.push({ url, method, body });
    if (url.includes("/batches/") && url.endsWith("/drawings")) {
      return {
        ok: true,
        status: 200,
        data: {
          batch: { id: "batch-1", label: null },
          runs: [
            {
              importId: "import-1",
              filename: "ZZ-301.pdf",
              status: "parsed",
              waitingForSlot: false,
              error: null,
              version: 3,
              staged: { schemaVersion: 1, kind: "shop_drawings", filename: "ZZ-301.pdf", documentNotes: null, items: [server.item] },
              items: [resolution({ id: "item-1" })],
            },
          ],
          records,
          specFields,
          duplicates: [],
          repeated: [],
        },
      };
    }
    if (url.startsWith("/api/projects/")) return { ok: false, status: 500, error: "no", data: null };
    if (url.endsWith("/confirm")) return { ok: true, status: 200, data: {} };
    if (method === "PATCH") {
      return new Promise<Answer>((resolve) => {
        server.held = { release: resolve };
      });
    }
    return {
      ok: true,
      status: 200,
      data: {
        import: {
          id: "import-1",
          project_id: "project-9",
          status: "parsed",
          version: 3,
          error: null,
          document_kind: "shop_drawings",
          filename: "ZZ-301.pdf",
          claim_live: null,
          within_deadline: null,
          claim_count: 1,
          parsed: {
            schemaVersion: 1,
            kind: "shop_drawings",
            filename: "ZZ-301.pdf",
            documentNotes: null,
            items: [server.item],
          },
        },
        resolution: [resolution({ id: "item-1" })],
        specFields,
        records,
      },
    };
  },
}));

function fabricItem(version: number, value: string): DrawingItem {
  resetIds();
  return item({
    id: "item-1",
    itemCodeRaw: "ZZ-301",
    observations: [
      callout("FABRIC", value, "ZZ-FAB-01", { id: "obs-fabric", version, specFieldId: "field-com1" }),
    ],
  });
}

describe("a confirm pressed while the save is still away", () => {
  beforeEach(() => {
    server.calls = [];
    server.held = null;
  });

  it("sends the version the save produced, not the one the click rendered", async () => {
    server.item = fabricItem(1, "Invented Velvet");
    render(<DrawingsReview importId="import-1" />);
    const box = await screen.findByDisplayValue("Invented Velvet");
    await userEvent.clear(box);
    await userEvent.type(box, "Invented Linen");

    // The click blurs the box, which queues the save; the save is still away
    // when the click handler runs.
    await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
    await waitFor(() => expect(server.held).not.toBeNull());
    const patch = server.calls.find((call) => call.method === "PATCH")!;
    expect(patch.body!.expectedVersion).toBe(1);

    // The server writes it: the row is now at version 2.
    server.item = fabricItem(2, "Invented Linen");
    await act(async () => {
      server.held!.release({
        ok: true,
        status: 200,
        data: { version: 4, versions: { items: {}, observations: { "obs-fabric": 2 } } },
      });
    });

    await waitFor(() => expect(server.calls.some((call) => call.url.endsWith("/confirm"))).toBe(true));
    const confirm = server.calls.find((call) => call.url.endsWith("/confirm"))!;
    expect(confirm.body!.observations).toEqual([{ id: "obs-fabric", version: 2 }]);
  });

  it("a second save queued behind a slow first sends the first one's version", async () => {
    server.item = fabricItem(1, "Invented Velvet");
    render(<DrawingsReview importId="import-1" />);
    const box = await screen.findByDisplayValue("Invented Velvet");
    await userEvent.clear(box);
    await userEvent.type(box, "Invented Linen");
    await userEvent.tab();
    await waitFor(() => expect(server.held).not.toBeNull());

    // A second edit from the SAME render, queued while the first is away.
    await userEvent.click(box);
    await userEvent.clear(box);
    await userEvent.type(box, "Invented Wool");
    await userEvent.tab();

    const first = server.held!;
    server.held = null;
    server.item = fabricItem(2, "Invented Linen");
    await act(async () => {
      first.release({ ok: true, status: 200, data: { version: 4, versions: { items: {}, observations: { "obs-fabric": 2 } } } });
    });
    await waitFor(() => expect(server.held).not.toBeNull());
    const patches = server.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]!.body!.expectedVersion).toBe(2);
  });
});

describe("a refused value", () => {
  beforeEach(() => {
    server.calls = [];
    server.held = null;
  });

  it("leaves the row showing the server's value and says what was not saved", async () => {
    server.item = fabricItem(1, "Invented Velvet");
    render(<DrawingsReview importId="import-1" />);
    const box = await screen.findByDisplayValue("Invented Velvet");
    await userEvent.clear(box);
    await userEvent.type(box, "Invented Linen");
    await userEvent.tab();
    await waitFor(() => expect(server.held).not.toBeNull());

    // Somebody else got there first: the server holds their words at v2.
    server.item = fabricItem(2, "Invented Bouclé");
    await act(async () => {
      server.held!.release({ ok: false, status: 409, error: "That spec was edited in another tab. Reload.", data: null });
    });

    expect(await screen.findByDisplayValue("Invented Bouclé")).toBeTruthy();
    expect(screen.queryByDisplayValue("Invented Linen")).toBeNull();
    expect(
      screen.getByText("Your 'Invented Linen' was not saved: That spec was edited in another tab. Reload."),
    ).toBeTruthy();

    // And a blur now sends nothing: the box holds what the server holds.
    const before = server.calls.filter((call) => call.method === "PATCH").length;
    await userEvent.click(screen.getByDisplayValue("Invented Bouclé"));
    await userEvent.tab();
    expect(server.calls.filter((call) => call.method === "PATCH")).toHaveLength(before);
  });
});

// ---- the pack screen: the same two defects, its own copy of the code --------

describe("the pack's drawings screen", () => {
  beforeEach(() => {
    server.calls = [];
    server.held = null;
  });

  it("confirms with the version the held save produced", async () => {
    server.item = fabricItem(1, "Invented Velvet");
    packMode.on = true;
    try {
      render(<PackDrawingsReview projectId="project-9" batchId="batch-1" />);
      const box = await screen.findByDisplayValue("Invented Velvet");
      await userEvent.clear(box);
      await userEvent.type(box, "Invented Linen");
      await userEvent.click(screen.getByRole("button", { name: /^Confirm/ }));
      await waitFor(() => expect(server.held).not.toBeNull());

      server.item = fabricItem(2, "Invented Linen");
      await act(async () => {
        server.held!.release({
          ok: true,
          status: 200,
          data: { version: 4, versions: { items: {}, observations: { "obs-fabric": 2 } } },
        });
      });
      await waitFor(() => expect(server.calls.some((call) => call.url.endsWith("/confirm"))).toBe(true));
      const confirm = server.calls.find((call) => call.url.endsWith("/confirm"))!;
      expect(confirm.body!.observations).toEqual([{ id: "obs-fabric", version: 2 }]);
    } finally {
      packMode.on = false;
    }
  });
});
