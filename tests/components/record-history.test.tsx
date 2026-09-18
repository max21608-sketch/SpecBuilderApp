// The versions tab: two versions selected, and the diff is the page.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordHistory from "@/components/history/RecordHistory";
import type { SnapshotDiff } from "@/lib/snapshot-diff";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

const EMPTY_DIFF: SnapshotDiff = {
  core: [],
  refs: [],
  attributes: [],
  answers: [],
  cells: [],
  isEmpty: true,
};

const version = (snapshotNo: number, kindLabel: string, over: Record<string, unknown> = {}) => ({
  id: `cs-${snapshotNo}`,
  kind: "manual_edit",
  kindLabel,
  reason: null,
  label: null,
  actor: "max.degroot",
  createdAt: `2026-09-1${snapshotNo}T09:40:00.000Z`,
  closedAt: null,
  source: null,
  evidence: null,
  snapshotNo,
  diff: snapshotNo === 1 ? null : EMPTY_DIFF,
  unreadable: null,
  ...over,
});

const HISTORY = {
  record: { id: "r1", label: "AP364c-021", itemDescription: "Sofa" },
  versions: [
    version(4, "Edited by hand", { reason: "Rev B drawing issued 14 Sept" }),
    version(3, "Drawings confirmed"),
    version(2, "Category set"),
    version(1, "Bill of quantities imported"),
  ],
  // Named after v2 was taken, and placed by that member row — never by its
  // own date, which is the error `baseline_members` exists to prevent.
  baselines: [{ changeSetId: "b1", label: "Rev A — what we quoted", createdAt: "2026-09-14", memberSnapshotNo: 2 }],
};

const COMPARISON = {
  from: 3,
  to: 4,
  diff: {
    ...EMPTY_DIFF,
    isEmpty: false,
    core: [{ field: "qty", label: "Quantity", was: "14", now: "16" }],
    attributes: [
      {
        key: "a1",
        label: "Depth",
        change: "changed" as const,
        fields: [{ field: "value", label: "value", was: "760 mm", now: "790 mm" }],
      },
    ],
  },
  cells: [{ name: "Dimensions", jsonId: 3, value: "W1900 x D790mm" }],
  unchanged: [{ key: "u1", label: "COM 1", value: "Yarn Tessarae" }],
};

function route(url: string) {
  if (url.includes("from=")) {
    const from = Number(new URL(url, "http://x").searchParams.get("from"));
    const to = Number(new URL(url, "http://x").searchParams.get("to"));
    return Promise.resolve({ ok: true, data: { ...COMPARISON, from, to } });
  }
  return Promise.resolve({ ok: true, data: HISTORY });
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url: string) => route(url));
});

describe("the record's versions", () => {
  it("opens on the newest pair, because 'what just changed' is the common case", async () => {
    render(<RecordHistory recordId="r1" projectId="p1" />);
    expect(await screen.findByText("What changed between v3 and v4")).toBeInTheDocument();
    expect(screen.getByText(/Comparing/)).toHaveTextContent("Comparing v3 → v4");
  });

  it("counts what did not move, and keeps it one click away", async () => {
    // A diff that hides the unchanged fields entirely cannot prove nothing
    // else moved.
    render(<RecordHistory recordId="r1" projectId="p1" />);
    const toggle = await screen.findByRole("button", { name: /unchanged — show them/ });
    expect(screen.queryByText("COM 1")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText("COM 1")).toBeInTheDocument();
  });

  it("shows the STORED cells apart from the diff, because they answer a different question", async () => {
    // The diff recomposes both ends with today's rules; these are what the
    // file said on the day.
    render(<RecordHistory recordId="r1" projectId="p1" />);
    expect(await screen.findByText("v4 as BWS would receive it")).toBeInTheDocument();
    expect(screen.getByText("W1900 x D790mm")).toBeInTheDocument();
  });

  it("re-compares from two clicked rows", async () => {
    render(<RecordHistory recordId="r1" projectId="p1" />);
    await screen.findByText("What changed between v3 and v4");
    await userEvent.click(screen.getByRole("button", { name: /v1/ }));
    await userEvent.click(screen.getByRole("button", { name: /v3/ }));
    await waitFor(() => expect(screen.getByText("What changed between v1 and v3")).toBeInTheDocument());
  });

  it("draws a baseline as a bar placed by the version it froze", async () => {
    render(<RecordHistory recordId="r1" projectId="p1" />);
    const bar = (await screen.findByText("Rev A — what we quoted")).closest("div")!;
    expect(within(bar).getByText("Baseline")).toBeInTheDocument();
    // Directly above v2 — the member row — so the versions below it are the
    // ones inside the point.
    const row = bar.parentElement!;
    expect(within(row).getByRole("button").textContent).toContain("v2");
  });

  it("says so rather than rendering an empty diff where there is one version", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.includes("from=")
        ? route(url)
        : Promise.resolve({ ok: true, data: { ...HISTORY, versions: [version(1, "Bill of quantities imported")] } }),
    );
    render(<RecordHistory recordId="r1" projectId="p1" />);
    expect(await screen.findByText(/first version of the item/)).toBeInTheDocument();
  });

  it("reports a failed comparison instead of leaving the last answer under the new heading", async () => {
    apiFetch.mockImplementation((url: string) =>
      url.includes("from=")
        ? Promise.resolve({ ok: false, error: "No such version of this record." })
        : route(url),
    );
    render(<RecordHistory recordId="r1" projectId="p1" />);
    expect(await screen.findByText("No such version of this record.")).toBeInTheDocument();
  });
});
