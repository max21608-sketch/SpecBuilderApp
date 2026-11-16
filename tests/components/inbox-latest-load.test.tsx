// The inbox paints the mail of the project it is SHOWING, whichever answer
// arrives last (review 4A, G16, 2026-11-16).
//
// Changing the project starts a new load while the old one may still be in
// flight. The audit found the old one could answer second and paint project
// A's mail under project B. Here the two answers are released in the wrong
// order on purpose, and the newer selection's mail must be what stays.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import InboxPage from "@/app/dashboard/inbox/page";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/dashboard/inbox",
  useRouter: () => ({ replace: vi.fn() }),
}));

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function message(projectId: string, subject: string) {
  return {
    id: `msg-${projectId}`,
    origin: "upload",
    mailbox: "inbox@example.com",
    fetch_status: "fetched",
    fetch_error: null,
    from_addr: "designer@example.com",
    from_name: null,
    subject,
    received_at: "2026-09-16T10:00:00.000Z",
    has_attachments: false,
    attachments_meta: null,
    routing_status: "assigned",
    routing_reason: "addressed to the project inbox",
    routing_candidates: null,
    project_id: projectId,
    bws_project_number: projectId === P1 ? "AP401" : "AP402",
    project_name: projectId === P1 ? "Ashcombe House" : "Brook Street",
    assignment_kind: "auto",
    intake_run_id: "run-1",
    run_status: "parsed",
    run_error: null,
    waiting_for_slot: false,
    pending_count: 2,
    applied_count: 0,
    chase_match: null,
    chaseReply: false,
    found: { proposals: 2, runs: 1, changesConfirmed: 0, nothingToRecord: false },
    triage: "open",
    parse_error: null,
    version: 1,
  };
}

const SUBJECT = { [P1]: "Ashcombe armchair, revised", [P2]: "Brook Street sofa, revised" } as const;

/** Each request waits until the test releases it. */
const pending: { projectId: string; release: () => void }[] = [];

beforeEach(() => {
  search = "";
  pending.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          const projectId = new URL(String(url), "http://localhost").searchParams.get("projectId") ?? "";
          const body = {
            ok: true,
            messages: [message(projectId, SUBJECT[projectId as keyof typeof SUBJECT])],
            heldCount: 0,
            arrivedToday: 0,
            ruledThisWeek: 0,
            failedReads: 0,
            projects: [
              { id: P1, bws_project_number: "AP401", name: "Ashcombe House" },
              { id: P2, bws_project_number: "AP402", name: "Brook Street" },
            ],
          };
          pending.push({
            projectId,
            release: () =>
              resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })),
          });
        }),
    ),
  );
});

describe("two loads answering out of order", () => {
  it("keeps the newer project's mail on screen when the older answer lands last", async () => {
    search = `project=${P1}`;
    const view = render(<InboxPage />);
    await vi.waitFor(() => expect(pending.some((p) => p.projectId === P1)).toBe(true));

    // The person picks the other project before the first answer is back.
    search = `project=${P2}`;
    view.rerender(<InboxPage />);
    await vi.waitFor(() => expect(pending.some((p) => p.projectId === P2)).toBe(true));

    // The newer answer first, then the stale one.
    await act(async () => {
      pending.find((p) => p.projectId === P2)!.release();
    });
    await screen.findByText(SUBJECT[P2]);
    await act(async () => {
      pending.find((p) => p.projectId === P1)!.release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByText(SUBJECT[P2])).toBeTruthy();
    expect(screen.queryByText(SUBJECT[P1])).toBeNull();
  });
});
