"use client";
// The category's cheat sheet, as questions, for one record.
//
// ============================================================================
// FORTY-THREE QUESTIONS WITH NO SENSE OF WHICH MATTER WHEN IS WHAT MADE THIS
// UNUSABLE.
//
// So the screen opens filtered to the ones that block a QUOTE, and the tiles
// above it are the filter. Three rules travel with that, all of them the chase
// screen's, learned there the hard way:
//
//  - A FILTER NARROWS WHAT IS LISTED, never what is asked and never what an
//    edit touches. Hiding a question does not answer it, and the row that is
//    hidden is still counted in every number on this screen.
//  - THE FILTER IS VISIBLE IN WORDS. A filter you cannot see is a filter you
//    forget you set, so the active tile is outlined AND repeated as a
//    removable chip, and the footer says how many of the total are showing.
//  - THE TILES' NUMBERS ARE THE RECORD'S OWN, whatever is listed. They come
//    from `quoteReadiness`, which is `loadOutstanding`'s own tiering filtered
//    to this record — not a second count of the same thing.
//
// ---- THE RIGHT-HAND COLUMN IS THE NEXT ACTION, NOT JUST PROVENANCE ---------
//
// A settled answer links to the page it came from. An unanswered one links to
// the person who owes it, or says when it was last chased. `spec_answers`
// carries no page of its own — the composed Dimensions cell has four — so the
// link is read off the ATTRIBUTE that filled the answer, which is the row that
// actually holds what a document said and where it said it.
//
// ---- AND THE STATE IS STILL A CONTROL --------------------------------------
//
// The approved mock-up draws the state as a static pill. It is a `select`
// here, wearing the pill's colours, because a static pill would remove the
// only way in the app to record TBC or N/A — and TBC is a real, distinct state
// from missing, which is the oldest rule in this repo. Choosing a state is a
// change event on a value the server holds, which is not the pre-selected
// accept control the level picker documents.
// ============================================================================
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ANSWER_STATES,
  ANSWER_STATE_LABELS,
  ANSWER_STATE_TONE,
  type AnswerState,
  type ItemLevel,
} from "@/lib/spec-vocab";
import { questionTierOrNull, TIER_LABELS } from "@/lib/tgq";
import { formatDay } from "@/lib/format-day";
import type { Palette } from "@/lib/palettes";
import type { Gate, GateField } from "@/lib/gates";
import AnswerValue from "@/components/records/AnswerValue";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import StatTile from "@/components/ui/StatTile";
import Tip from "@/components/ui/Tip";
import Button from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import { TONE } from "@/components/ui/tone";

/** Only the parts of a checklist answer this screen reads. */
export type ChecklistAnswer = {
  requirement_id: string;
  prompt: string;
  help_text: string | null;
  section: string | null;
  tgq_levels: string[] | null;
  field_name: string | null;
  json_id: number | null;
  local_key: string | null;
  answer_id: string | null;
  value: string | null;
  qualifier: string | null;
  state: AnswerState;
  version: number;
};

/** Only the parts of a captured spec this screen reads — its page, and its finish. */
export type ChecklistAttribute = {
  json_id: number | null;
  dimension_slot: string | null;
  finish_state: string | null;
  source_run_id: string | null;
  source_page: number | null;
  source_filename: string | null;
};

type MatrixField = Pick<GateField, "localKey" | "fieldName"> & {
  gate: Gate;
  jsonId: number | null;
};

/** Which rows the screen is narrowed to. Null is everything. */
type Focus = "tgq" | "later" | "settled" | "na" | null;

const FOCUS_LABELS: Record<Exclude<Focus, null>, string> = {
  tgq: "TGQ",
  later: "Also outstanding",
  settled: "Settled",
  na: "Not applicable",
};

/**
 * A rule a reader would otherwise have to know, on the question that carries
 * it. Keyed by BWS field id, because the rule belongs to the FIELD.
 *
 * Deliberately short. A tip is one or two sentences; anything longer belongs
 * in the docs, and anything whose absence would MISLEAD stays on the page in
 * words (the unheld-palette sentence under the control is the standing case).
 */
const FIELD_TIPS: Record<number, string> = {
  3: "BWS field 3. All five slots — W, D, H, SH and Dia — compose into this one cell, so answering it is not the same as measuring a seat height.",
};

const isOutstanding = (state: AnswerState) => state === "missing" || state === "tbc";

/**
 * Question / Answer / State / Source, one template written once.
 *
 * Stacked below 760px, where four columns of which two are controls is
 * unreadable. Repeated on the header and on each row rather than reached for
 * with `subgrid`, so a row can carry its own border without the header
 * inheriting it.
 */
const ROW_GRID = "grid grid-cols-1 min-[760px]:grid-cols-[1fr_240px_110px_120px]";

/**
 * The key `waiting` is keyed by, as the server builds it.
 *
 * `questionKey` lives in `chase-drafts.ts`, which imports the database driver
 * — importing it into a client component would pull the driver into the
 * browser bundle. Written out here rather than moved, because moving it
 * touches a file three other screens are being rebuilt against in parallel.
 * The shape is asserted by a component test; if it ever diverges, the Source
 * column silently stops saying "chased".
 */
const questionKey = (recordId: string, requirementId: string) => `${recordId}:${requirementId}:0`;

export default function RecordChecklist({
  recordId,
  projectId,
  answers,
  level,
  tgqMatrix,
  matrixFields,
  palettes,
  paletteByQuestion,
  waiting,
  designerContact,
  attributes,
  readiness,
  savingId,
  reloadKey,
  onSave,
}: {
  projectId: string;
  answers: ChecklistAnswer[];
  level: ItemLevel | null;
  tgqMatrix: { fields: number[]; localKeys: string[] } | null;
  matrixFields: MatrixField[] | null;
  palettes: (Omit<Palette, "options"> & {
    allows_free_text: boolean;
    source_note: string | null;
    synced_at: string | null;
    options: Palette["options"];
  })[];
  paletteByQuestion: { json_id: number | null; local_key: string | null; palette_key: string }[];
  /** Keyed by `questionKey(recordId, requirementId, 0)`. */
  waiting: Record<string, { draftId: string; sentAt: string | null; contactName: string }>;
  designerContact: { name: string; designer_code: string } | null;
  attributes: ChecklistAttribute[];
  readiness: {
    toQuote: number | null;
    alsoOutstanding: number | null;
    outstanding: number;
    settled: number;
    notApplicable: number;
    noLevel: boolean;
  };
  savingId: string | null;
  reloadKey: number;
  onSave: (answer: ChecklistAnswer, value: string, state: AnswerState) => void;
  recordId: string;
}) {
  // Opens on the questions that hold up a price, which is the only reading of
  // "is this done" worth anything at tender stage. Off where the record has no
  // level: `toQuote` is then null, and filtering to a number that does not
  // exist would show an empty screen with no explanation.
  const [focus, setFocus] = useState<Focus>(
    readiness.toQuote !== null && readiness.toQuote > 0 ? "tgq" : null,
  );
  const [search, setSearch] = useState("");

  const matrix = useMemo(
    () =>
      tgqMatrix
        ? { fields: new Set<number>(tgqMatrix.fields), localKeys: new Set<string>(tgqMatrix.localKeys) }
        : null,
    [tgqMatrix],
  );

  const tierOf = (answer: ChecklistAnswer) =>
    questionTierOrNull(
      { tgqLevels: answer.tgq_levels ?? [], jsonId: answer.json_id, localKey: answer.local_key },
      level,
      matrix,
    );

  // ---- which palette a question offers -------------------------------------
  //
  // The link is Matthew's matrix, which is what says "Stitching spec is one of
  // these three" — so it is looked up by the BWS field the question points at,
  // or by the local key on the six questions that have no BWS field at all.
  const palettesByKey = useMemo(
    () =>
      new Map(
        (palettes ?? []).map((row) => [
          row.key,
          {
            key: row.key,
            name: row.name,
            owner: row.owner,
            allowsFreeText: Boolean(row.allows_free_text),
            sourceNote: row.source_note,
            syncedAt: row.synced_at,
            options: row.options ?? [],
          } satisfies Palette,
        ]),
      ),
    [palettes],
  );
  const paletteKeys = useMemo(() => {
    const byField = new Map<number, string>();
    const byLocal = new Map<string, string>();
    for (const row of paletteByQuestion ?? []) {
      if (row.json_id !== null && row.json_id !== undefined) byField.set(Number(row.json_id), row.palette_key);
      if (row.local_key) byLocal.set(row.local_key, row.palette_key);
    }
    return { byField, byLocal };
  }, [paletteByQuestion]);
  const paletteFor = (answer: ChecklistAnswer): Palette | null => {
    const key =
      (answer.local_key ? paletteKeys.byLocal.get(answer.local_key) : undefined) ??
      (answer.json_id !== null ? paletteKeys.byField.get(answer.json_id) : undefined);
    return key ? (palettesByKey.get(key) ?? null) : null;
  };

  // ---- where an answer came from, and which gates want it ------------------
  //
  // `spec_answers` holds no page. The ATTRIBUTE that filled it does, so the
  // provenance is read from the row that actually carries what a document said
  // — field 3 through any of its slots, because all five compose into it.
  const attributeFor = (answer: ChecklistAnswer): ChecklistAttribute | null => {
    if (answer.json_id === null) return null;
    if (answer.json_id === 3) return attributes.find((row) => row.dimension_slot) ?? null;
    return attributes.find((row) => row.json_id === answer.json_id) ?? null;
  };
  /** Every gate of Matthew's matrix that asks for this question's field. */
  const gatesFor = (answer: ChecklistAnswer): Gate[] => {
    if (!matrixFields) return [];
    const rows = matrixFields.filter(
      (row) =>
        (answer.json_id !== null && row.jsonId === answer.json_id) ||
        (answer.local_key !== null && row.localKey === answer.local_key),
    );
    return [...new Set(rows.map((row) => row.gate))];
  };

  // ---- the four tiles ------------------------------------------------------
  //
  // `later` is split into what nobody has looked at and what somebody said is
  // not decided yet. They are two different things, and the tile's one line is
  // where the difference fits.
  const laterSplit = useMemo(() => {
    let unlooked = 0;
    let tbc = 0;
    for (const answer of answers) {
      if (!isOutstanding(answer.state)) continue;
      if (tierOf(answer) === "to_quote") continue;
      if (answer.state === "missing") unlooked += 1;
      else tbc += 1;
    }
    return { unlooked, tbc };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tierOf is rebuilt every render from these.
  }, [answers, level, matrix]);

  const matches = (answer: ChecklistAnswer): boolean => {
    const term = search.trim().toLowerCase();
    if (term && !`${answer.prompt} ${answer.field_name ?? ""} ${answer.value ?? ""}`.toLowerCase().includes(term)) {
      return false;
    }
    if (focus === null) return true;
    if (focus === "settled") return answer.state === "confirmed";
    if (focus === "na") return answer.state === "na";
    if (!isOutstanding(answer.state)) return false;
    return focus === "tgq" ? tierOf(answer) === "to_quote" : tierOf(answer) !== "to_quote";
  };

  const shown = answers.filter(matches);
  const sections = shown.reduce<Map<string, ChecklistAnswer[]>>((map, answer) => {
    const key = answer.section ?? "Other";
    map.set(key, [...(map.get(key) ?? []), answer]);
    return map;
  }, new Map());
  /** How many the category asks in each section, whatever the filter hides. */
  const sectionTotals = answers.reduce<Map<string, number>>((map, answer) => {
    const key = answer.section ?? "Other";
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map());

  if (answers.length === 0) {
    return (
      <Note tone="warn" title="No checklist yet.">
        This record has no category, so there are no questions to ask. Choosing one on the Specs tab, under
        <em> This item</em> → Edit, creates them. Until then the record scores nothing outstanding, which is not the
        same as having nothing outstanding.
      </Note>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          label={TIER_LABELS.to_quote}
          tone="danger"
          value={readiness.toQuote ?? "—"}
          meaning={readiness.noLevel ? "no level, so nothing is tiered" : "blocks a price going out"}
          action={readiness.toQuote ? "show these" : undefined}
          onPress={readiness.toQuote ? () => setFocus(focus === "tgq" ? null : "tgq") : undefined}
          active={focus === "tgq"}
        />
        <StatTile
          label={TIER_LABELS.later}
          tone="warn"
          value={readiness.alsoOutstanding ?? readiness.outstanding}
          meaning={`${laterSplit.unlooked} unlooked · ${laterSplit.tbc} TBC`}
          action="show these"
          onPress={() => setFocus(focus === "later" ? null : "later")}
          active={focus === "later"}
        />
        <StatTile
          label="Settled"
          tone="good"
          value={readiness.settled}
          meaning="confirmed against a document or a person"
          action="show these"
          onPress={() => setFocus(focus === "settled" ? null : "settled")}
          active={focus === "settled"}
        />
        <StatTile
          label="Not applicable"
          tone="plain"
          value={readiness.notApplicable}
          meaning={readiness.notApplicable === 0 ? "no question ruled out yet" : "ruled out for this item"}
          action="show these"
          onPress={() => setFocus(focus === "na" ? null : "na")}
          active={focus === "na"}
        />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search the questions"
          className="w-[250px] rounded border border-neutral-300 px-2.5 py-1.5 text-sm"
        />
        {/* THE FILTER, IN WORDS AND REMOVABLE. A filter you cannot see is a
            filter you forget you set. */}
        {focus && (
          <Button variant="quiet" size="xs" onClick={() => setFocus(null)}>
            <Chip tone={focus === "tgq" ? "danger" : focus === "later" ? "warn" : focus === "settled" ? "good" : "plain"}>
              {FOCUS_LABELS[focus]} ✕
            </Chip>
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-neutral-500">
          showing {shown.length} of {answers.length}
        </span>
        {(focus || search.trim()) && (
          <Button
            variant="quiet"
            size="xs"
            onClick={() => {
              setFocus(null);
              setSearch("");
            }}
          >
            show all {answers.length}
          </Button>
        )}
      </div>

      {shown.length === 0 && (
        <Note tone="plain">
          Nothing matches. The {answers.length} questions are all still there — a filter narrows what is listed and
          never what is asked.
        </Note>
      )}

      {[...sections.entries()].map(([section, rows]) => (
        <Card
          key={section}
          title={section}
          actions={
            <CardHeadingNote>
              {rows.length} of {sectionTotals.get(section) ?? rows.length} here
            </CardHeadingNote>
          }
          flush
        >
          <div>
            <div className={`${ROW_GRID} hidden border-b border-neutral-200 bg-[#fcfcfc] min-[760px]:grid`}>
              <div className="px-4 py-2 text-th font-semibold uppercase tracking-wider text-neutral-500">Question</div>
              <div className="px-4 py-2 text-th font-semibold uppercase tracking-wider text-neutral-500">Answer</div>
              <div className="px-4 py-2 text-center text-th font-semibold uppercase tracking-wider text-neutral-500">
                State
              </div>
              <div className="px-4 py-2 text-right text-th font-semibold uppercase tracking-wider text-neutral-500">
                Source
              </div>
            </div>

            {rows.map((answer) => {
              const tier = tierOf(answer);
              const attribute = attributeFor(answer);
              const gates = gatesFor(answer);
              return (
                <div key={answer.requirement_id} className={`${ROW_GRID} border-b border-neutral-100`}>
                  <div className="flex items-start gap-2 px-4 py-2.5">
                    {/* The tier survives a widened filter: a red dot beside a
                        question says it blocks a price even when the list is
                        showing everything. */}
                    {tier === "to_quote" && (
                      <span
                        aria-label={TIER_LABELS.to_quote}
                        title={TIER_LABELS.to_quote}
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE.danger.dot}`}
                      />
                    )}
                    <span className="min-w-0">
                      <span className="text-neutral-900">{answer.prompt}</span>
                      {answer.json_id !== null && FIELD_TIPS[answer.json_id] && (
                        <Tip>{FIELD_TIPS[answer.json_id]!}</Tip>
                      )}
                      {answer.field_name && (
                        <span className="mt-0.5 block text-[11px] text-neutral-400">
                          BWS {answer.json_id} · {answer.field_name.trim()}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="px-4 py-2.5">
                    {/* A DROPDOWN ONLY WHERE THIS APP HOLDS THE LIST. Five of
                        Matthew's eleven palettes are BWS-owned and we have none
                        of them; those stay free text and say so in one line,
                        because an empty select reads as broken. The control is
                        re-keyed on every reload so it always shows what the
                        SERVER holds. */}
                    <AnswerValue
                      palette={paletteFor(answer)}
                      value={answer.value}
                      disabled={savingId === answer.answer_id}
                      inputKey={`${answer.answer_id}:${answer.version}:${reloadKey}`}
                      onCommit={(next) => onSave(answer, next, next ? "confirmed" : "missing")}
                    />
                    {/* THE RETURN LINE (0029): the spec on top, where it goes
                        underneath. The exported cell joins them with a hyphen
                        and a reader checking against a page has to be able to
                        tell which half the document said. */}
                    {answer.qualifier && (
                      <p className="mt-1 text-[11px] text-neutral-500">{answer.qualifier}</p>
                    )}
                  </div>

                  <div className="px-4 py-2.5 min-[760px]:text-center">
                    <select
                      value={answer.state}
                      disabled={savingId === answer.answer_id}
                      onChange={(event) => onSave(answer, answer.value ?? "", event.target.value as AnswerState)}
                      aria-label={`State of ${answer.prompt}`}
                      className={`rounded border px-1.5 py-0.5 text-[11.5px] disabled:opacity-50 ${
                        TONE[ANSWER_STATE_TONE[answer.state]].chip
                      }`}
                    >
                      {ANSWER_STATES.map((state) => (
                        <option key={state} value={state}>
                          {ANSWER_STATE_LABELS[state]}
                        </option>
                      ))}
                    </select>
                    {/* A TBC finish can never produce a confirmed answer,
                        whatever the drawing said — so where the TBC came from
                        the library rather than from this question, say so. */}
                    {answer.state === "tbc" && attribute?.finish_state === "tbc" && (
                      <p className="mt-1 text-[10.5px] text-neutral-500">the finish is TBC</p>
                    )}
                  </div>

                  <div className="px-4 py-2.5 text-[11.5px] min-[760px]:text-right">
                    <Source
                      answer={answer}
                      attribute={attribute}
                      chased={waiting[questionKey(recordId, answer.requirement_id)]}
                      designerContact={designerContact}
                      projectId={projectId}
                    />
                    {/* The same field legitimately sits at two gates, so
                        answering it once satisfies both. */}
                    {gates.length > 1 && (
                      <span className="mt-0.5 block text-[10.5px] text-neutral-400">
                        {gates.join(" and ")} both
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </>
  );
}

/**
 * The next action for one question, in the order a person would take it.
 *
 * A settled answer goes to the page it came from; an outstanding one to
 * whoever owes it, or to when it was last asked. "—" is the honest answer
 * where there is nobody recorded to ask: a link to a chase with no contact
 * would be a button that cannot do anything.
 */
function Source({
  answer,
  attribute,
  chased,
  designerContact,
  projectId,
}: {
  answer: ChecklistAnswer;
  attribute: ChecklistAttribute | null;
  chased: { draftId: string; sentAt: string | null; contactName: string } | undefined;
  designerContact: { name: string; designer_code: string } | null;
  projectId: string;
}) {
  if (!isOutstanding(answer.state)) {
    if (attribute?.source_run_id) {
      return (
        <a
          href={`/api/imports/${attribute.source_run_id}/source${attribute.source_page ? `#page=${attribute.source_page}` : ""}`}
          target="_blank"
          rel="noreferrer"
          title={`${attribute.source_filename ?? "source"}${attribute.source_page ? ` — page ${attribute.source_page}` : ""}`}
          className="block truncate text-neutral-500 underline hover:text-neutral-900"
        >
          {attribute.source_filename ?? "source"}
          {attribute.source_page ? ` p${attribute.source_page}` : ""}
        </a>
      );
    }
    // A person typed it. Honest, and the shape the app is built for: a spec
    // somebody typed IS a spec with no page to turn to.
    return <span className="text-neutral-400">typed by hand</span>;
  }

  if (chased) {
    return (
      <Link
        href={`/dashboard/drafts?projectId=${projectId}`}
        title={`Asked of ${chased.contactName}`}
        className={`underline ${TONE.info.text}`}
      >
        chased{chased.sentAt ? ` ${formatDay(chased.sentAt.slice(0, 10))}` : ""}
      </Link>
    );
  }

  if (designerContact) {
    return (
      <Link href={`/dashboard/drafts?projectId=${projectId}`} className="text-neutral-500 underline hover:text-neutral-900">
        Ask {designerContact.name.split(" ")[0]}
      </Link>
    );
  }

  return <span className="text-neutral-400">—</span>;
}
