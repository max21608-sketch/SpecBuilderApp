"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { buttonClass } from "@/components/ui/Button";
import {
  completionSentence,
  PROJECT_STATE_LABELS,
  type ProjectCompletion,
  type ProjectState,
} from "@/lib/project-completion";

type Project = {
  id: string;
  bws_project_number: string;
  name: string;
  client: string | null;
  record_count: string;
  status: string;
  archived_at: string | null;
  archived_by: string | null;
  /** Derived on the server; see src/lib/project-completion.ts. */
  completion: ProjectCompletion;
  state: ProjectState;
};

/** ACTIVE green, COMPLETED blue, ARCHIVED grey — the state, at a glance. */
const STATE_PILL: Record<ProjectState, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-sky-100 text-sky-800 border-sky-200",
  archived: "bg-neutral-100 text-neutral-600 border-neutral-300",
};

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

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Projects</h1>

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {/* ABOVE the list. Adding a project is the first thing somebody does on a
          new deployment, and the form was previously below however many
          projects already existed -- off the bottom of the screen exactly when
          the list was long enough to make it hard to find. */}
      <form onSubmit={create} className="mt-6 border border-neutral-200 rounded-lg bg-white p-4">
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
                    <p className="text-xs text-neutral-500">
                      {project.client ?? "No client recorded"} · {project.record_count} spec record
                      {project.record_count === "1" ? "" : "s"}
                      {project.status === "archived" && project.archived_at && (
                        <> · archived {new Date(project.archived_at).toLocaleDateString()}</>
                      )}
                    </p>
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
