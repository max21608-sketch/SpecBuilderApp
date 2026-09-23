// The inbox for one project.
//
// ============================================================================
// Plan any-bill, step 7. What is proved here:
//
//   THE SELECT IS URL STATE. Choosing a project writes `?project=<id>` and
//   keeps every other parameter; a URL carrying one asks the route for that
//   project's mail.
//
//   HELD MAIL IS ONE LINE IN A PROJECT VIEW, never a list and never a tile:
//   it is on no project, so it cannot be this one's. The line links to the
//   full inbox.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InboxPage from "@/app/dashboard/inbox/page";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/dashboard/inbox",
  useRouter: () => ({ replace }),
}));

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function message(over: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    origin: "upload",
    mailbox: "inbox@example.com",
    fetch_status: "fetched",
    fetch_error: null,
    from_addr: "designer@example.com",
    from_name: null,
    subject: "Armchair, revised specification",
    received_at: "2026-09-16T10:00:00.000Z",
    has_attachments: false,
    attachments_meta: null,
    routing_status: "assigned",
    routing_reason: "addressed to the project inbox",
    routing_candidates: null,
    project_id: P1,
    bws_project_number: "AP401",
    project_name: "Ashcombe House",
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
    ...over,
  };
}

const PROJECTS = [
  { id: P1, bws_project_number: "AP401", name: "Ashcombe House" },
  { id: P2, bws_project_number: "AP402", name: "Brook Street" },
];

const HELD = message({
  id: "msg-held",
  subject: "FW: some comments",
  routing_status: "unassigned",
  project_id: null,
  intake_run_id: null,
  run_status: null,
  found: null,
});

/** What the route answers, by whether it was asked for one project. */
function payload(url: string) {
  const projectId = new URL(url, "http://localhost").searchParams.get("projectId");
  return {
    ok: true,
    // The route filters on project_id, so held mail never comes back in a
    // project view — as the real one does.
    messages: projectId ? [message()] : [message(), HELD],
    heldCount: 3,
    arrivedToday: 0,
    ruledThisWeek: 0,
    failedReads: 0,
    projects: PROJECTS,
  };
}

const fetched: string[] = [];

beforeEach(() => {
  search = "";
  replace.mockReset();
  fetched.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      return new Response(JSON.stringify(payload(String(url))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

describe("choosing a project", () => {
  it("offers All projects first, then each project", async () => {
    render(<InboxPage />);
    const select = (await screen.findByRole("combobox", { name: "Which project's mail" })) as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options[0]).toBe("All projects");
    expect(options).toContain("AP402 — Brook Street");
    expect(select.value).toBe("all");
  });

  it("writes the project into the URL and keeps the tab", async () => {
    search = "tab=everything";
    render(<InboxPage />);
    const select = await screen.findByRole("combobox", { name: "Which project's mail" });
    await userEvent.selectOptions(select, P2);
    expect(replace).toHaveBeenCalledWith(`/dashboard/inbox?tab=everything&project=${P2}`, { scroll: false });
  });

  it("asks the route for that project's mail when the URL names one", async () => {
    search = `project=${P1}`;
    render(<InboxPage />);
    await screen.findByText("Armchair, revised specification");
    expect(fetched.some((url) => url.includes(`projectId=${P1}`))).toBe(true);
    expect(((await screen.findByRole("combobox", { name: "Which project's mail" })) as HTMLSelectElement).value).toBe(P1);
  });

  it("asks for everything with no project in the URL", async () => {
    render(<InboxPage />);
    await screen.findByText("Armchair, revised specification");
    expect(fetched.every((url) => !url.includes("projectId="))).toBe(true);
  });
});

describe("held mail in a project view", () => {
  it("is one line with a link to the full inbox, and no list, tile or tab", async () => {
    search = `project=${P1}`;
    render(<InboxPage />);
    const line = await screen.findByText(/3 held messages are on no project yet/);
    expect(line.querySelector("a")?.getAttribute("href")).toBe("/dashboard/inbox");
    expect(screen.queryByRole("heading", { name: /Could not be placed/ })).toBeNull();
    expect(screen.queryByText("FW: some comments")).toBeNull();
    expect(screen.queryByText("needs a person to say which project")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Could not be placed/ })).toBeNull();
  });

  it("is listed as before in the whole inbox", async () => {
    render(<InboxPage />);
    await screen.findByRole("heading", { name: /Could not be placed/ });
    expect(screen.getByText("FW: some comments")).toBeTruthy();
    expect(screen.queryByText(/held messages are on no project yet/)).toBeNull();
  });
});
