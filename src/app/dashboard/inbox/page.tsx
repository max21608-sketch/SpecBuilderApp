"use client";

// Every email that has reached the app, and where it went.
//
// ============================================================================
// THE UNPLACED LIST IS THE POINT OF THIS SCREEN
//
// An email nobody has placed on a project is the one state in this feature
// that silently stops work: the sender believes they have told us, and nothing
// on any project screen says otherwise. So held messages sort first, are never
// hidden behind a filter — INCLUDING the tabs, which is why the amber table
// renders under every tab that could hold one — and carry the reason the
// headers were not enough.
//
// Assigning one is the SPEND POINT — it starts a charged model read — and the
// button says so. Nothing is ever assigned automatically from an ambiguous
// outcome: two projects matching equally well is a decision, not a tie to
// break, and the picker is pre-filled with the CANDIDATES rather than with a
// choice.
//
// ---- ROWS, NOT CARDS -----------------------------------------------------
//
// Seventeen stacked cards is four screens of scrolling; seventeen rows is one.
// The job on this screen is scanning — which of these has eleven specs and
// four that change a confirmed value — and that is a column, not a paragraph.
// `What it found` is the column that earns its place: an email that was read
// and produced nothing is a different thing from one waiting to be reviewed,
// and it now says so instead of looking identical.
// ============================================================================
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import StatTile from "@/components/ui/StatTile";
import Button, { buttonClass } from "@/components/ui/Button";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { useUrlTab } from "@/lib/use-url-tab";
import { WAITING_FOR_SLOT_LABEL } from "@/lib/intake-status";

/** What a read turned up. Computed in the route by `describeChange`, per 0021. */
type Found = {
  proposals: number;
  runs: number;
  changesConfirmed: number;
  nothingToRecord: boolean;
};

type Message = {
  id: string;
  origin: string;
  mailbox: string;
  fetch_status: string;
  fetch_error: string | null;
  from_addr: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  has_attachments: boolean;
  attachments_meta: { filename?: string }[] | null;
  routing_status: "assigned" | "ambiguous" | "unassigned";
  routing_reason: string | null;
  routing_candidates: { projectId: string; signal: string; evidence: string }[] | null;
  project_id: string | null;
  bws_project_number: string | null;
  project_name: string | null;
  assignment_kind: string | null;
  intake_run_id: string | null;
  run_status: string | null;
  run_error: string | null;
  /** `pending` because the project is already reading as many as it may. */
  waiting_for_slot: boolean | null;
  pending_count: string | number;
  applied_count: string | number;
  chase_match: string | null;
  /** The confident reading only. A boolean cannot carry a caveat. */
  chaseReply: boolean;
  /** Null until the run has been read: "not read yet" is not "found nothing". */
  found: Found | null;
  triage: string;
  parse_error: string | null;
  version: number;
};

type Project = { id: string; bws_project_number: string; name: string };

type Payload = {
  messages: Message[];
  heldCount: number;
  /**
   * THE SERVER'S COUNT OF FAILED READS, over every message rather than the 200
   * this screen holds. A failed read is `assigned`, so it sorts BELOW the held
   * mail that is never truncated away, and counting it out of `messages` made
   * the one tile that watches an unwatched queue the one tile that could
   * silently read low. The table below still renders the rows this page has.
   */
  failedReads: number;
  arrivedToday: number;
  ruledThisWeek: number;
  projects: Project[];
};

const TABS = ["review", "held", "nothing", "everything"] as const;
type Tab = (typeof TABS)[number];

/**
 * How a message reads on this screen.
 *
 * `reading` and `failed` are deliberately NOT folded into `review`: an email
 * the queue has not got to is not an email waiting for a person, and saying so
 * is the difference between a queue somebody watches and a queue somebody
 * believes is stuck.
 */
function outcome(message: Message): "held" | "waiting" | "reading" | "failed" | "nothing" | "review" {
  if (message.routing_status !== "assigned") return "held";
  if (message.run_status === "failed") return "failed";
  // WAITING FOR A SLOT IS NOT READING. The cap defers a read rather than
  // refusing it, so this row needs nobody and will start on its own — and a
  // message the app auto-assigned on a busy morning is the normal way to reach
  // this state, which is why it earns a word of its own rather than an error.
  if (message.run_status === "pending" && message.waiting_for_slot) return "waiting";
  if (!message.found) return "reading";
  if (message.found.nothingToRecord) return "nothing";
  return "review";
}

/** Today where the reader is, which is where this app is pinned. */
function arrivedToday(message: Message): boolean {
  if (!message.received_at) return false;
  const at = new Date(message.received_at);
  return !Number.isNaN(at.getTime()) && at.toDateString() === new Date().toDateString();
}

/**
 * When it arrived, and how long ago in CALENDAR DAYS.
 *
 * Not elapsed hours: an email at 4pm yesterday is twenty-two hours old and it
 * is not "today", and a screen that said so beside a tile counting today's
 * post would be contradicting itself on one line. Midnights crossed, which is
 * what a person means.
 */
function whenItArrived(received: string | null): { on: string; ago: string } {
  if (!received) return { on: "unknown", ago: "" };
  const at = new Date(received);
  if (Number.isNaN(at.getTime())) return { on: received, ago: "" };
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(at)) / 86_400_000);
  return {
    on: at.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    ago: days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`,
  };
}

function sender(message: Message): string {
  return message.from_name
    ? `${message.from_name} <${message.from_addr ?? "unknown"}>`
    : (message.from_addr ?? "unknown sender");
}

function InboxView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [tab, setTab] = useUrlTab<Tab>({
    fallback: "review",
    resolve: (raw) => (TABS.includes(raw as Tab) ? (raw as Tab) : null),
  });

  /**
   * EVERY message, triaged ones included, and the tabs narrow it here.
   *
   * A tab's count cannot be derived from the rows you are already looking at —
   * the projects list's rule — and "Ruled on this week" would read zero on
   * exactly the screen it appears on if the request hid them.
   */
  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/email-messages?includeTriaged=1`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Say what an action returned, AFTER the reload it triggers. */
  const reloadThen = useCallback(
    async (failure: string | null) => {
      await load();
      if (failure) setError(failure);
    },
    [load],
  );

  async function act(message: Message, body: Record<string, unknown>) {
    setBusy(message.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/email-messages/${message.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, version: message.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      // Always reset: an HTML error page must not leave the row disabled.
      setBusy(null);
    }
  }

  const buckets = useMemo(() => {
    const all = data?.messages ?? [];
    const open = all.filter((message) => message.triage === "open");
    return {
      all,
      held: open.filter((message) => outcome(message) === "held"),
      nothing: open.filter((message) => outcome(message) === "nothing"),
      // A FAILED READ IS ITS OWN QUEUE, and it came out of "to review" when
      // assignment stopped being something a person always did. Since 2.11 the
      // app places mail on a project by itself and starts the charged read, so
      // a read that failed is work nobody asked for, that nobody is waiting
      // on, and that only a person pressing Retry will move. Left inside the
      // review bucket it was one row among a morning's post, and the only
      // thing saying it had happened was that row.
      failed: open.filter((message) => outcome(message) === "failed"),
      review: open.filter((message) => ["review", "waiting", "reading"].includes(outcome(message))),
    };
  }, [data]);

  if (error && !data) {
    return (
      <PageBody>
        <Note tone="danger">{error}</Note>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody>
        <Spinner label="Loading the inbox" />
      </PageBody>
    );
  }

  const specsProposed = buckets.review.reduce((sum, message) => sum + (message.found?.proposals ?? 0), 0);
  const heldToday = buckets.held.filter(arrivedToday).length;
  const listed =
    tab === "held" ? [] : tab === "nothing" ? buckets.nothing : tab === "everything" ? buckets.all : buckets.review;

  return (
    <>
      <PageHeader
        title="Inbox"
        // THE CONSENT STATEMENT, at the top of the screen where the volume is
        // visible, which is the 2026-09-15 precedent: asking per message was
        // ceremony rather than consent, and the decision belongs where a
        // morning's post can be seen at once.
        subtitle="Mail addressed to a project's inbox, or forwarded from it, is assigned and read automatically the moment it arrives — one charged model call each. Anything placed by a subject reference or a known sender waits below for you to confirm."
        actions={
          // AN .eml IS UPLOADED ON THE PROJECT IT BELONGS TO, through the pack
          // upload, because a spec document arrives as part of a delivery and
          // the store is scoped to `projects/<id>/`. There is no project-less
          // upload to offer here, so this goes where one can be chosen.
          <Link href="/dashboard/projects" className={buttonClass("secondary")}>
            Upload an .eml
          </Link>
        }
        tabs={
          <Tabs
            label="Which mail"
            value={tab}
            onChange={setTab}
            items={[
              { id: "review", label: "To review", count: buckets.review.length, tone: "info" },
              { id: "held", label: "Could not be placed", count: buckets.held.length, tone: "warn" },
              { id: "nothing", label: "Nothing to record", count: buckets.nothing.length },
              { id: "everything", label: "Everything", count: buckets.all.length },
            ]}
          />
        }
      />

      <PageBody>
        {error && <Note tone="danger">{error}</Note>}

        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          <StatTile
            label="Read, waiting for you"
            tone="info"
            value={buckets.review.length}
            meaning={`${specsProposed} spec${specsProposed === 1 ? "" : "s"} proposed`}
            onPress={tab === "review" ? undefined : () => setTab("review")}
            active={tab === "review"}
          />
          <StatTile
            label="Could not be placed"
            tone={buckets.held.length > 0 ? "warn" : "plain"}
            value={buckets.held.length}
            meaning="needs a person to say which project"
            onPress={buckets.held.length > 0 && tab !== "held" ? () => setTab("held") : undefined}
            active={tab === "held"}
          />
          {/* THE READS NOBODY IS COMING BACK FOR.
              Since 2.11 the app assigns confidently routed mail by itself and
              starts the charged read, so this is the only count on any screen
              that says something the app did on its own did not work. It is a
              QUEUE rather than an incident — with Graph on, one of these is a
              document to retry and three in a morning is a mailbox to look at —
              which is why it earns a tile and not a chip on one row. Slate at
              zero: red for an empty queue teaches people to ignore red.

              THE NUMBER IS THE SERVER'S, not this page's rows. Counted out of
              `messages` it was capped at 200 and sorted below every held
              message, so the count that exists because nobody is watching the
              queue was itself the count that could quietly go short. */}
          <StatTile
            label="Reads that failed"
            tone={data.failedReads > 0 ? "danger" : "plain"}
            value={data.failedReads}
            meaning={data.failedReads === 0 ? "nothing waiting on a retry" : "each needs a person to retry it"}
          />
          {/* THE SERVER'S COUNT, over every message rather than the 200 this
              screen holds. What is said UNDER it is about the held ones, which
              sort first and are never truncated away. */}
          <StatTile
            label="Arrived today"
            value={data.arrivedToday}
            meaning={
              data.arrivedToday === 0
                ? "nothing yet today"
                : heldToday > 0
                  ? `${heldToday} could not be placed`
                  : "all assigned automatically"
            }
          />
          <StatTile
            label="Ruled on this week"
            tone="good"
            value={data.ruledThisWeek}
            meaning="applied or dismissed"
            onPress={tab === "everything" ? undefined : () => setTab("everything")}
            active={tab === "everything"}
          />
        </div>

        {tab !== "held" && (
          <>
            <h2 className="mt-6 text-th font-bold uppercase tracking-wider text-neutral-500">
              {tab === "nothing" ? "Nothing to record" : tab === "everything" ? "Everything" : "Read and waiting for you"}
              <span className="font-medium normal-case tracking-normal text-neutral-500">
                {" "}· newest first ·{" "}
                {tab === "nothing"
                  ? "read, and they state nothing this app can record"
                  : tab === "everything"
                    ? "including the ones already ruled on"
                    : "already on a project, already extracted"}
              </span>
            </h2>
            {listed.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Nothing here.</p>
            ) : (
              <Card flush className="mt-2">
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-[42%]">Subject</Th>
                      <Th className="w-[16%]">Project</Th>
                      <Th className="w-[18%]">What it found</Th>
                      <Th className="w-[14%]">Arrived</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((message) => (
                      <MessageRow
                        key={message.id}
                        message={message}
                        busy={busy === message.id}
                        onAct={(body) => void act(message, body)}
                      />
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}
          </>
        )}

        {/* A FAILED READ IS NEVER HIDDEN BY A TAB EITHER, for the reason held
            mail is not. It is the second state on this screen that silently
            stops work, and since 2.11 it is the one nobody chose: the app
            placed the message and started the read on its own, so there is no
            person waiting for the result who would notice it never came. The
            row is the same one the main list renders — Open goes to the review
            screen, where Retry lives and where the cost of pressing it is
            stated.

            IT RENDERS ON THE SERVER'S COUNT, not on this page's rows. The two
            disagree only when the 200-row page has truncated one away, and the
            tile without a table would be a number with nothing under it to act
            on — so the heading appears either way and says how many rows are
            missing from it. */}
        {(data.failedReads > 0 || buckets.failed.length > 0) && (
          <>
            <h2 className="mt-6 text-th font-bold uppercase tracking-wider text-red-700">
              Reads that failed
              <span className="font-medium normal-case tracking-normal text-neutral-500">
                {" "}· the message is on its project and the read did not finish — open it to retry
                {/* NAME THE GAP, AND DO NOT INVENT A WAY OUT OF IT. This
                    screen has no project filter and no paging, so there is
                    nothing to tell somebody to press: what is owed them is
                    that the tile and the table do not quietly disagree. */}
                {data.failedReads > buckets.failed.length &&
                  ` · showing ${buckets.failed.length} of ${data.failedReads} — the rest are older than the 200 messages this page holds`}
              </span>
            </h2>
            <Card flush className="mt-2 border-red-200">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-[42%]">Subject</Th>
                    <Th className="w-[16%]">Project</Th>
                    <Th className="w-[18%]">What it found</Th>
                    <Th className="w-[14%]">Arrived</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {buckets.failed.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      busy={busy === message.id}
                      onAct={(body) => void act(message, body)}
                    />
                  ))}
                </tbody>
              </Table>
            </Card>
          </>
        )}

        {/* HELD MAIL IS NEVER HIDDEN BY A TAB. It is the exception rather than
            the page — three rows in an amber table under the main list — but a
            default view that hid it would put the one state that silently
            stops work behind a click. */}
        {buckets.held.length > 0 && (
          <>
            <h2 className="mt-6 text-th font-bold uppercase tracking-wider text-amber-700">
              Could not be placed
              <span className="font-medium normal-case tracking-normal text-neutral-500">
                {" "}· the headers name no project, or name two equally well
              </span>
            </h2>
            <Card flush className="mt-2 border-amber-200">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-[44%]">Subject</Th>
                    <Th className="w-[30%]">Why it is here</Th>
                    <Th className="w-[26%]">Put it on a project</Th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.held.map((message) => {
                    const candidates = (message.routing_candidates ?? [])
                      .map((candidate) => data.projects.find((project) => project.id === candidate.projectId))
                      .filter((project): project is Project => Boolean(project));
                    // AMBIGUOUS OFFERS ONLY THE CANDIDATES, and chooses none:
                    // two projects matching equally well is a decision, and a
                    // pre-selected picker would make agreeing with it silent.
                    const offer = message.routing_status === "ambiguous" && candidates.length > 0 ? candidates : data.projects;
                    return (
                      <Tr key={message.id}>
                        <Td>
                          <span className="block font-semibold text-neutral-900">
                            {message.subject ?? "(no subject)"}
                          </span>
                          <span className="block text-neutral-500">{sender(message)}</span>
                          <span className="block text-neutral-500">{whenItArrived(message.received_at).on}</span>
                          {message.parse_error && (
                            <span className="block text-red-700">
                              This message could not be fully parsed: {message.parse_error}
                            </span>
                          )}
                        </Td>
                        <Td muted>
                          {message.routing_status === "ambiguous" && <Chip tone="warn">two projects match equally</Chip>}
                          <span className="mt-1 block">{message.routing_reason}</span>
                          {/* The candidates are listed only where they are the
                              QUESTION. On an unplaced message the reason
                              already contains the evidence, and printing it
                              twice reads as two separate findings. */}
                          {message.routing_status === "ambiguous" && (message.routing_candidates ?? []).length > 0 && (
                            <ul className="mt-1 list-inside list-disc">
                              {(message.routing_candidates ?? []).slice(0, 4).map((candidate, index) => (
                                <li key={index}>{candidate.evidence}</li>
                              ))}
                            </ul>
                          )}
                          {/* ROUTING'S OWN SENTENCE DOES NOT NAME THE PROJECT.
                              "the sender is a contact on this project" was
                              written for a row that had already been placed on
                              one; since 2026-09-21 a subject reference or a
                              known sender is held instead, and the person being
                              asked to choose cannot see which project routing
                              meant. Named, and never PRESELECTED: the picker
                              still offers every project and chooses none, for
                              the reason the ambiguous one does. */}
                          {message.routing_status !== "ambiguous" && candidates.length > 0 && (
                            <span className="mt-1 block">
                              Routing read it as {candidates.map((project) => project.bws_project_number).join(", ")} —
                              held because that signal is not strong enough to spend a charged read on its own.
                            </span>
                          )}
                        </Td>
                        <Td>
                          <select
                            value={assignTo[message.id] ?? ""}
                            disabled={busy === message.id}
                            aria-label={`Which project ${message.subject ?? "this email"} belongs to`}
                            onChange={(event) =>
                              setAssignTo((prev) => ({ ...prev, [message.id]: event.target.value }))
                            }
                            className="w-full rounded border border-amber-300 bg-white px-2 py-1 disabled:opacity-50"
                          >
                            <option value="">Choose a project…</option>
                            {offer.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.bws_project_number} — {project.name}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Button
                              variant="primary"
                              size="xs"
                              disabled={busy === message.id || !assignTo[message.id]}
                              onClick={() =>
                                void act(message, { action: "assign", projectId: assignTo[message.id] })
                              }
                            >
                              Assign &amp; read
                            </Button>
                            <Button
                              variant="quiet"
                              size="xs"
                              disabled={busy === message.id}
                              onClick={() => void act(message, { action: "triage", triage: "not_specification" })}
                            >
                              Not a spec
                            </Button>
                          </div>
                          {/* THE SPEND POINT, said before the click. */}
                          <span className="mt-1 block text-[11px] text-neutral-500">One charged model call.</span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}

/** One assigned message. */
function MessageRow({
  message,
  busy,
  onAct,
}: {
  message: Message;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => void;
}) {
  const state = outcome(message);
  const arrived = whenItArrived(message.received_at);
  const attachments = message.attachments_meta?.length ?? 0;
  const applied = Number(message.applied_count ?? 0);
  const review = message.intake_run_id ? `/dashboard/imports/${message.intake_run_id}` : null;

  return (
    <Tr>
      <Td>
        {review ? (
          <Link href={review} className="block font-semibold text-blue-700 no-underline hover:underline">
            {message.subject ?? "(no subject)"}
          </Link>
        ) : (
          <span className="block font-semibold text-neutral-900">{message.subject ?? "(no subject)"}</span>
        )}
        <span className="block text-neutral-500">{sender(message)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {/* THE SIGNAL THAT PLACED IT, printed on every row, so a wrong
              placement is visible rather than hidden. */}
          {/* THE SIGNAL THAT PLACED IT — only where something did. An unplaced
              message was not assigned by hand either, and saying so would be a
              claim about a decision nobody took.

              The FIRST clause of the reason, with the whole of it on hover: the
              resolver writes a sentence and the review screen prints it in
              full, and a chip 400px wide pushes the columns this screen exists
              to align. */}
          {message.routing_status === "assigned" ? (
            // IN WORDS, not "auto": since 2026-09-21 this row is the only
            // place a charged read nobody asked for is accounted for, and a
            // four-letter chip is not an account of it.
            <Chip dot tone={message.assignment_kind === "auto" ? "live" : "plain"} title={message.routing_reason ?? undefined}>
              {message.assignment_kind === "auto" ? "assigned automatically" : "assigned by hand"}
              {message.routing_reason ? ` · ${message.routing_reason.split(" — ")[0]}` : ""}
            </Chip>
          ) : (
            <Chip tone="warn" title={message.routing_reason ?? undefined}>
              not on a project
            </Chip>
          )}
          {message.chaseReply && <Chip tone="good">reply to a chase</Chip>}
          {attachments > 0 && (
            <Chip>
              {attachments} attachment{attachments === 1 ? "" : "s"}
            </Chip>
          )}
          {message.triage !== "open" && <Chip>ruled on</Chip>}
        </span>
        {message.parse_error && (
          <span className="block text-red-700">This message could not be fully parsed: {message.parse_error}</span>
        )}
      </Td>
      <Td>
        {message.project_id ? (
          <>
            <Link
              href={`/dashboard/projects/${message.project_id}`}
              className="block font-semibold text-blue-700 no-underline hover:underline"
            >
              {message.bws_project_number}
            </Link>
            <span className="block text-neutral-500">{message.project_name}</span>
          </>
        ) : (
          <span className="text-neutral-400">none</span>
        )}
      </Td>
      <Td>
        {state === "held" ? (
          /* NEVER READ, and that is the rule rather than a gap: an unassigned
             email is not read at all, because there are no registers to
             resolve it against and the read is what costs money. */
          <>
            <Chip tone="warn">not read</Chip>
            <span className="mt-1 block text-[11px] text-neutral-500">nothing is read until it is placed</span>
          </>
        ) : state === "failed" ? (
          <>
            <Chip tone="danger">Read failed</Chip>
            {message.run_error && <span className="mt-1 block text-[11px] text-neutral-500">{message.run_error}</span>}
          </>
        ) : state === "waiting" ? (
          /* THE CAP DEFERRED IT, WHICH IS NOT AN ERROR AND NEEDS NOBODY. The
             one word this row must not carry is a Retry: the read is promised
             and starts when one of the project's in-flight reads finishes. */
          <>
            <Chip tone="info">{WAITING_FOR_SLOT_LABEL}</Chip>
            <span className="mt-1 block text-[11px] text-neutral-500">
              starts on its own when one of this project&apos;s reads finishes
            </span>
          </>
        ) : state === "reading" ? (
          <>
            <Chip dot tone="info">Reading…</Chip>
            {/* A dispatch that MAY not have reached the queue leaves the run
                queued with its reason on it, rather than failing a read that
                could still be running. Printed here, or the row claims the app
                is working on something nothing is coming for. */}
            {message.run_error && <span className="mt-1 block text-[11px] text-neutral-500">{message.run_error}</span>}
          </>
        ) : message.found?.nothingToRecord ? (
          <>
            <Chip>nothing to record</Chip>
            <span className="mt-1 block text-[11px] text-neutral-500">read, found no specification</span>
          </>
        ) : (
          <>
            <span className="flex flex-wrap items-center gap-1.5">
              <Chip tone="info">
                {message.found?.proposals} spec{message.found?.proposals === 1 ? "" : "s"}
              </Chip>
              <Chip>
                {message.found?.runs} phase{message.found?.runs === 1 ? "" : "s"}
              </Chip>
            </span>
            {/* A `changes` needs an overwrite acknowledgement and a `withdraws`
                does not; both undo something somebody settled, which is the
                column's question. */}
            {(message.found?.changesConfirmed ?? 0) > 0 && (
              <span className="mt-1 block text-[11px] text-neutral-500">
                {message.found?.changesConfirmed} change{message.found?.changesConfirmed === 1 ? "s" : ""} a confirmed
                value
              </span>
            )}
          </>
        )}
      </Td>
      <Td muted>
        {arrived.on}
        <span className="block">{arrived.ago}</span>
      </Td>
      <Td className="text-right">
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          {review && Number(message.pending_count ?? 0) > 0 ? (
            <Link href={review} className={buttonClass("primary", "xs")}>
              Review
            </Link>
          ) : review ? (
            <Link href={review} className={buttonClass("secondary", "xs")}>
              Open
            </Link>
          ) : null}
          {message.triage === "open" && state === "nothing" && (
            <Button
              variant="quiet"
              size="xs"
              disabled={busy}
              onClick={() => onAct({ action: "triage", triage: "nothing_to_record" })}
            >
              Dismiss
            </Button>
          )}
          {/* A WRONG PLACEMENT IS UNDOABLE UNTIL SOMETHING HAS BEEN APPLIED.
              After that the specs are on records and unassigning would leave
              them standing on a message the project no longer holds. */}
          {applied === 0 && message.routing_status === "assigned" && (
            /* UNASSIGN, in the words a person uses for it. The control the
               approved gate amendment asks for beside an automatic
               assignment is this one, and it is offered for a hand-placed
               message on the same terms — an automatic placement is not
               harder to undo than a deliberate one. The arrival copy under
               `mailbox/` survives it, which is what makes it reversible. */
            <Button
              variant="quiet"
              size="xs"
              disabled={busy}
              title="Unassign: takes it off this project and holds it again. The message itself is kept."
              onClick={() => onAct({ action: "unassign" })}
            >
              Wrong project
            </Button>
          )}
          <a href={`/api/email-messages/${message.id}/mime`} className={buttonClass("quiet", "xs")}>
            .eml
          </a>
        </span>
      </Td>
    </Tr>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<PageBody><Spinner label="Loading the inbox" /></PageBody>}>
      <InboxView />
    </Suspense>
  );
}
