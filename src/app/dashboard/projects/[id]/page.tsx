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
// Sections are in the order the work happens: who the project is, where copies
// go, when it is due, who to ask, what has been read in.
//
// TABS, ONE PER RUN. A BOQ's tabs are sub-quotes — a mock-up run, a main run, a
// value-engineered run — quoting the SAME item codes at different quantities.
// Listing them together made three of everything in one table with no way to
// see which was which; a tab each is how the client, the quote and the job
// already think about them. Overview holds everything that is true of the
// project as a whole.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import ContactsPanel, { type Contact } from "@/components/projects/ContactsPanel";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";
import SpecTable from "@/components/records/SpecTable";
import ProjectHistory from "@/components/history/ProjectHistory";
import OpenChangeBar from "@/components/history/OpenChangeBar";
import {
  SPECS_AGREED_LABEL,
  daysUntilSpecsAgreed,
  hasProgramme,
  todayLocal,
  validateProgramme,
} from "@/lib/project-programme";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { ATTRIBUTE_UNITS, ATTRIBUTE_UNIT_LABELS } from "@/lib/spec-vocab";
import { intakeStatusLabel } from "@/lib/intake-status";

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
  status: string;
  archived_at: string | null;
  archived_by: string | null;
  version: number;
};

type DocumentRun = {
  id: string;
  source_kind: string;
  document_kind: string | null;
  status: string;
  error: string | null;
  created_at: string;
  created_by: string | null;
  filename: string | null;
  source_preserved: boolean;
  // Null on anything uploaded before 0007, which is why the grouping below
  // keeps a home for runs that belong to no pack.
  batch_id: string | null;
  batch_label: string | null;
  batch_created_at: string | null;
};

/** One delivery, and the runs that arrived in it. */
type Pack = {
  id: string | null;
  label: string | null;
  createdAt: string;
  runs: DocumentRun[];
};

type SpecRun = {
  id: string;
  name: string;
  source_sheet: string | null;
  boq_revision: string | null;
  boq_date: string | null;
  header_notes: string[];
  record_count: string;
  attribute_count: string;
};

type ProjectNote = {
  id: string;
  topic: string | null;
  title: string | null;
  body: string;
  flagged: boolean;
  source_page: number | null;
  source_filename: string | null;
  version: number;
};

const SOURCE_LABELS: Record<string, string> = { boq_xlsx: "BOQ", spec_document: "Specification document" };

// A document's kind is what a person calls it; the source kind is only which
// pipeline read it.
const KIND_LABELS: Record<string, string> = {
  preamble: "Preamble",
  shop_drawings: "Shop drawings",
  ffe_schedule: "FF&E schedule",
  spec_bible: "Specification bible",
  finishes_schedule: "Finishes schedule",
  fabric_schedule: "Fabric schedule",
  other: "Other document",
};

type Form = {
  name: string;
  client: string;
  sharedInbox: string;
  orderDate: string;
  specsAgreedBy: string;
  deliveryDate: string;
  defaultDimensionUnit: string;
};

function formOf(project: Project): Form {
  return {
    name: project.name,
    client: project.client ?? "",
    sharedInbox: project.shared_inbox ?? "",
    orderDate: project.order_date ?? "",
    specsAgreedBy: project.specs_agreed_by ?? "",
    deliveryDate: project.delivery_date ?? "",
    defaultDimensionUnit: project.default_dimension_unit ?? "",
  };
}

function ProjectOverview() {
  const projectId = String(useParams().id ?? "");
  // "?tab=spec" is how the projects list offers the spec table as a destination
  // of its own. It selects the FIRST run, because there is no merged view to
  // send anybody to.
  const wantedTab = useSearchParams().get("tab");
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<DocumentRun[] | null>(null);
  const [runs, setRuns] = useState<SpecRun[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  // Collapsed by default. A real preamble states thirty things, each a
  // paragraph, and all of them expanded is why this section could not be read.
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<string>("overview");
  const [retiringRun, setRetiringRun] = useState<string | null>(null);
  const [retireRunReason, setRetireRunReason] = useState("");
  const [retiringBusy, setRetiringBusy] = useState(false);
  // Once only, and only before anybody has clicked: re-running it would drag a
  // reader back to the first run every time the project reloaded.
  const tabPreselected = useRef(false);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [suggestedCodes, setSuggestedCodes] = useState<string[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{
      project: Project;
      documents: DocumentRun[];
      runs: SpecRun[];
      notes: ProjectNote[];
    }>(`/api/projects/${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setProject(res.data.project);
    setDocuments(res.data.documents);
    setRuns(res.data.runs ?? []);
    setNotes(res.data.notes ?? []);
    setForm(formOf(res.data.project));
  }, [projectId]);

  async function retireRun(runId: string) {
    if (!retireRunReason.trim()) return;
    setRetiringBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${runId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "retired", reason: retireRunReason.trim() }),
      });
      // Reload first, then report. This screen clears its banner on a
      // successful load, so setting the message first would show a refusal for
      // a few milliseconds and then nothing at all.
      await load();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setRetiringRun(null);
      setRetireRunReason("");
      // The retired run has left the tabs, so the tab it was on no longer
      // exists. Back to the overview rather than a blank panel.
      setTab("overview");
    } finally {
      // Always reset: a non-JSON error must not leave the dialog frozen.
      setRetiringBusy(false);
    }
  }

  const loadContacts = useCallback(async () => {
    const res = await apiFetch<{
      contacts: { id: string; name: string; email: string | null; organisation: string | null; role: Contact["role"]; designer_code: string | null; version: number }[];
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
      })),
    );
  }, [projectId]);

  // The designer codes this project's records carry that nobody is yet, read
  // off the records list so the contacts panel can show the gap.
  const loadCodes = useCallback(async () => {
    const res = await apiFetch<{ records: { designer: string | null }[] }>(
      `/api/records?projectId=${encodeURIComponent(projectId)}`,
    );
    if (!res.ok) return; // a missing hint is not worth an error banner
    setSuggestedCodes([
      ...new Set(
        res.data.records
          .map((record) => (record.designer ?? "").trim().toUpperCase())
          .filter((code) => code !== ""),
      ),
    ]);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load();
    void loadContacts();
    void loadCodes();
  }, [projectId, load, loadContacts, loadCodes]);

  useEffect(() => {
    if (tabPreselected.current || !wantedTab || runs.length === 0) return;
    // A run id sends you to that exact run -- the record screen's back link
    // uses it, because a record number is project-wide and the same code sits
    // on more than one tab. "spec" just means "the spec table", so it takes
    // the first run. An id for a run this project does not have falls through
    // to Overview rather than showing an empty tab nobody selected.
    const wanted = wantedTab === "spec" ? runs[0] : runs.find((run) => run.id === wantedTab);
    if (!wanted) return;
    tabPreselected.current = true;
    setTab(wanted.id);
  }, [wantedTab, runs]);

  // Runs grouped into the packs they arrived in, newest first, each pack's own
  // runs oldest first so they read in the order the work happens.
  //
  // Pre-0007 runs have no batch and are collected under a single null pack at
  // the end -- they are real documents somebody imported and must not vanish
  // because a later migration gave their successors a grouping.
  const packs = useMemo<Pack[]>(() => {
    if (!documents) return [];
    const byBatch = new Map<string, Pack>();
    const loose: DocumentRun[] = [];
    for (const run of documents) {
      if (!run.batch_id) {
        loose.push(run);
        continue;
      }
      const existing = byBatch.get(run.batch_id);
      if (existing) {
        existing.runs.push(run);
        continue;
      }
      byBatch.set(run.batch_id, {
        id: run.batch_id,
        label: run.batch_label,
        createdAt: run.batch_created_at ?? run.created_at,
        runs: [run],
      });
    }
    const grouped = [...byBatch.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const pack of grouped) pack.runs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (loose.length > 0) {
      grouped.push({ id: null, label: null, createdAt: loose[loose.length - 1]?.created_at ?? "", runs: loose });
    }
    return grouped;
  }, [documents]);

  const dirty = useMemo(() => {
    if (!project || !form) return false;
    const stored = formOf(project);
    return (Object.keys(stored) as (keyof Form)[]).some((key) => stored[key].trim() !== form[key].trim());
  }, [project, form]);

  useUnsavedChangesWarning(
    dirty,
    "This project has unsaved changes. Leave without saving them?",
  );

  // Refused before the request, in the same words the server uses. The server
  // check is the real one — this only saves a round trip.
  const dateError = useMemo(() => {
    if (!form) return null;
    return validateProgramme({
      orderDate: form.orderDate || null,
      specsAgreedBy: form.specsAgreedBy || null,
      deliveryDate: form.deliveryDate || null,
    });
  }, [form]);

  const toggleNote = (noteId: string) =>
    setOpenNotes((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });

  /**
   * Marking a note load-bearing. Independent of `status`, which is whether the
   * note is a correct reading of the document -- "this is wrong" and "this
   * matters" are different answers and must not share a field.
   */
  async function setNoteFlag(note: ProjectNote, flagged: boolean) {
    setError(null);
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flagged, version: note.version }),
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await load();
  }

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

  async function retireNote(note: ProjectNote) {
    setError(null);
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "retired", version: note.version }),
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await load();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!project || !form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: project.version,
          name: form.name.trim(),
          client: form.client.trim() || null,
          sharedInbox: form.sharedInbox.trim() || null,
          orderDate: form.orderDate.trim() || null,
          specsAgreedBy: form.specsAgreedBy.trim() || null,
          deliveryDate: form.deliveryDate.trim() || null,
          defaultDimensionUnit: form.defaultDimensionUnit.trim() || null,
        }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setProject(res.data.project);
      setForm(formOf(res.data.project));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (error && !project) return <p className="max-w-4xl mx-auto text-sm text-red-700">{error}</p>;
  if (!project || !form) return <div className="max-w-4xl mx-auto"><Spinner label="Loading project" /></div>;

  const flaggedCount = notes.filter((note) => note.flagged).length;
  const allNotesOpen = notes.length > 0 && notes.every((note) => openNotes.has(note.id));

  const today = todayLocal();
  const untilSpecs = daysUntilSpecsAgreed(project.specs_agreed_by, today);
  const programme = hasProgramme({
    orderDate: project.order_date,
    specsAgreedBy: project.specs_agreed_by,
    deliveryDate: project.delivery_date,
  });

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
    className: "w-full border border-neutral-300 rounded px-3 py-2 text-sm",
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold text-neutral-900">
          {project.bws_project_number} — {project.name}
        </h1>
        <Link href="/dashboard/projects" className="text-sm text-neutral-500 underline hover:text-neutral-800">
          All projects
        </Link>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      {/* Says what archiving DID and did not do. A banner that only said
          "Archived" would read as a lock, and nothing here locks anything. */}
      {project.status === "archived" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <span>
            This project is archived
            {project.archived_at && <> since {new Date(project.archived_at).toLocaleDateString()}</>}
            {project.archived_by && <> by {project.archived_by}</>}. It is hidden from the projects list. Everything on
            it is still editable, still exports, and nothing has been deleted.
          </span>
          <button
            type="button"
            onClick={() => void setArchived(false)}
            disabled={saving}
            className="text-sm px-3 py-1.5 rounded border border-amber-400 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {saving ? "Restoring…" : "Restore it"}
          </button>
        </div>
      )}

      {/* One tab per RUN. The same item code appears in several of them at
          different quantities, which is the whole reason they are separate. */}
      <nav className="mt-4 flex flex-wrap gap-1 border-b border-neutral-200">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`px-3 py-2 text-sm -mb-px border-b-2 ${
            tab === "overview"
              ? "border-neutral-900 text-neutral-900 font-medium"
              : "border-transparent text-neutral-500 hover:text-neutral-800"
          }`}
        >
          Overview
        </button>
        {runs.map((run) => (
          <button
            key={run.id}
            type="button"
            onClick={() => setTab(run.id)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${
              tab === run.id
                ? "border-neutral-900 text-neutral-900 font-medium"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {run.name}
            <span className="ml-1 text-xs text-neutral-400">{run.record_count}</span>
          </button>
        ))}
        {/* Last, and project-wide: a change usually belongs to one run, but a
            baseline and a comparison never do. */}
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`px-3 py-2 text-sm -mb-px border-b-2 ${
            tab === "history"
              ? "border-neutral-900 text-neutral-900 font-medium"
              : "border-transparent text-neutral-500 hover:text-neutral-800"
          }`}
        >
          History
        </button>
      </nav>

      {/* On every tab, because a person starts a change and then goes looking
          for the item it applies to. */}
      <OpenChangeBar projectId={project.id} />

      {tab === "history" && <ProjectHistory projectId={project.id} />}

      {tab === "overview" && (
        <p className="mt-3 text-sm">
          <Link
            href={`/dashboard/projects/${project.id}/finishes`}
            className="text-neutral-600 underline hover:text-neutral-900"
          >
            Finishes library
          </Link>
          <span className="ml-2 text-xs text-neutral-500">
            Every finish code this project&rsquo;s documents carry, and the items that use it.
          </span>
        </p>
      )}

      {runs.map((run) =>
        tab === run.id ? (
          <section key={run.id} className="mt-4">
            <p className="text-xs text-neutral-500">
              {run.source_sheet && <>from sheet “{run.source_sheet}”</>}
              {run.boq_revision && <> · revision {run.boq_revision}</>}
              {run.boq_date && <> · dated {run.boq_date}</>}
            </p>
            {run.header_notes?.length > 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                The bill said: {run.header_notes.join(" · ")}
              </p>
            )}
            <SpecTable projectId={project.id} runId={run.id} />

            {/* Retiring a run takes a whole sub-quote out of the tabs and out
                of the export. Every record on it goes with it, and both can be
                brought back — but the reason is required, because whoever
                finds the gap later needs to know why it is there. */}
            {retiringRun === run.id ? (
              <div className="mt-3 border border-red-300 bg-red-50 rounded-lg px-4 py-3">
                <p className="text-sm font-medium text-red-900">Retire “{run.name}”?</p>
                <p className="mt-0.5 text-xs text-red-800">
                  Its {run.record_count} record{Number(run.record_count) === 1 ? "" : "s"} stop being live: they leave this
                  project&rsquo;s export and its tabs. Nothing is deleted, and the run can be brought back. A BWS job
                  already created from one of these records is NOT removed by its absence from the export — check those
                  by hand.
                </p>
                <input
                  value={retireRunReason}
                  autoFocus
                  onChange={(event) => setRetireRunReason(event.target.value)}
                  placeholder="Superseded by the Rev B bill confirmed on 16 Sep"
                  className="mt-2 w-full border border-red-300 rounded px-2 py-1 text-sm bg-white"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void retireRun(run.id)}
                    disabled={!retireRunReason.trim() || retiringBusy}
                    className="border border-red-400 bg-white rounded px-3 py-1 text-sm hover:bg-red-100 disabled:opacity-50"
                  >
                    {retiringBusy ? "Retiring…" : "Retire the run"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetiringRun(null)}
                    className="text-sm text-red-800 hover:text-red-950"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRetiringRun(run.id);
                  setRetireRunReason("");
                }}
                className="mt-3 text-xs text-neutral-500 underline hover:text-red-700"
              >
                Retire this run
              </button>
            )}
          </section>
        ) : null,
      )}

      <div className={tab === "overview" ? "" : "hidden"}>
      <form onSubmit={save} className="mt-4 border border-neutral-200 rounded-lg bg-white p-4">
        <h2 className="font-medium text-neutral-900">Identity</h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-neutral-600">
            BWS project number
            <input
              value={project.bws_project_number}
              readOnly
              disabled
              className="mt-1 w-full border border-neutral-200 bg-neutral-50 text-neutral-500 rounded px-3 py-2 text-sm"
            />
            <span className="block mt-1 text-xs text-neutral-500">
              Fixed. Every record number and every export is labelled with it.
            </span>
          </label>
          <label className="text-sm text-neutral-600">
            Name
            <input {...field("name")} className={`mt-1 ${field("name").className}`} />
          </label>
          <label className="text-sm text-neutral-600">
            Client
            <input {...field("client")} placeholder="None recorded" className={`mt-1 ${field("client").className}`} />
          </label>
        </div>

        <h2 className="mt-6 font-medium text-neutral-900">Shared inbox</h2>
        <p className="mt-1 text-xs text-neutral-500">
          The project&rsquo;s shared mailbox, recorded here so correspondence has one home. Leave it blank if there
          is none — that is a real choice, not a gap.
        </p>
        <input
          {...field("sharedInbox")}
          type="email"
          placeholder="p17231@benwhistler.com"
          className={`mt-2 sm:max-w-sm ${field("sharedInbox").className}`}
        />

        {/* The unit question, asked once instead of once per dimension. It is
            the LAST resort of three — a unit printed on the page wins, and the
            page's own figures agreeing wins after that — so the copy has to say
            when it is used, or it reads as "force everything to centimetres". */}
        <h2 className="mt-6 font-medium text-neutral-900">Drawing units</h2>
        <p className="mt-1 text-xs text-neutral-500">
          What this project&rsquo;s drawings are drawn in. Used only where a page prints no unit and its own figures
          do not agree — a unit printed on the page always wins. Leave it unset and every such dimension asks you
          individually, which is the old behaviour.
        </p>
        <select
          value={form.defaultDimensionUnit}
          onChange={(event) => setForm({ ...form, defaultDimensionUnit: event.target.value })}
          className="mt-2 border border-neutral-300 rounded px-3 py-2 text-sm"
        >
          <option value="">Not set — ask me per dimension</option>
          {ATTRIBUTE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {ATTRIBUTE_UNIT_LABELS[unit]}
            </option>
          ))}
        </select>
        {form.defaultDimensionUnit && (
          <p className="mt-1 text-xs text-amber-800">
            A dimension that would be implausible at this unit is flagged for a second look, but it is still
            confirmable — this setting trades a check for speed.
          </p>
        )}

        <h2 className="mt-6 font-medium text-neutral-900">TOE key dates</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {SPECS_AGREED_LABEL} is the gate before drawings can be issued, and the date the spec table measures
          Overdue against.
        </p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-neutral-600">
            Order date
            <input {...field("orderDate")} type="date" className={`mt-1 ${field("orderDate").className}`} />
          </label>
          <label className="text-sm text-neutral-600">
            {SPECS_AGREED_LABEL}
            <input {...field("specsAgreedBy")} type="date" className={`mt-1 ${field("specsAgreedBy").className}`} />
          </label>
          <label className="text-sm text-neutral-600">
            Delivery date
            <input {...field("deliveryDate")} type="date" className={`mt-1 ${field("deliveryDate").className}`} />
          </label>
        </div>

        {/* A null date means NO PROGRAMME, not "on time". Saying nothing here
            would let an empty programme read as a healthy one — the same error
            as a category with no requirements scoring 0/0 and rendering green. */}
        {!programme ? (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            No programme recorded. Nothing on this project can be flagged overdue until{" "}
            {SPECS_AGREED_LABEL.toLowerCase()} holds a date — that is not the same as being on time.
          </p>
        ) : project.specs_agreed_by === null ? (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            No date for {SPECS_AGREED_LABEL.toLowerCase()}. The other dates are recorded, but Overdue is measured
            against this one, so nothing will be flagged.
          </p>
        ) : untilSpecs !== null && untilSpecs < 0 ? (
          <p className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
            Specifications were due {-untilSpecs} day{untilSpecs === -1 ? "" : "s"} ago. Anything outstanding on
            the spec table is overdue.
          </p>
        ) : (
          <p className="mt-3 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
            {untilSpecs === 0
              ? "Specifications are due today."
              : `${untilSpecs} day${untilSpecs === 1 ? "" : "s"} until specifications must be agreed.`}
          </p>
        )}

        {dateError && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{dateError}</p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !dirty || Boolean(dateError)}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {dirty && <span className="text-xs text-amber-800">Unsaved changes</span>}
          {!dirty && saved && <span className="text-xs text-green-700">Saved</span>}
        </div>
      </form>

      <div className="mt-8 flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium text-neutral-900">Contacts</h2>
        <Link
          href={`/dashboard/drafts?projectId=${project.id}`}
          className="text-sm text-neutral-600 underline hover:text-neutral-900"
        >
          Chase what is missing
        </Link>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Who to ask about this project. The designer code matches the BOQ&rsquo;s own wording and is what ties a
        record&rsquo;s questions to a person.
      </p>
      {contacts === null ? (
        <div className="mt-3"><Spinner label="Loading contacts" /></div>
      ) : (
        <ContactsPanel
          projectId={project.id}
          contacts={contacts}
          suggestedCodes={suggestedCodes.filter(
            (code) => !contacts.some((contact) => contact.designerCode === code),
          )}
          onChanged={() => void loadContacts()}
        />
      )}

      <h2 className="mt-8 font-medium text-neutral-900">Intake</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Drop the whole tender pack in at once — the bill of quantities, the drawings, and the preamble if there is
        one. Each file&rsquo;s kind is declared, because a BOQ and a schedule are both spreadsheets and the bytes
        cannot say which is which.
      </p>
      <IntakeBatchUpload projectId={project.id} onUploaded={() => void load()} />
      {/* GROUPED BY PACK, and each pack links to its own screen.
          A delivery's runs used to be listed flat, so the two screens that
          read a whole pack -- the pack screen with its Read all, and the
          combined drawings review, which is the ONLY place a record described
          by two documents is named -- were reachable solely from the redirect
          that fires once after upload. Navigate away and there was no route
          back to either except browser history. */}
      {documents === null ? (
        <div className="mt-3"><Spinner label="Loading documents" /></div>
      ) : packs.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">
          Nothing imported yet. Start with the bill of quantities — it creates this project&rsquo;s spec records.
        </p>
      ) : (
        packs.map((pack) => {
          const drawings = pack.runs.filter((run) => run.document_kind === "shop_drawings");
          const unread = pack.runs.filter((run) => run.status === "pending" || run.status === "failed");
          return (
            <div key={pack.id ?? "unpacked"} className="mt-3 border border-neutral-200 rounded-lg bg-white">
              <div className="px-4 py-2 border-b border-neutral-200 bg-neutral-50 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-neutral-900">
                  {pack.id
                    ? (pack.label ?? `${pack.runs.length} document${pack.runs.length === 1 ? "" : "s"}`)
                    : "Not part of a pack"}
                </p>
                {/* The count is NOT repeated here: a pack's default label is
                    already "10 documents", and the two together read as
                    twenty. */}
                <p className="text-xs text-neutral-500">
                  {pack.id ? (
                    <>
                      delivered {new Date(pack.createdAt).toLocaleDateString("en-GB")}
                      {unread.length > 0 && <> · {unread.length} not read yet</>}
                    </>
                  ) : (
                    <>Uploaded before deliveries were grouped. Nothing is wrong with them.</>
                  )}
                </p>
                {pack.id && (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {/* Only when there is more than one, because the combined
                        screen exists for what can only be seen ACROSS
                        documents. One drawing has nothing to compare. */}
                    {drawings.length > 1 && (
                      <Link
                        href={`/dashboard/projects/${project.id}/intake/${pack.id}/drawings`}
                        className="text-sm px-3 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700"
                      >
                        Review all {drawings.length} drawings together
                      </Link>
                    )}
                    <Link
                      href={`/dashboard/projects/${project.id}/intake/${pack.id}`}
                      className="text-sm px-3 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
                    >
                      Open the pack
                    </Link>
                  </span>
                )}
              </div>
              <ul className="divide-y divide-neutral-200">
                {pack.runs.map((run) => (
                  <li key={run.id} className="px-4 py-3 flex items-center gap-4 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="text-neutral-900">
                        {run.filename ?? "Unnamed file"}
                        <span className="text-neutral-500">
                          {" · "}
                          {(run.document_kind && KIND_LABELS[run.document_kind]) ?? SOURCE_LABELS[run.source_kind] ?? run.source_kind}
                        </span>
                      </p>
                      <p className="text-xs text-neutral-500">
                        {new Date(run.created_at).toLocaleString("en-GB")}
                        {run.created_by ? ` · ${run.created_by}` : ""}
                        {run.source_preserved ? "" : " · original not kept"}
                      </p>
                      {run.status === "failed" && run.error && (
                        <p className="mt-1 text-xs text-red-700">{run.error}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded border ${
                        run.status === "failed"
                          ? "text-red-800 border-red-300 bg-red-50"
                          : run.status === "confirmed"
                            ? "text-green-800 border-green-300 bg-green-50"
                            : "text-neutral-700 border-neutral-300 bg-neutral-50"
                      }`}
                    >
                      {intakeStatusLabel(run.status)}
                    </span>
                    <Link
                      href={`/dashboard/imports/${run.id}`}
                      className="shrink-0 text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      {/* What the preamble said the whole package is built under. LAST on this
          screen, because it is reference material: a reader scrolls to it when
          they want it, and it is the longest thing here by far. Retired, never
          deleted -- a mis-read note is still evidence that somebody looked. */}
      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-medium text-neutral-900">
          From the preamble
          {flaggedCount > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-800">{flaggedCount} flagged</span>
          )}
        </h2>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={() => setOpenNotes(allNotesOpen ? new Set() : new Set(notes.map((note) => note.id)))}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            {allNotesOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-500">
          Nothing yet. If the pack came with a preamble, upload it above and review what it requires. Plenty of
          projects do not have one.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-neutral-500">
            The conditions the whole package is built under. Flag the ones that change what gets quoted &mdash; a
            flameproofing standard, a tolerance, a precedence clause &mdash; so they are not read at the same weight as
            the boilerplate.
          </p>
          <ul className="mt-3 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
            {notes.map((note) => {
              const open = openNotes.has(note.id);
              return (
                <li
                  key={note.id}
                  className={`px-4 py-3 text-sm ${note.flagged ? "bg-amber-50 border-l-2 border-l-amber-400" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    {/* The title is the whole row's toggle: a preamble note's
                        body runs to a paragraph, and thirty of them expanded is
                        why this section was unreadable. */}
                    <button
                      type="button"
                      onClick={() => toggleNote(note.id)}
                      aria-expanded={open}
                      className={`flex-1 text-left font-medium ${note.flagged ? "text-amber-900" : "text-neutral-900"}`}
                    >
                      {open ? "\u25be" : "\u25b8"} {note.title ?? "Untitled requirement"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void setNoteFlag(note, !note.flagged)}
                      title={note.flagged ? "Stop flagging this" : "Flag this as load-bearing"}
                      className={`text-xs ${note.flagged ? "text-amber-800 hover:text-amber-900" : "text-neutral-400 hover:text-neutral-900"}`}
                    >
                      {note.flagged ? "\u2605 Flagged" : "\u2606 Flag"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void retireNote(note)}
                      className="text-xs text-neutral-500 hover:text-neutral-900"
                    >
                      Retire
                    </button>
                  </div>
                  {open && <p className="mt-1 whitespace-pre-line text-neutral-700">{note.body}</p>}
                  <p className="mt-1 text-xs text-neutral-500">
                    {note.topic}
                    {note.source_filename && <> &middot; {note.source_filename}</>}
                    {note.source_page && <> page {note.source_page}</>}
                    {!open && note.body.length > 0 && (
                      <> &middot; {note.body.length > 90 ? `${note.body.slice(0, 90).trimEnd()}\u2026` : note.body}</>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* There is no "every run in one table" link any more. The screen it went
          to merged the sub-quotes into one list, which is the one thing the run
          tabs exist to prevent. The project-wide EXPORT is a different matter
          and stays: a BWS import replaces the fields it is given, so the file
          has to carry every record in its scope. */}
      <div className="mt-8 flex gap-3">
        {runs.length > 0 && (
          <a
            href={`/api/projects/${project.id}/export`}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
          >
            Export the whole project
          </a>
        )}
        {/* At the end, away from Save changes, and only when the project is not
            already archived -- restoring is offered by the banner instead. */}
        {project.status === "active" && (
          <button
            type="button"
            onClick={() => void setArchived(true)}
            disabled={saving}
            className="ml-auto text-sm px-3 py-1.5 rounded border border-neutral-300 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
            title="Hides it from the projects list. Nothing is deleted and nothing becomes read-only."
          >
            {saving ? "Archiving…" : "Archive this project"}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

// `useSearchParams` needs a Suspense boundary in the App Router, and the whole
// screen sits inside it because the parameter decides which tab renders.
export default function ProjectOverviewPage() {
  return (
    <Suspense fallback={<Spinner label="Loading project" />}>
      <ProjectOverview />
    </Suspense>
  );
}
