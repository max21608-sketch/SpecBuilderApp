// The drawings review screen, rendered — the state a reviewer reaches LAST.
//
// A finished document showed nothing at all: every card disappears as it is
// reviewed, so the end of the job and a screen whose cards had failed to load
// looked identical, and the bottom of the page was a dead end with no way back
// to the project. Both were reported after the first real run-through.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DrawingsReview from "@/components/imports/DrawingsReview";
import { item, observation, resetIds } from "./fixtures";
import type { DrawingItem } from "@/lib/drawing-document";

const fetched = vi.hoisted(() => ({ current: null as unknown }));
/**
 * What the PROJECT endpoint answers, which is where the next step comes from.
 *
 * This screen learns its project only once the document has loaded, so it reads
 * `GET /api/projects/[id]` — the same endpoint the overview reads — to work out
 * what the reviewer should do next. Undefined here means the read fails, which
 * is the case the component has to survive without losing its way back.
 */
const project = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    if (url.startsWith("/api/projects/")) {
      if (project.current === undefined) return { ok: false, status: 500, error: "no", data: null };
      return { ok: true, data: project.current };
    }
    return { ok: true, data: fetched.current };
  },
}));

function show(items: DrawingItem[], projectPayload?: unknown) {
  project.current = projectPayload;
  fetched.current = {
    import: {
      id: "import-1",
      project_id: "project-9",
      status: "confirmed",
      version: 3,
      error: null,
      document_kind: "shop_drawings",
      filename: "S-100.pdf",
      claim_live: null,
      within_deadline: null,
      claim_count: 1,
      parsed: { schemaVersion: 1, kind: "shop_drawings", filename: "S-100.pdf", documentNotes: null, items },
    },
    resolution: [],
    specFields: [],
    records: [],
  };
  return render(<DrawingsReview importId="import-1" />);
}

describe("a reviewed drawing set", () => {
  beforeEach(() => resetIds());

  it("says so, and counts what it did", async () => {
    show([
      item({
        observations: [
          observation({ reviewStatus: "applied" }),
          observation({ reviewStatus: "applied" }),
          observation({ reviewStatus: "ignored" }),
        ],
      }),
    ]);
    expect(await screen.findByText("Review complete")).toBeTruthy();
    expect(screen.getByText(/2 specs applied/)).toBeTruthy();
    expect(screen.getByText(/1 ignored/)).toBeTruthy();
  });

  it("offers the way back to the project", async () => {
    show([item({ observations: [observation({ reviewStatus: "applied" })] })]);
    const link = await screen.findByRole("link", { name: "Open the project page" });
    expect(link.getAttribute("href")).toBe("/dashboard/projects/project-9");
  });

  // ITEM 1.11. "How do you get to this page? At what point in the workflow do
  // you come to this?" was asked ON THIS SCREEN. The end of a review is where a
  // reviewer is most certainly looking for what to do next, so the box and the
  // foot of the page both carry the project's own next step — and the way back
  // to the project is demoted beside it, because "where I came from" and "what
  // to do next" are different questions.
  it("carries the project's next step, and demotes the way back", async () => {
    show([item({ observations: [observation({ reviewStatus: "applied" })] })], {
      ok: true,
      summary: { records: 14, uncategorised: 0, toQuote: 5, documentsReading: 0, documentsFailed: 0 },
      documents: [{ id: "import-1", status: "confirmed", source_kind: "spec_document", document_kind: "shop_drawings", batch_id: "batch-1" }],
      runs: [{ id: "run-1" }],
    });
    const next = await screen.findAllByRole("link", {
      name: "Review 14 items — 5 to-quote specs outstanding",
    });
    // Once in the Review complete box, once at the foot of the page.
    expect(next).toHaveLength(2);
    expect(next[0]!.getAttribute("href")).toBe("/dashboard/projects/project-9?tab=run-1&focus=tgq");
    expect(screen.getByRole("link", { name: "Open the project page" }).className).not.toContain("bg-neutral-900");
  });

  // A STEP NOBODY COULD COMPUTE COSTS AN EMPHASIS, NEVER A ROUTE. The project
  // read can fail; the way out of this screen cannot depend on it.
  it("keeps the way back when the project cannot be read", async () => {
    show([item({ observations: [observation({ reviewStatus: "applied" })] })]);
    const back = await screen.findByRole("link", { name: "Open the project page" });
    expect(back.className).toContain("bg-neutral-900");
  });

  it("stays quiet while anything is still pending", async () => {
    show([item({ observations: [observation({ reviewStatus: "pending" })] })]);
    // The link is the way out either way; the green box is the claim, and it
    // must not be made over a document somebody is halfway through.
    await screen.findByRole("link", { name: "Open the project page" });
    expect(screen.queryByText("Review complete")).toBeNull();
  });

  // ONE PRIMARY PER SCREEN, AND IT IS THE NEXT STEP (§0.3). The deployed screen
  // carried the card's `Confirm S-100 (2 configurations)` AND `Review 9
  // documents` at the foot — and this document was one of the nine, so the two
  // dark buttons proposed different next moves in the same weight. While cards
  // are pending the card's Confirm is the primary and the step is not shown at
  // all; the way back stays, demoted, because it always has to.
  it("shows no next step while cards are still pending", async () => {
    show([item({ observations: [observation({ reviewStatus: "pending" })] })], {
      ok: true,
      summary: { records: 14, uncategorised: 0, toQuote: 5, documentsReading: 0, documentsFailed: 0 },
      documents: [{ id: "import-1", status: "confirmed", source_kind: "spec_document", document_kind: "shop_drawings", batch_id: "batch-1" }],
      runs: [{ id: "run-1" }],
    });
    const back = await screen.findByRole("link", { name: "Open the project page" });
    expect(screen.queryByRole("link", { name: "Review 14 items — 5 to-quote specs outstanding" })).toBeNull();
    // Not the primary either: the primary is on the card.
    expect(back.className).not.toContain("bg-neutral-900");
  });
});

// The navigator, added when the screen was rebuilt to the approved mock-up.
//
// A six-card screen is six screens of scrolling and the thing a reviewer loses
// is which item they are on. It is a SCROLL, never a filter: every card stays
// on the page, because hiding the others would make "confirm this one" mean
// something different depending on where somebody had walked to.
describe("the item navigator", () => {
  beforeEach(() => resetIds());

  it("says where you are, and only appears once there is more than one card", async () => {
    show([
      item({ id: "item-a", itemCodeRaw: "S-100", observations: [observation({ reviewStatus: "pending" })] }),
      item({ id: "item-b", itemCodeRaw: "S-201", observations: [observation({ reviewStatus: "pending" })] }),
    ]);
    expect(await screen.findByText(/Item 1 of 2/)).toBeTruthy();
    expect(screen.getAllByText("S-100").length).toBeGreaterThan(0);
  });

  it("is absent on a document with one item, because there is nowhere to go", async () => {
    show([item({ id: "item-a", itemCodeRaw: "S-100", observations: [observation({ reviewStatus: "pending" })] })]);
    await screen.findByRole("link", { name: "Open the project page" });
    expect(screen.queryByText(/Item 1 of/)).toBeNull();
  });

  it("moves to the next card and never hides the one it left", async () => {
    show([
      item({ id: "item-a", itemCodeRaw: "S-100", observations: [observation({ reviewStatus: "pending" })] }),
      item({ id: "item-b", itemCodeRaw: "S-201", observations: [observation({ reviewStatus: "pending" })] }),
    ]);
    await screen.findByText(/Item 1 of 2/);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText(/Item 2 of 2/)).toBeTruthy();
    // Both cards are still on the page: the navigator scrolls, it does not filter.
    expect(screen.getAllByText("S-100").length).toBeGreaterThan(0);
    expect(screen.getAllByText("S-201").length).toBeGreaterThan(0);
  });
});
