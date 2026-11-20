// The record header's counts line (2026-11-20).
//
// It read "10 to answer at TGQ · 2 to chase · the button says 3 (differs — see
// the rows) · 2 you record on this item's details · 4 counted as separate slots
// · 2 project-wide, answered once on the project" beside "Chase the 3" and a
// Quote readiness card saying 8 TGQ and 2 project-wide: a sentence apologising
// for its own button. The visible line is now the card's two figures, and the
// same clauses, computed the same way, are behind "Why". The fixture is the
// screenshot's record (invented names): four dimension slots, two record
// columns, two project-wide rows, and a button counting three questions.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordHeader from "@/components/records/RecordHeader";
import { chaseCountParts } from "@/lib/chase-counts";
import type { SpecRecord } from "@/components/records/record-payload";

const record = {
  id: "rec-1",
  project_id: "proj-1",
  bws_project_number: "T90111",
  run_id: "run-1",
  run_name: "Guest Rooms",
  item_description: "Invented lounge chair",
  area: "Guest Room Type A",
  qty: 48,
  qty_raw: null,
  parent_id: null,
  variant_label: null,
  source_line_no: 11,
  category_name: "Armchairs",
  level: "simple",
  level_suggested: null,
  level_suggested_reason: null,
  designer: null,
} as unknown as SpecRecord;

const screenshotWhy = chaseCountParts({
  buckets: { toAnswer: 10, chase: 2, details: 2, readiness: 0, slots: 4, project: 2, nowhere: 0 },
  toChase: 3,
});

function header(chaseWhy: string[] | null) {
  return render(
    <RecordHeader
      record={record}
      data={{ mockup: null, designerContact: null, twins: [] } as never}
      parentRefs="HH-CH-02"
      recordLabel="T90111-002"
      runHref="/dashboard/projects/proj-1?tab=run-1"
      level="simple"
      savingLevel={false}
      setLevel={async () => {}}
      readiness={{ toQuote: 8, toChase: 3, projectWide: 2 }}
      chaseHref="/dashboard/drafts?projectId=proj-1"
      chaseWhy={chaseWhy}
      onAddSpec={() => {}}
      tabs={null}
    />,
  );
}

describe("the record header's counts", () => {
  it("shows the card's figures beside the button, and no sentence about the button", () => {
    const { container } = header(screenshotWhy);
    expect(screen.getByRole("link", { name: "Chase the 3" })).toBeInTheDocument();
    const text = container.textContent ?? "";
    // The card says 8 TGQ and 2 project-wide; so does the header.
    expect(text).toMatch(/8 TGQ · 2 project-wide · Why/);
    // The reconciliation is not on the page until somebody asks.
    expect(text).not.toContain("the button says");
    expect(text).not.toContain("to answer at TGQ");
    expect(screen.queryByRole("list", { name: "Why these counts differ" })).not.toBeInTheDocument();
  });

  it("lists the same clauses as before behind Why, and folds them away again", async () => {
    header(screenshotWhy);
    await userEvent.click(screen.getByRole("button", { name: "Why" }));
    const list = screen.getByRole("list", { name: "Why these counts differ" });
    const items = within(list).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "10 to answer at TGQ",
      "2 to chase",
      "the button says 3 (differs — see the rows)",
      "2 you record on this item's details",
      "4 counted as separate slots",
      "2 project-wide, answered once on the project",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Hide why" }));
    expect(screen.queryByRole("list", { name: "Why these counts differ" })).not.toBeInTheDocument();
  });

  it("carries no counts line at all where the numbers need no explaining", () => {
    const { container } = header(null);
    expect(screen.getByRole("link", { name: "Chase the 3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Why" })).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/\d+ TGQ/);
  });
});
