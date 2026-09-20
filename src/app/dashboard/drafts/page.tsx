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
import StatTile from "@/components/ui/StatTile";
import ChaseDraftCard, { type Draft } from "@/components/drafts/ChaseDraftCard";
import ChaseQuestionTable, { type LevelSuggestion, type TableQuestion } from "@/components/drafts/ChaseQuestionTable";
import ContactsPanel from "@/components/projects/ContactsPanel";
import {
  ITEM_LEVELS,
  ITEM_LEVEL_LABELS,
  type AnswerState,
  type ItemLevel,
} from "@/lib/spec-vocab";
import { type QuestionTier } from "@/lib/tgq";
import { defaultSelection, selectionKey, selectionSummary } from "@/lib/chase-selection";
import Button from "@/components/ui/Button";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import Card from "@/components/ui/Card";
import Note from "@/components/ui/Note";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr } from "@/components/ui/Table";

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
  /** Furniture lines in the export's scope — the overview's Line items count. */
  lineCount: number | null;
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

const key = selectionKey;

/** One flat list of the inventory's questions, each carrying who it is asked of. */
const flatten = (payload: Payload) =>
  payload.inventory.groups.flatMap((group) =>
    group.questions.map((question) => ({ ...question, contactId: group.contact.id, contactName: group.contact.name })),
  );

/**
 * The contact tab for records with nobody to ask.
 *
 * They are not a group in the inventory — `splitByContact` puts a record with
 * no designer, or a designer code no contact carries, into `blocked` — so
 * their questions cannot be listed beside the others. The tab is still worth
 * its place: a chase screen that showed only what CAN be asked would hide the
 * reason 31 questions are not being asked at all.
 */
const NOBODY = "__nobody__";

/** Blocked because there is nobody to ask, as opposed to having no level. */
const isContactBlocker = (reason: string) => reason !== "no level on the record";

/**
 * The contact tab actually on screen, given what the inventory holds.
 *
 * A `contactId` from the URL may name somebody with nothing outstanding on
 * this project, or nobody at all; that falls back to Everyone. It is a
 * function rather than an expression in the render because the DEFAULT
 * SELECTION has to be seeded for the same tab the strip is showing — two
 * readings of that would preselect one person's questions under another
 * person's name.
 */
const effectiveContact = (contactId: string, payload: Payload) =>
  contactId === NOBODY || payload.inventory.groups.some((group) => group.contact.id === contactId) ? contactId : "";

function DraftsView() {
  const params = useSearchParams();
  const projectId = params.get("projectId");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [settingLevel, setSettingLevel] = useState<string | null>(null);
  const [discard, setDiscard] = useState<{ id: string; contact_name: string; version: number }[] | null>(null);
  const [conflict, setConflict] = useState<unknown[] | null>(null);
  /**
   * THE THREE FILTERS THE PAGE OWNS, because the controls for them are up here.
   *
   * The contact strip is the header band's `Tabs` — a chase is written to ONE
   * person, so "what do I owe Hayley" is this screen's primary axis. The tier
   * and the waiting toggle are the tiles, because a `StatTile` IS a filter.
   * The table holds the rest and applies all of them the same way: they narrow
   * what is LISTED and never what is ticked.
   */
  // ARRIVING ON ONE PERSON. The project's Contacts table links "Draft a chase"
  // straight to that contact, so the tab it names opens selected. Read ONCE,
  // as the initial value rather than on every render: after that the strip is
  // the truth, and re-reading it would drag somebody back to the contact in
  // the URL every time they pressed another tab.
  const [contactId, setContactId] = useState(() => params.get("contactId") ?? "");
  const [tier, setTier] = useState<"all" | QuestionTier>("all");
  const [includeWaiting, setIncludeWaiting] = useState(false);
  const [acceptingLevels, setAcceptingLevels] = useState(false);
  // The default selection is computed on FIRST LOAD and again when the contact
  // changes, and at no other time. After that a reload intersects the user's
  // choices with what is still selectable, so acting on a card does not
  // silently re-tick what they unticked.
  const seeded = useRef(false);
  // The contact the seeding should read, without putting it in `load`'s
  // dependencies: doing that would re-fetch the whole inventory every time
  // somebody pressed another tab.
  const contactRef = useRef(contactId);

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
    for (const group of res.data.inventory.groups) {
      for (const question of group.questions) {
        live.add(key(question.recordId, question.requirementId));
      }
    }

    if (!seeded.current) {
      seeded.current = true;
      // EXACTLY WHAT BLOCKS A QUOTE for the contact on screen, which may be
      // one named in the URL. It used to be both tiers across every contact,
      // which is what Max saw: 822 ticked where four were meant.
      setSelected(defaultSelection(flatten(res.data), effectiveContact(contactRef.current, res.data)));
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

  /**
   * CHANGING CONTACT RE-SEEDS THE SELECTION, and that is the default rather
   * than a convenience.
   *
   * A chase is written to ONE person. Carrying Hayley's ticks onto Claire's
   * email is a wrong default nobody would see until it had been sent, and a
   * footer counting the preselection would meanwhile describe a set the screen
   * never ticked. Nothing is remembered either way: coming back to a contact
   * re-seeds rather than restoring what was ticked before, because a
   * per-contact memory is a third state to keep in step with a question list
   * that moves under it.
   */
  function chooseContact(next: string) {
    contactRef.current = next;
    setContactId(next);
    if (data) setSelected(defaultSelection(flatten(data), effectiveContact(next, data)));
  }

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

  /**
   * Sets EVERY level-less record to one level.
   *
   * A select that writes the moment it changes, which the suggestion rule
   * forbids — but the rule is about AGREEING WITH A VALUE THE APP IS SHOWING:
   * a select pre-filled with "Simple" fires no change event when somebody
   * chooses Simple, so the one action recording their agreement does nothing.
   * This select shows no value and asserts nothing; picking one is the
   * person's own statement about all n records, and it starts empty so the
   * change always fires.
   *
   * One request per record, because there is no bulk route for a level a
   * person CHOSE — only for accepting what the app suggested. Sequential, so a
   * refusal stops the rest rather than firing 59 writes at a stale version.
   */
  async function setAllLevels(level: string) {
    if (!level || !data) return;
    setAcceptingLevels(true);
    setError(null);
    try {
      let failure: string | null = null;
      for (const record of data.inventory.levelless) {
        const res = await apiFetch(`/api/records/${record.recordId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ level, version: record.version }),
        });
        if (!res.ok) {
          failure = `${record.recordLabel}: ${res.error}`;
          break;
        }
      }
      await reloadThen(failure);
    } finally {
      setAcceptingLevels(false);
    }
  }

  /**
   * Accepts every level this app suggested, under ONE change set.
   *
   * `acceptSuggestedLevels` writes only what is already suggested and never
   * revisits a decided level, so the button can only file what the screen was
   * showing. 59 records must not mean 59 visits.
   */
  async function acceptSuggestedLevels() {
    if (!projectId) return;
    setAcceptingLevels(true);
    setError(null);
    try {
      const res = await apiFetch<{ accepted?: number }>(`/api/projects/${projectId}/levels/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) setNotice(`${res.data.accepted ?? 0} suggested level${res.data.accepted === 1 ? "" : "s"} accepted.`);
    } finally {
      setAcceptingLevels(false);
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

  if (error && !data) {
    return (
      <PageBody width="wide">
        <Note tone="danger">{error}</Note>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody width="wide">
        <Spinner label="Loading chase emails" />
      </PageBody>
    );
  }

  const { inventory, project } = data;

  /**
   * How many furniture LINES this project has, and how many are done.
   *
   * Counted over every record the inventory knows about, not over the
   * questions: a line with nothing outstanding contributes no question and
   * would be invisible in a question count, which is exactly the line the
   * second half of this tile is about.
   */
  const lineTotals = (() => {
    const withWork = new Set(inventory.groups.flatMap((group) => group.questions.map((q) => q.recordId)));
    const settled = inventory.lineCount == null ? 0 : Math.max(0, inventory.lineCount - withWork.size);
    return { lines: inventory.lineCount ?? withWork.size, settled };
  })();
  const activeDrafts = data.drafts.filter((d) => d.status === "draft");

  /**
   * The contact tab actually on screen.
   *
   * A `contactId` from the URL may name somebody who has nothing outstanding
   * on this project, or nobody at all. That falls back to Everyone SILENTLY:
   * the alternative is an empty table under a tab that is not in the strip,
   * which reads as a project with no questions on it. The SAME function seeds
   * the default selection, so the ticks can never belong to a tab the strip is
   * not showing.
   */
  const contactTab = effectiveContact(contactId, data);

  /**
   * What the preselection ticked, and what it deliberately left.
   *
   * The NOBODY tab is not a contact: it lists records with no route to a
   * person, renders no question table and has nothing to tick, so it reads as
   * "nobody chosen" rather than as a contact with nothing blocking a quote.
   */
  const preselection = selectionSummary(tableQuestions, contactTab === NOBODY ? "" : contactTab);

  /** Records nobody can be asked about, as opposed to records with no level. */
  const nobody = inventory.blocked.filter((row) => isContactBlocker(row.reason));
  const nobodyQuestions = nobody.reduce((sum, row) => sum + row.questionCount, 0);

  /** What the app guessed each level-less line is, keyed the way the table asks. */
  const levelSuggestions: Record<string, LevelSuggestion> = {};
  for (const row of inventory.levelless) {
    if (row.suggested) {
      levelSuggestions[row.recordId] = { level: row.suggested, reason: row.suggestedReason };
    }
  }
  const suggestedLevels = inventory.levelless.filter((row) => row.suggested).length;

  return (
    <>
      {/* WHERE YOU ARE, WHAT THIS IS, AND WHAT YOU CAME TO DO. The crumb goes
          back to the project, because a chase is always about one project and
          the screen is reached from it. */}
      <PageHeader
        crumbs={[{ label: `${project.bws_project_number} — ${project.name}`, href: `/dashboard/projects/${project.id}` }]}
        title="Chase what is missing"
        subtitle="Drafts only. Nothing is sent from this app — you send it from your own Outlook."
        actions={
          <>
            {/* A question already asked is EXCLUDED by default, and this is how
                you see them. Not a link: it changes what you are looking at. */}
            <Button
              variant="secondary"
              aria-pressed={includeWaiting}
              onClick={() => setIncludeWaiting((on) => !on)}
              className={includeWaiting ? "border-blue-300 bg-blue-50 text-blue-800" : ""}
            >
              Waiting on a reply
              <span className="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-px text-[11px] tabular-nums text-neutral-600">
                {inventory.totals.waiting}
              </span>
            </Button>
            <Button
              variant="primary"
              disabled={generating || selected.size === 0}
              // WHY IT IS DISABLED, not just that it is. Nothing preselected
              // for a contact whose to-quote set is empty is a real state and
              // not a fault, so the reason says what is true of THAT contact
              // rather than repeating the generic instruction.
              title={
                selected.size > 0
                  ? undefined
                  : preselection.contactChosen && preselection.preselected === 0
                    ? "Nothing needed to quote for this contact — tick a question below to ask it anyway"
                    : "Tick at least one question below"
              }
              onClick={() => void generate()}
            >
              {generating ? "Drafting…" : `Draft the email · ${selected.size} question${selected.size === 1 ? "" : "s"}`}
            </Button>
          </>
        }
        tabs={
          <Tabs
            label="Who to chase"
            value={contactTab}
            onChange={chooseContact}
            items={[
              { id: "", label: "Everyone", count: tableQuestions.length },
              ...inventory.groups.map((group) => ({
                id: group.contact.id,
                label: group.contact.name,
                count: group.questions.length,
              })),
              {
                id: NOBODY,
                label: "Nobody assigned",
                count: nobodyQuestions,
                tone: "warn" as const,
                hidden: nobody.length === 0,
              },
            ]}
          />
        }
      />

      <PageBody width="wide">
        {error && (
          <Note tone="danger">
            {error}
            {conflict && conflict.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
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
          </Note>
        )}
        {notice && <Note tone="good">{notice}</Note>}

        {discard && (
          <Note
            tone="warn"
            title="Regenerating will discard the edits on"
            actions={
              <>
                <Button
                  variant="danger"
                  size="xs"
                  disabled={generating}
                  onClick={() => generate(discard.map((d) => ({ id: d.id, version: d.version })))}
                >
                  Yes, discard and regenerate
                </Button>
                <Button variant="quiet" size="xs" disabled={generating} onClick={() => setDiscard(null)}>
                  Cancel
                </Button>
              </>
            }
          >
            {discard.map((d) => d.contact_name).join(", ")}. Those drafts will be rebuilt from the current spec data.
          </Note>
        )}

        {/* ---- levels, first, because they gate everything below ------------
            RED, because a record with no level cannot be tiered and therefore
            cannot be chased at all — it blocks the quotation, which is what red
            means here. */}
        {inventory.levelless.length > 0 && (
          <Note
            tone="danger"
            title={`${inventory.levelless.length} item${inventory.levelless.length === 1 ? " has" : "s have"} no level,`}
            actions={
              <>
                {/* A SELECT THAT WRITES ON CHANGE, which is allowed here and is
                    not allowed for a suggestion: it shows no value and asserts
                    nothing, so choosing one is the person's own statement about
                    all of them. The trap it avoids by starting empty is that a
                    pre-filled select fires no change event when somebody picks
                    the value it already shows. */}
                <select
                  value=""
                  disabled={acceptingLevels}
                  aria-label="Set every level-less item to one level"
                  onChange={(event) => void setAllLevels(event.target.value)}
                  className="rounded border border-red-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                >
                  <option value="">Set all {inventory.levelless.length} to…</option>
                  {ITEM_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {ITEM_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
                {suggestedLevels > 0 && (
                  <SuggestButton
                    value={`Accept the ${suggestedLevels} suggested`}
                    evidence="each was guessed from the bill's own words, and all of them file under one change"
                    busy={acceptingLevels}
                    onAccept={() => void acceptSuggestedLevels()}
                  />
                )}
              </>
            }
          >
            so nothing on them can be tiered and they cannot be chased.{" "}
            {suggestedLevels > 0
              ? `${suggestedLevels} ${suggestedLevels === 1 ? "has" : "have"} a suggestion.`
              : "None of them has a suggestion, so each is a decision on its own record."}
          </Note>
        )}

        {/* THE FOUR NUMBERS, AS TILES — AND EACH ONE IS A FILTER.
            ==================================================================
            A tile opens the list already narrowed to what it counts, and the
            filter it set is repeated as a removable chip in the row above the
            table, because a filter you cannot see is a filter you forget you
            set. What a tile must never do is change what is ASKED: the ticks
            are the truth, and the footer says in words how many ticked
            questions the filters are hiding. */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatTile
            label="TGQ"
            tone="danger"
            value={inventory.totals.toQuote}
            meaning="blocking a quotation"
            action={tier === "to_quote" ? "showing these" : "show these"}
            onPress={() => setTier(tier === "to_quote" ? "all" : "to_quote")}
            active={tier === "to_quote"}
          />
          <StatTile
            label="Also outstanding"
            tone="warn"
            value={inventory.totals.later}
            meaning="not holding up the quote"
            action={tier === "later" ? "showing these" : "show these"}
            onPress={() => setTier(tier === "later" ? "all" : "later")}
            active={tier === "later"}
          />
          <StatTile
            label="Waiting on a reply"
            tone="info"
            value={inventory.totals.waiting}
            meaning="asked, nothing back"
            action={includeWaiting ? "hide them again" : "include them"}
            onPress={() => setIncludeWaiting((on) => !on)}
            active={includeWaiting}
          />
          {/* THE UNIT ON SCREEN. The table below is one row per furniture line,
              not one per question, so the count that says how big the job is is
              a count of LINES. How many have nothing left is the second half of
              it: a line with nothing outstanding contributes no row, and
              "11 lines" over eight visible rows is a question about the data. */}
          <StatTile
            label="Furniture lines"
            value={lineTotals.lines}
            meaning={
              lineTotals.settled > 0
                ? `${lineTotals.settled} with nothing outstanding`
                : "every one has something outstanding"
            }
            action={tier !== "all" || includeWaiting ? "show all" : undefined}
            onPress={
              tier !== "all" || includeWaiting
                ? () => {
                    setTier("all");
                    setIncludeWaiting(false);
                  }
                : undefined
            }
          />
        </div>

        {/* A DRAFT WITH NO Cc IS A CHASE NOBODY ELSE CAN SEE. Said in words, not
            hidden in a tip: an unset inbox and a set one render identically
            otherwise. */}
        <p className="mt-2 text-xs text-neutral-500">
          Cc:{" "}
          {project.shared_inbox ? (
            project.shared_inbox
          ) : (
            <span className="text-amber-800">no project inbox set — drafts will have no Cc</span>
          )}
        </p>

        <ContactsPanel
          projectId={project.id}
          contacts={data.contacts}
          suggestedCodes={inventory.suggestedCodes}
          onChanged={() => void load()}
        />

        {contactTab === NOBODY ? (
          /* NOBODY TO ASK. These records have questions and no route to a
             person, so they are not in the table above at any filter — the tab
             exists so they are not invisible either. */
          <Card
            flush
            title={
              <>
                Nobody assigned
                <span className="font-medium normal-case tracking-normal text-neutral-500">
                  {" "}· {nobodyQuestions} question{nobodyQuestions === 1 ? "" : "s"} with no route to a person
                </span>
              </>
            }
          >
            <Table>
              <thead>
                <tr>
                  <Th className="w-[16%]">Record</Th>
                  <Th>Item</Th>
                  <Th className="w-[34%]">Why nobody can be asked</Th>
                  <Th num className="w-[12%]">Questions</Th>
                </tr>
              </thead>
              <tbody>
                {nobody.map((row) => (
                  <Tr key={row.recordId}>
                    <Td>
                      <Link
                        href={`/dashboard/records/${row.recordId}`}
                        className="font-mono text-blue-700 no-underline hover:underline"
                      >
                        {row.recordLabel}
                      </Link>
                    </Td>
                    <Td>{row.itemDescription}</Td>
                    <Td>
                      <Chip tone="warn">{row.reason}</Chip>
                      {row.designer && <span className="ml-2 text-neutral-500">designer code {row.designer}</span>}
                    </Td>
                    <Td num>{row.questionCount}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          /* ---- what to ask, by furniture line ------------------------------ */
          <ChaseQuestionTable
            questions={tableQuestions}
            selected={selected}
            onToggle={toggle}
            onToggleMany={toggleMany}
            generating={generating}
            onGenerate={() => void generate()}
            contactId={contactTab}
            tier={tier}
            onTier={setTier}
            includeWaiting={includeWaiting}
            onIncludeWaiting={setIncludeWaiting}
            levelSuggestions={levelSuggestions}
            onAcceptLevel={(recordId) => {
              const row = inventory.levelless.find((entry) => entry.recordId === recordId);
              if (row?.suggested) void setLevel(row, row.suggested);
            }}
            acceptingLevel={settingLevel}
          />
        )}

        {/* ---- the blockers that are not about a contact -------------------- */}
        {(inventory.uncategorised.length > 0 || inventory.unauthored.length > 0) && (
          <Note tone="warn" title="Cannot be chased at all:">
            <ul className="mt-1 space-y-0.5">
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
          </Note>
        )}

        {/* ---- drafts ------------------------------------------------------- */}
        <h2 className="mt-8 text-th font-bold uppercase tracking-wider text-neutral-500">
          Drafts
          {activeDrafts.length > 0 && (
            <span className="font-medium normal-case tracking-normal"> · {activeDrafts.length} ready to send</span>
          )}
        </h2>
        {data.drafts.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">
            No drafts yet. Tick the questions to ask above, then press Draft it.
          </p>
        ) : (
          <div className="space-y-4">
            {data.drafts.map((draft) => (
              <ChaseDraftCard key={draft.id} draft={draft} onChanged={() => void load()} />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}

export default function DraftsPage() {
  return (
    <Suspense fallback={<PageBody width="wide"><Spinner label="Loading" /></PageBody>}>
      <DraftsView />
    </Suspense>
  );
}
