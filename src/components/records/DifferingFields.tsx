"use client";
// The fields that make a configuration different, at the top of its screen.
//
// A configuration added by hand starts with the bill line's shared specs and
// the fields that usually DIFFER between configurations — the fabrics, COM 1
// to COM 3, `DIFFERING_FIELD_JSON_IDS` — left `missing`. They are the
// first thing somebody opening it has to do, so they are the first thing on
// the Specs tab, blank and ready to fill in, each with the second line of the
// same field (where on the item it goes, 0029) beside it.
//
// They are the SAME checklist answers the Checklist tab shows, saved through
// the same `PATCH /api/answers/[id]`. Nothing here writes a value on its own:
// a blank stays `missing` until a person types one.
import { useMemo } from "react";
import AnswerValue from "@/components/records/AnswerValue";
import Chip from "@/components/ui/Chip";
import { ANSWER_STATE_LABELS, answerStateTone, type AnswerState } from "@/lib/spec-vocab";
import { DIFFERING_FIELD_JSON_IDS } from "@/lib/configuration-carry";
import type { Palette } from "@/lib/palettes";

export type DifferingAnswer = {
  answer_id: string | null;
  prompt: string;
  field_name: string | null;
  json_id: number | null;
  local_key: string | null;
  value: string | null;
  qualifier: string | null;
  state: AnswerState;
  version: number;
};

type PaletteRow = Omit<Palette, "options" | "allowsFreeText" | "sourceNote" | "syncedAt"> & {
  allows_free_text: boolean;
  source_note: string | null;
  synced_at: string | null;
  options: Palette["options"];
};

export default function DifferingFields<A extends DifferingAnswer>({
  answers,
  palettes,
  paletteByQuestion,
  savingId,
  reloadKey,
  onSave,
}: {
  answers: A[];
  palettes: PaletteRow[];
  paletteByQuestion: { json_id: number | null; local_key: string | null; palette_key: string }[];
  savingId: string | null;
  reloadKey: number;
  onSave: (answer: A, value: string, state: AnswerState, qualifier?: string | null) => void;
}) {
  const rows = useMemo(
    () =>
      DIFFERING_FIELD_JSON_IDS.flatMap((jsonId) => answers.filter((answer) => answer.json_id === jsonId)),
    [answers],
  );
  const paletteFor = (answer: A): Palette | null => {
    const key =
      paletteByQuestion.find((row) => answer.local_key && row.local_key === answer.local_key)?.palette_key ??
      paletteByQuestion.find((row) => row.json_id !== null && row.json_id === answer.json_id)?.palette_key;
    const row = key ? palettes.find((palette) => palette.key === key) : undefined;
    return row
      ? {
          key: row.key,
          name: row.name,
          owner: row.owner,
          allowsFreeText: Boolean(row.allows_free_text),
          sourceNote: row.source_note,
          syncedAt: row.synced_at,
          options: row.options ?? [],
        }
      : null;
  };

  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-neutral-500">
        This item has no category yet, so there are no fabric questions to fill in. Set one above.
      </p>
    );
  }

  const blank = rows.filter((answer) => answer.state === "missing").length;
  return (
    <div>
      <p className="mb-2 text-[12.5px] text-neutral-600">
        {blank === rows.length
          ? "Nothing is filled in yet — these are what usually differ between configurations."
          : `${blank} of ${rows.length} still blank.`}
      </p>
      <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
        {rows.map((answer) => (
          <li
            key={answer.answer_id ?? `${answer.json_id}:${answer.prompt}`}
            className="grid gap-2 py-2 min-[760px]:grid-cols-[160px_minmax(0,1fr)_200px_90px] min-[760px]:items-start"
          >
            <span className="text-[12.5px] font-medium text-neutral-900">{answer.field_name?.trim() || answer.prompt}</span>
            <AnswerValue
              palette={paletteFor(answer)}
              value={answer.value}
              disabled={!answer.answer_id || savingId === answer.answer_id}
              inputKey={`diff:${answer.answer_id}:${answer.version}:${reloadKey}`}
              onCommit={(next) => onSave(answer, next, next ? "confirmed" : "missing")}
            />
            <input
              key={`q:${answer.answer_id}:${answer.version}:${reloadKey}`}
              defaultValue={answer.qualifier ?? ""}
              disabled={!answer.answer_id || savingId === answer.answer_id || !answer.value}
              placeholder="Where on the item"
              aria-label={`Where on the item — ${answer.field_name?.trim() || answer.prompt}`}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next === (answer.qualifier ?? "")) return;
                onSave(answer, answer.value ?? "", answer.state, next || null);
              }}
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50"
            />
            <Chip tone={answerStateTone(answer.state)}>{ANSWER_STATE_LABELS[answer.state] ?? answer.state}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}
