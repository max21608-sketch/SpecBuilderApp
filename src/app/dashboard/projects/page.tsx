"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
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
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingProject = useRef<string | null>(null);

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

  function pickFile(projectId: string) {
    pendingProject.current = projectId;
    fileInput.current?.click();
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const projectId = pendingProject.current;
    event.target.value = "";
    if (!file || !projectId) return;
    setUploadingFor(projectId);
    setError(null);
    try {
      // Bytes go browser -> blob store directly, never through a route handler:
      // a real source document is well over the serverless request-body ceiling.
      // Keeping the original is the point — the records this creates have to be
      // checkable back against the document they came from.
      let res;
      try {
        // The store is configured PRIVATE, and must stay that way: these are
        // NDA-covered client documents, and a public blob URL is readable by
        // anyone who has it. The server re-reads the blob with a bearer token.
        const blob = await upload(file.name, file, {
          access: "private",
          handleUploadUrl: "/api/uploads/token",
        });
        res = await apiFetch<{ importId: string }>("/api/imports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, url: blob.url, filename: file.name, contentType: file.type, size: file.size }),
        });
      } catch (cause) {
        // No blob store, or it refused. Fall back to reading the file directly
        // so the import still works — but that path cannot keep the original,
        // and the review screen says so rather than pretending otherwise.
        setError(
          `The file could not be stored (${cause instanceof Error ? cause.message : String(cause)}). Reading it without keeping a copy.`,
        );
        const form = new FormData();
        form.set("file", file);
        form.set("projectId", projectId);
        res = await apiFetch<{ importId: string }>("/api/imports", { method: "POST", body: form });
      }
      if (!res.ok) { setError(res.error); return; }
      window.location.href = `/dashboard/imports/${res.data.importId}`;
    } finally {
      setUploadingFor(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Projects</h1>

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <input ref={fileInput} type="file" accept=".xlsx" onChange={onFile} className="hidden" />

      {projects === null ? (
        <div className="mt-6"><Spinner label="Loading projects" /></div>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-600">No projects yet. Add one below, then import its BOQ.</p>
      ) : (
        <ul className="mt-6 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {projects.map((project) => (
            <li key={project.id} className="px-4 py-3 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neutral-900">
                  {project.bws_project_number} — {project.name}
                </p>
                <p className="text-sm text-neutral-500">
                  {project.client ?? "No client recorded"} · {project.record_count} spec record
                  {project.record_count === "1" ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => pickFile(project.id)}
                disabled={uploadingFor !== null}
                className="shrink-0 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
              >
                {uploadingFor === project.id ? "Reading…" : "Import BOQ"}
              </button>
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
