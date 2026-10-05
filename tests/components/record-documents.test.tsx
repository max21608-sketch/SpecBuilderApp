// The record's Documents tab: one row per document, what it gave the item,
// and an empty state that says only what is true of this record.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import RecordDocuments, { RecordDocumentsTable } from "@/components/records/RecordDocuments";
import type { RecordDocument, RecordDocumentsResult } from "@/lib/record-documents";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

const drawing: RecordDocument = {
  key: "att-1",
  filename: "X-100 drawings.pdf",
  subject: null,
  kind: "shop_drawings",
  kindLabel: "Shop drawings",
  arrivedAt: "2026-10-02T09:00:00.000Z",
  relations: ["2 specs, pages 2–3", "1 retired spec, page 4"],
  pages: [2, 3, 4],
  reviews: [{ runId: "run-1", label: "Shop drawings" }],
  open: { href: "/api/imports/run-1/source#page=2", inline: true },
};

const email: RecordDocument = {
  key: "att-2",
  filename: "reply.eml",
  subject: "Re: invented armchair",
  kind: "email",
  kindLabel: "Email",
  arrivedAt: "2026-10-03T09:00:00.000Z",
  relations: ["1 checklist answer"],
  pages: [],
  reviews: [{ runId: "run-2", label: "Email" }],
  open: { href: "/api/email-messages/m-1/mime", inline: false },
};

const result = (documents: RecordDocument[], origin = { mockup: false, noBill: false }): RecordDocumentsResult => ({
  documents,
  origin,
});

beforeEach(() => {
  apiFetch.mockReset();
});

describe("the documents table", () => {
  it("lists each document with what it gave the item and where to open it", () => {
    render(<RecordDocumentsTable result={result([drawing, email])} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);

    const first = within(rows[0]!);
    expect(first.getByText("X-100 drawings.pdf")).toBeTruthy();
    expect(first.getByText("Shop drawings")).toBeTruthy();
    expect(first.getByText("2 specs, pages 2–3")).toBeTruthy();
    expect(first.getByText("1 retired spec, page 4")).toBeTruthy();
    // A PDF is a link that opens at the page, in a new tab.
    const open = first.getByRole("link", { name: "Open at page 2" });
    expect(open.getAttribute("href")).toBe("/api/imports/run-1/source#page=2");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(first.getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/dashboard/imports/run-1");

    // An email downloads, through the route that never renders it.
    const second = within(rows[1]!);
    expect(second.getByText("Re: invented armchair")).toBeTruthy();
    const download = second.getByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toBe("/api/email-messages/m-1/mime");
    expect(download.hasAttribute("download")).toBe(true);
  });

  it("says a hand-typed item has no document, and why", () => {
    render(<RecordDocumentsTable result={result([], { mockup: false, noBill: true })} />);
    expect(screen.getByText("No document has been confirmed onto this item yet. It was typed in by hand.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not call a mock-up item hand-typed", () => {
    render(<RecordDocumentsTable result={result([], { mockup: true, noBill: true })} />);
    expect(screen.queryByText(/typed in by hand/)).toBeNull();
    expect(screen.getByText(/added to the mock-up phase from another item/)).toBeTruthy();
  });

  it("says staged documents are not listed", () => {
    render(<RecordDocumentsTable result={result([drawing])} />);
    expect(
      screen.getByText("Documents whose specs are still waiting for review are not listed until they are confirmed."),
    ).toBeTruthy();
  });
});

describe("the documents tab", () => {
  it("loads its own list and hands the count up", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { ok: true, ...result([drawing, email]) } });
    const onCount = vi.fn();
    render(<RecordDocuments recordId="rec-1" onCount={onCount} />);
    await waitFor(() => expect(screen.getByText("X-100 drawings.pdf")).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith("/api/records/rec-1/documents");
    expect(onCount).toHaveBeenCalledWith(2);
  });

  it("says so in words when the list cannot be loaded", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, error: "The server returned an error (500).", data: null });
    render(<RecordDocuments recordId="rec-1" />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The server returned an error (500)."));
  });
});
