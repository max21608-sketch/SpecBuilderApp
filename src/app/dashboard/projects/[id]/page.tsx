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
import FinishesLibrary from "@/components/finishes/FinishesLibrary";
import AddRun from "@/components/projects/AddRun";
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
import Button from "@/components/ui/Button";
import {
  completionSentence,
  EMPTY_COMPLETION,
  PROJECT_STATE_LABELS,
  type ProjectCompletion,
  type ProjectState,
} from "@/lib/project-completion";
import { EMPTY_SUMMARY, type ProjectSummary } from "@/lib/project-summary";
import StatTile from "@/components/ui/StatTile";
import Tip from "@/components/ui/Tip";

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

/** ACTIVE green, COMPLETED blue, ARCHIVED grey — the same three as the list. */
const STATE_PILL: Record<ProjectState, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-sky-100 text-sky-800 border-sky-200",
  archived: "bg-neutral-100 text-neutral-600 border-neutral-300",
};

/**
 * A titled box. The screen is long and every section used to be a bare
 * heading over a list, so scrolling it read as one continuous document rather
 * than as a set of things you can deal with separately.
 */
/**
 * One field of the project summary: a small label, the value, an optional tip.
 *
 * Deliberately not a `<dl>`: the grid is four across and a definition list
 * would need every term and every description to be siblings, which puts the
 * layout in the CSS and the meaning nowhere.
 */
function Detail({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
        {tip && <Tip>{tip}</Tip>}
      </div>
      <div className="mt-0.5 truncate text-sm text-neutral-900">{children}</div>
    </div>
  );
}

/** A value nobody has set. Grey and in words, never an empty cell. */
function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-neutral-400">{children}</span>;
}

/**
 * One line of the Specifications card: a count, what it means, and the control
 * that acts on it.
 *
 * THE FIGURE AND ITS FIX TRAVEL TOGETHER. A number with no action beside it
 * makes somebody go and find the screen it belongs to, which is the whole
 * complaint about this page — and the count itself is the link, so there are
 * two ways to the same place rather than one.
 */
function SummaryRow({
  label,
  count,
  meaning,
  tone,
  actionLabel,
  actionHref,
}: {
  label: string;
  count: number;
  meaning: string;
  tone: "danger" | "warn" | "info";
  actionLabel?: string;
  actionHref?: string | null;
}) {
  const colour =
    tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-blue-700";
  return (
    <tr>
      <td className="px-3 py-2.5 align-top">
        {actionHref ? (
          <Link href={actionHref} className="font-medium text-neutral-900 underline hover:text-neutral-600">
            {label}
          </Link>
        ) : (
          <span className="font-medium text-neutral-900">{label}</span>
        )}
      </td>
      <td className={`px-3 py-2.5 text-right align-top text-base font-semibold tabular-nums ${colour}`}>
        {actionHref ? (
          <Link href={actionHref} className="no-underline hover:underline">
            {count.toLocaleString()}
          </Link>
        ) : (
          count.toLocaleString()
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-neutral-600">{meaning}</td>
      <td className="px-3 py-2.5 text-right align-top">
        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="inline-flex items-center rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 no-underline hover:bg-neutral-50"
          >
            {actionLabel}
          </Link>
        )}
      </td>
    </tr>
  );
}

function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 border border-neutral-200 rounded-lg bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-medium text-neutral-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

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
  // Derived on the server and re-read on every load, because it changes when
  // an answer changes rather than when the project row does.
  const [completion, setCompletion] = useState<ProjectCompletion>(EMPTY_COMPLETION);
  // What the project is SHORT of, as opposed to whether it is finished. Same
  // scope, different question — see src/lib/project-summary.ts.
  const [summary, setSummary] = useState<ProjectSummary>(EMPTY_SUMMARY);
  const [state, setState] = useState<ProjectState>("active");
  /**
   * The details form is filled in ONCE and then read.
   *
   * It used to be the first and largest thing on this screen, above everything
   * a person actually comes here for. It reads as a summary until somebody
   * presses Edit. Not a disclosure of the same markup: the summary is the
   * compact grid below, and the form is the one that already existed, with its
   * validation and its unsaved-changes warning untouched.
   */
  const [editingDetails, setEditingDetails] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{
      project: Project;
      completion: ProjectCompletion;
      summary: ProjectSummary;
      state: ProjectState;
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
    setCompletion(res.data.completion ?? EMPTY_COMPLETION);
    setSummary(res.data.summary ?? EMPTY_SUMMARY);
    setState(res.data.state ?? "active");
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
    if (tabPreselected.current || !wantedTab) return;
    // The two project-wide tabs answer for themselves, and BEFORE the runs
    // arrive: gating them on `runs.length` would leave the old /finishes URL
    // landing on Overview for as long as the first request took.
    if (wantedTab === "finishes") {
      tabPreselected.current = true;
      setTab(wantedTab);
      return;
    }
    // Old links said ?tab=history. History is on the Overview now, so that is
    // where they land rather than on an empty screen.
    if (wantedTab === "history") {
      tabPreselected.current = true;
      setTab("overview");
      return;
    }
    if (runs.length === 0) return;
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
      // Back to the summary. The panel exists to be filled in and left, and
      // staying in it after a save leaves nine inputs on screen saying nothing.
      setEditingDetails(false);
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

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
    className: "w-full border border-neutral-300 rounded px-3 py-2 text-sm",
  });

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link href="/dashboard/projects" className="text-sm text-neutral-500 underline hover:text-neutral-800">
          &larr; Projects
        </Link>
        <h1 className="text-xl font-semibold text-neutral-900">
          {project.bws_project_number} — {project.name}
        </h1>
        {/* WHAT STATE THIS PROJECT IS IN, derived and never set by hand:
            COMPLETED arrives on its own when every question on every record is
            settled. The title says why, because a badge nobody can explain is
            a badge nobody believes. */}
        <span
          className={`text-[11px] tracking-wide px-2 py-0.5 rounded border ${STATE_PILL[state]}`}
          title={completionSentence(completion) ?? "Every question on every record is settled."}
        >
          {PROJECT_STATE_LABELS[state]}
        </span>
        <span className="ml-auto text-xs">
          {dirty ? (
            <span className="text-amber-800">Unsaved changes</span>
          ) : saved ? (
            <span className="text-green-700">Saved</span>
          ) : null}
        </span>
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
        {/* PROJECT-WIDE, like History and unlike a run: the same finish code is
            quoted on the mock-up, the main run and the VE, and correcting it
            corrects all of them. It was a grey line on the Overview tab, which
            meant it disappeared the moment anybody clicked a run — the tab is
            where a person looks for it. */}
        <button
          type="button"
          onClick={() => setTab("finishes")}
          className={`px-3 py-2 text-sm -mb-px border-b-2 ${
            tab === "finishes"
              ? "border-neutral-900 text-neutral-900 font-medium"
              : "border-transparent text-neutral-500 hover:text-neutral-800"
          }`}
        >
          Finishes
        </button>
        {/* A RUN WITH NO BILL BEHIND IT (0028). Matthew: "a large number of
            new projects ... coming into the TG0 stage" — and until now a
            project could only be started by uploading a BOQ spreadsheet. */}
        <AddRun
          projectId={project.id}
          onAdded={async (runId) => {
            await load();
            setTab(runId);
          }}
        />
        {/* THERE IS NO HISTORY TAB. Versions, baselines and the change trail
            are on the Overview itself (2026-09-17): a version is the answer to
            "what did this project look like on the 14th", which is a question
            somebody asks WHILE looking at the project, not a place they set
            out for. */}
      </nav>

      {/* On every tab, because a person starts a change and then goes looking
          for the item it applies to. */}
      <OpenChangeBar projectId={project.id} />

      {/* Mounted only when selected: it loads the whole library and every item
          each code is on, which is not a query the Overview should be paying
          for on every visit. */}
      {tab === "finishes" && (
        <section className="mt-4">
          <FinishesLibrary projectId={project.id} />
        </section>
      )}

      {runs.map((run) =>
        tab === run.id ? (
          <section key={run.id} className="mt-4">
            <SpecTable projectId={project.id} runId={run.id} />

            {/* WHERE THIS RUN CAME FROM, AT THE BOTTOM. It is provenance —
                read once when somebody asks which revision they are looking
                at, and never while working down the records. Above the table
                it cost four lines of the screen on every visit. */}
            <p className="mt-4 text-xs text-neutral-500">
              {run.source_sheet && <>from sheet “{run.source_sheet}”</>}
              {run.boq_revision && <> · revision {run.boq_revision}</>}
              {run.boq_date && <> · dated {run.boq_date}</>}
            </p>
            {run.header_notes?.length > 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                The bill said: {run.header_notes.join(" · ")}
              </p>
            )}

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
              <Button
                size="xs"
                variant="danger"
                className="mt-3"
                onClick={() => {
                  setRetiringRun(run.id);
                  setRetireRunReason("");
                }}
              >
                Retire this run
              </Button>
            )}
          </section>
        ) : null,
      )}

      <div className={tab === "overview" ? "" : "hidden"}>

      {/* ==================================================================
          THE PROJECT, AS A SUMMARY. Filled in once, then read.

          It was a form of nine inputs and three captions, first and largest on
          the screen, above everything a person comes here for. The FORM is
          unchanged and still below — with its validation, its date rules and
          its unsaved-changes warning — it just does not open until somebody
          asks for it.

          The captions are gone. Where a field carries a rule worth knowing it
          gets a `?` you hover; where its ABSENCE would look identical to being
          fine it stays on the page in words, which is why the no-programme
          notice is still printed and not a tip.
          ================================================================== */}
      {!editingDetails && (
        <div className="mt-6 border border-neutral-200 rounded-lg bg-white">
          <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Project</h2>
            <span className="flex-1" />
            <Button size="xs" onClick={() => setEditingDetails(true)}>
              Edit
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-4 py-4 sm:grid-cols-4">
            <Detail label="BWS number">
              <span className="font-mono">{project.bws_project_number}</span>
            </Detail>
            <Detail label="Name">{project.name}</Detail>
            <Detail label="Client">{project.client || <Unset>none recorded</Unset>}</Detail>
            <Detail
              label="Shared inbox"
              tip="Mail forwarded here is placed on this project automatically. Blank means there is none, and mail will not route to it."
            >
              {project.shared_inbox ? (
                <span className="font-mono text-xs">{project.shared_inbox}</span>
              ) : (
                <Unset>none</Unset>
              )}
            </Detail>
            <Detail
              label="Drawing units"
              tip="Used only where a page prints no unit and its own figures do not agree. A unit printed on the page always wins."
            >
              {project.default_dimension_unit ? (
                ATTRIBUTE_UNIT_LABELS[project.default_dimension_unit as keyof typeof ATTRIBUTE_UNIT_LABELS] ??
                project.default_dimension_unit
              ) : (
                <Unset>not set — asked per dimension</Unset>
              )}
            </Detail>
            <Detail label="Order date">{project.order_date ?? <Unset>not set</Unset>}</Detail>
            <Detail
              label={SPECS_AGREED_LABEL}
              tip="The gate before drawings can be issued, and the date the spec table measures Overdue against."
            >
              {project.specs_agreed_by ? (
                <span className="font-medium">{project.specs_agreed_by}</span>
              ) : (
                <Unset>not set</Unset>
              )}
            </Detail>
            <Detail label="Delivery date">{project.delivery_date ?? <Unset>not set</Unset>}</Detail>
          </div>
          {/* NOT a tip. A project with no programme and a project on time look
              identical otherwise, so this has to be readable without hovering
              anything. */}
          {!programme && (
            <p className="mx-4 mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No programme recorded. Nothing on this project can be flagged overdue until{" "}
              {SPECS_AGREED_LABEL.toLowerCase()} holds a date — that is not the same as being on time.
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={save}
        className={`mt-6 border border-neutral-200 rounded-lg bg-white p-4 ${editingDetails ? "" : "hidden"}`}
      >
        <h2 className="font-medium text-neutral-900">Details</h2>
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
          {/* DISCARDS NOTHING BY ITSELF — it closes the panel and puts the form
              back to what the server holds, which is the only state the summary
              can honestly render. `dirty` is what makes the difference visible
              before it goes. */}
          <Button
            size="sm"
            onClick={() => {
              setForm(formOf(project));
              setEditingDetails(false);
            }}
          >
            {dirty ? "Discard changes" : "Close"}
          </Button>
          {dirty && <span className="text-xs text-amber-800">Unsaved changes</span>}
          {!dirty && saved && <span className="text-xs text-green-700">Saved</span>}
        </div>
      </form>

      {/* WHAT HAS BEEN SPECIFIED, and whether that is everything. The pill at
          the top of the page is derived from exactly these numbers, so the two
          cannot disagree about whether a project is finished. */}
      {/* ==================================================================
          THE NUMBERS FIRST, AND EACH ONE PRESSABLE.

          "45 records, 1,899 questions still missing or TBC" was one sentence
          that answered neither question a KAM has — CAN I QUOTE THIS, and WHAT
          IS STOPPING ME. The strip answers the first; the table under it
          answers the second, one actionable row at a time, with the control
          beside the figure rather than on a screen you have to go and find.
          ================================================================== */}
      {completion.records > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          <StatTile
            label="Line items"
            value={summary.records}
            meaning={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
            href={firstRunHref}
            action="see them all"
          />
          <StatTile
            label="TGQ"
            tone="danger"
            value={summary.toQuote}
            meaning={summary.tgqNarrowed ? "questions blocking a quote" : "every outstanding question — see below"}
            href={firstRunHref}
            action="open the spec table"
          />
          <StatTile
            label="Also outstanding"
            tone="warn"
            value={summary.missing + summary.tbc}
            meaning={`${summary.missing} unlooked · ${summary.tbc} TBC`}
            href={firstRunHref}
            action="open the spec table"
          />
          <StatTile label="Settled" tone="good" value={summary.settled} meaning="confirmed or N/A" />
          <StatTile
            label="Finishes"
            tone="info"
            value={summary.finishes}
            meaning={
              summary.finishesNoKind > 0 ? `${summary.finishesNoKind} with no kind` : "all filed under a kind"
            }
            href={`/dashboard/projects/${project.id}?tab=finishes`}
            action="open the library"
          />
        </div>
      )}

      <Card
        title="Specifications"
        aside={
          firstRunHref ? (
            <Link href={firstRunHref} className="text-sm text-neutral-600 underline hover:text-neutral-900">
              Open the spec table
            </Link>
          ) : undefined
        }
      >
        {completion.records === 0 ? (
          <p className="mt-1 text-sm text-neutral-700">
            Nothing imported yet. A bill of quantities is what creates this project&rsquo;s records.
          </p>
        ) : completion.complete ? (
          <p className="mt-1 text-sm text-neutral-700">
            {completion.records === 1 ? "The one record is settled" : `All ${completion.records} records are settled`} —
            every question confirmed or marked not applicable. That is what COMPLETED means here, and it is worked out
            from the answers rather than set by anybody.
          </p>
        ) : (
          <>
            {/* THE TGQ SET HAS NEVER BEEN NARROWED, AND THE SCREEN SAYS SO.
                `tgq_levels` is still at 0019's seeded default — all three
                levels on all 728 questions — so "needed to quote" is
                arithmetically the same number as "outstanding" and means
                nothing. Printing it in red as though it were a measurement is
                the confidently-wrong figure this app exists to avoid, so where
                it is a placeholder it is labelled one. It corrects itself the
                moment the workbook is re-seeded, with no code change. */}
            {!summary.tgqNarrowed && summary.toQuote > 0 && (
              <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-medium">Every outstanding question still counts as blocking a quote.</span>{" "}
                Matthew&rsquo;s TGQ workbook has not been applied, so all {summary.toQuote.toLocaleString()} are marked
                as needed — which is today&rsquo;s position, not a measurement of this project. Applying it only ever
                removes questions from that figure.
              </p>
            )}
            <div className="mt-3 overflow-hidden rounded border border-neutral-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-neutral-100">
                  {/* TGQ, NOT "needed to quote". They are the same question —
                      settled on 2026-09-18 — and two names for it is how a
                      reader comes to believe they are two measurements. The
                      plain-English gloss stays in the meaning column, where it
                      explains rather than competes. */}
                  <SummaryRow
                    label="TGQ"
                    tone="danger"
                    count={summary.toQuote}
                    meaning={
                      summary.tgqNarrowed
                        ? "Questions that block a quotation at each item's level."
                        : "Placeholder — every outstanding question, as above."
                    }
                    actionLabel="Chase them"
                    actionHref={`/dashboard/drafts?projectId=${project.id}`}
                  />
                  {summary.missing + summary.tbc > 0 && (
                    <SummaryRow
                      label="Also outstanding"
                      tone="warn"
                      count={summary.missing + summary.tbc}
                      meaning={`${summary.missing} nobody has looked at, ${summary.tbc} answered TBC.`}
                      actionLabel="Open the spec table"
                      actionHref={firstRunHref}
                    />
                  )}
                  {summary.uncategorised > 0 && (
                    <SummaryRow
                      label="No category"
                      tone="warn"
                      count={summary.uncategorised}
                      meaning="No questions at all, so they score zero outstanding. Nobody has decided what to ask."
                      actionLabel="Set them"
                      actionHref={firstRunHref}
                    />
                  )}
                  {summary.noLevel > 0 && (
                    <SummaryRow
                      label="No level"
                      tone="warn"
                      count={summary.noLevel}
                      meaning={`Nothing on them is tiered, so they are missing from the figure above.${
                        summary.levelSuggested > 0 ? ` ${summary.levelSuggested} have a suggestion waiting.` : ""
                      }`}
                      actionLabel="Open the spec table"
                      actionHref={firstRunHref}
                    />
                  )}
                  {summary.finishesNoKind > 0 && (
                    <SummaryRow
                      label="Finishes with no kind"
                      tone="info"
                      count={summary.finishesNoKind}
                      meaning="The kind is what the screens group and filter by."
                      actionLabel="Open the library"
                      actionHref={`/dashboard/projects/${project.id}?tab=finishes`}
                    />
                  )}
                  {summary.documentsFailed > 0 && (
                    <SummaryRow
                      label="Documents that failed to read"
                      tone="danger"
                      count={summary.documentsFailed}
                      meaning="Everything else read itself on arrival. These need a retry, which charges again."
                      actionLabel="Open the pack"
                      actionHref={firstPackHref}
                    />
                  )}
                  {summary.documentsReading > 0 && (
                    <SummaryRow
                      label="Still being read"
                      tone="info"
                      count={summary.documentsReading}
                      meaning="Dispatched on arrival and running now. Nothing to do."
                    />
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Counted over the records the export ships: active records on live runs, and a bill line that has been split
          into configurations is counted through those.
        </p>
      </Card>

      {/* VERSIONS, ON THE PAGE. It was a tab, and a tab is a place you have to
          decide to go to — whereas "what did this look like last week" is a
          question asked while looking at the thing. */}
      <Card title="Versions and history">
        <ProjectHistory projectId={project.id} specsAgreedBy={project.specs_agreed_by} />
      </Card>

      <Card
        title="Contacts"
        aside={
          <Link
            href={`/dashboard/drafts?projectId=${project.id}`}
            className="text-sm text-neutral-600 underline hover:text-neutral-900"
          >
            Chase what is missing
          </Link>
        }
      >
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
      </Card>

      <Card title="Source documents">
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

      </Card>

      {/* What the preamble said the whole package is built under. LAST on this
          screen, because it is reference material: a reader scrolls to it when
          they want it, and it is the longest thing here by far. Retired, never
          deleted -- a mis-read note is still evidence that somebody looked. */}
      <Card
        title={flaggedCount > 0 ? `From the preamble — ${flaggedCount} flagged` : "From the preamble"}
        aside={
          notes.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpenNotes(allNotesOpen ? new Set() : new Set(notes.map((note) => note.id)))}
              className="text-xs text-neutral-500 hover:text-neutral-900"
            >
              {allNotesOpen ? "Collapse all" : "Expand all"}
            </button>
          ) : undefined
        }
      >
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

      </Card>

      {/* There is no "every run in one table" link any more. The screen it went
          to merged the sub-quotes into one list, which is the one thing the run
          tabs exist to prevent. The project-wide EXPORT is a different matter
          and stays: a BWS import replaces the fields it is given, so the file
          has to carry every record in its scope. */}
      <Card title="Export and archive">
      <p className="mt-1 text-xs text-neutral-500">
        The export is the complete dataset for this project — a BWS import replaces the fields it is given, so it is
        never a subset. Archiving hides the project from the list and changes nothing else: nothing here can be
        deleted, because a record is the only place a client ref maps to a BWS job.
      </p>
      <div className="mt-3 flex gap-3">
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
      </Card>
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
