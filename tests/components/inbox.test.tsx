// The inbox, rendered.
//
// ============================================================================
// THE TWO RULES WORTH A TEST
//
// HELD MAIL IS NEVER HIDDEN BY THE TAB. An email nobody has placed is the one
// state in this feature that silently stops work — the sender believes they
// have told us and no project screen says otherwise — so the amber table is
// under the default view as well as under its own tab.
//
// AND "READ, AND IT SAID NOTHING" IS NOT A BLANK. An email that was read and
// produced no specification is a different outcome from one waiting to be
// reviewed and from one the queue has not reached, and the column says which.
// A blank cell reads as a document nobody has got to yet.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import InboxPage from "@/app/dashboard/inbox/page";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/dashboard/inbox",
  useRouter: () => ({ replace }),
}));

function message(over: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    origin: "upload",
    mailbox: "ashcombe.specs@example.com",
    fetch_status: "fetched",
    fetch_error: null,
    from_addr: "priya.raman@example.com",
    from_name: "Priya Raman",
    subject: "AC-101 lounge armchair, revised specification",
    received_at: "2026-09-16T10:00:00.000Z",
    has_attachments: false,
    attachments_meta: null,
    routing_status: "assigned",
    routing_reason: "addressed to the project inbox — ashcombe.specs@example.com",
    routing_candidates: null,
    project_id: "proj-1",
    bws_project_number: "AP401",
    project_name: "Ashcombe House",
    assignment_kind: "auto",
    intake_run_id: "run-1",
    run_status: "parsed",
    run_error: null,
    waiting_for_slot: false,
    pending_count: 4,
    applied_count: 0,
    chase_match: "confident",
    chaseReply: true,
    found: { proposals: 4, runs: 2, changesConfirmed: 1, nothingToRecord: false },
    triage: "open",
    parse_error: null,
    version: 1,
    ...over,
  };
}

const PAYLOAD = {
  ok: true,
  messages: [
    message(),
    message({
      id: "msg-2",
      subject: "Lindow wool — lead times for the autumn",
      chase_match: null,
      chaseReply: false,
      pending_count: 0,
      found: { proposals: 0, runs: 0, changesConfirmed: 0, nothingToRecord: true },
    }),
    message({
      id: "msg-3",
      subject: "FW: client comments - armchairs",
      routing_status: "unassigned",
      routing_reason: "the sender is a contact on one project — priya.raman@example.com is a contact on this project",
      routing_candidates: [
        { projectId: "proj-1", signal: "sender_is_contact", evidence: "priya.raman@example.com is a contact on this project" },
      ],
      project_id: null,
      bws_project_number: null,
      project_name: null,
      intake_run_id: null,
      run_status: null,
      found: null,
    }),
    // AN AUTO-ASSIGNED READ THAT FAILED. Nobody pressed anything to start it,
    // so nobody is waiting for its result and nothing else on any screen says
    // it happened.
    message({
      id: "msg-5",
      subject: "S-301 desk chair — timber finish",
      chase_match: null,
      chaseReply: false,
      run_status: "failed",
      run_error: "The model could not be reached.",
      pending_count: 0,
      applied_count: 0,
      found: null,
    }),
    message({
      id: "msg-4",
      subject: "UP-101 headboard — fabric confirmed",
      chase_match: null,
      chaseReply: false,
      run_status: "pending",
      waiting_for_slot: true,
      pending_count: 0,
      applied_count: 0,
      found: null,
    }),
  ],
  heldCount: 1,
  arrivedToday: 0,
  ruledThisWeek: 3,
  projects: [{ id: "proj-1", bws_project_number: "AP401", name: "Ashcombe House" }],
};

beforeEach(() => {
  search = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

describe("the inbox", () => {
  it("shows held mail under the default tab, not only under its own", async () => {
    render(<InboxPage />);
    await screen.findByRole("heading", { name: /Could not be placed/ });
    // The default tab is "To review"; the held message is still on screen.
    expect(screen.getByText("FW: client comments - armchairs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign & read" })).toBeInTheDocument();
  });

  it("says a charged call before the button that spends it", async () => {
    render(<InboxPage />);
    expect(await screen.findByText("One charged model call.")).toBeInTheDocument();
  });

  it("says what a read turned up, in the column", async () => {
    render(<InboxPage />);
    await screen.findByText("AC-101 lounge armchair, revised specification");
    expect(screen.getByText("4 specs")).toBeInTheDocument();
    expect(screen.getByText("2 phases")).toBeInTheDocument();
    expect(screen.getByText(/1 changes a confirmed value/)).toBeInTheDocument();
    // An email that produced nothing is NOT in the list of things waiting for a
    // person: it is a different outcome and it has its own tab.
    expect(screen.queryByText("Lindow wool — lead times for the autumn")).not.toBeInTheDocument();
  });

  it("says a read that found nothing is a read, not a blank", async () => {
    search = "tab=nothing";
    render(<InboxPage />);
    await screen.findByText("Lindow wool — lead times for the autumn");
    expect(screen.getByText("nothing to record")).toBeInTheDocument();
    expect(screen.getByText("read, found no specification")).toBeInTheDocument();
    // And it can be ruled on from there.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("prints the signal that placed it, so a wrong placement is visible", async () => {
    render(<InboxPage />);
    await screen.findByText("AC-101 lounge armchair, revised specification");
    expect(screen.getAllByText(/assigned automatically · addressed to the project inbox/).length).toBeGreaterThan(0);
    expect(screen.getByText("reply to a chase")).toBeInTheDocument();
  });
});

// ============================================================================
// AN AUTOMATIC ASSIGNMENT IS ACCOUNTED FOR ON ITS OWN ROW (2.11)
//
// The app now starts a charged read with nobody watching, for mail addressed
// to a project's inbox. Two things have to be on the screen for that to be
// honest: the row saying so in words with the signal that decided, and the
// control that takes it back. The consent sentence is in the header band
// rather than beside each row — the 2026-09-15 precedent, where asking per
// document was found to be ceremony rather than consent.
// ============================================================================
describe("the inbox — an automatic assignment", () => {
  it("says it was assigned automatically, and offers to undo it", async () => {
    render(<InboxPage />);
    await screen.findByText("AC-101 lounge armchair, revised specification");
    expect(screen.getAllByText(/assigned automatically · addressed to the project inbox/).length).toBeGreaterThan(0);
    const undo = screen.getAllByRole("button", { name: "Wrong project" })[0]!;
    expect(undo).toHaveAttribute("title", expect.stringContaining("Unassign"));
  });

  it("states the charge once, at the top, where a morning's post is visible", async () => {
    render(<InboxPage />);
    await screen.findByText("AC-101 lounge armchair, revised specification");
    expect(
      screen.getByText(/assigned and read automatically the moment it arrives — one charged model call each/),
    ).toBeInTheDocument();
  });

  it("names the project a weak signal pointed at, without choosing it", async () => {
    render(<InboxPage />);
    await screen.findByText("FW: client comments - armchairs");
    // The held message routed by the sender alone: the project is NAMED, and
    // the picker still reads "Choose a project…".
    expect(screen.getByText(/Routing read it as AP401/)).toBeInTheDocument();
    const picker = screen.getByLabelText(/Which project FW: client comments/);
    expect(picker).toHaveValue("");
  });

  it("says a deferred read is waiting for a slot, not reading and not failed", async () => {
    render(<InboxPage />);
    await screen.findByText("UP-101 headboard — fabric confirmed");
    expect(screen.getByText("Waiting for a slot")).toBeInTheDocument();
    expect(screen.getByText(/starts on its own when one of this project/)).toBeInTheDocument();
  });

  // ==========================================================================
  // A READ THE APP STARTED AND LOST IS A QUEUE, NOT A ROW (3c.4)
  //
  // Before this, the only thing that said an automatic read had failed was the
  // row's own chip, inside a list of everything else waiting for a person. With
  // Graph on that is a queue somebody has to watch and nothing counted it.
  // ==========================================================================
  it("counts a failed read on a tile of its own", async () => {
    render(<InboxPage />);
    await screen.findByText("S-301 desk chair — timber finish");
    // Twice on the screen: the tile and the table it heads. The count's own
    // line is the half only the tile carries.
    expect(screen.getAllByText("Reads that failed").length).toBeGreaterThan(0);
    expect(screen.getByText("each needs a person to retry it")).toBeInTheDocument();
  });

  it("puts it in its own table under the default tab, never behind one", async () => {
    render(<InboxPage />);
    await screen.findByRole("heading", { name: /Reads that failed/ });
    // The default tab is "To review", and this row is not one of those: nobody
    // is waiting for a result that never came.
    expect(screen.getByText("Read failed")).toBeInTheDocument();
    expect(screen.getByText("The model could not be reached.")).toBeInTheDocument();
  });
});
