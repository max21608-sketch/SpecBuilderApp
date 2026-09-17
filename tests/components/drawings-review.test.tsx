// The drawings review screen, rendered — the state a reviewer reaches LAST.
//
// A finished document showed nothing at all: every card disappears as it is
// reviewed, so the end of the job and a screen whose cards had failed to load
// looked identical, and the bottom of the page was a dead end with no way back
// to the project. Both were reported after the first real run-through.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DrawingsReview from "@/components/imports/DrawingsReview";
import { item, observation, resetIds } from "./fixtures";
import type { DrawingItem } from "@/lib/drawing-document";

const fetched = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async () => ({ ok: true, data: fetched.current }),
}));

function show(items: DrawingItem[]) {
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

  it("stays quiet while anything is still pending", async () => {
    show([item({ observations: [observation({ reviewStatus: "pending" })] })]);
    // The link is the way out either way; the green box is the claim, and it
    // must not be made over a document somebody is halfway through.
    await screen.findByRole("link", { name: "Open the project page" });
    expect(screen.queryByText("Review complete")).toBeNull();
  });
});
