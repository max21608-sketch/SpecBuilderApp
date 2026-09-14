"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";

type Project = { id: string; bws_project_number: string; name: string; client: string | null; record_count: string };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ projects: Project[] }>("/api/projects");
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setProjects(res.data.projects);
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
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Projects</h1>

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {projects === null ? (
        <div className="mt-6"><Spinner label="Loading projects" /></div>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-600">
          No projects yet. Add one below, then open it to import its BOQ.
        </p>
      ) : (
        <ul className="mt-6 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {projects.map((project) => (
            <li key={project.id} className="px-4 py-3 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  className="font-medium text-neutral-900 underline hover:text-neutral-600"
                >
                  {project.bws_project_number} — {project.name}
                </Link>
                <p className="text-sm text-neutral-500">
                  {project.client ?? "No client recorded"} · {project.record_count} spec record
                  {project.record_count === "1" ? "" : "s"}
                </p>
              </div>
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="shrink-0 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100"
              >
                Overview
              </Link>
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="shrink-0 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100"
              >
                Open
              </Link>
              <Link
                href={`/dashboard/records?projectId=${project.id}`}
                className="shrink-0 text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
              >
                Spec table
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="mt-8 border border-neutral-200 rounded-lg bg-white p-4">
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
    </div>
  );
}
