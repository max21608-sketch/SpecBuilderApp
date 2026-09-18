"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import Button, { buttonClass } from "@/components/ui/Button";
import {
  completionSentence,
  PROJECT_STATE_LABELS,
  PROJECT_STATE_TONE,
  type ProjectCompletion,
  type ProjectState,
} from "@/lib/project-completion";
import { EMPTY_SUMMARY, type ProjectSummary } from "@/lib/project-summary";
import { daysUntilSpecsAgreed, todayLocal } from "@/lib/project-programme";
import Tip from "@/components/ui/Tip";
import Pill from "@/components/ui/Pill";
import StatTile from "@/components/ui/StatTile";
import PageBody from "@/components/ui/PageBody";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/lib/use-url-tab";
import { formatDay } from "@/lib/format-day";
import PageHeader from "@/components/ui/PageHeader";
import { Table, Th, Td, Tr } from "@/components/ui/Table";

type Project = {
  id: string;
  bws_project_number: string;
  name: string;
  client: string | null;
  record_count: string;
  status: string;
  archived_at: string | null;
  archived_by: string | null;
  specs_agreed_by: string | null;
  run_count: string;
  /** Questions asked and not yet answered. Derived; see loadOutstanding. */
  waiting: number;
  /** Derived on the server; see src/lib/project-completion.ts. */
  completion: ProjectCompletion;
  /** The same numbers the project page shows. See src/lib/project-summary.ts. */
  summary: ProjectSummary;
  state: ProjectState;
};

/** The tabs across the top. `all` is every project whatever its state. */
type StateTab = ProjectState | "all";

const TAB_LABELS: Record<StateTab, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
  all: "All",
};

/**
 * The specs-agreed-by date, and whether it has passed.
 *
 * NO PROGRAMME IS NOT ON TIME. A project with no date renders identically to a
 * healthy one unless it says so, which is why the empty case is words rather
 * than a blank cell — the same rule the project page's amber notice follows.
 *
 * Compared as `YYYY-MM-DD` STRINGS via the shared helper. These are `date`
 * columns, both drivers parse one into local midnight, and `toISOString()` then
 * renders the day BEFORE it in British Summer Time.
 */
function Programme({ day }: { day: string | null }) {
  const none = (
    <span className="text-neutral-400">
      no programme
      <Tip>
        Nothing on this project can be flagged overdue until this date is set. That is not the same as being on
        time.
      </Tip>
    </span>
  );
  if (!day) return none;
  const days = daysUntilSpecsAgreed(day, todayLocal());
  if (days === null) return none;
  return (
    <span className={days < 0 ? "text-red-700" : "text-neutral-700"}>
      {formatDay(day)}
      <span
        className={`ml-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
          days < 0
            ? "border-red-200 bg-red-50 text-red-700"
            : days <= 14
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-neutral-200 bg-neutral-50 text-neutral-500"
        }`}
      >
        {days < 0
          ? `${-days} day${days === -1 ? "" : "s"} over`
          : days === 0
            ? "today"
            : `${days} day${days === 1 ? "" : "s"}`}
      </span>
    </span>
  );
}

const STATE_TABS = ["active", "completed", "archived", "all"] as const;

function ProjectsView() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [unplacedMail, setUnplacedMail] = useState(0);
  /**
   * WHICH TAB, IN THE URL. Active by default — the point of archiving is that a
   * finished project stops being in the way — but every project is LOADED
   * whatever the tab, because the tabs carry counts and a count of what you are
   * not looking at cannot be derived from the rows you are.
   */
  const [tab, setTab] = useUrlTab<StateTab>({
    fallback: "active",
    resolve: (raw) => (STATE_TABS.includes(raw as StateTab) ? (raw as StateTab) : null),
  });
  /** Which tile is pressed, if any. Narrows the list and nothing else. */
  const [focus, setFocus] = useState<null | "to_quote" | "overdue" | "waiting">(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ projects: Project[]; archivedCount: number; unplacedMail: number }>(
      "/api/projects?includeArchived=true",
    );
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setProjects(res.data.projects);
    setUnplacedMail(res.data.unplacedMail ?? 0);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bwsProjectNumber: number, name, client }),
      });
      if (!res.ok) { setError(res.error); return; }
      setNumber(""); setName(""); setClient("");
      // Close on success. The new project is in the list below, which is what
      // somebody wants to see next; leaving three empty inputs open in front of
      // it says the add did not happen.
      setAdding(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  // Client-side, over the three things somebody actually types: the BWS
  // number, the project name and the client. A server round trip per keystroke
  // would buy nothing on a list this size.
  /** How many projects each tab holds. Over EVERY project, never the listed ones. */
  const tabCounts = useMemo(() => {
    const all = projects ?? [];
    return {
      active: all.filter((project) => project.state === "active").length,
      completed: all.filter((project) => project.state === "completed").length,
      archived: all.filter((project) => project.state === "archived").length,
      all: all.length,
    } satisfies Record<StateTab, number>;
  }, [projects]);

  const shown = useMemo(() => {
    if (!projects) return projects;
    const term = search.trim().toLowerCase();
    const today = todayLocal();
    return projects.filter((project) => {
      if (tab !== "all" && project.state !== tab) return false;
      if (term && !`${project.bws_project_number} ${project.name} ${project.client ?? ""}`.toLowerCase().includes(term)) {
        return false;
      }
      if (focus === "to_quote") return (project.summary ?? EMPTY_SUMMARY).toQuote > 0;
      if (focus === "waiting") return (project.waiting ?? 0) > 0;
      if (focus === "overdue") {
        const days = project.specs_agreed_by ? daysUntilSpecsAgreed(project.specs_agreed_by, today) : null;
        return days !== null && days < 0;
      }
      return true;
    });
  }, [projects, search, tab, focus]);

  /**
   * The strip at the top, over the rows that are LISTED.
   *
   * Computed from the same payload the table renders, so a total can never
   * describe a different set from the rows under it — the filter's own rule,
   * applied to a summary.
   */
  const totals = useMemo(() => {
    const rows = shown ?? [];
    const today = todayLocal();
    let toQuote = 0;
    let waiting = 0;
    let overdue = 0;
    let withWork = 0;
    for (const project of rows) {
      const summary = project.summary ?? EMPTY_SUMMARY;
      toQuote += summary.toQuote;
      waiting += project.waiting ?? 0;
      if (summary.toQuote > 0) withWork += 1;
      const days = project.specs_agreed_by ? daysUntilSpecsAgreed(project.specs_agreed_by, today) : null;
      if (days !== null && days < 0) overdue += 1;
    }
    return { toQuote, waiting, overdue, withWork };
  }, [shown]);

  return (
    <>
      {/* THE FIRST ADOPTER OF `PageHeader`. Where you are, what this is, and
          what you came to do — in that order, in the band, at 1100 wide
          whatever the body under it does.

          STATE IS A TAB, NOT A CHECKBOX, and it belongs to the page's identity
          rather than its content, which is why it is in the band. Archived used
          to be opt-in through a tick box beside the search, which hid Completed
          entirely — it had nowhere to be. Every project is loaded whatever the
          tab, because a tab's count cannot be derived from the rows you are
          already looking at. */}
      <PageHeader
        title="Projects"
        subtitle="Everything in the spec builder, and what each one is waiting on."
        actions={
          // COLLAPSED. It stays ABOVE the list when open, for the reason it was
          // moved here — on a new deployment adding a project is the first
          // thing anybody does, and it used to be below however many projects
          // already existed. But on a deployment that HAS projects it is a form
          // of three inputs in front of the work, every visit.
          <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding((open) => !open)}>
            {adding ? "Cancel" : "Add a project"}
          </Button>
        }
        tabs={
          <Tabs
            label="Project state"
            value={tab}
            onChange={setTab}
            items={STATE_TABS.map((name) => ({ id: name, label: TAB_LABELS[name], count: tabCounts[name] }))}
          />
        }
      />
      <PageBody>
      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {/* ABOVE the list. Adding a project is the first thing somebody does on a
          new deployment, and the form was previously below however many
          projects already existed -- off the bottom of the screen exactly when
          the list was long enough to make it hard to find. */}
      <form
        onSubmit={create}
        className={`mt-6 border border-neutral-200 rounded-lg bg-white p-4 ${adding ? "" : "hidden"}`}
      >
        <h2 className="font-medium text-neutral-900">Add a project</h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="P17231"
                 className="border border-neutral-300 rounded px-3 py-2 text-sm" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name"
                 className="border border-neutral-300 rounded px-3 py-2 text-sm" />
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client (optional)"
                 className="border border-neutral-300 rounded px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={saving}
                className="mt-3 text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50">
          {saving ? "Adding…" : "Add project"}
        </button>
      </form>

      {/* TOTALS ACROSS WHAT IS LISTED, computed from the rows already loaded —
          no second request, and no number here that the table below cannot be
          made to show. "Across N projects" is stated, because a total over a
          filtered list that did not say so would be read as a total over the
          business. */}
      {(projects ?? []).length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatTile
            label="TGQ"
            tone={totals.toQuote > 0 ? "danger" : "good"}
            value={totals.toQuote}
            meaning={`across ${totals.withWork} project${totals.withWork === 1 ? "" : "s"}`}
            action={totals.withWork > 0 ? "show those projects" : undefined}
            onPress={totals.withWork > 0 ? () => setFocus(focus === "to_quote" ? null : "to_quote") : undefined}
            active={focus === "to_quote"}
          />
          <StatTile
            label="Overdue"
            tone={totals.overdue > 0 ? "danger" : "plain"}
            value={totals.overdue}
            meaning="past specs-agreed-by"
            action={totals.overdue > 0 ? "show them" : undefined}
            onPress={totals.overdue > 0 ? () => setFocus(focus === "overdue" ? null : "overdue") : undefined}
            active={focus === "overdue"}
          />
          <StatTile
            label="Waiting on a reply"
            tone="info"
            value={totals.waiting}
            meaning="chases sent, nothing back"
            action={totals.waiting > 0 ? "show them" : undefined}
            onPress={totals.waiting > 0 ? () => setFocus(focus === "waiting" ? null : "waiting") : undefined}
            active={focus === "waiting"}
          />
          {/* BELONGS TO NO PROJECT, by definition — which is exactly why it is
              here. Unplaced mail is the one state in the app that silently
              stops work: the sender believes they have told us, and no project
              screen says otherwise. So it is a link out to the inbox rather
              than a filter on this list. */}
          <StatTile
            label="Unplaced mail"
            tone={unplacedMail > 0 ? "warn" : "plain"}
            value={unplacedMail}
            meaning="could not be auto-assigned"
            href="/dashboard/inbox"
            action="open the inbox"
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search a number, a name, or a client"
          className="border border-neutral-300 rounded px-3 py-2 text-sm w-72"
        />
        {focus !== null && (
          <Button size="xs" variant="quiet" onClick={() => setFocus(null)}>
            Clear the filter
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-sm text-neutral-500">
          {(shown ?? []).length} project{(shown ?? []).length === 1 ? "" : "s"}
        </span>
      </div>

      {projects === null ? (
        <div className="mt-4"><Spinner label="Loading projects" /></div>
      ) : (shown ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          {search.trim() || focus !== null
            ? "No project matches that."
            : tab === "all"
              ? "No projects yet. Add one, then open it to import its BOQ."
              : `Nothing ${TAB_LABELS[tab].toLowerCase()}. Try another tab, or add a project.`}
        </p>
      ) : (
        /* NOT `overflow-hidden`, which is the rounding-versus-a-row trade
           `Table.tsx` records: it makes the wrapper the sticky scroll container
           and the header then covers a row nobody would know to look for. */
        <div className="mt-4 rounded-[10px] border border-neutral-200 bg-white">
          <Table>
            <thead>
              <tr>
                <Th className="w-[11%]">Number</Th>
                <Th className="w-[23%]">Project</Th>
                <Th className="w-[14%]">Client</Th>
                <Th num className="w-[8%]">Items</Th>
                <Th num className="w-[11%]">
                  TGQ
                  <Tip>
                    Questions blocking a quotation. Matthew&rsquo;s matrix where he has written one for the
                    category, the older per-level model where he has not.
                  </Tip>
                </Th>
                <Th className="w-[15%]">
                  Specs agreed by
                  <Tip>The gate before drawings can be issued, and the date Overdue is measured against.</Tip>
                </Th>
                <Th className="w-[10%]">State</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(shown ?? []).map((project) => (
                <Tr key={project.id} className={project.status === "archived" ? "bg-neutral-50" : ""}>
                  {/* THE NUMBER IS ITS OWN COLUMN, and monospace. It is what
                      people say out loud and what every export is labelled
                      with, and a number glued to a name with an em dash is a
                      column you cannot scan. */}
                  <Td>
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="font-mono text-[13px] font-semibold text-blue-700 no-underline hover:underline"
                    >
                      {project.bws_project_number}
                    </Link>
                  </Td>
                  <Td>
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="text-blue-700 no-underline hover:underline"
                    >
                      {project.name}
                    </Link>
                    {/* What the project IS MADE OF, under its name. A run count
                        is the first thing that tells you whether a bill has
                        been through at all. */}
                    <p className="text-xs text-neutral-500">
                      {(project.summary ?? EMPTY_SUMMARY).records === 0 ? (
                        "nothing imported yet"
                      ) : (
                        <>
                          {project.run_count} run{Number(project.run_count) === 1 ? "" : "s"} ·{" "}
                          {(project.summary ?? EMPTY_SUMMARY).finishes} finish
                          {(project.summary ?? EMPTY_SUMMARY).finishes === 1 ? "" : "es"}
                        </>
                      )}
                      {project.status === "archived" && project.archived_at && (
                        <> · archived {formatDay(String(project.archived_at).slice(0, 10))}</>
                      )}
                    </p>
                  </Td>
                  <Td className="text-neutral-700">
                    {project.client ?? <span className="text-neutral-400">none recorded</span>}
                  </Td>
                  {/* THE EXPORT'S SCOPE, not every row in spec_records. The raw
                      count includes split bill lines (which are headings, and
                      whose configurations are what ships) and retired records,
                      so it read 52 beside a TGQ figure computed over 45. Two
                      numbers on one row describing different sets of records is
                      the check sheet's own failure mode. */}
                  <Td num className="text-neutral-700">
                    {(project.summary ?? EMPTY_SUMMARY).records}
                  </Td>
                  {/* THE NUMBER THAT DECIDES WHAT YOU DO TODAY, and the reason
                      this screen is a table at all. Red because it blocks money
                      going out, and a link rather than a figure, because
                      reading it is never the end of the errand. */}
                  <Td num>
                    {(project.summary ?? EMPTY_SUMMARY).records === 0 ? (
                      <span className="text-neutral-400">—</span>
                    ) : (project.summary ?? EMPTY_SUMMARY).toQuote === 0 ? (
                      <span className="font-semibold tabular-nums text-green-700">0</span>
                    ) : (
                      <Link
                        href={`/dashboard/drafts?projectId=${project.id}`}
                        className="font-semibold tabular-nums text-red-700 no-underline hover:underline"
                      >
                        {(project.summary ?? EMPTY_SUMMARY).toQuote.toLocaleString()}
                      </Link>
                    )}
                  </Td>
                  {/* OVERDUE IS STATED, NEVER WORKED OUT BY THE READER — and a
                      project with NO programme says so, because an empty
                      programme rendering as healthy is the error worth
                      preventing. */}
                  <Td className="text-xs">
                    <Programme day={project.specs_agreed_by} />
                  </Td>
                  <Td>
                    {/* COMPLETED arrives on its own, so the pill has to be
                        able to say what is still outstanding under ACTIVE. */}
                    <Pill
                      tone={PROJECT_STATE_TONE[project.state]}
                      title={completionSentence(project.completion) ?? "Every question on every record is settled."}
                    >
                      {PROJECT_STATE_LABELS[project.state]}
                    </Pill>
                  </Td>
                  {/* THE TWO THINGS YOU LEAVE THIS SCREEN TO DO, quiet: the
                      project's NAME is the way in, and two filled buttons a row
                      compete with it for the eye. `quiet` is the per-row variant
                      for exactly this — bordered on hover, still a hit area.
                      Spec table is gone from here because the name goes there
                      anyway; Export is the one thing the name does NOT reach. */}
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/dashboard/drafts?projectId=${project.id}`}
                        className={buttonClass("quiet", "xs", "no-underline")}
                      >
                        Chase
                      </Link>
                      <a
                        href={`/api/projects/${project.id}/export`}
                        className={buttonClass("quiet", "xs", "no-underline")}
                      >
                        Export
                      </a>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </PageBody>
    </>
  );
}

// `useUrlTab` reads `useSearchParams`, which Next requires to sit under a
// Suspense boundary or the whole route opts out of static rendering with a
// build warning.
export default function ProjectsPage() {
  return (
    <Suspense fallback={<PageBody><Spinner label="Loading projects" /></PageBody>}>
      <ProjectsView />
    </Suspense>
  );
}
