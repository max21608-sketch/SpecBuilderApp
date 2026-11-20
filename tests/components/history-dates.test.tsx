// History prints an instant as the rest of the app does (2026-11-20).
//
// Both History screens formatted with the BROWSER's locale, so on a US-English
// browser — and in this test environment — History read "Sep 14, 10:40 AM"
// beside an inbox reading "18 Nov, 10:42" and a Documents tab reading
// "20/11/2026, 12:15". They are en-GB now, as those screens are. What is
// formatted here is `change_sets.created_at`, an instant; the key dates on the
// same screen are calendar days and go through `formatDay`, untouched.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectHistory from "@/components/history/ProjectHistory";
import RecordHistory from "@/components/history/RecordHistory";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

/** "14 Sept, 10:40": day, short month, a 24-hour time — whatever the zone. */
const EN_GB_INSTANT = /\d{1,2} [A-Z][a-z]{2,4},? \d{2}:\d{2}/;
const US_ORDER = /[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M/;

const change = (id: string, createdAt: string, kindLabel: string) => ({
  id,
  kind: "manual_edit",
  kindLabel,
  reason: null,
  label: null,
  actor: "qa",
  createdAt,
  closedAt: null,
  source: null,
  evidence: null,
});

beforeEach(() => {
  apiFetch.mockReset();
});

describe("History's dates", () => {
  it("the project's trail prints each change in en-GB, never in US order", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      data: {
        changes: [
          { ...change("cs-2", "2026-11-20T12:34:00.000Z", "Edited by hand"), recordsChanged: 1, records: [] },
          { ...change("cs-1", "2026-09-14T09:40:00.000Z", "Bill of quantities imported"), recordsChanged: 1, records: [] },
        ],
      },
    });
    const { container } = render(<ProjectHistory projectId="p1" />);
    await screen.findAllByText(/Edited by hand/);
    const text = container.textContent ?? "";
    expect(text).toMatch(EN_GB_INSTANT);
    expect(text).not.toMatch(US_ORDER);
    expect(text).not.toMatch(/\d [AP]M/);
  });

  it("the record's versions print each version in en-GB, never in US order", async () => {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("from=")
          ? { ok: false, status: 404, error: "no comparison here", data: null }
          : {
              ok: true,
              data: {
                record: { id: "r1", label: "T90001-001", itemDescription: "Invented sofa" },
                versions: [
                  { ...change("cs-2", "2026-11-20T12:34:00.000Z", "Edited by hand"), snapshotNo: 2, diff: null, unreadable: null },
                  { ...change("cs-1", "2026-09-14T09:40:00.000Z", "Bill of quantities imported"), snapshotNo: 1, diff: null, unreadable: null },
                ],
                baselines: [],
              },
            },
      ),
    );
    const { container } = render(<RecordHistory recordId="r1" projectId="p1" />);
    await screen.findAllByText(/Bill of quantities imported/);
    const text = container.textContent ?? "";
    expect(text).toMatch(EN_GB_INSTANT);
    expect(text).not.toMatch(US_ORDER);
    expect(text).not.toMatch(/\d [AP]M/);
  });
});
