// One press of a drawings card's Confirm sends one confirm (2026-11-20).
//
// Pressing "Confirm 1 spec" a second time while the first request was away
// sent a second confirm: the press waited for the save chain with the button
// still live, and `busy` is state, so the second click got through. The first
// confirm moved the item's version, so the second came back 409 and the screen
// said "This item's targets changed while you were reviewing it" — about the
// reviewer's own confirm. Now the press holds the card from the first click
// until its answer is handled, and a 409 the server calls `already_confirmed`
// is said as a notice, "Already confirmed.", never as the red "targets
// changed".
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

type Answer = { ok: boolean; status: number; error?: string; data: unknown };

const server = vi.hoisted(() => ({
  calls: [] as { url: string; method: string }[],
  item: null as unknown,
  /** How the next confirm answers: held open until released, or at once. */
  confirm: "held" as "held" | Answer,
  held: null as null | { release: (answer: Answer) => void },
  /** An edit's save, held open until released. */
  patch: null as null | { release: (answer: Answer) => void },
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    server.calls.push({ url, method });
    if (url.endsWith("/confirm")) {
      if (server.confirm === "held") {
        return new Promise<Answer>((resolve) => {
          server.held = { release: resolve };
        });
      }
      return server.confirm;
    }
    if (method === "PATCH") {
      return new Promise<Answer>((resolve) => {
        server.patch = { release: resolve };
      });
    }
    if (url.includes("/batches/") && url.endsWith("/drawings")) {
      return {
        ok: true,
        status: 200,
        data: {
          batch: { id: "batch-1", label: null },
          runs: [
            {
              importId: "import-1",
              filename: "ZZ-701.pdf",
              status: "parsed",
              waitingForSlot: false,
              error: null,
              version: 3,
              staged: { schemaVersion: 1, kind: "shop_drawings", filename: "ZZ-701.pdf", documentNotes: null, items: [server.item] },
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
          filename: "ZZ-701.pdf",
          claim_live: null,
          within_deadline: null,
          claim_count: 1,
          parsed: { schemaVersion: 1, kind: "shop_drawings", filename: "ZZ-701.pdf", documentNotes: null, items: [server.item] },
        },
        resolution: [resolution({ id: "item-1" })],
        specFields,
        records,
      },
    };
  },
}));

function fabricItem(version = 1, value = "Invented Velvet"): DrawingItem {
  resetIds();
  return item({
    id: "item-1",
    itemCodeRaw: "ZZ-701",
    observations: [callout("FABRIC", value, "ZZ-FAB-01", { id: "obs-fabric", version, specFieldId: "field-com1" })],
  });
}

const confirms = () => server.calls.filter((call) => call.url.endsWith("/confirm"));

beforeEach(() => {
  server.calls = [];
  server.held = null;
  server.patch = null;
  server.confirm = "held";
  server.item = fabricItem();
});

describe.each([
  ["the drawings review", () => render(<DrawingsReview importId="import-1" />)],
  ["the pack's drawings review", () => render(<PackDrawingsReview projectId="project-9" batchId="batch-1" />)],
])("%s", (_name, mount) => {
  it("sends one confirm for two presses made while an edit is still saving", async () => {
    // The window the second press got through: the click blurs the box, the
    // press waits for that save, and the button stayed live while it waited.
    server.confirm = { ok: true, status: 200, data: {} };
    mount();
    const box = await screen.findByDisplayValue("Invented Velvet");
    await userEvent.clear(box);
    await userEvent.type(box, "Invented Linen");
    await userEvent.click(screen.getByRole("button", { name: "Confirm 1 spec" }));
    await waitFor(() => expect(server.patch).not.toBeNull());

    // The card is held from the first click: it says so and cannot be pressed.
    const pressed = screen.getByRole("button", { name: "Confirming…" });
    expect(pressed).toBeDisabled();
    await userEvent.click(pressed);

    server.item = fabricItem(2, "Invented Linen");
    await act(async () => {
      server.patch!.release({ ok: true, status: 200, data: { version: 4, versions: { items: {}, observations: { "obs-fabric": 2 } } } });
    });
    await waitFor(() => expect(confirms().length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirming…" })).not.toBeInTheDocument());
    expect(confirms()).toHaveLength(1);
  });

  it("holds the button until the confirm's answer is handled", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm 1 spec" }));
    await waitFor(() => expect(server.held).not.toBeNull());
    expect(screen.getByRole("button", { name: "Confirming…" })).toBeDisabled();
    await act(async () => {
      server.held!.release({ ok: true, status: 200, data: {} });
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirming…" })).not.toBeInTheDocument());
    expect(confirms()).toHaveLength(1);
  });

  it("says Already confirmed, as a notice, when the server finds the card's specs already applied", async () => {
    server.confirm = {
      ok: false,
      status: 409,
      error: "Already confirmed.",
      data: { ok: false, conflict: true, code: "already_confirmed", error: "Already confirmed." },
    };
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm 1 spec" }));
    expect(await screen.findByText("Already confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/targets changed/)).not.toBeInTheDocument();
  });

  it("still says the server's sentence, in red, for a real refusal", async () => {
    server.confirm = {
      ok: false,
      status: 409,
      error: "This item's targets changed while you were reviewing it. Reload before confirming.",
      data: { ok: false, conflict: true, code: "item_version_stale" },
    };
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm 1 spec" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/targets changed/);
  });
});
