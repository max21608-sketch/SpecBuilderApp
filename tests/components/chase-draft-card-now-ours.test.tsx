// Component tier. A designer's draft holding a question that is no longer the
// client's — seed 0015 after the draft, "Put it back", or a colleague
// re-roled to designer — is FLAGGED where it is, each line named with its
// Remove beside it, and is NOT refused: it still downloads and can be marked
// sent (chase review A1, 2026-11-21).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard/drafts" }));

import ChaseDraftCard, { type Draft, type DraftItem } from "@/components/drafts/ChaseDraftCard";

const item = (over: Partial<DraftItem>): DraftItem => ({
  recordId: "rec-1",
  requirementId: "req-1",
  recordLabel: "T1-001",
  refs: "S-1",
  prompt: "COM 1",
  fieldLabel: "COM 1",
  currentValueText: "Missing",
  liveState: "missing",
  staleReasons: [],
  tier: "to_quote",
  tierChanged: false,
  nowOurs: false,
  ...over,
});

const draft = (items: DraftItem[], over: Partial<Draft> = {}): Draft => ({
  id: "d-1",
  status: "draft",
  subject: "Questions",
  body: "<p>Hello</p>",
  body_format: "html",
  intro_text: "Hello",
  closing_text: "Thanks",
  recipient_name: "Claire",
  recipient_email: "claire@example.test",
  cc_email: null,
  project_label: "T1",
  contact_name: "Claire",
  contact_email: "claire@example.test",
  generated_at: "2026-11-20T10:00:00Z",
  version: 3,
  manually_edited_at: null,
  manually_edited_by: null,
  sent_at: null,
  sent_by: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  items,
  staleCount: 0,
  nowOursCount: items.filter((row) => row.nowOurs).length,
  ...over,
});

beforeEach(() => {
  cleanup();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: {} });
});

describe("a draft holding questions that are now ours", () => {
  it("says so in place, names each, and removes one with the Remove beside it", async () => {
    const ours = item({ requirementId: "req-2", prompt: "Assembly guide required", nowOurs: true });
    render(<ChaseDraftCard draft={draft([item({}), ours])} onChanged={() => {}} />);
    expect(screen.getByText(/1 question in this draft is now ours to answer — remove it, or generate a new chase/)).toBeTruthy();
    expect(screen.getByText("now ours to answer")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Assembly guide required on T1-001" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/drafts/d-1/edit", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(apiFetch.mock.calls[0]![1].body as string);
    expect(body.questions).toEqual([{ recordId: "rec-1", requirementId: "req-1" }]);
  });

  it("still downloads, and \"Yes, I sent it\" still posts — a flag, never a refusal", async () => {
    render(<ChaseDraftCard draft={draft([item({}), item({ requirementId: "req-2", nowOurs: true })])} onChanged={() => {}} />);
    await userEvent.click(screen.getByText("Open in Outlook (.eml)"));
    await userEvent.click(screen.getByRole("button", { name: /sent this/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, I sent it" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/drafts/d-1/confirm-sent", expect.objectContaining({ method: "POST" }));
  });

  it("says nothing on a draft whose lines are all the client's", () => {
    render(<ChaseDraftCard draft={draft([item({})])} onChanged={() => {}} />);
    expect(screen.queryByText(/now ours to answer/)).toBeNull();
  });
});
