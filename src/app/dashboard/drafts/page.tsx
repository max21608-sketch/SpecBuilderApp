"use client";

// Chase emails. Choose the questions, generate a draft per recipient, download
// it, send it in Outlook, then tell the app you did.
//
// Nothing here sends anything. The app has no send path at all.
//
// ============================================================================
// FOUR DELIBERATE BEHAVIOURS
//
//   * THE UNIT ON SCREEN IS THE FURNITURE LINE, collapsed, with its questions
//     inside it and its finish options (S-301 A, B, C, D) in between. A flat
//     list of questions is 823 rows on the pilot and nobody reads it. The
//     grouping is `src/lib/chase-grouping.ts`; the table is
//     `ChaseQuestionTable`.
//
//   * Questions are split into what BLOCKS A QUOTE and what does not, and the
//     email prints them under those two headings. The split comes from
//     `questionTier` and the server recomputes it — the screen's ticks decide
//     which questions are asked, never which half they land in.
//
//   * Readiness questions are NOT selected by default. 408 of the 728 seeded
//     requirements are readiness questions, and they include deposit status,
//     COM payment plan and BWS folder setup — Ben Whistler's own commercial
//     checklist. They can be chosen, but not by accident.
//
//   * Records with no contact, no designer, no category or NO LEVEL are shown
//     as blockers with an action, never quietly left out of the counts. A
//     record with no level has no tier, so an email about it could not say
//     which half it was in; the level picker is on the blocker itself, because
//     visiting 59 records to set 59 levels is not a workflow.
//
//   * The selection SURVIVES a reload. Every card action reloads the screen,
//     and rebuilding the default selection each time silently re-ticked
//     everything the user had just untucked.
// ============================================================================
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import ChaseDraftCard, { type Draft } from "@/components/drafts/ChaseDraftCard";
import ChaseQuestionTable, { type TableQuestion } from "@/components/drafts/ChaseQuestionTable";
import ContactsPanel from "@/components/projects/ContactsPanel";
import {
  ITEM_LEVELS,
  ITEM_LEVEL_LABELS,
  type AnswerState,
  type ItemLevel,
} from "@/lib/spec-vocab";
import { type QuestionTier } from "@/lib/tgq";
import Button from "@/components/ui/Button";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  organisation: string | null;
  role: "designer" | "client" | "internal";
  designerCode: string | null;
  version: number;
  capsulePartyId?: number | null;
  capsulePartyType?: string | null;
  capsuleSyncedAt?: string | null;
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
  tier: QuestionTier | null;
  waiting: { draftId: string; sentAt: string | null; contactName: string } | null;
  // Where the question sits in the bill, so the screen can group by furniture
  // line. Display only: none of it decides what may be asked.
  level: ItemLevel | null;
  qty: number | null;
  runId: string;
  runName: string;
  parentId: string | null;
  variantLabel: string | null;
  parentRefs: string;
  parentQty: number | null;
  groupNo: number;
  groupLabel: string;
  variantCount: number;
};

type Blocked = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  designer: string | null;
  questionCount: number;
  reason: string;
};

type Levelless = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  version: number;
  /** What this app guessed, and why. It tiers nothing until accepted. */
  suggested: string | null;
  suggestedReason: string | null;
};

type Inventory = {
  groups: { contact: Contact; questions: Question[] }[];
  blocked: Blocked[];
  suggestedCodes: string[];
  uncategorised: { recordId: string; recordLabel: string; itemDescription: string }[];
  unauthored: Record<string, unknown>[];
  levelless: Levelless[];
  totals: {
    outstanding: number;
    specField: number;
    readiness: number;
    toQuote: number;
    later: number;
    noLevel: number;
    waiting: number;
    blockedRecords: number;
  };
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
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [settingLevel, setSettingLevel] = useState<string | null>(null);
  const [discard, setDiscard] = useState<{ id: string; contact_name: string; version: number }[] | null>(null);
  const [conflict, setConflict] = useState<unknown[] | null>(null);
  // The default selection is computed ONCE. After that a reload intersects the
  // user's choices with what is still selectable, so acting on a card does not
  // silently re-tick what they unticked.
  const seeded = useRef(false);

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

    const live = new Set<string>();
    const defaults = new Set<string>();
    for (const group of res.data.inventory.groups) {
      for (const question of group.questions) {
        const k = key(question.recordId, question.requirementId);
        live.add(k);
        // Both tiers of spec-field questions, minus anything already awaiting
        // a reply. Readiness is never defaulted in — decision 19.
        if (question.requirementKind === "spec_field" && !question.waiting) defaults.add(k);
      }
    }

    if (!seeded.current) {
      seeded.current = true;
      setSelected(defaults);
      return;
    }
    setSelected((prev) => new Set([...prev].filter((k) => live.has(k))));
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Say what an action returned, AFTER the reload it triggers. */
  const reloadThen = useCallback(
    async (failure: string | null) => {
      await load();
      if (failure) setError(failure);
    },
    [load],
  );

  const selectable = useMemo(() => {
    if (!data) return [];
    // EVERY question the server offered, unfiltered. The table's filters decide
    // what is listed; they must not decide what is asked, or a question
    // somebody deliberately ticked disappears from the draft when they change a
    // dropdown. Where the two disagree the table says so in words.
    return data.inventory.groups.map((group) => ({ contact: group.contact, questions: group.questions }));
  }, [data]);

  /** One flat list, each question carrying the contact it would be asked of. */
  const tableQuestions = useMemo<TableQuestion[]>(
    () =>
      selectable.flatMap((group) =>
        group.questions.map((question) => ({
          ...question,
          contactId: group.contact.id,
          contactName: group.contact.name,
        })),
      ),
    [selectable],
  );

  function toggle(recordId: string, requirementId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(recordId, requirementId);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleMany(questions: { recordId: string; requirementId: string }[], on: boolean) {
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

  /** Sets a level from the blocker list, so 59 records do not mean 59 visits. */
  async function setLevel(record: Levelless, level: string) {
    if (!level) return;
    setSettingLevel(record.recordId);
    setError(null);
    try {
      const res = await apiFetch(`/api/records/${record.recordId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level, version: record.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      setSettingLevel(null);
    }
  }

  async function generate(acknowledge: { id: string; version: number }[] = []) {
    if (!data || !projectId) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    setConflict(null);
    try {
      const selections = selectable
        .map((group) => ({
          contactId: group.contact.id,
          questions: group.questions
            .filter((q) => selected.has(key(q.recordId, q.requirementId)))
            // The server reads the tier off the live row; sending one would be
            // a 400. What the client chooses is WHICH questions to ask.
            .map((q) => ({ recordId: q.recordId, requirementId: q.requirementId })),
        }))
        .filter((group) => group.questions.length > 0);

      if (selections.length === 0) {
        setError("Choose at least one question to ask.");
        return;
      }

      const res = await apiFetch<{ created: unknown[]; superseded: number }>(`/api/drafts/generate`, {
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
      const created = res.data.created?.length ?? 0;
      await load();
      setNotice(`${created} draft${created === 1 ? "" : "s"} generated. Open each one in Outlook to send it.`);
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
        <span className="text-red-700 font-medium">{inventory.totals.toQuote}</span> needed to quote ·{" "}
        <span className="text-neutral-900 font-medium">{inventory.totals.later}</span> also outstanding ·{" "}
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
              {conflict.slice(0, 10).map((row, index) => {
                const r = row as { recordLabel?: string | null; prompt?: string | null; reason?: string; why?: string };
                return (
                  <li key={index}>
                    {r.recordLabel ? <span className="font-medium">{r.recordLabel}</span> : null}
                    {r.prompt ? ` — “${r.prompt}”` : ""} {r.reason ?? r.why ?? ""}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {notice && (
        <p className="mt-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{notice}</p>
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

      {/* ---- levels, first, because they gate everything below ------------ */}
      {inventory.levelless.length > 0 && (
        <div className="mt-4 border border-amber-300 bg-amber-50 rounded p-3">
          <p className="text-sm font-medium text-amber-900">
            {inventory.levelless.length} record{inventory.levelless.length === 1 ? " has" : "s have"} no level
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            A level says how much has to be known before the item can be priced, so until one is set nothing on
            the record can be sorted into what blocks a quote and what does not. Set them here.
          </p>
          <ul className="mt-2 space-y-1">
            {inventory.levelless.map((row) => (
              <li key={row.recordId} className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
                <Link href={`/dashboard/records/${row.recordId}`} className="underline tabular-nums">
                  {row.recordLabel}
                </Link>
                <span className="text-amber-800">{row.itemDescription}</span>
                {/* WHAT THE APP WOULD SAY, and what it read to say it. The
                    picker is pre-filled with the guess so agreeing is one
                    click — but it is still a click, and until it happens the
                    record counts as having no level. */}
                {row.suggested && (
                  <>
                    <span className="text-xs text-amber-800" title={row.suggestedReason ?? undefined}>
                      suggested: {row.suggested}
                      {row.suggestedReason && <> — {row.suggestedReason}</>}
                    </span>
                    {/* Its own button: a select pre-filled with the guess fires
                        no change event when somebody picks the guess, so
                        agreeing would silently do nothing. */}
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={settingLevel === row.recordId}
                      onClick={() => void setLevel(row, row.suggested ?? "")}
                    >
                      Accept
                    </Button>
                  </>
                )}
                <select
                  defaultValue=""
                  disabled={settingLevel === row.recordId}
                  onChange={(event) => void setLevel(row, event.target.value)}
                  className="ml-auto border border-amber-400 rounded px-2 py-0.5 text-sm bg-white disabled:opacity-50"
                >
                  <option value="">— set level —</option>
                  {ITEM_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {ITEM_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- other blockers ----------------------------------------------- */}
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

      {/* ---- what to ask, by furniture line ------------------------------- */}
      <ChaseQuestionTable
        questions={tableQuestions}
        selected={selected}
        onToggle={toggle}
        onToggleMany={toggleMany}
        generating={generating}
        onGenerate={() => void generate()}
      />

      {/* ---- drafts ------------------------------------------------------- */}
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

export default function DraftsPage() {
  return (
    <div className="px-1">
      <h1 className="text-xl font-semibold text-neutral-900">Chase emails</h1>
      <Suspense fallback={<Spinner label="Loading" />}>
        <DraftsView />
      </Suspense>
    </div>
  );
}
