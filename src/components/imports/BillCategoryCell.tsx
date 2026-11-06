"use client";

// A bill line's category on the review: a decision, a suggestion, or a choice
// still to make (audit 2026-11-06, G8; Max: "follow the rule").
//
// THE LEVEL CELL'S RULE, IN A SECOND COLUMN. The cell was a select pre-filled
// with the staging's guess, with a grey "suggested" beside it, and the confirm
// wrote whatever the select showed. A reviewer could not agree with the guess:
// re-picking the option a select already shows fires no change event, so the
// act that would have recorded their agreement did nothing; and a guess nobody
// looked at became the record's category and created its checklist. Now:
//
//   - CHOSEN: a Chip with a quiet Change. It is a decision; a select showing
//     it invites an accidental edit.
//   - SUGGESTED: a `SuggestButton` with the words it was read from, and a
//     quiet "Choose another" that opens the select EMPTY, so picking the
//     suggested sheet from it is a change like any other.
//   - NOTHING TO SUGGEST, or a tie: the select, empty, with the reason under
//     it in a few words.
//
// What the confirm writes is `categoryToWrite` (`src/lib/bill-category.ts`):
// a chosen category or none, never the guess.
import { useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import { suggestedCategoryId } from "@/lib/bill-category";

export type CategoryOption = { id: string; family: string; name: string };

export type CategoryCellLine = {
  lineNo: number;
  categoryId: string | null;
  categoryStatus: string;
  categoryReason?: string | null;
  categoryCandidates?: { id: string; name: string }[];
};

/** "Uph · Sofas": the family first, because the same name can sit in both. */
export function categoryLabel(category: CategoryOption): string {
  return `${category.family === "upholstery" ? "Uph" : "Cab"} · ${category.name}`;
}

export default function BillCategoryCell({
  line,
  categories,
  editable,
  busy,
  onSet,
}: {
  line: CategoryCellLine;
  categories: CategoryOption[];
  editable: boolean;
  busy: boolean;
  onSet: (categoryId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const byId = (id: string | null) => (id ? (categories.find((category) => category.id === id) ?? null) : null);
  const chosen = line.categoryStatus === "chosen" ? byId(line.categoryId) : null;
  const suggested = byId(suggestedCategoryId(line));

  if (chosen && !editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Chip tone="good">{categoryLabel(chosen)}</Chip>
        {editable && (
          <Button variant="quiet" size="xs" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </span>
    );
  }

  if (suggested && !editing) {
    return (
      <span className="flex max-w-[13rem] flex-col items-start gap-1">
        <SuggestButton
          // A sheet's name is long ("Armchairs, Benches, Stools, Sofas") and
          // the button does not wrap by default; this one may, or the Category
          // column pushes the bill past its box (the overflow rule).
          value={<span className="whitespace-normal text-left">{categoryLabel(suggested)}</span>}
          evidence={line.categoryReason ?? "matched on the line's name"}
          busy={busy}
          disabled={!editable}
          onAccept={() => onSet(suggested.id)}
        />
        {editable && (
          <Button variant="quiet" size="xs" onClick={() => setEditing(true)}>
            Choose another
          </Button>
        )}
      </span>
    );
  }

  // EMPTY unless a person chose it: a select already showing a sheet is the
  // trap this cell exists to avoid.
  const tie = (line.categoryCandidates ?? []).map((candidate) => candidate.name);
  return (
    <>
      <select
        value={chosen ? chosen.id : ""}
        disabled={!editable}
        aria-label={`Category for row ${line.lineNo}`}
        onChange={(event) => {
          onSet(event.target.value || null);
          setEditing(false);
        }}
        className="w-full max-w-[11rem] rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">— not yet —</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {categoryLabel(category)}
          </option>
        ))}
      </select>
      {editing ? (
        <Button variant="quiet" size="xs" className="mt-1" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      ) : tie.length > 1 ? (
        <span className="mt-1 block text-[10.5px] text-neutral-500">several fit: {tie.join(" or ")}</span>
      ) : (
        <span className="mt-1 block text-[10.5px] text-neutral-500">nothing matched the name</span>
      )}
    </>
  );
}
