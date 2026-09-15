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
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import ContactsPanel, { type Contact } from "@/components/projects/ContactsPanel";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";
import SpecTable from "@/components/records/SpecTable";
import {
  SPECS_AGREED_LABEL,
  daysUntilSpecsAgreed,
  hasProgramme,
  todayLocal,
  validateProgramme,
} from "@/lib/project-programme";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { ATTRIBUTE_UNITS, ATTRIBUTE_UNIT_LABELS } from "@/lib/spec-vocab";

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
  source_page: number | null;
  source_filename: string | null;
  version: number;
};

// One place, so a status never reads as a raw enum on one screen and a sentence
// on another.
const STATUS_LABELS: Record<string, string> = {
  pending: "Not read yet",
  queued: "Queued",
  parsing: "Being read",
  parsed: "Ready to review",
  confirmed: "Review complete",
  failed: "Failed",
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

export default function ProjectOverviewPage() {
  const projectId = String(useParams().id ?? "");
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<DocumentRun[] | null>(null);
  const [runs, setRuns] = useState<SpecRun[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [tab, setTab] = useState<string>("overview");
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
      </nav>

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

      {/* What the preamble said the whole package is built under. Retired,
          never deleted: a mis-read note is still evidence that somebody looked. */}
      <h2 className="mt-8 font-medium text-neutral-900">From the preamble</h2>
      {notes.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-500">
          Nothing yet. Upload the pack&rsquo;s preamble below and review what it requires.
        </p>
      ) : (
        <ul className="mt-3 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {notes.map((note) => (
            <li key={note.id} className="px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-neutral-900">{note.title ?? "Untitled requirement"}</p>
                <button
                  type="button"
                  onClick={() => void retireNote(note)}
                  className="text-xs text-neutral-500 hover:text-neutral-900"
                >
                  Retire
                </button>
              </div>
              <p className="mt-1 text-neutral-700">{note.body}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {note.topic}
                {note.source_filename && <> · {note.source_filename}</>}
                {note.source_page && <> page {note.source_page}</>}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 font-medium text-neutral-900">Contacts</h2>
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
        Drop the whole tender pack in at once — the preamble, the bill of quantities and the drawings. Each file&rsquo;s
        kind is declared, because a BOQ and a schedule are both spreadsheets and the bytes cannot say which is which.
      </p>
      <IntakeBatchUpload projectId={project.id} onUploaded={() => void load()} />
      {documents !== null && documents.length > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          Everything read in so far:
        </p>
      )}
      {documents === null ? (
        <div className="mt-3"><Spinner label="Loading documents" /></div>
      ) : documents.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">
          Nothing imported yet. Start with the bill of quantities — it creates this project&rsquo;s spec records.
        </p>
      ) : (
        <ul className="mt-3 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {documents.map((run) => (
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
                {STATUS_LABELS[run.status] ?? run.status}
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
      )}

      <div className="mt-8 flex gap-3">
        <Link
          href={`/dashboard/records?projectId=${project.id}`}
          className="text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100"
        >
          Every run in one table
        </Link>
        {runs.length > 0 && (
          <a
            href={`/api/projects/${project.id}/export`}
            className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700"
          >
            Export the whole project
          </a>
        )}
      </div>
      </div>
    </div>
  );
}
