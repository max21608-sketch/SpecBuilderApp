"use client";

// Chase emails. Choose the questions, generate a draft per recipient, download
// it, send it in Outlook, then tell the app you did.
//
// Nothing here sends anything. The app has no send path at all.
//
// Two deliberate behaviours to preserve:
//
//   * Readiness questions are NOT selected by default. 408 of the 728 seeded
//     requirements are readiness questions, and they include deposit status,
//     COM payment plan and BWS folder setup — Ben Whistler's own commercial
//     checklist. They can be chosen, but not by accident.
//
//   * Records with no contact, no designer or no authored category are shown
//     as blockers with an action, never quietly left out of the counts.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import ChaseDraftCard, { type Draft } from "@/components/drafts/ChaseDraftCard";
import ContactsPanel from "@/components/projects/ContactsPanel";
import { ANSWER_STATE_LABELS, type AnswerState } from "@/lib/spec-vocab";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  organisation: string | null;
  role: "designer" | "client" | "internal";
  designerCode: string | null;
  version: number;
};

type Question = {
  recordId: string;
  requirementId: string;
  recordLabel: string;
  refs: string;
  itemDescription: string;
  area: string | null;
  prompt: string;
  requirementKind: "spec_field" | "readiness";
  fieldLabel: string | null;
  state: AnswerState;
  waiting: { draftId: string; sentAt: string | null; contactName: string } | null;
};

type Inventory = {
  groups: { contact: Contact; questions: Question[] }[];
  blocked: { recordId: string; recordLabel: string; itemDescription: string; designer: string | null; questionCount: number; reason: string }[];
  suggestedCodes: string[];
  uncategorised: { recordId: string; recordLabel: string; itemDescription: string }[];
  unauthored: Record<string, unknown>[];
  totals: { outstanding: number; specField: number; readiness: number; waiting: number; blockedRecords: number };
};

type Payload = {
  project: { id: string; bws_project_number: string; name: string; shared_inbox: string | null; version: number };
  contacts: Contact[];
  drafts: Draft[];
  inventory: Inventory;
};

const key = (recordId: string, requirementId: string) => `${recordId}:${requirementId}`;

function DraftsView() {
  const projectId = useSearchParams().get("projectId");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeChased, setIncludeChased] = useState(false);
  const [showReadiness, setShowReadiness] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [discard, setDiscard] = useState<{ id: string; contact_name: string; version: number }[] | null>(null);
  const [conflict, setConflict] = useState<unknown[] | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setError("No project selected.");
      return;
    }
    const res = await apiFetch<Payload>(`/api/drafts?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
    // Default selection: outstanding spec-field questions that are not already
    // waiting on a reply. Recomputed on every load so a confirmed send drops
    // its questions out of the next selection.
    const next = new Set<string>();
    for (const group of res.data.inventory.groups) {
      for (const question of group.questions) {
        if (question.requirementKind !== "spec_field") continue;
        if (question.waiting) continue;
        next.add(key(question.recordId, question.requirementId));
      }
    }
    setSelected(next);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectable = useMemo(() => {
    if (!data) return [];
    return data.inventory.groups.map((group) => ({
      contact: group.contact,
      questions: group.questions.filter((q) => (includeChased ? true : !q.waiting)),
    }));
  }, [data, includeChased]);

  const selectedCount = selected.size;

  function toggle(recordId: string, requirementId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(recordId, requirementId);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleGroup(questions: Question[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const q of questions) {
        const k = key(q.recordId, q.requirementId);
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  async function generate(acknowledge: { id: string; version: number }[] = []) {
    if (!data || !projectId) return;
    setGenerating(true);
    setError(null);
    setConflict(null);
    try {
      const selections = selectable
        .map((group) => ({
          contactId: group.contact.id,
          questions: group.questions
            .filter((q) => selected.has(key(q.recordId, q.requirementId)))
            .map((q) => ({ recordId: q.recordId, requirementId: q.requirementId })),
        }))
        .filter((group) => group.questions.length > 0);

      if (selections.length === 0) {
        setError("Choose at least one question to ask.");
        return;
      }

      const res = await apiFetch<{ created: unknown[] }>(`/api/drafts/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          selections,
          // The drafts we were looking at. An empty array asserts there were
          // none, which is what stops two people generating at once.
          expectedCurrentDrafts: data.drafts
            .filter((d) => d.status === "draft")
            .map((d) => ({ id: d.id, version: d.version })),
          acknowledgeDiscard: acknowledge,
        }),
      });

      if (!res.ok) {
        if (res.data?.code === "unacknowledged_edits") {
          setDiscard(res.data.diff as { id: string; contact_name: string; version: number }[]);
          return;
        }
        setError(res.error);
        if (Array.isArray(res.data?.diff)) setConflict(res.data.diff as unknown[]);
        return;
      }
      setDiscard(null);
      await load();
    } finally {
      setGenerating(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading chase emails" />;

  const { inventory, project } = data;
  const activeDrafts = data.drafts.filter((d) => d.status === "draft");

  return (
    <>
      <p className="mt-1 text-sm text-neutral-600">
        {project.bws_project_number} {project.name} ·{" "}
        <span className="text-neutral-900 font-medium">{inventory.totals.outstanding}</span> outstanding ·{" "}
        <span className="text-blue-700 font-medium">{inventory.totals.waiting}</span> awaiting a reply
        {inventory.totals.blockedRecords > 0 && (
          <>
            {" · "}
            <span className="text-amber-800 font-medium">{inventory.totals.blockedRecords}</span> record
            {inventory.totals.blockedRecords === 1 ? "" : "s"} that cannot be chased
          </>
        )}
      </p>

      <p className="mt-1 text-xs text-neutral-500">
        Cc:{" "}
        {project.shared_inbox ? (
          project.shared_inbox
        ) : (
          <span className="text-amber-800">no project inbox set — drafts will have no Cc</span>
        )}
      </p>

      {error && (
        <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
          {conflict && conflict.length > 0 && (
            <ul className="mt-1 list-disc list-inside">
              {conflict.slice(0, 10).map((row, index) => (
                <li key={index}>
                  {String((row as { recordLabel?: string }).recordLabel ?? "")}{" "}
                  {String((row as { reason?: string; why?: string }).reason ?? (row as { why?: string }).why ?? "")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {discard && (
        <div className="mt-3 border border-amber-300 bg-amber-50 rounded p-3 text-sm text-amber-900">
          <p className="mb-2">
            Regenerating will discard the edits on{" "}
            <span className="font-medium">{discard.map((d) => d.contact_name).join(", ")}</span>. Those drafts
            will be rebuilt from the current spec data.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={generating}
              onClick={() => generate(discard.map((d) => ({ id: d.id, version: d.version })))}
              className="text-sm px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50"
            >
              Yes, discard and regenerate
            </button>
            <button
              type="button"
              disabled={generating}
              onClick={() => setDiscard(null)}
              className="text-sm px-2 py-1 rounded border border-amber-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ContactsPanel
        projectId={project.id}
        contacts={data.contacts}
        suggestedCodes={inventory.suggestedCodes}
        onChanged={() => void load()}
      />

      {/* ---- blockers --------------------------------------------------- */}
      {(inventory.blocked.length > 0 || inventory.uncategorised.length > 0 || inventory.unauthored.length > 0) && (
        <div className="mt-4 border border-amber-200 bg-amber-50 rounded p-3">
          <p className="text-sm font-medium text-amber-900 mb-1">
            Cannot be chased ({inventory.blocked.length + inventory.uncategorised.length + inventory.unauthored.length})
          </p>
          <ul className="text-sm text-amber-900 space-y-0.5">
            {inventory.blocked.map((row) => (
              <li key={row.recordId}>
                <Link href={`/dashboard/records/${row.recordId}`} className="underline">
                  {row.recordLabel}
                </Link>{" "}
                {row.itemDescription} — {row.reason}
                {row.designer ? ` (${row.designer})` : ""} · {row.questionCount} question
                {row.questionCount === 1 ? "" : "s"}
              </li>
            ))}
            {inventory.uncategorised.map((row) => (
              <li key={row.recordId}>
                <Link href={`/dashboard/records/${row.recordId}`} className="underline">
                  {row.recordLabel}
                </Link>{" "}
                {row.itemDescription} — no category, so there is no checklist to measure it against
              </li>
            ))}
            {inventory.unauthored.map((row) => (
              <li key={String(row.id)}>
                <Link href={`/dashboard/records/${String(row.id)}`} className="underline">
                  {String(row.bws_project_number)}-{String(row.record_no).padStart(3, "0")}
                </Link>{" "}
                {String(row.item_description)} — {String(row.category_name)} has no requirements authored yet
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            A record with nobody to ask needs a contact — add one above.
          </p>
        </div>
      )}

      {/* ---- selection --------------------------------------------------- */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-neutral-800">Questions to ask</h2>
        <label className="flex items-center gap-1.5 text-sm text-neutral-700">
          <input type="checkbox" checked={includeChased} onChange={(e) => setIncludeChased(e.target.checked)} />
          Include questions already awaiting a reply
        </label>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating || selectedCount === 0}
          className="ml-auto text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {generating ? "Generating…" : `Generate drafts (${selectedCount})`}
        </button>
      </div>

      {selectable.length === 0 && (
        <p className="mt-2 text-sm text-neutral-600">
          Nothing outstanding can be matched to a contact yet.
        </p>
      )}

      {selectable.map((group) => {
        const spec = group.questions.filter((q) => q.requirementKind === "spec_field");
        const readiness = group.questions.filter((q) => q.requirementKind === "readiness");
        return (
          <div key={group.contact.id} className="mt-3 border border-neutral-200 rounded-lg bg-white">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100">
              <span className="text-sm font-medium text-neutral-900">{group.contact.name}</span>
              <span className="text-xs text-neutral-500">
                {group.contact.email ?? <span className="text-amber-700">no email on file</span>}
                {group.contact.designerCode ? ` · ${group.contact.designerCode}` : ""}
              </span>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(spec, true)}
                  className="text-xs underline text-neutral-600 hover:text-neutral-900"
                >
                  Select spec fields
                </button>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.questions, false)}
                  className="text-xs underline text-neutral-600 hover:text-neutral-900"
                >
                  Clear
                </button>
              </span>
            </div>

            <QuestionList questions={spec} selected={selected} onToggle={toggle} />

            {readiness.length > 0 && (
              <div className="border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setShowReadiness((v) => !v)}
                  className="w-full text-left px-3 py-2 text-xs text-amber-900 bg-amber-50 hover:bg-amber-100"
                >
                  {showReadiness ? "▾" : "▸"} {readiness.length} readiness question
                  {readiness.length === 1 ? "" : "s"} — internal and commercial, not selected by default
                </button>
                {showReadiness && <QuestionList questions={readiness} selected={selected} onToggle={toggle} />}
              </div>
            )}
          </div>
        );
      })}

      {/* ---- drafts ------------------------------------------------------ */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-800">
        Drafts {activeDrafts.length > 0 && <span className="text-neutral-500">({activeDrafts.length} ready)</span>}
      </h2>
      {data.drafts.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">
          No drafts yet. Choose questions above and click Generate drafts.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {data.drafts.map((draft) => (
            <ChaseDraftCard key={draft.id} draft={draft} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </>
  );
}

function QuestionList({
  questions,
  selected,
  onToggle,
}: {
  questions: Question[];
  selected: Set<string>;
  onToggle: (recordId: string, requirementId: string) => void;
}) {
  if (questions.length === 0) {
    return <p className="px-3 py-2 text-sm text-neutral-500">Nothing outstanding.</p>;
  }
  return (
    <ul className="divide-y divide-neutral-100">
      {questions.map((question) => {
        const k = `${question.recordId}:${question.requirementId}`;
        return (
          <li key={k} className="px-3 py-1.5 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.has(k)}
              onChange={() => onToggle(question.recordId, question.requirementId)}
            />
            <span className="min-w-0 flex-1">
              <span className="text-neutral-500 tabular-nums">{question.recordLabel}</span>{" "}
              {question.refs && <span className="font-medium text-neutral-900">{question.refs}</span>}{" "}
              <span className="text-neutral-700">{question.itemDescription}</span>
              <span className="block text-neutral-900">{question.prompt}</span>
              {question.fieldLabel && (
                <span className="block text-xs text-neutral-500">BWS: {question.fieldLabel.trim()}</span>
              )}
            </span>
            <span className="shrink-0 flex items-center gap-1.5">
              <span
                className={`text-xs px-2 py-0.5 rounded border ${
                  question.state === "tbc"
                    ? "text-amber-800 border-amber-300 bg-amber-50"
                    : "text-red-700 border-red-300 bg-red-50"
                }`}
              >
                {ANSWER_STATE_LABELS[question.state]}
              </span>
              {question.waiting && (
                <span
                  className="text-xs px-2 py-0.5 rounded border text-blue-800 border-blue-300 bg-blue-50"
                  title={`Asked ${question.waiting.contactName}${question.waiting.sentAt ? ` on ${new Date(question.waiting.sentAt).toLocaleDateString()}` : ""}`}
                >
                  Waiting
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function DraftsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Chase emails</h1>
      <Suspense fallback={<Spinner label="Loading" />}>
        <DraftsView />
      </Suspense>
    </div>
  );
}
