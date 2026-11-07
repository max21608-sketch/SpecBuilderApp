"use client";

// The project overview. Everything about a project that is not a spec record.
//
// A project was write-once before this screen: the create form set a number, a
// name and a client and nothing could reach them again, the shared inbox was
// editable only through the API, and the three TOE dates had existed since
// migration 0002 with no way to enter one. The dates are the interesting part —
// `specs_agreed_by` is what turns "outstanding" into "overdue" on the spec
// table, and until something could write it that state could not exist.
//
// ============================================================================
// THE NUMBERS ARE THE SCREEN, AND EVERY ONE OF THEM GOES SOMEWHERE.
//
// "45 records in this project's export scope. 1,899 questions still missing or
// TBC" was one sentence answering neither question a KAM has — CAN I QUOTE
// THIS, and WHAT IS STOPPING ME. The order is now the order of those two: who
// the project is, the five pressable tiles, then one row per thing that is in
// the way with the control that fixes it beside the figure, then where the
// facts came from (documents), who to ask (contacts), and what has happened.
//
// TABS, ONE PER RUN. A BOQ's tabs are sub-quotes — a mock-up run, a main run, a
// value-engineered run — quoting the SAME item codes at different quantities.
// Listing them together made three of everything in one table with no way to
// see which was which; a tab each is how the client, the quote and the job
// already think about them. Overview holds everything that is true of the
// project as a whole.
// ============================================================================
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import ContactsPanel, { type Contact, type ContactsOutstanding } from "@/components/projects/ContactsPanel";
import { FOCUSES, type Focus, type RunTally } from "@/components/records/SpecTable";
import PhaseTabs, { type SpecRun } from "@/components/projects/PhaseTabs";
import ExportMenu from "@/components/records/ExportMenu";
import HistoryCard, { useHistoryCard } from "@/components/projects/HistoryCard";
import OpenChangeBar from "@/components/history/OpenChangeBar";
import FinishesLibrary from "@/components/finishes/FinishesLibrary";
import AddRun from "@/components/projects/AddRun";
import { daysUntilSpecsAgreed, todayLocal } from "@/lib/project-programme";
import Button, { buttonClass } from "@/components/ui/Button";
import {
  completionSentence,
  EMPTY_COMPLETION,
  PROJECT_STATE_LABELS,
  PROJECT_STATE_TONE,
  type ProjectCompletion,
  type ProjectState,
} from "@/lib/project-summary-shape";
import { EMPTY_SUMMARY, type ProjectSummary } from "@/lib/project-summary-shape";
import StatTile from "@/components/ui/StatTile";
import NextStepAction from "@/components/ui/NextStepAction";
import { nextStep } from "@/lib/next-step";
import Tip from "@/components/ui/Tip";
import Pill from "@/components/ui/Pill";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Card from "@/components/ui/Card";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { Table, Td, Tr } from "@/components/ui/Table";
import { useUrlTab } from "@/lib/use-url-tab";
import ProjectWideCard from "@/components/projects/ProjectWideCard";
import ProjectDetailsCard from "@/components/projects/ProjectDetailsCard";
import { inboxBuckets, type InboxOutcomeFields } from "@/lib/inbox-outcome";
import { formatDay } from "@/lib/format-day";
import NotesCard, { type ProjectNote } from "@/components/projects/NotesCard";
import DocumentsTab, { useDocumentsPoll, useProjectDocuments, type DocumentRun } from "@/components/projects/DocumentsTab";

type Project = {
  id: string;
  bws_project_number: string;
  name: string;
  client: string | null;
  shared_inbox: string | null;
  order_date: string | null;
  specs_agreed_by: string | null;
  delivery_date: string | null;
  default_dimension_unit: string | null;
  /** The short code in in-house finish codes (0044): AMB → BW-AMB-001. */
  finish_code_prefix: string | null;
  status: string;
  archived_at: string | null;
  archived_by: string | null;
  version: number;
};

/**
 * One line of the Specifications card: a count, what it means, and the control
 * that acts on it.
 *
 * THE FIGURE AND ITS FIX TRAVEL TOGETHER. A number with no action beside it
 * makes somebody go and find the screen it belongs to, which is the whole
 * complaint about this page — and the count itself is the link, so there are
 * two ways to the same place rather than one.
 *
 * A ROW WITH A COUNT OF ZERO STILL RENDERS, and that is the change worth
 * stating: every one of these is a CHECK, and a check that disappears when it
 * passes is a check nobody knows is being made. It renders plain instead —
 * no colour, no button — so the eye goes to the rows that want something.
 */
function SummaryRow({
  label,
  count,
  meaning,
  tone,
  action,
  href,
}: {
  label: string;
  count: number;
  meaning: React.ReactNode;
  tone: "danger" | "warn" | "info";
  /** The control beside the figure. Only rendered when there is something to do. */
  action?: React.ReactNode;
  href?: string | null;
}) {
  const live = count > 0;
  const colour =
    !live
      ? "text-neutral-400"
      : tone === "danger"
        ? "text-red-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-blue-700";
  return (
    <Tr>
      <Td className="w-[26%] align-top">
        {href && live ? (
          <Link href={href} className="font-semibold text-neutral-900 no-underline hover:underline">
            {label}
          </Link>
        ) : (
          <span className={`font-semibold ${live ? "text-neutral-900" : "text-neutral-500"}`}>{label}</span>
        )}
      </Td>
      <Td num className={`w-[10%] align-top text-[15px] font-semibold ${colour}`}>
        {href && live ? (
          <Link href={href} className="text-inherit no-underline hover:underline">
            {count.toLocaleString()}
          </Link>
        ) : (
          count.toLocaleString()
        )}
      </Td>
      <Td className={`align-top ${live ? "text-neutral-600" : "text-neutral-400"}`}>{meaning}</Td>
      <Td className="w-[24%] align-top">
        <div className="flex flex-wrap justify-end gap-1.5">{live ? action : null}</div>
      </Td>
    </Tr>
  );
}

function ProjectOverview() {
  const projectId = String(useParams().id ?? "");
  /**
   * `?focus=` — which of the spec table's tiles a link arrived pressing.
   *
   * The next-step control lands somebody on a phase tab already narrowed, so
   * "Categorise 6 items" shows the six rather than every record with a filter
   * to find. Read here rather than inside the table because the table is a
   * component with no business knowing about URLs, and RESOLVED against the
   * table's own vocabulary so a hand-edited query cannot put it in a state no
   * tile can clear.
   */
  const searchParams = useSearchParams();
  const rawFocus = searchParams.get("focus");
  // `?finish=<CODE>` lands the finishes tab on one code -- the record screen's
  // "set on WD-05 in the finishes library" link (0045).
  const finishQuery = searchParams.get("finish") ?? "";
  const initialFocus: Focus = ((): Focus => {
    // The table's own list, so a focus it learns is one a link can carry.
    return FOCUSES.find((value) => value === rawFocus) ?? null;
  })();
  const [project, setProject] = useState<Project | null>(null);
  const docs = useProjectDocuments();
  const { documents, setDocuments, setFailedDocuments, failedDocuments, packs } = docs;
  const [runs, setRuns] = useState<SpecRun[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  /**
   * WHICH TAB, AND IT LIVES IN THE URL.
   *
   * It used to live in `useState`, filled ONCE from `?tab=` by a `tabPreselected`
   * ref on the first render that had runs. Three things then disagreed with the
   * screen: reload gave you the tab named in the URL rather than the one you
   * were on, Back walked out of the project instead of between its tabs, and a
   * link pasted into Teams opened the tab the sender had LEFT.
   *
   * `resolve` carries the aliases, and returning null is what makes the deep
   * link survive: while the runs are still loading a run id resolves to
   * nothing, Overview renders, and the URL is left alone until the data
   * arrives. Correcting it there would destroy the link a quarter of a second
   * before it became valid.
   *
   * "?tab=spec" is how the projects list offers the spec table as a destination
   * of its own; it takes the FIRST run, because there is no merged view to send
   * anybody to. `finishes`, `history` and `documents` answer for themselves and
   * BEFORE the runs arrive, so the old /finishes redirect lands immediately.
   */
  const [tab, setTab] = useUrlTab<string>({
    fallback: "overview",
    resolve: (raw) => {
      if (!raw) return null;
      if (raw === "finishes" || raw === "history" || raw === "documents" || raw === "overview") return raw;
      if (runs.length === 0) return null;
      if (raw === "spec") return runs[0]?.id ?? null;
      return runs.some((run) => run.id === raw) ? raw : null;
    },
  });
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [contactsOutstanding, setContactsOutstanding] = useState<ContactsOutstanding | null>(null);
  /** This project's mail still to review; null until counted (plan any-bill, step 7). */
  const [inboxToReview, setInboxToReview] = useState<number | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const [suggestedCodes, setSuggestedCodes] = useState<string[]>([]);
  const [codeCounts, setCodeCounts] = useState<Record<string, number>>({});
  const [unlinkedFinishCodes, setUnlinkedFinishCodes] = useState<{ code: string; records: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [acceptingLevels, setAcceptingLevels] = useState(false);
  // Derived on the server and re-read on every load, because it changes when
  // an answer changes rather than when the project row does.
  const [completion, setCompletion] = useState<ProjectCompletion>(EMPTY_COMPLETION);
  // What the project is SHORT of, as opposed to whether it is finished. Same
  // scope, different question — see src/lib/project-summary.ts.
  const [summary, setSummary] = useState<ProjectSummary>(EMPTY_SUMMARY);
  const [state, setState] = useState<ProjectState>("active");
  /**
   * EACH RUN'S OWN NUMBERS, reported up by the table that already loaded them.
   *
   * The header band belongs to the page and its subtitle and actions are per
   * run, so it needs a figure the run's own table has. A second fetch for it
   * would be a second reading of `to_quote_outstanding`, and two readings is
   * how a header comes to disagree with the rows under it.
   */
  const [runTallies, setRunTallies] = useState<Record<string, RunTally>>({});
  const history = useHistoryCard();

  const load = useCallback(async () => {
    const res = await apiFetch<{
      project: Project;
      completion: ProjectCompletion;
      summary: ProjectSummary;
      state: ProjectState;
      documents: DocumentRun[];
      runs: SpecRun[];
      notes: ProjectNote[];
      unlinkedFinishCodes: { code: string; records: number }[];
      failedDocuments: number;
      designerCodes: Record<string, number>;
    }>(`/api/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setProject(res.data.project);
    setCompletion(res.data.completion ?? EMPTY_COMPLETION);
    setSummary(res.data.summary ?? EMPTY_SUMMARY);
    setState(res.data.state ?? "active");
    setDocuments(res.data.documents);
    setRuns(res.data.runs ?? []);
    setNotes(res.data.notes ?? []);
    setUnlinkedFinishCodes(res.data.unlinkedFinishCodes ?? []);
    setFailedDocuments(Number(res.data.failedDocuments ?? 0));
    // The designer codes come with the project now. See the route: reading
    // them off /api/records made this screen load every outstanding question
    // in the project a second time.
    const counts = res.data.designerCodes ?? {};
    setCodeCounts(counts);
    setSuggestedCodes(Object.keys(counts).sort());
    // NOT the details form: `ProjectDetailsCard` owns it, and a reload here
    // never reaches what somebody is typing there (audit G6).
  }, [projectId, setDocuments, setFailedDocuments]);

  /** Agree with every level this project's records were guessed, in one act. */
  async function acceptLevels() {
    setAcceptingLevels(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/levels/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: null }),
      });
      await load();
      if (!res.ok) setError(res.error);
    } finally {
      setAcceptingLevels(false);
    }
  }

  /**
   * WHO OWES US WHAT, fetched ALONGSIDE the project rather than inside it.
   *
   * It is the chase screen's own `loadOutstanding` + `groupByContact`, which
   * loads every outstanding question in the project — 19,655 of them on the
   * 300-line project, measured 2026-09-22 — to produce three integers per
   * contact. Inside the project request it made the tiles, the documents, the
   * phases and the notes wait for it. Split out, the screen paints and this
   * column fills a moment later; `null` is "still counting", which the table
   * says in words, and is why it is not defaulted to zeros.
   */
  const loadContactsOutstanding = useCallback(async () => {
    const res = await apiFetch<{ contactsOutstanding: ContactsOutstanding }>(
      `/api/projects/${encodeURIComponent(projectId)}/contacts-outstanding`,
    );
    if (!res.ok) return; // the column says it could not count; the screen is still usable
    setContactsOutstanding(res.data.contactsOutstanding ?? null);
  }, [projectId]);

  const loadContacts = useCallback(async () => {
    const res = await apiFetch<{
      contacts: {
        id: string;
        name: string;
        email: string | null;
        organisation: string | null;
        role: Contact["role"];
        designer_code: string | null;
        version: number;
        capsule_party_id: number | string | null;
        capsule_party_type: string | null;
        capsule_synced_at: string | null;
      }[];
    }>(`/api/projects/${encodeURIComponent(projectId)}/contacts`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setContacts(
      res.data.contacts.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        organisation: row.organisation,
        role: row.role,
        designerCode: row.designer_code,
        version: row.version,
        // Carried through, not dropped: without these every contact renders
        // as "Not linked" however well linked it is.
        capsulePartyId: row.capsule_party_id === null ? null : Number(row.capsule_party_id),
        capsulePartyType: row.capsule_party_type,
        capsuleSyncedAt: row.capsule_synced_at,
      })),
    );
  }, [projectId]);


  /**
   * THE INBOX'S OWN COUNT, over the inbox's own payload. "To review" is
   * `inboxBuckets` over `/api/email-messages?projectId=` — the function the
   * inbox's tab calls — rather than a second count in SQL, so the header and
   * the tab it links to cannot disagree. A failure leaves the link uncounted.
   */
  const loadInboxCount = useCallback(async () => {
    const res = await apiFetch<{ messages: InboxOutcomeFields[] }>(
      `/api/email-messages?projectId=${encodeURIComponent(projectId)}`,
    );
    if (res.ok && Array.isArray(res.data.messages)) setInboxToReview(inboxBuckets(res.data.messages).review.length);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load();
    void loadContacts();
    void loadContactsOutstanding();
    void loadInboxCount();
  }, [projectId, load, loadContacts, loadContactsOutstanding, loadInboxCount]);

  useDocumentsPoll(projectId, docs);

  // THE NUMBERS ONLY, after the Project-wide card writes: the summary and the
  // completion move, and nothing else should. Never through `load()`, which
  // re-reads every card on the page for two numbers.
  const refreshNumbers = useCallback(async () => {
    const res = await apiFetch<{ summary: ProjectSummary; completion: ProjectCompletion; state: ProjectState }>(
      `/api/projects/${encodeURIComponent(projectId)}`,
    );
    if (!res.ok) return;
    setSummary(res.data.summary ?? EMPTY_SUMMARY);
    setCompletion(res.data.completion ?? EMPTY_COMPLETION);
    setState(res.data.state ?? "active");
  }, [projectId]);


  // Reported up by whichever run table is mounted. Stored by run id so
  // switching tabs does not blank the header while the next table loads.
  const onRunSummary = useCallback((runId: string, tally: RunTally) => {
    setRunTallies((current) => {
      const held = current[runId];
      if (held && held.records === tally.records && held.toQuote === tally.toQuote) return current;
      return { ...current, [runId]: tally };
    });
  }, []);
  /**
   * Archiving, and its opposite.
   *
   * Deliberately NOT part of the Save-changes form. Archiving is a decision
   * about the project's life, not an edit to one of its fields, and burying it
   * among the dates would make it something somebody does by accident while
   * correcting a client name.
   */
  async function setArchived(archived: boolean) {
    if (!project) return;
    setError(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: archived ? "archived" : "active", version: project.version }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await load();
    } finally {
      // Always reset: an HTML error page must not leave the button disabled.
      setSaving(false);
    }
  }

  if (error && !project)
    return (
      <PageBody>
        <p className="text-sm text-red-700">{error}</p>
      </PageBody>
    );
  if (!project)
    return (
      <PageBody>
        <Spinner label="Loading project" />
      </PageBody>
    );


  const today = todayLocal();
  const untilSpecs = daysUntilSpecsAgreed(project.specs_agreed_by, today);

  /**
   * Where a "look at the records" control goes.
   *
   * The spec table REQUIRES a run — a screen that merged them listed three
   * sub-quotes in one flat list and was deleted for it — so every link from
   * this page lands on the first live run's tab, which is also what the BOQ
   * confirm redirects to. Null when there is no run yet, and every caller then
   * renders the figure without a link rather than a link that goes nowhere.
   */
  const firstRunHref = runs.length > 0 ? `/dashboard/projects/${project.id}?tab=${runs[0]!.id}` : null;
  const firstPackHref =
    packs.length > 0 && packs[0]!.id ? `/dashboard/projects/${project.id}/intake/${packs[0]!.id}` : null;
  const chaseHref = `/dashboard/drafts?projectId=${project.id}`;
  const infillHref = `/dashboard/projects/${project.id}/infill`;
  const finishesHref = `/dashboard/projects/${project.id}?tab=finishes`;

  const activeRun = runs.find((run) => run.id === tab) ?? null;
  const activeTally = activeRun ? runTallies[activeRun.id] : undefined;

  /**
   * WHAT THIS PROJECT NEEDS NEXT, and it is the header's primary action.
   *
   * Decided by `nextStep()` from the numbers this page has already loaded — no
   * second fetch, no second reading of any rule — so this screen, the bill
   * review's success state and both drawings reviews all print the same answer.
   * See `src/lib/next-step.ts` for the precedence and why it is one function.
   *
   * `waiting` is NOT passed, and deliberately: this payload does not carry one.
   * A zero here would make this screen claim nothing is waiting where another
   * screen with the real figure says otherwise, so the step is skipped instead.
   */
  const step = nextStep({
    projectId: project.id,
    summary,
    documents: documents ?? [],
    runs,
    packId: packs.find((pack) => pack.id)?.id ?? null,
  });


  /**
   * SPECS DUE, and where the date is set.
   *
   * IN WORDS when there is none, never a tip: a project with no programme and a
   * project on time render identically otherwise, which is the one test a tip
   * has to pass.
   */
  const specsDue = project.specs_agreed_by ? (
    <>
      specs due{" "}
      <Link
        href={`/dashboard/projects/${project.id}?tab=overview#project-details`}
        className="text-neutral-600 underline hover:text-neutral-900"
      >
        {formatDay(project.specs_agreed_by)}
      </Link>
      {untilSpecs !== null && (
        <span className={untilSpecs < 0 ? "text-red-700" : ""}>
          {" · "}
          {untilSpecs < 0
            ? `${-untilSpecs} day${untilSpecs === -1 ? "" : "s"} over`
            : untilSpecs === 0
              ? "due today"
              : `${untilSpecs} day${untilSpecs === 1 ? "" : "s"}`}
        </span>
      )}
    </>
  ) : (
    <span className="text-amber-800">no programme — nothing here can be flagged overdue</span>
  );

  /**
   * THE TWO CARDS THAT ARE ALSO TABS.
   *
   * Held in a variable and rendered twice — once on the Overview where they
   * have always been, once on their own tab — so the two can never drift into
   * showing different things. A second copy of a hundred lines of JSX is how a
   * tab starts saying something the card does not.
   */
  const historyCard = (
    <HistoryCard
      projectId={project.id}
      specsAgreedBy={project.specs_agreed_by}
      toQuote={summary.toQuote}
      history={history}
    />
  );

  const documentsCard = <DocumentsTab projectId={project.id} docs={docs} onReload={load} onError={setError} />;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Projects", href: "/dashboard/projects" }]}
        title={`${project.bws_project_number} — ${project.name}`}
        /* WHAT STATE THIS PROJECT IS IN, derived and never set by hand:
           COMPLETED arrives on its own when every question on every record is
           settled. The title says why, because a badge nobody can explain is a
           badge nobody believes. */
        titleAside={
          <Pill
            tone={PROJECT_STATE_TONE[state]}
            title={completionSentence(completion) ?? "Every question on every record is settled."}
          >
            {PROJECT_STATE_LABELS[state]}
          </Pill>
        }
        subtitle={
          activeRun ? (
            /* THE RUN'S OWN LINE. Its revision and date are TEXT columns and
               are printed verbatim — parsing "14-Sep-26" into a date is the
               TOE-dates trap for a value nothing computes with. */
            <>
              {activeRun.name}
              {activeRun.boq_revision && <> · BOQ rev {activeRun.boq_revision}</>}
              {activeRun.boq_date && <>, {activeRun.boq_date}</>}
              {activeTally && <> · {activeTally.records} items</>} · {specsDue}
            </>
          ) : (
            <>
              {project.client ? `${project.client} · ` : ""}
              {specsDue}
            </>
          )
        }
        actions={
          <>
            <OpenChangeBar projectId={project.id} onChanged={() => void load()} />
            {/* THIS PROJECT'S MAIL, counted as the inbox's To review tab counts
                it. A link: it goes to the inbox, narrowed to this project. */}
            <Link
              href={`/dashboard/inbox?project=${encodeURIComponent(project.id)}`}
              className={buttonClass("secondary", "sm", "no-underline")}
            >
              Inbox{inboxToReview !== null && <> {inboxToReview.toLocaleString()}</>}
            </Link>
            {/* FILL IN WHAT WE KNOW, BESIDE THE CHASE. The two are the same
                list with different controls on it — one records what somebody
                in this building already knows, the other asks the client for
                what is left — so they sit together and in that order. */}
            {summary.records > 0 && (
              <Link href={infillHref} className={buttonClass("secondary", "sm", "no-underline")}>
                Fill in ourselves
              </Link>
            )}
            {/* CHASE IS SECONDARY, AND IT GOES WHEN IT IS THE STEP. Two
                controls in one band leading to the same screen, one of them
                emphasised, reads as two different jobs. */}
            {step?.kind !== "waiting" && (
              <Link href={chaseHref} className={buttonClass("secondary", "sm", "no-underline")}>
                Chase {(activeTally ? activeTally.toQuote : summary.toQuote).toLocaleString()}
              </Link>
            )}
            {/* THE EXPORT IS NEVER FILTERED, so the cluster carries the scope
                of whatever is on screen and nothing else: this run on a run
                tab, the whole project everywhere else. */}
            {runs.length > 0 && (
              /* ONE PRIMARY PER BAND. The spec upload is normally the emphatic
                 control here; where a next step is also rendered, two black
                 controls sit side by side and neither reads as the thing to
                 do. The step wins — except when the step IS the export, which
                 is suppressed below, and then the cluster keeps it. */
              <ExportMenu
                projectId={project.id}
                runId={activeRun?.id ?? null}
                emphasis={!step || step.kind === "export"}
              />
            )}
            {/* THE NEXT STEP, LAST AND EMPHATIC. `export` is suppressed here
                and nowhere else: the export cluster is already in this band, so
                a second control saying the same thing would be the only place
                in the app with two primaries in one header. */}
            <NextStepAction step={step} suppress={["export"]} />
          </>
        }
        /* One tab per RUN. The same item code appears in several of them at
           different quantities, which is the whole reason they are separate.

           DOCUMENTS AND HISTORY ARE TABS TOO, and their CARDS stay on the
           Overview as well. A tab and a card are two ways to the same place,
           which costs nothing and is the point: which one you reach for depends
           on whether you already know where you are going. Both render the SAME
           JSX, held in one variable, so they cannot drift.

           FINISHES IS PROJECT-WIDE, like History and unlike a run: the same
           finish code is quoted on the mock-up, the main run and the VE, and
           correcting it corrects all of them.

           `AddRun` is the strip's trailing slot — a run with no bill behind it
           (0028), because until it existed a project could only be started by
           uploading a BOQ spreadsheet. */
        tabs={
          <Tabs
            label="Project sections"
            value={tab}
            onChange={setTab}
            items={[
              { id: "overview", label: "Overview", count: null },
              ...runs.map((run) => ({ id: run.id, label: run.name, count: Number(run.record_count) })),
              { id: "finishes", label: "Finishes", count: summary.finishes || null },
              { id: "documents", label: "Documents", count: documents?.length ? documents.length : null },
              { id: "history", label: "History", count: history.count },
            ]}
            trailing={
              <AddRun
                projectId={project.id}
                onAdded={async (runId) => {
                  await load();
                  setTab(runId);
                }}
              />
            }
          />
        }
      />

      {/* WIDE FOR A RUN, STANDARD EVERYWHERE ELSE. The spec table is a grid
          somebody works across and has columns that cannot be dropped; the
          Overview is reading and deciding. */}
      <PageBody width={activeRun ? "wide" : "std"}>
        {error && <Note tone="danger">{error}</Note>}

        {/* Says what archiving DID and did not do. A banner that only said
            "Archived" would read as a lock, and nothing here locks anything. */}
        {project.status === "archived" && (
          <Note
            tone="warn"
            actions={
              <Button size="xs" disabled={saving} onClick={() => void setArchived(false)}>
                {saving ? "Restoring…" : "Restore it"}
              </Button>
            }
          >
            This project is archived
            {project.archived_at && <> since {new Date(project.archived_at).toLocaleDateString()}</>}
            {project.archived_by && <> by {project.archived_by}</>}. It is hidden from the projects list. Everything
            on it is still editable, still exports, and nothing has been deleted.
          </Note>
        )}

        {/* Mounted only when selected: it loads the whole library and every item
            each code is on, which is not a query the Overview should be paying
            for on every visit. */}
        {tab === "finishes" && <FinishesLibrary projectId={project.id} initialQuery={finishQuery} />}

        <PhaseTabs
          projectId={project.id}
          runs={runs}
          tab={tab}
          initialFocus={initialFocus}
          onRunSummary={onRunSummary}
          onReload={load}
          onError={setError}
          onRetired={() => setTab("overview")}
        />

        {/* Each on its own tab, the same JSX the Overview renders. */}
        {tab === "documents" && documentsCard}
        {tab === "history" && historyCard}

        <div className={tab === "overview" ? "" : "hidden"}>
          {/* ==================================================================
              THE PROJECT, AS A SUMMARY. Filled in once, then read.

              It was a form of nine inputs and three captions, first and largest
              on the screen, above everything a person comes here for. The FORM
              is unchanged and still below — with its validation, its date rules
              and its unsaved-changes warning — it just does not open until
              somebody asks for it, and it saves as ONE act.

              The captions are gone. Where a field carries a rule worth knowing
              it gets a `?` you hover; where its ABSENCE would look identical to
              being fine it stays on the page in words, which is why the
              no-programme notice is still printed and not a tip.
              ================================================================== */}
          <ProjectDetailsCard project={project} onSaved={setProject} onError={setError} />

          {/* ==================================================================
              THE NUMBERS, AND EACH ONE PRESSABLE.

              The strip answers CAN I QUOTE THIS; the table under it answers WHAT
              IS STOPPING ME, one actionable row at a time, with the control
              beside the figure rather than on a screen you have to go and find.
              ================================================================== */}
          {completion.records > 0 && (
            <>
              <div
                className={`mt-4 grid grid-cols-2 gap-2.5 ${summary.disagreements > 0 ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}
              >
                <StatTile
                  label="Line items"
                  value={summary.records}
                  meaning={`${runs.length} phase${runs.length === 1 ? "" : "s"}`}
                  href={firstRunHref}
                />
                {/* ==========================================================
                    THESE THREE COUNT LINE ITEMS, AND THEY DO NOT ADD UP.

                    Asked for on 2026-09-21 on a 503-line project, where they
                    read 8,769 / 10,841 / 65: "these numbers are so high,
                    they're just meaningless." The question count stays on the
                    sub-line, because it is worth having and because it is what
                    the chase actually asks.

                    Two things every one of them has to say, or the strip
                    trades one misleading reading for another:

                      - WHICH POPULATION. An uncategorised record has no
                        questions, so it is in none of these. `Line items` is
                        503 and these are over the 408 with a category.
                      - THAT THEY OVERLAP. An item clear at TGQ can still carry
                        other questions, so it is counted twice. The caption
                        under the strip says so in words.

                    The placeholder sentence deliberately LEFT this tile: with
                    an item count as the big number, "166 items still on the
                    placeholder" underneath it reads as the same measure when
                    it is a different one (which TGQ MODEL applies, not what is
                    outstanding). It is said in full in the note and the TGQ
                    row of the table below.
                    ========================================================== */}
                <StatTile
                  label="TGQ"
                  tone="danger"
                  value={summary.toQuoteItems}
                  // ITEM QUESTIONS, with the project-wide ones apart — they
                  // are answered once, on the card below, not per item.
                  meaning={`of ${summary.itemsWithQuestions.toLocaleString()} items · ${summary.toQuote.toLocaleString()} to answer on the items${
                    summary.projectWide > 0 ? ` · ${summary.projectWide} project-wide` : ""
                  }`}
                  href={firstRunHref}
                />
                <StatTile
                  label="Also outstanding"
                  tone="warn"
                  value={summary.alsoOutstandingItems}
                  meaning={`of ${summary.itemsWithQuestions.toLocaleString()} items · ${summary.missing.toLocaleString()} unlooked, ${summary.tbc.toLocaleString()} TBC`}
                  href={firstRunHref}
                />
                <StatTile
                  label="Settled"
                  tone="good"
                  value={summary.settledItems}
                  meaning={`of ${summary.itemsWithQuestions.toLocaleString()} items, nothing left on them`}
                />
                <StatTile
                  label="Finishes"
                  tone="info"
                  value={summary.finishes}
                  meaning={
                    unlinkedFinishCodes.length > 0
                      ? `${unlinkedFinishCodes.length} code${unlinkedFinishCodes.length === 1 ? "" : "s"} not in the library`
                      : summary.finishes === 0
                        ? "none in the library yet"
                        : summary.finishesNoKind > 0
                          ? `${summary.finishesNoKind} with no kind`
                          : "all filed under a kind"
                  }
                  href={finishesHref}
                />
                {/* ======================================================
                    TWO DOCUMENTS DISAGREE, AND NOBODY HAS DECIDED (0046).

                    Max, 2026-10-05: "highlight them in red just to show that
                    there's big disagreement and flag it up somewhere". The
                    bill's value stands until a person decides; this is the
                    somewhere. Red, and ABSENT at zero — a tile reading 0 on
                    every project is a red box people learn to read past. It
                    lands on the phase holding the first one, already filtered
                    to the items that disagree, the way every other tile here
                    lands on the table. Counted by src/lib/disagreements.ts,
                    the loader the table and the record read.
                    ====================================================== */}
                {summary.disagreements > 0 && (
                  <StatTile
                    label="Documents disagree"
                    tone="danger"
                    value={summary.disagreements}
                    meaning={`disagreement${summary.disagreements === 1 ? "" : "s"} between documents`}
                    href={
                      summary.disagreementRunId
                        ? `/dashboard/projects/${project.id}?tab=${summary.disagreementRunId}&focus=disagree`
                        : firstRunHref
                          ? `${firstRunHref}&focus=disagree`
                          : null
                    }
                  />
                )}
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">
                Pressing a tile opens the spec table already filtered to it. TGQ, Also outstanding and Settled count
                LINE ITEMS, out of the {summary.itemsWithQuestions.toLocaleString()} that have a category — an item
                can be in two of them, so they do not add up.
              </p>
            </>
          )}

          <Card
            title={
              <>
                Specifications
                <Tip>
                  Counted over what the export ships: active records on live phases, a split bill line counted through
                  its configurations.
                </Tip>
              </>
            }
            flush
            actions={
              firstRunHref ? (
                <Link
                  href={firstRunHref}
                  className="text-[12px] font-medium normal-case tracking-normal text-blue-700 no-underline hover:underline"
                >
                  Spec table
                </Link>
              ) : undefined
            }
          >
            {completion.records === 0 ? (
              <p className="px-4 py-3 text-sm text-neutral-700">
                Nothing imported yet. A bill of quantities is what creates this project&rsquo;s records.
              </p>
            ) : (
              <>
                {/* THE TGQ SET HAS NEVER BEEN NARROWED, AND THE SCREEN SAYS SO.
                    `tgq_levels` is still at 0019's seeded default — all three
                    levels on all 728 questions — so for a category Matthew has
                    not written a gate model for, "needed to quote" is
                    arithmetically the same number as "outstanding". Printing it
                    in red as though it were a measurement is the
                    confidently-wrong figure this app exists to avoid, so where
                    it is a placeholder it is labelled one. */}
                {summary.tgqFromFallback > 0 && (
                  <Note tone="warn" className="mx-4 mt-3">
                    <b className="font-semibold">
                      {summary.tgqFromFallback} of these {summary.tgqFromMatrix + summary.tgqFromFallback} items are
                      in a category Matthew has not written a gate model for
                    </b>
                    , so their TGQ is still the placeholder — every outstanding question on them counts as blocking.
                    The other {summary.tgqFromMatrix} use his matrix. The figure will only ever come down.
                  </Note>
                )}
                <Table>
                  <tbody>
                    {/* TGQ, NOT "needed to quote". They are the same question —
                        settled on 2026-09-18 — and two names for it is how a
                        reader comes to believe they are two measurements.

                        IN ITEMS, like every other row of this table. It used to
                        print the QUESTION count while No category, No level and
                        Unresolved finish codes beside it were all per item,
                        which made the one number in the middle read as a fifth
                        measure. Asked for in the same breath as the tiles:
                        "can it be TGQ referencing line items, not individual
                        questions?" The questions are still named, on the
                        meaning line, because that is what a chase asks for. */}
                    <SummaryRow
                      label="TGQ"
                      tone="danger"
                      count={summary.toQuoteItems}
                      href={chaseHref}
                      meaning={
                        <>
                          Items with something still blocking a quotation, of the{" "}
                          {summary.itemsWithQuestions.toLocaleString()} that have a category —{" "}
                          {summary.toQuote.toLocaleString()} to answer between them (questions, and on
                          Matthew&rsquo;s matrix also dimension slots and record columns)
                          {summary.projectWide > 0 && (
                            <>
                              , and{" "}
                              <a href="#project-wide" className="text-blue-700 no-underline hover:underline">
                                {summary.projectWide} project-wide
                              </a>{" "}
                              answered once for every item
                            </>
                          )}
                          .
                          {summary.tgqFromFallback > 0 &&
                            ` His matrix for ${summary.tgqFromMatrix} items, the placeholder for ${summary.tgqFromFallback}.`}
                        </>
                      }
                      action={
                        <>
                          <Link href={chaseHref} className={buttonClass("secondary", "xs", "no-underline")}>
                            Chase them
                          </Link>
                          <Link href={chaseHref} className={buttonClass("quiet", "xs", "no-underline")}>
                            By contact
                          </Link>
                        </>
                      }
                    />
                    <SummaryRow
                      label="No category"
                      tone="warn"
                      count={summary.uncategorised}
                      href={firstRunHref}
                      meaning="No questions at all, so they score zero outstanding."
                      action={
                        firstRunHref ? (
                          <Link href={firstRunHref} className={buttonClass("secondary", "xs", "no-underline")}>
                            Set the {summary.uncategorised}
                          </Link>
                        ) : null
                      }
                    />
                    {/* NOT "missing from the figure above" any more, and the
                        distinction is the whole point of the hybrid: Matthew's
                        matrix is per category and carries no level column, so a
                        level-less record in a covered category is tiered
                        perfectly well. The level still decides the placeholder
                        half, and it still picks the BWS boilerplate. */}
                    <SummaryRow
                      label="No level"
                      tone="warn"
                      count={summary.noLevel}
                      href={firstRunHref}
                      meaning={
                        <>
                          Needed by the{" "}
                          {summary.tgqFromFallback > 0 ? "placeholder half of TGQ and by the " : ""}
                          BWS boilerplate.
                          {summary.levelSuggested > 0 && ` ${summary.levelSuggested} have a suggestion.`}
                        </>
                      }
                      action={
                        <>
                          {summary.levelSuggested > 0 && (
                            <Button size="xs" disabled={acceptingLevels} onClick={() => void acceptLevels()}>
                              {acceptingLevels ? "Accepting…" : `Accept ${summary.levelSuggested}`}
                            </Button>
                          )}
                          {firstRunHref && (
                            <Link href={firstRunHref} className={buttonClass("quiet", "xs", "no-underline")}>
                              Review
                            </Link>
                          )}
                        </>
                      }
                    />
                    {/* A CODE A DRAWING CARRIES THAT THE LIBRARY HAS NEVER HEARD
                        OF. Named, never counted: an unlinked code is a job, and
                        a number is a notification. */}
                    <SummaryRow
                      label="Unresolved finish codes"
                      tone="warn"
                      count={unlinkedFinishCodes.length}
                      href={finishesHref}
                      meaning={
                        unlinkedFinishCodes.length === 0 ? (
                          "Every code a drawing carries is in the library."
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {unlinkedFinishCodes.slice(0, 6).map((row) => (
                              <Link key={row.code} href={finishesHref} className="no-underline">
                                <Chip mono>{row.code}</Chip>
                              </Link>
                            ))}
                            {unlinkedFinishCodes.length > 6 && (
                              <span className="text-neutral-500">and {unlinkedFinishCodes.length - 6} more</span>
                            )}
                          </span>
                        )
                      }
                      action={
                        <Link href={finishesHref} className={buttonClass("secondary", "xs", "no-underline")}>
                          Bring them in
                        </Link>
                      }
                    />
                    <SummaryRow
                      label="Documents that failed to read"
                      tone="danger"
                      count={failedDocuments}
                      href={firstPackHref}
                      meaning="The queue refused them. Everything else read itself on arrival."
                      action={
                        firstPackHref ? (
                          <Link href={firstPackHref} className={buttonClass("secondary", "xs", "no-underline")}>
                            Try again
                          </Link>
                        ) : null
                      }
                    />
                    {summary.documentsReading > 0 && (
                      <SummaryRow
                        label="Still being read"
                        tone="info"
                        count={summary.documentsReading}
                        meaning="Dispatched on arrival and running now. Nothing to do."
                      />
                    )}
                  </tbody>
                </Table>
              </>
            )}
          </Card>

          {/* PROJECT-WIDE QUESTIONS, ANSWERED ONCE (Max, 2026-10-12). They do
              not count in any item's TGQ and still block every quote, so they
              live here, beside the project's own numbers — and every screen
              that says "+n project-wide" links to this anchor. */}
          {completion.records > 0 && <ProjectWideCard projectId={project.id} onChanged={() => void refreshNumbers()} />}

          {documentsCard}

          <Card
            title={
              <>
                Contacts
                <Tip>
                  The designer code matches the BOQ&rsquo;s own wording, and is what ties a record&rsquo;s questions
                  to a person.
                </Tip>
              </>
            }
            flush
            actions={
              <>
                <Link
                  href={chaseHref}
                  className="text-[12px] font-medium normal-case tracking-normal text-blue-700 no-underline hover:underline"
                >
                  Chase what is missing
                </Link>
                <Button size="xs" onClick={() => setAddingContact((open) => !open)}>
                  {addingContact ? "Close" : "Add"}
                </Button>
              </>
            }
          >
            {contacts === null ? (
              <div className="p-4"><Spinner label="Loading contacts" /></div>
            ) : (
              <ContactsPanel
                projectId={project.id}
                contacts={contacts}
                outstanding={contactsOutstanding}
                codeCounts={codeCounts}
                adding={addingContact}
                onAddingChange={setAddingContact}
                suggestedCodes={suggestedCodes.filter(
                  (code) => !contacts.some((contact) => contact.designerCode === code),
                )}
                onChanged={() => {
                  void loadContacts();
                  void load();
                  void loadContactsOutstanding();
                }}
              />
            )}
          </Card>

          {/* VERSIONS, ON THE PAGE. It was a tab, and a tab is a place you have
              to decide to go to — whereas "what did this look like last week" is
              a question asked while looking at the thing. */}
          {historyCard}

          {/* What the preamble said the whole package is built under. LAST on
              this screen, because it is reference material: a reader scrolls to
              it when they want it, and it is the longest thing here by far.
              Retired, never deleted — a mis-read note is still evidence that
              somebody looked. */}
          <NotesCard projectId={project.id} notes={notes} onError={setError} onChanged={load} />

          {/* ARCHIVING IS THE LAST THING ON THE PAGE, on its own, and it is a
              `danger` button because it changes what the projects list shows.
              The EXPORT used to be beside it in a card called "Export and
              archive", which put the file this app exists to produce next to
              the control that hides the project; the outputs are in the header
              band now, where every screen's actions are. */}
          {project.status === "active" && (
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
              <Button
                variant="danger"
                size="sm"
                disabled={saving}
                onClick={() => void setArchived(true)}
                title="Hides it from the projects list. Nothing is deleted and nothing becomes read-only."
              >
                {saving ? "Archiving…" : "Archive this project"}
              </Button>
              <span className="text-xs text-neutral-500">
                Hides it from the list and changes nothing else. Nothing here can be deleted, because a record is the
                only place a client ref maps to a BWS job.
              </span>
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}

// `useSearchParams` needs a Suspense boundary in the App Router, and the whole
// screen sits inside it because the parameter decides which tab renders.
export default function ProjectOverviewPage() {
  return (
    <Suspense fallback={<PageBody><Spinner label="Loading project" /></PageBody>}>
      <ProjectOverview />
    </Suspense>
  );
}
