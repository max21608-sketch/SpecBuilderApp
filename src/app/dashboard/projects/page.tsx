"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import Button, { buttonClass } from "@/components/ui/Button";
import {
  completionSentence,
  PROJECT_STATE_LABELS,
  type ProjectCompletion,
  type ProjectState,
} from "@/lib/project-completion";
import { EMPTY_SUMMARY, type ProjectSummary } from "@/lib/project-summary";
import { SPECS_AGREED_LABEL, daysUntilSpecsAgreed, todayLocal } from "@/lib/project-programme";
import Tip from "@/components/ui/Tip";
import StatTile from "@/components/ui/StatTile";

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
  /** Derived on the server; see src/lib/project-completion.ts. */
  completion: ProjectCompletion;
  /** The same numbers the project page shows. See src/lib/project-summary.ts. */
  summary: ProjectSummary;
  state: ProjectState;
};

/** ACTIVE green, COMPLETED blue, ARCHIVED grey — the state, at a glance. */
const STATE_PILL: Record<ProjectState, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-sky-100 text-sky-800 border-sky-200",
  archived: "bg-neutral-100 text-neutral-600 border-neutral-300",
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
  if (!day) return <span className="text-neutral-400">no programme</span>;
  const days = daysUntilSpecsAgreed(day, todayLocal());
  if (days === null) return <span className="text-neutral-400">no programme</span>;
  if (days < 0) {
    return (
      <span className="text-red-700">
        {day}
        <span className="ml-1 rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[10px] font-semibold">
          {-days} day{days === -1 ? "" : "s"} over
        </span>
      </span>
    );
  }
  return (
    <span className="text-neutral-700">
      {day}
      <span
        className={`ml-1 rounded border px-1 py-0.5 text-[10px] font-semibold ${
          days <= 14 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-neutral-200 bg-neutral-50 text-neutral-500"
        }`}
      >
        {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}
      </span>
    </span>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [archivedCount, setArchivedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // Opt-in. The point of archiving is that a finished project stops being in
  // the way, so the default list is the work in front of somebody.
  const [includeArchived, setIncludeArchived] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ projects: Project[]; archivedCount: number }>(
      `/api/projects${includeArchived ? "?includeArchived=true" : ""}`,
    );
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setProjects(res.data.projects);
    setArchivedCount(res.data.archivedCount ?? 0);
  }, [includeArchived]);

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
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term || !projects) return projects;
    return projects.filter((project) =>
      `${project.bws_project_number} ${project.name} ${project.client ?? ""}`.toLowerCase().includes(term),
    );
  }, [projects, search]);

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
    let settled = 0;
    let overdue = 0;
    let noProgramme = 0;
    let withWork = 0;
    for (const project of rows) {
      const summary = project.summary ?? EMPTY_SUMMARY;
      toQuote += summary.toQuote;
      settled += summary.settled;
      if (summary.toQuote > 0) withWork += 1;
      const days = project.specs_agreed_by ? daysUntilSpecsAgreed(project.specs_agreed_by, today) : null;
      if (days === null) noProgramme += 1;
      else if (days < 0) overdue += 1;
    }
    return { toQuote, settled, overdue, noProgramme, withWork };
  }, [shown]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">Projects</h1>
        <span className="flex-1" />
        {/* COLLAPSED. It stays ABOVE the list when open, for the reason it was
            moved here — on a new deployment adding a project is the first thing
            anybody does, and it used to be below however many projects already
            existed. But on a deployment that HAS projects it is a form of three
            inputs in front of the work, every visit. */}
        <Button variant={adding ? "secondary" : "primary"} onClick={() => setAdding((open) => !open)}>
          {adding ? "Cancel" : "Add a project"}
        </Button>
      </div>

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
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile
            label="TGQ, all projects"
            tone={totals.toQuote > 0 ? "danger" : "good"}
            value={totals.toQuote}
            meaning={`across ${totals.withWork} project${totals.withWork === 1 ? "" : "s"}`}
          />
          <StatTile
            label="Overdue"
            tone={totals.overdue > 0 ? "danger" : "plain"}
            value={totals.overdue}
            meaning="past the specs-agreed date"
          />
          <StatTile
            label="No programme"
            tone={totals.noProgramme > 0 ? "warn" : "plain"}
            value={totals.noProgramme}
            meaning="cannot be flagged overdue at all"
          />
          <StatTile
            label="Settled"
            tone="good"
            value={totals.settled}
            meaning="questions confirmed or N/A"
          />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search projects"
          className="border border-neutral-300 rounded px-3 py-2 text-sm w-64"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Show archived ({archivedCount})
        </label>
      </div>

      {projects === null ? (
        <div className="mt-4"><Spinner label="Loading projects" /></div>
      ) : (shown ?? []).length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          {search.trim()
            ? "No project matches that."
            : includeArchived
              ? "No projects yet. Add one above, then open it to import its BOQ."
              : "Nothing active. Add a project above, or tick Show archived to see finished ones."}
        </p>
      ) : (
        <div className="mt-4 border border-neutral-200 rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium text-right">Items</th>
                <th className="px-4 py-2 font-medium text-right">
                  TGQ
                  <Tip>
                    Questions blocking a quotation. Matthew&rsquo;s matrix where he has written one for the
                    category, the older per-level model where he has not.
                  </Tip>
                </th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">
                  Specs by
                  <Tip>{`${SPECS_AGREED_LABEL}. The gate before drawings can be issued, and the date Overdue is measured against.`}</Tip>
                </th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {(shown ?? []).map((project) => (
                <tr key={project.id} className={project.status === "archived" ? "bg-neutral-50" : ""}>
                  <td className="px-4 py-3">
                    {/* The name IS the way in. The row used to carry an
                        "Overview" button pointing at the same place, which
                        read as though one of the two went somewhere else. */}
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="font-medium text-neutral-900 underline hover:text-neutral-600"
                    >
                      {project.bws_project_number} — {project.name}
                    </Link>
                    {project.status === "archived" && project.archived_at && (
                      <p className="text-xs text-neutral-500">
                        archived {new Date(project.archived_at).toLocaleDateString()}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-neutral-700">
                    {project.client ?? <span className="text-neutral-400">none recorded</span>}
                  </td>
                  {/* THE EXPORT'S SCOPE, not every row in spec_records. The raw
                      count includes split bill lines (which are headings, and
                      whose configurations are what ships) and retired records,
                      so it read 52 beside a TGQ figure computed over 45. Two
                      numbers on one row describing different sets of records is
                      the check sheet's own failure mode. */}
                  <td className="px-4 py-3 align-top text-right tabular-nums text-neutral-700">
                    {(project.summary ?? EMPTY_SUMMARY).records}
                  </td>
                  {/* THE NUMBER THAT DECIDES WHAT YOU DO TODAY, and the reason
                      this screen is a table at all. Red because it blocks money
                      going out, and a link rather than a figure, because
                      reading it is never the end of the errand. */}
                  <td className="px-4 py-3 align-top text-right">
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
                  </td>
                  {/* OVERDUE IS STATED, NEVER WORKED OUT BY THE READER — and a
                      project with NO programme says so, because an empty
                      programme rendering as healthy is the error worth
                      preventing. */}
                  <td className="px-4 py-3 align-top text-xs">
                    <Programme day={project.specs_agreed_by} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-block text-[11px] tracking-wide px-2 py-0.5 rounded border ${STATE_PILL[project.state]}`}
                      // COMPLETED arrives on its own, so the pill has to be
                      // able to say what is still outstanding under ACTIVE.
                      title={completionSentence(project.completion) ?? "Every question on every record is settled."}
                    >
                      {PROJECT_STATE_LABELS[project.state]}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-end gap-2">
                      {/* The project's own run tabs. There is deliberately no
                          screen that lists every run's records together: a
                          mock-up run, a main run and a VE run quote the SAME
                          codes at different quantities. */}
                      <Link href={`/dashboard/projects/${project.id}?tab=spec`} className={buttonClass("primary")}>
                        Spec table
                      </Link>
                      {/* Asking for what is missing is the stage after intake,
                          and it is where a KAM spends their week. */}
                      <Link href={`/dashboard/drafts?projectId=${project.id}`} className={buttonClass("secondary")}>
                        Chase
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
