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
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import ContactsPanel, { type Contact, type ContactsOutstanding } from "@/components/projects/ContactsPanel";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";
import SpecTable, { type Focus, type RunTally } from "@/components/records/SpecTable";
import ExportMenu from "@/components/records/ExportMenu";
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
import { intakeStatusLabel, intakeStatusTone, isIntakeRunWorking } from "@/lib/intake-status";
import Button, { buttonClass } from "@/components/ui/Button";
import {
  completionSentence,
  EMPTY_COMPLETION,
  PROJECT_STATE_LABELS,
  PROJECT_STATE_TONE,
  type ProjectCompletion,
  type ProjectState,
} from "@/lib/project-completion";
import { EMPTY_SUMMARY, type ProjectSummary } from "@/lib/project-summary";
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
import { formatDay } from "@/lib/format-day";

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
  /** What this document PRODUCED, counted off the FKs the confirm wrote. */
  specs_applied: string | number | null;
  runs_created: string | number | null;
  records_created: string | number | null;
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

/** How many files a pack shows before the rest fold behind a link. */
const PACK_FILES_SHOWN = 5;

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

/** A day as a person writes it, or the grey words for one nobody has set. */
function day(value: string | null): React.ReactNode {
  return value ? formatDay(value) : <Unset>not set</Unset>;
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
  const rawFocus = useSearchParams().get("focus");
  const initialFocus: Focus = ((): Focus => {
    const known: Focus[] = ["tgq", "waiting", "no_category", "no_level", "quotable"];
    return known.find((value) => value === rawFocus) ?? null;
  })();
  const [project, setProject] = useState<Project | null>(null);
  const [documents, setDocuments] = useState<DocumentRun[] | null>(null);
  const [runs, setRuns] = useState<SpecRun[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  // Collapsed by default. A real preamble states thirty things, each a
  // paragraph, and all of them expanded is why this section could not be read.
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState(false);
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
  const [retiringRun, setRetiringRun] = useState<string | null>(null);
  const [retireRunReason, setRetireRunReason] = useState("");
  const [retiringBusy, setRetiringBusy] = useState(false);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [contactsOutstanding, setContactsOutstanding] = useState<ContactsOutstanding | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const [suggestedCodes, setSuggestedCodes] = useState<string[]>([]);
  const [codeCounts, setCodeCounts] = useState<Record<string, number>>({});
  const [unlinkedFinishCodes, setUnlinkedFinishCodes] = useState<{ code: string; records: number }[]>([]);
  const [failedDocuments, setFailedDocuments] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
  const [retryingDocument, setRetryingDocument] = useState<string | null>(null);
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
  // The history card's three controls live in its heading, so the page holds
  // their state and the component is told.
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [historyNaming, setHistoryNaming] = useState(false);
  const [historyComparing, setHistoryComparing] = useState(false);
  const [historyShowAll, setHistoryShowAll] = useState(false);
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

  /**
   * Ask for a failed document to be read again.
   *
   * IT CHARGES. The read was dispatched on arrival and the queue refused it, so
   * this is a second billed model call and the button says so on hover. There
   * is no exactly-once billing guarantee anywhere in this pipeline.
   */
  async function retryDocument(run: DocumentRun) {
    setRetryingDocument(run.id);
    try {
      const res = await apiFetch(`/api/imports/${run.id}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      await load();
      if (!res.ok) setError(res.error);
    } finally {
      setRetryingDocument(null);
    }
  }

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


  useEffect(() => {
    if (!projectId) return;
    void load();
    void loadContacts();
    void loadContactsOutstanding();
  }, [projectId, load, loadContacts, loadContactsOutstanding]);

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

  // Reported up by whichever run table is mounted. Stored by run id so
  // switching tabs does not blank the header while the next table loads.
  const onRunSummary = useCallback((runId: string, tally: RunTally) => {
    setRunTallies((current) => {
      const held = current[runId];
      if (held && held.records === tally.records && held.toQuote === tally.toQuote) return current;
      return { ...current, [runId]: tally };
    });
  }, []);

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

  if (error && !project)
    return (
      <PageBody>
        <p className="text-sm text-red-700">{error}</p>
      </PageBody>
    );
  if (!project || !form)
    return (
      <PageBody>
        <Spinner label="Loading project" />
      </PageBody>
    );

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

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
    className: "w-full border border-neutral-300 rounded px-3 py-2 text-sm",
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
    <Card
      title="History"
      flush
      actions={
        <>
          <Button size="xs" onClick={() => setHistoryNaming((open) => !open)}>
            Name this point
          </Button>
          <Button size="xs" onClick={() => setHistoryComparing((open) => !open)}>
            Compare two points
          </Button>
          {historyCount !== null && historyCount > 0 && (
            <button
              type="button"
              onClick={() => setHistoryShowAll((open) => !open)}
              className="text-[12px] font-medium normal-case tracking-normal text-blue-700 hover:underline"
            >
              {historyShowAll ? "Show fewer" : `All ${historyCount}`}
            </button>
          )}
        </>
      }
    >
      <ProjectHistory
        projectId={project.id}
        specsAgreedBy={project.specs_agreed_by}
        toQuote={summary.toQuote}
        onLoaded={setHistoryCount}
        naming={historyNaming}
        onNamingChange={setHistoryNaming}
        comparing={historyComparing}
        onComparingChange={setHistoryComparing}
        showAll={historyShowAll}
        onShowAllChange={setHistoryShowAll}
      />
    </Card>
  );

  const documentsCard = (
    <Card
      title={
        <>
          Source documents
          <Tip>
            {/* IT SAID "each file's kind is declared on upload", which is the
                impression 4a.3 exists to remove: the name is read the moment a
                file lands, the document is read at the press, and what a person
                picks beats both. The declaring still happens — at registration,
                where it always has. */}
            Drop a pack and the app works out what each file is — from its name straight away, then from the document
            itself when you press. Every answer says what it was read from, and your own choice always wins.
          </Tip>
        </>
      }
      flush
      actions={
        <Button size="xs" variant={uploading ? "secondary" : "primary"} onClick={() => setUploading((v) => !v)}>
          {uploading ? "Close" : "Add documents"}
        </Button>
      }
    >
      {uploading && (
        <div className="border-b border-neutral-200 px-4 py-3">
          <IntakeBatchUpload
            projectId={project.id}
            onUploaded={() => {
              setUploading(false);
              void load();
            }}
          />
        </div>
      )}
      {/* GROUPED BY PACK, and each pack links to its own screen.
          A delivery's runs used to be listed flat, so the two screens that
          read a whole pack -- the pack screen with its Read all, and the
          combined drawings review, which is the ONLY place a record described
          by two documents is named -- were reachable solely from the redirect
          that fires once after upload. Navigate away and there was no route
          back to either except browser history. */}
      {documents === null ? (
        <div className="p-4"><Spinner label="Loading documents" /></div>
      ) : packs.length === 0 ? (
        <p className="px-4 py-3 text-sm text-neutral-600">
          Nothing imported yet. Start with the bill of quantities — it creates this project&rsquo;s spec records.
        </p>
      ) : (
        packs.map((pack) => {
          const drawings = pack.runs.filter((run) => run.document_kind === "shop_drawings");
          const reading = pack.runs.filter((run) => isIntakeRunWorking(run.status) || run.status === "pending");
          const ready = pack.runs.filter((run) => run.status === "parsed");
          const key = pack.id ?? "unpacked";
          const expanded = expandedPacks.has(key);
          const shown = expanded ? pack.runs : pack.runs.slice(0, PACK_FILES_SHOWN);
          const folded = pack.runs.length - shown.length;
          return (
            <div key={key}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-neutral-200 bg-[#fcfcfc] px-4 py-2.5">
                <b className="text-[13px]">
                  {pack.id
                    ? (pack.label ?? `${pack.runs.length} document${pack.runs.length === 1 ? "" : "s"}`)
                    : "Not part of a pack"}
                </b>
                <span className="text-xs text-neutral-500">
                  {pack.id ? (
                    <>
                      delivered {formatDay(String(pack.createdAt).slice(0, 10))}
                      {reading.length > 0 && (
                        <span className="text-blue-700"> · {reading.length} still being read</span>
                      )}
                      {ready.length > 0 && <> · {ready.length} ready to review</>}
                    </>
                  ) : (
                    <>Uploaded before deliveries were grouped. Nothing is wrong with them.</>
                  )}
                </span>
                {pack.id && (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {/* Only when there is more than one, because the combined
                        screen exists for what can only be seen ACROSS
                        documents. One drawing has nothing to compare. */}
                    {drawings.length > 1 && (
                      <Link
                        href={`/dashboard/projects/${project.id}/intake/${pack.id}/drawings`}
                        className={buttonClass("primary", "xs", "no-underline")}
                      >
                        Review all {drawings.length} drawings together
                      </Link>
                    )}
                    <Link
                      href={`/dashboard/projects/${project.id}/intake/${pack.id}`}
                      className={buttonClass("secondary", "xs", "no-underline")}
                    >
                      Open the pack
                    </Link>
                  </span>
                )}
              </div>
              <Table>
                <tbody>
                  {shown.map((run) => {
                    const specs = Number(run.specs_applied ?? 0);
                    const madeRuns = Number(run.runs_created ?? 0);
                    const madeRecords = Number(run.records_created ?? 0);
                    /* WHAT IT PRODUCED. A state says what the app did to the
                       file; this says what the file did to the project, which
                       is the question somebody scanning eleven filenames has.
                       Each branch is counted, never guessed, and a document
                       that produced nothing yet says which of the two reasons
                       that is. */
                    const produced =
                      run.status === "failed"
                        ? (run.error ?? "the queue refused it")
                        : isIntakeRunWorking(run.status) || run.status === "pending"
                          ? `started ${new Date(run.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · nothing to do`
                          : madeRuns > 0
                            ? `${madeRuns} phase${madeRuns === 1 ? "" : "s"} · ${madeRecords} record${madeRecords === 1 ? "" : "s"}`
                            : specs > 0
                              ? `${specs} spec${specs === 1 ? "" : "s"} applied`
                              : run.status === "parsed"
                                ? "staged, nothing applied yet"
                                : "nothing applied";
                    return (
                      <Tr key={run.id}>
                        <Td className="w-[46%]">
                          <Link
                            href={`/dashboard/imports/${run.id}`}
                            className="text-blue-700 no-underline hover:underline"
                          >
                            {run.filename ?? "Unnamed file"}
                          </Link>
                          <p className="text-xs text-neutral-500">
                            {(run.document_kind && KIND_LABELS[run.document_kind]) ??
                              SOURCE_LABELS[run.source_kind] ??
                              run.source_kind}
                            {" · "}
                            {new Date(run.created_at).toLocaleString("en-GB")}
                            {run.created_by ? ` · ${run.created_by}` : ""}
                            {run.source_preserved ? "" : " · original not kept"}
                          </p>
                        </Td>
                        <Td className="w-[16%]">
                          <Chip tone={intakeStatusTone(run.status)} dot={isIntakeRunWorking(run.status)}>
                            {intakeStatusLabel(run.status)}
                          </Chip>
                        </Td>
                        <Td muted className="w-[22%]">
                          {produced}
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            {run.status === "failed" ? (
                              <Button
                                size="xs"
                                disabled={retryingDocument === run.id}
                                title="Reads the document again. This is a second charged model call."
                                onClick={() => void retryDocument(run)}
                              >
                                {retryingDocument === run.id ? "Trying…" : "Try again"}
                              </Button>
                            ) : run.status === "parsed" ? (
                              <Link
                                href={`/dashboard/imports/${run.id}`}
                                className={buttonClass("secondary", "xs", "no-underline")}
                              >
                                Review
                              </Link>
                            ) : isIntakeRunWorking(run.status) || run.status === "pending" ? (
                              <span className="text-[11.5px] text-neutral-500">it will appear here</span>
                            ) : (
                              <Link
                                href={`/dashboard/imports/${run.id}`}
                                className={buttonClass("quiet", "xs", "no-underline")}
                              >
                                Open
                              </Link>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              {folded > 0 && (
                <div className="border-b border-neutral-200 px-4 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPacks((current) => {
                        const next = new Set(current);
                        next.add(key);
                        return next;
                      })
                    }
                    className="text-[12px] text-blue-700 hover:underline"
                  >
                    {folded} more in this pack
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </Card>
  );

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
              { id: "history", label: "History", count: historyCount },
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
        {tab === "finishes" && <FinishesLibrary projectId={project.id} />}

        {runs.map((run) =>
          tab === run.id ? (
            <section key={run.id}>
              <SpecTable
                projectId={project.id}
                runId={run.id}
                onSummary={(tally) => onRunSummary(run.id, tally)}
                initialFocus={initialFocus}
              />

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

              {/* Retiring a phase takes a whole sub-quote out of the tabs and out
                  of the export. Every record on it goes with it, and both can be
                  brought back — but the reason is required, because whoever
                  finds the gap later needs to know why it is there. */}
              {retiringRun === run.id ? (
                <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
                  <p className="text-sm font-medium text-red-900">Retire “{run.name}”?</p>
                  <p className="mt-0.5 text-xs text-red-800">
                    Its {run.record_count} record{Number(run.record_count) === 1 ? "" : "s"} stop being live: they
                    leave this project&rsquo;s export and its tabs. Nothing is deleted, and the phase can be brought
                    back. A BWS job already created from one of these records is NOT removed by its absence from the
                    export — check those by hand.
                  </p>
                  <input
                    value={retireRunReason}
                    autoFocus
                    onChange={(event) => setRetireRunReason(event.target.value)}
                    placeholder="Superseded by the Rev B bill confirmed on 16 Sep"
                    className="mt-2 w-full rounded border border-red-300 bg-white px-2 py-1 text-sm"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={!retireRunReason.trim() || retiringBusy}
                      onClick={() => void retireRun(run.id)}
                    >
                      {retiringBusy ? "Retiring…" : "Retire the phase"}
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => setRetiringRun(null)}>
                      Keep it
                    </Button>
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
                  Retire this phase
                </Button>
              )}
            </section>
          ) : null,
        )}

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
          {!editingDetails && (
            <Card
              title="Project"
              className="scroll-mt-20"
              actions={
                <>
                  {dirty ? (
                    <span className="font-medium normal-case tracking-normal text-amber-800">Unsaved changes</span>
                  ) : saved ? (
                    <span className="font-medium normal-case tracking-normal text-green-700">Saved</span>
                  ) : null}
                  <Button size="xs" onClick={() => setEditingDetails(true)}>
                    Edit
                  </Button>
                </>
              }
            >
              <div id="project-details" className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
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
                    <a
                      href={`mailto:${project.shared_inbox}`}
                      className="font-mono text-xs text-blue-700 no-underline hover:underline"
                    >
                      {project.shared_inbox}
                    </a>
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
                <Detail label="Order date">{day(project.order_date)}</Detail>
                <Detail
                  label={SPECS_AGREED_LABEL}
                  tip="The gate before drawings can be issued, and the date the spec table measures Overdue against."
                >
                  {project.specs_agreed_by ? (
                    <span className="font-medium">
                      {formatDay(project.specs_agreed_by)}
                      {untilSpecs !== null && (
                        <Chip tone={untilSpecs < 0 ? "danger" : untilSpecs <= 14 ? "warn" : "plain"} className="ml-1.5">
                          {untilSpecs < 0
                            ? `${-untilSpecs} day${untilSpecs === -1 ? "" : "s"} over`
                            : untilSpecs === 0
                              ? "today"
                              : `${untilSpecs} days`}
                        </Chip>
                      )}
                    </span>
                  ) : (
                    <Unset>not set</Unset>
                  )}
                </Detail>
                <Detail label="Delivery">{day(project.delivery_date)}</Detail>
              </div>
              {/* NOT a tip. A project with no programme and a project on time
                  look identical otherwise, so this has to be readable without
                  hovering anything. */}
              {!programme && (
                <Note tone="warn">
                  No programme recorded. Nothing on this project can be flagged overdue until{" "}
                  {SPECS_AGREED_LABEL.toLowerCase()} holds a date — that is not the same as being on time.
                </Note>
              )}
            </Card>
          )}

          <form
            onSubmit={save}
            className={`mt-4 rounded-[10px] border border-neutral-200 bg-white p-4 ${editingDetails ? "" : "hidden"}`}
          >
            <h2 className="font-medium text-neutral-900">Details</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-sm text-neutral-600">
                BWS project number
                <input
                  value={project.bws_project_number}
                  readOnly
                  disabled
                  className="mt-1 w-full rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500"
                />
                <span className="mt-1 block text-xs text-neutral-500">
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
              The project&rsquo;s shared mailbox, recorded here so correspondence has one home. Leave it blank if
              there is none — that is a real choice, not a gap.
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
              What this project&rsquo;s drawings are drawn in. Used only where a page prints no unit and its own
              figures do not agree — a unit printed on the page always wins. Leave it unset and every such dimension
              asks you individually, which is the old behaviour.
            </p>
            <select
              value={form.defaultDimensionUnit}
              onChange={(event) => setForm({ ...form, defaultDimensionUnit: event.target.value })}
              className="mt-2 rounded border border-neutral-300 px-3 py-2 text-sm"
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
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <Note tone="warn">
                No programme recorded. Nothing on this project can be flagged overdue until{" "}
                {SPECS_AGREED_LABEL.toLowerCase()} holds a date — that is not the same as being on time.
              </Note>
            ) : project.specs_agreed_by === null ? (
              <Note tone="warn">
                No date for {SPECS_AGREED_LABEL.toLowerCase()}. The other dates are recorded, but Overdue is measured
                against this one, so nothing will be flagged.
              </Note>
            ) : untilSpecs !== null && untilSpecs < 0 ? (
              <Note tone="danger">
                Specifications were due {-untilSpecs} day{untilSpecs === -1 ? "" : "s"} ago. Anything outstanding on
                the spec table is overdue.
              </Note>
            ) : (
              <Note tone="plain">
                {untilSpecs === 0
                  ? "Specifications are due today."
                  : `${untilSpecs} day${untilSpecs === 1 ? "" : "s"} until specifications must be agreed.`}
              </Note>
            )}

            {dateError && <Note tone="danger">{dateError}</Note>}

            <div className="mt-4 flex items-center gap-3">
              {/* SAVED AS ONE ACT, not on blur: typing the name, tabbing to the
                  client and typing there used to lose the second box, because
                  the first blur saved and the reload re-keyed every input. */}
              <Button type="submit" variant="primary" size="sm" disabled={saving || !dirty || Boolean(dateError)}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
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

          {/* ==================================================================
              THE NUMBERS, AND EACH ONE PRESSABLE.

              The strip answers CAN I QUOTE THIS; the table under it answers WHAT
              IS STOPPING ME, one actionable row at a time, with the control
              beside the figure rather than on a screen you have to go and find.
              ================================================================== */}
          {completion.records > 0 && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-5">
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
                  meaning={`of ${summary.itemsWithQuestions.toLocaleString()} items · ${summary.toQuote.toLocaleString()} questions`}
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
                          Items with at least one question blocking a quotation, of the{" "}
                          {summary.itemsWithQuestions.toLocaleString()} that have a category —{" "}
                          {summary.toQuote.toLocaleString()} question
                          {summary.toQuote === 1 ? "" : "s"} between them.
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
          <Card
            title={
              <>
                From the preamble
                {flaggedCount > 0 && (
                  <Chip tone="warn" className="normal-case tracking-normal">
                    {flaggedCount} flagged
                  </Chip>
                )}
              </>
            }
            actions={
              notes.length > 0 ? (
                <>
                  <Button size="xs" variant="quiet" onClick={() => setNotesOpen((open) => !open)}>
                    {notesOpen ? "Collapse" : `Show the ${notes.length}`}
                  </Button>
                  {notesOpen && (
                    <Button
                      size="xs"
                      variant="quiet"
                      onClick={() =>
                        setOpenNotes(allNotesOpen ? new Set() : new Set(notes.map((note) => note.id)))
                      }
                    >
                      {allNotesOpen ? "Collapse all" : "Expand all"}
                    </Button>
                  )}
                </>
              ) : undefined
            }
          >
            {notes.length === 0 ? (
              <p className="text-xs text-neutral-500">
                Nothing yet. If the pack came with a preamble, upload it above and review what it requires. Plenty of
                projects do not have one.
              </p>
            ) : !notesOpen ? (
              <p className="text-xs text-neutral-500">
                {notes.length} note{notes.length === 1 ? "" : "s"} from the preamble. Reference material; collapsed
                by default.
              </p>
            ) : (
              <>
                <p className="text-xs text-neutral-500">
                  The conditions the whole package is built under. Flag the ones that change what gets quoted &mdash;
                  a flameproofing standard, a tolerance, a precedence clause &mdash; so they are not read at the same
                  weight as the boilerplate.
                </p>
                <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
                  {notes.map((note) => {
                    const open = openNotes.has(note.id);
                    return (
                      <li
                        key={note.id}
                        className={`px-4 py-3 text-sm ${note.flagged ? "border-l-2 border-l-amber-400 bg-amber-50" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          {/* The title is the whole row's toggle: a preamble
                              note's body runs to a paragraph, and thirty of them
                              expanded is why this section was unreadable. */}
                          <button
                            type="button"
                            onClick={() => toggleNote(note.id)}
                            aria-expanded={open}
                            className={`flex-1 text-left font-medium ${note.flagged ? "text-amber-900" : "text-neutral-900"}`}
                          >
                            {open ? "▾" : "▸"} {note.title ?? "Untitled requirement"}
                          </button>
                          <Button
                            size="xs"
                            variant="quiet"
                            title={note.flagged ? "Stop flagging this" : "Flag this as load-bearing"}
                            onClick={() => void setNoteFlag(note, !note.flagged)}
                          >
                            {note.flagged ? "★ Flagged" : "☆ Flag"}
                          </Button>
                          <Button size="xs" variant="quiet" onClick={() => void retireNote(note)}>
                            Retire
                          </Button>
                        </div>
                        {open && <p className="mt-1 whitespace-pre-line text-neutral-700">{note.body}</p>}
                        <p className="mt-1 text-xs text-neutral-500">
                          {note.topic}
                          {note.source_filename && <> &middot; {note.source_filename}</>}
                          {note.source_page && <> page {note.source_page}</>}
                          {!open && note.body.length > 0 && (
                            <> &middot; {note.body.length > 90 ? `${note.body.slice(0, 90).trimEnd()}…` : note.body}</>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>

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
