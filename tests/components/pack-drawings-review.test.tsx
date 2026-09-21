// The pack's drawings step, rendered — what *Read all* says it did.
//
// Item 2.10.f capped how many charged reads of one pack run at once, and left
// this half open: *Read all* is one press over every unread document, so on an
// eleven-document pack it started eleven concurrent model calls, and the
// documents it is usually pressed for are the eleven a rate-limit storm has
// just failed. The route now defers what it cannot start, and eight rows that
// read "started" would be the screen promising eight calls that are not
// happening.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PackDrawingsReview from "@/components/imports/PackDrawingsReview";

/** Every extract request this screen made, and what the route answered. */
const extracts = vi.hoisted(() => ({ calls: [] as string[], waitingFrom: 0 }));
const payload = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    // The project read behind the next-step button. Failing it is the state
    // this screen has to survive, and it keeps the test to one subject.
    if (url.startsWith("/api/projects/") && url.includes("/drawings")) {
      return { ok: true, status: 200, data: payload.current };
    }
    if (url.startsWith("/api/projects/")) return { ok: false, status: 500, error: "no", data: null };
    if (url.endsWith("/extract")) {
      extracts.calls.push(url);
      // The cap: the first few presses start a read and the rest are deferred,
      // which the route answers 202 / ok: true / waiting rather than as an
      // error, because the document WILL be read.
      const waiting = extracts.calls.length > extracts.waitingFrom;
      return { ok: true, status: waiting ? 202 : 200, data: waiting ? { waiting: true } : { status: "queued" } };
    }
    return { ok: true, status: 200, data: { import: { version: 1 } } };
  },
}));

type RunSeed = { status: string; waitingForSlot?: boolean };

function show(seeds: RunSeed[], waitingFrom: number) {
  extracts.calls = [];
  extracts.waitingFrom = waitingFrom;
  payload.current = {
    batch: { id: "batch-1", label: null },
    runs: seeds.map((seed, index) => ({
      importId: `import-${index}`,
      filename: `S-${100 + index}.pdf`,
      status: seed.status,
      waitingForSlot: seed.waitingForSlot ?? false,
      error: null,
      version: 1,
      staged: null,
      items: [],
    })),
    records: [],
    specFields: [],
    duplicates: [],
    repeated: [],
  };
  return render(<PackDrawingsReview projectId="project-9" batchId="batch-1" />);
}

describe("the drawings step and the read cap", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("says a document the cap deferred is waiting for a slot, not unread", async () => {
    show([{ status: "pending", waitingForSlot: true }, { status: "pending" }], 0);
    // Two different sentences, and only one of them is a button somebody has
    // to press.
    expect(await screen.findByText("Waiting for a slot")).toBeTruthy();
    expect(screen.getByText("Not read yet")).toBeTruthy();
  });

  it("offers Read all for the documents nobody has promised, and not for the deferred ones", async () => {
    show([{ status: "pending", waitingForSlot: true }, { status: "pending" }, { status: "failed" }], 0);
    // Two of the three: the deferred one is already queued behind the reads in
    // flight, and "each is charged" over it would be a charge nobody pays.
    expect(await screen.findByRole("button", { name: /Read all 2 — each is charged/ })).toBeTruthy();
  });

  it("reports the split in words rather than eleven starts", async () => {
    show(Array.from({ length: 11 }, () => ({ status: "pending" as const })), 3);
    const button = await screen.findByRole("button", { name: /Read all 11/ });
    await userEvent.click(button);

    expect(extracts.calls).toHaveLength(11);
    expect(await screen.findByText(/3 reading · 8 waiting for a slot/)).toBeTruthy();
    // And it says nobody is wanted, so the eight are not read as a failure.
    expect(screen.getByText(/Nothing more to press/)).toBeTruthy();
  });

  it("says only what it started when nothing was deferred", async () => {
    show([{ status: "pending" }, { status: "pending" }], 99);
    await userEvent.click(await screen.findByRole("button", { name: /Read all 2/ }));
    expect(await screen.findByText("2 reading")).toBeTruthy();
    expect(screen.queryByText(/waiting for a slot/)).toBeNull();
  });
});
