"use client";

// One gap, and the box you answer it in.
//
// ============================================================================
// A DIMENSION IS NOT AN ANSWER, AND THAT IS THE WHOLE REASON THIS IS NOT ONE
// COMPONENT WITH ONE INPUT.
//
// The composed Dimensions cell (`W840 x D790 x H720mm`) is a PROJECTION of the
// record's dimension attributes. Typing it into the checklist answer would
// survive exactly until the next drawing confirm, which recomposes the cell
// from the attributes and wipes it — and the person who typed it would have
// no way of knowing. So a dimension row writes an ATTRIBUTE with a slot,
// through `POST /api/attributes`, and the answer follows from
// `recomposeAnswers`. Everything else writes the answer.
//
// `composeDimensionCell` is called here to show what the cell now reads. That
// is the SINGLE composer — the export, the record screen and the drawings
// review all call it too — not a second implementation.
//
// ---- WHAT A SAVE DOES ON SCREEN -------------------------------------------
//
// It reports what was written, in words, and the row STAYS. A filled gap
// leaves `loadOutstanding`, so reloading the list would make the row somebody
// just answered disappear — which reads as the save having failed. The row
// goes on the next deliberate reload of the line, which is what the line's own
// "n answered" note explains.
//
// A REFUSAL is the other way round: a 409 means the screen is out of date, so
// the row reloads ITSELF (not the page) and then says what happened. Every
// path resets `busy` in a `finally`, so an HTML error page cannot leave a box
// disabled with nothing said.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { TONE } from "@/components/ui/tone";
import AnswerValue from "@/components/records/AnswerValue";
import { Td } from "@/components/ui/Table";
import { composeDimensionCell, type DimensionRow } from "@/lib/dimensions";
import { formatDay } from "@/lib/format-day";
import { rowKind, type InfillDimension, type InfillQuestion } from "@/lib/infill";
import type { Palette } from "@/lib/palettes";
import {
  ANSWER_STATE_LABELS,
  DIMENSION_SLOTS,
  DIMENSION_SLOT_LABELS,
  isDimensionSlot,
  type AnswerState,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { TIER_LABELS } from "@/lib/tgq";

/** What a save came back with. The row never parses a response itself. */
export type SaveOutcome = { ok: true; message: string } | { ok: false; error: string; code: string | null };

export type SaveAnswer = (
  question: InfillQuestion,
  input: { value: string | null; state: AnswerState; reason: string | null },
) => Promise<SaveOutcome>;

export type SaveDimension = (
  question: InfillQuestion,
  input: { slot: DimensionSlot; value: string; unit: AttributeUnit },
) => Promise<SaveOutcome>;

/** Missing blocks a quote; TBC is a person saying "not yet". The chase screen's map. */
const STATE_TONE: Record<string, "danger" | "warn" | "plain"> = { missing: "danger", tbc: "warn" };

/** The two a person types off a drawing or a tape measure. */
const UNITS: AttributeUnit[] = ["mm", "cm"];

function askedOn(sentAt: string): string {
  const at = new Date(sentAt);
  if (Number.isNaN(at.getTime())) return sentAt;
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  return formatDay(day);
}

export default function InfillRow({
  question,
  palette,
  columns,
  pad,
  onSaveAnswer,
  onSaveDimension,
  onReload,
}: {
  question: InfillQuestion;
  /** Null where the question offers none, or where BWS owns the list. */
  palette: Palette | null;
  columns: number;
  /** The indent of the level this row sits at, so options read as nested. */
  pad: string;
  onSaveAnswer: SaveAnswer;
  onSaveDimension: SaveDimension;
  /** Re-read THIS line's questions. Called after a refusal, never after a save. */
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The value that was refused for want of a reason, kept so answering the
   * question the screen just asked does not mean typing the value again.
   */
  const [pendingReason, setPendingReason] = useState<{ value: string | null; state: AnswerState } | null>(null);
  const [reason, setReason] = useState("");
  const [recorded, setRecorded] = useState<InfillDimension[]>([]);

  const kind = rowKind(question, palette);
  const toQuote = question.tier === "to_quote" && question.requirementKind === "spec_field";

  async function run(fn: () => Promise<SaveOutcome>) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await fn();
      if (outcome.ok) {
        setDone(outcome.message);
        setPendingReason(null);
        setReason("");
        return outcome;
      }
      // A REFUSAL MEANS THE SCREEN IS OUT OF DATE. Reload the line first so the
      // row is rendered against what the server now holds, then say what
      // happened — the other order clears the message with the reload.
      if (outcome.code !== "reason_required") await onReload();
      setError(outcome.error);
      return outcome;
    } finally {
      // Always, so a non-JSON response cannot leave the box disabled.
      setBusy(false);
    }
  }

  async function commit(value: string | null, state: AnswerState, withReason: string | null = null) {
    const outcome = await run(() => onSaveAnswer(question, { value, state, reason: withReason }));
    if (!outcome.ok && outcome.code === "reason_required") setPendingReason({ value, state });
  }

  // ---- the row ------------------------------------------------------------
  return (
    <>
      <tr className="hover:bg-neutral-50">
        <td className={`border-b border-neutral-100 px-2 py-1.5 align-top ${pad}`}>
          <span
            aria-hidden
            title={
              toQuote
                ? TIER_LABELS.to_quote
                : question.requirementKind === "readiness"
                  ? "Readiness — internal and commercial"
                  : TIER_LABELS.later
            }
            className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
              toQuote ? TONE.danger.dot : question.requirementKind === "readiness" ? TONE.warn.dot : "bg-neutral-300"
            }`}
          />
        </td>

        {/* ---- what is being asked, and what is already known -------------- */}
        <Td colSpan={2} className="align-top">
          <span className="text-neutral-900">{question.prompt}</span>
          {question.fieldLabel && (
            <span className="block text-[11px] text-neutral-500">BWS: {question.fieldLabel.trim()}</span>
          )}
          {/* REFERENCE, NEVER A PRE-FILL. There is deliberately no control that
              copies any of this into the box: a value is never filled in from a
              sister item, which is the rule M8 exists to prove. */}
          {question.sisters.length > 0 && (
            <span className="block text-[11px] text-neutral-600">
              {question.sisters.map((sister) => `${sister.name}: ${sister.value}`).join(" · ")}
            </span>
          )}
          {question.finishNote && (
            <span className="block text-[11px] text-neutral-600">In the library: {question.finishNote}</span>
          )}
          {question.waiting && (
            <span className="block text-[11px] text-blue-700">
              asked{question.waiting.sentAt ? ` ${askedOn(question.waiting.sentAt)}` : ""}
              {question.waiting.contactName ? ` · ${question.waiting.contactName}` : ""} — answer it here if you know it
            </span>
          )}
        </Td>

        {/* ---- the control ------------------------------------------------- */}
        <Td colSpan={3} className="align-top">
          {question.answerId === null ? (
            /* NO CHECKLIST ROW TO WRITE TO. It is created when a category is
               set, so the honest answer is to say so and send them there —
               inventing one here would need the requirement's own spec field
               and would be a second implementation of what the record screen
               already does. */
            <span className="text-xs text-amber-800">
              No checklist row for this question yet.{" "}
              <Link href={`/dashboard/records/${question.recordId}`} className="underline" target="_blank" rel="noopener noreferrer">
                Open the item
              </Link>
            </span>
          ) : kind === "dimension" ? (
            <DimensionWriter
              question={question}
              recorded={recorded}
              busy={busy}
              onRecord={async (input) => {
                const outcome = await run(() => onSaveDimension(question, input));
                if (outcome.ok) {
                  setRecorded((prev) => [
                    ...prev,
                    { slot: input.slot, value: input.value, unit: input.unit, state: "confirmed" },
                  ]);
                }
                return outcome.ok;
              }}
            />
          ) : (
            <div className="flex items-start gap-2">
              <AnswerValue
                palette={palette}
                value={question.currentValue}
                disabled={busy}
                /* Re-keyed on the version, so a row reloaded after a refusal
                   shows what the server holds rather than the stale text the
                   browser still had in the box. */
                inputKey={`${question.requirementId}:${question.answerVersion ?? 0}`}
                onCommit={(next) => {
                  const value = next.trim();
                  // An EMPTY box records nothing. Clearing an answer back to
                  // missing is a decision, and it belongs on the record screen
                  // beside the history that will show it — a blur on an empty
                  // box in a meeting is far more often a keystroke than a
                  // statement.
                  if (!value) return;
                  void commit(value, "confirmed");
                }}
              />
              {/* TBC IS AN ANSWER, and a distinct one: "we asked and they have
                  not decided" is not "nobody has looked". It is quiet because
                  it is the lesser of the two things this screen is for. */}
              <Button
                size="xs"
                variant="quiet"
                disabled={busy || question.state === "tbc"}
                title={question.state === "tbc" ? "Already recorded as TBC" : "They have not decided yet"}
                onClick={() => void commit(question.currentValue, "tbc")}
              >
                TBC
              </Button>
            </div>
          )}

          {done && <p className="mt-1 text-xs text-green-700">{done}</p>}
          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </Td>

        {/* ---- what is recorded now ---------------------------------------- */}
        <Td className="align-top">
          <Chip tone={STATE_TONE[question.state] ?? "plain"}>
            {ANSWER_STATE_LABELS[question.state as AnswerState] ?? question.state}
          </Chip>
          {/* A QUESTION ALREADY TBC SHOWS WHAT WAS RECORDED. Typing a value
              over it confirms it, which is the same control — TBC is a state a
              person set, not a different kind of question. */}
          {question.state === "tbc" && question.currentValue && (
            <span className="block text-[11px] text-neutral-500">recorded as TBC: {question.currentValue}</span>
          )}
        </Td>
      </tr>

      {/* A PANEL THAT SPANS THE ROW IS ITS OWN `<tr>`, never an extra colSpan
          cell beside the data cells — a row carrying both is twice as many
          column slots wide, and the browser finds room for the panel BESIDE
          the data rather than under it. */}
      {pendingReason && (
        <tr>
          <td colSpan={columns} className={`border-b border-neutral-100 bg-amber-50/60 px-4 py-2 text-xs ${pad}`}>
            <label className="block text-amber-900">
              That answer is already confirmed. Say why it is changing — or open a change at the top and everything you
              record goes under it.
              <input
                value={reason}
                autoFocus
                onChange={(event) => setReason(event.target.value)}
                placeholder="Hayley said on the handover call that it is now polished nickel"
                className="mt-1 w-full rounded border border-amber-300 bg-white px-2 py-1"
              />
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <Button
                size="xs"
                variant="secondary"
                disabled={busy || !reason.trim()}
                onClick={() => void commit(pendingReason.value, pendingReason.state, reason.trim())}
              >
                {busy ? "Recording…" : "Record it"}
              </Button>
              <Button size="xs" variant="quiet" onClick={() => setPendingReason(null)}>
                Leave it
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Slot, figure, unit — and never a free-text dimension.
 *
 * 0011's biconditional is that `attr_group = 'dimension'` MEANS one of the
 * five slots, which is what makes `composeDimensionCell` total. A box that
 * took "840 wide" would have to parse it, and the unit-resolution order exists
 * because a wrong unit reads as a real measurement and nothing downstream
 * questions it. So the person says which slot and which unit, and the app
 * infers nothing at all.
 */
function DimensionWriter({
  question,
  recorded,
  busy,
  onRecord,
}: {
  question: InfillQuestion;
  recorded: InfillDimension[];
  busy: boolean;
  onRecord: (input: { slot: DimensionSlot; value: string; unit: AttributeUnit }) => Promise<boolean>;
}) {
  const [slot, setSlot] = useState<DimensionSlot | "">("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<AttributeUnit>("mm");

  const held = [...(question.dimensions ?? []), ...recorded];
  const taken = new Set(held.map((row) => row.slot));

  // What the cell reads now, through the app's ONE composer. Composing it here
  // rather than asking the server for it is not a second implementation: it is
  // the same function the export and the record screen call.
  const rows: DimensionRow[] = held
    .filter((row) => isDimensionSlot(row.slot))
    .map((row, index) => ({
      slot: row.slot as DimensionSlot,
      value: row.value,
      unit: (row.unit ?? null) as AttributeUnit | null,
      state: row.state as AttributeState,
      sortOrder: index,
    }));
  const cell = rows.length > 0 ? composeDimensionCell(rows).text : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={slot}
          disabled={busy}
          aria-label={`Which dimension of ${question.recordLabel}`}
          onChange={(event) => setSlot(event.target.value as DimensionSlot | "")}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">— which —</option>
          {DIMENSION_SLOTS.map((option) => (
            <option key={option} value={option} disabled={taken.has(option)}>
              {DIMENSION_SLOT_LABELS[option]}
              {taken.has(option) ? " — already recorded" : ""}
            </option>
          ))}
        </select>
        <input
          value={value}
          disabled={busy}
          inputMode="decimal"
          placeholder="840"
          aria-label={`Figure for ${question.recordLabel}`}
          onChange={(event) => setValue(event.target.value)}
          className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
        />
        <select
          value={unit}
          disabled={busy}
          aria-label="Unit"
          onChange={(event) => setUnit(event.target.value as AttributeUnit)}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50"
        >
          {UNITS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant="secondary"
          disabled={busy || !slot || !value.trim()}
          onClick={async () => {
            if (!slot || !value.trim()) return;
            const ok = await onRecord({ slot, value: value.trim(), unit });
            if (ok) {
              setSlot("");
              setValue("");
            }
          }}
        >
          {busy ? "Recording…" : "Record"}
        </Button>
      </div>
      {cell && (
        <p className="mt-1 text-[11px] text-neutral-600">
          Dimensions now read <span className="font-mono text-neutral-900">{cell}</span>
        </p>
      )}
    </div>
  );
}
