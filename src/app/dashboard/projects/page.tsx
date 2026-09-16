"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";

type Project = {
  id: string;
  bws_project_number: string;
  name: string;
  client: string | null;
  record_count: string;
  status: string;
  archived_at: string | null;
  archived_by: string | null;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [saving, setSaving] = useState(false);
  // Opt-in. The point of archiving is that a finished project stops being in
  // the way, so the default list is the work in front of somebody.
  const [includeArchived, setIncludeArchived] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ projects: Project[] }>(
      `/api/projects${includeArchived ? "?includeArchived=true" : ""}`,
    );
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setProjects(res.data.projects);
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

  const archivedCount = projects?.filter((project) => project.status === "archived").length ?? 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">Projects</h1>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Include archived
          {includeArchived && archivedCount > 0 && (
            <span className="text-xs text-neutral-500">({archivedCount} shown)</span>
          )}
        </label>
      </div>

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

      {projects === null ? (
        <div className="mt-6"><Spinner label="Loading projects" /></div>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-600">
          {includeArchived
            ? "No projects yet. Add one above, then open it to import its BOQ."
            : "Nothing active. Add a project above, or tick Include archived to see finished ones."}
        </p>
      ) : (
        <ul className="mt-6 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {projects.map((project) => (
            <li
              key={project.id}
              className={`px-4 py-3 flex items-center gap-4 ${project.status === "archived" ? "bg-neutral-50" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  className="font-medium text-neutral-900 underline hover:text-neutral-600"
                >
                  {project.bws_project_number} — {project.name}
                </Link>
                {project.status === "archived" && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded border border-neutral-300 bg-white text-neutral-600">
                    Archived
                  </span>
                )}
                <p className="text-sm text-neutral-500">
                  {project.client ?? "No client recorded"} · {project.record_count} spec record
                  {project.record_count === "1" ? "" : "s"}
                  {project.status === "archived" && project.archived_at && (
                    <> · archived {new Date(project.archived_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              {/* TWO buttons, not three. "Open" carried the same href AND the
                  same styling as "Overview", so the row offered the same
                  destination twice and read as though one of them went
                  somewhere else. */}
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="shrink-0 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100"
              >
                Overview
              </Link>
              {/* The project's own run tabs. There is deliberately no screen
                  that lists every run's records together: a mock-up run, a main
                  run and a VE run quote the SAME codes at different quantities,
                  so merging them is three of everything with no way to tell
                  which is which. */}
              <Link
                href={`/dashboard/projects/${project.id}?tab=spec`}
                className="shrink-0 text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
              >
                Spec table
              </Link>
              {/* Asking for what is missing is the stage after intake, and it
                  is where a KAM spends their week. It gets its own way in. */}
              <Link
                href={`/dashboard/drafts?projectId=${project.id}`}
                className="shrink-0 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100"
              >
                Chase
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
