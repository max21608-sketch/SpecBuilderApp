"use client";

// A reviewer's corrections to a card's configurations (brief C1).
//
// ============================================================================
// EVERY CONTROL HERE IS AN EDIT TO STAGED DATA, AND NOTHING MORE.
//
// Max, 2026-09-23: "if someone sees that something's wrong, they still need to
// work through, even if it means they have to add it manually." So a person
// can add, rename and remove a configuration, change which configurations a
// row applies to, and say whether the pages are one item or several — before
// confirm, on the card.
//
// Each goes through the review screen's existing autosave, with the item's or
// the observation's own version, and is stored BESIDE the model's reading
// (`configurationsByReviewer`, `relationshipByReviewer`) — never over it — so
// the card can say "read as 4, you set 5" and nothing about provenance is lost.
// Where each row then LANDS is computed by `namedConfigurationPlans`, the same
// pure function the confirm calls; nothing here decides it.
//
// A NAME IS REFUSED IN WORDS before it is sent, by the same
// `variantLabelProblem` the route and the database-facing code use.
// ============================================================================
import { useState } from "react";
import { normaliseVariantLabel, variantLabelProblem } from "@/lib/record-variants";
import Button from "@/components/ui/Button";

/** Names a reviewer typed, one per comma, folded the way the column stores them. */
export function parseConfigurationNames(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) {
    const label = normaliseVariantLabel(part);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Why these names cannot be added, in words, or null. */
export function configurationNamesProblem(labels: readonly string[], existing: readonly string[]): string | null {
  if (labels.length === 0) return "Type a name for the configuration.";
  for (const label of labels) {
    const problem = variantLabelProblem(label);
    if (problem) return problem;
    if (existing.includes(label)) return `${label} is already a configuration of this item.`;
  }
  return null;
}

/** "+ Add configuration", at the end of a strip or on a card that has none yet. */
export function AddConfiguration({
  existing,
  disabled,
  onAdd,
  label = "+ Add configuration",
  hint,
}: {
  existing: readonly string[];
  disabled: boolean;
  onAdd: (labels: string[]) => void;
  label?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const labels = parseConfigurationNames(text);
  const problem = text.trim() === "" ? null : configurationNamesProblem(labels, existing);
  if (!open) {
    return (
      <Button size="xs" variant="quiet" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        aria-label="Configuration name"
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={hint ?? "TYPE 6 — or several, with commas"}
        className="w-48 rounded border border-neutral-300 px-2 py-0.5 text-xs"
      />
      <Button
        size="xs"
        variant="primary"
        disabled={disabled || labels.length === 0 || problem !== null}
        onClick={() => {
          onAdd(labels);
          setText("");
          setOpen(false);
        }}
      >
        Add {labels.length > 1 ? labels.length : ""}
      </Button>
      <Button size="xs" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {problem && <span className="basis-full text-xs text-amber-800">{problem}</span>}
    </span>
  );
}

/** Rename the configuration on the open tab. */
export function RenameConfiguration({
  label,
  existing,
  disabled,
  onRename,
}: {
  label: string;
  existing: readonly string[];
  disabled: boolean;
  onRename: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(label);
  const to = normaliseVariantLabel(text);
  const problem =
    to === label ? null : configurationNamesProblem([to], existing.filter((entry) => entry !== label));
  if (!open) {
    return (
      <Button
        size="xs"
        variant="quiet"
        disabled={disabled}
        onClick={() => {
          setText(label);
          setOpen(true);
        }}
      >
        Rename
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        aria-label={`New name for ${label}`}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="w-40 rounded border border-neutral-300 px-2 py-0.5 text-xs"
      />
      <Button
        size="xs"
        variant="primary"
        disabled={disabled || to === "" || to === label || problem !== null}
        onClick={() => {
          onRename(to);
          setOpen(false);
        }}
      >
        Save name
      </Button>
      <Button size="xs" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {problem && <span className="basis-full text-xs text-amber-800">{problem}</span>}
    </span>
  );
}

/**
 * Remove the configuration on the open tab.
 *
 * NEVER SILENTLY DROPS A ROW. A row that belonged ONLY to this configuration is
 * a fabric somebody read off the page for one chair; removing the chair has to
 * say where that row goes — shared by the others, or moved to one of them — in
 * the SAME act. Removing without choosing leaves each such row as a blocker on
 * the card, never shared by default.
 */
export function RemoveConfiguration({
  label,
  others,
  ownRows,
  disabled,
  onRemove,
}: {
  label: string;
  others: readonly string[];
  /** How many rows land on this configuration and nothing else. */
  ownRows: number;
  disabled: boolean;
  onRemove: (rowsTo: { mode: "shared" } | { mode: "move"; to: string } | { mode: "none" }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [moveTo, setMoveTo] = useState(others[0] ?? "");
  if (others.length === 0) return null;
  if (!open) {
    return (
      <Button size="xs" variant="quiet" disabled={disabled} onClick={() => setOpen(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="inline-flex basis-full flex-wrap items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      {ownRows === 0 ? (
        <>
          <span>Remove {label}? Nothing on these pages belongs only to it.</span>
          <Button size="xs" variant="danger" disabled={disabled} onClick={() => onRemove({ mode: "none" })}>
            Remove {label}
          </Button>
        </>
      ) : (
        <>
          <span>
            {label} has {ownRows} row{ownRows === 1 ? "" : "s"} of its own. Where do {ownRows === 1 ? "it" : "they"} go?
          </span>
          <Button size="xs" variant="danger" disabled={disabled} onClick={() => onRemove({ mode: "shared" })}>
            Remove, and share {ownRows === 1 ? "it" : "them"} with all
          </Button>
          <span className="inline-flex items-center gap-1">
            <select
              aria-label={`Move ${label}'s rows to`}
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
              className="rounded border border-amber-300 bg-white px-1 py-0.5"
            >
              {others.map((other) => (
                <option key={other} value={other}>
                  {other}
                </option>
              ))}
            </select>
            <Button
              size="xs"
              variant="danger"
              disabled={disabled || !moveTo}
              onClick={() => onRemove({ mode: "move", to: moveTo })}
            >
              Remove, and move {ownRows === 1 ? "it" : "them"} there
            </Button>
          </span>
        </>
      )}
      <Button size="xs" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
  );
}

/**
 * Which configurations ONE ROW applies to — a small multi-select on the row,
 * with "all" as its own choice. Saved as the row's `configurations`; "put the
 * reading back" clears the reviewer's answer and the model's stands again.
 */
export function RowConfigurationPicker({
  labels,
  lands,
  readAs,
  byReviewer,
  disabled,
  onSave,
  startOpen = false,
}: {
  /** Every configuration of the code, in order. */
  labels: readonly string[];
  /** Where the row lands today. */
  lands: readonly string[];
  /** Where the MODEL put it, as it counts today — for "read as". */
  readAs: readonly string[] | null;
  /** The reviewer's own answer, if there is one. */
  byReviewer: readonly string[] | null | undefined;
  disabled: boolean;
  onSave: (configurations: string[] | null) => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [chosen, setChosen] = useState<Set<string>>(new Set(lands));
  const all = labels.length > 0 && labels.every((label) => chosen.has(label));
  const edited = Array.isArray(byReviewer);
  if (!open) {
    return (
      <Button
        size="xs"
        variant="quiet"
        disabled={disabled}
        onClick={() => {
          setChosen(new Set(lands));
          setOpen(true);
        }}
      >
        Applies to…
      </Button>
    );
  }
  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-2 rounded border border-neutral-300 bg-white px-2 py-1">
      <label className="inline-flex items-center gap-1">
        <input
          type="checkbox"
          checked={all}
          onChange={(event) => setChosen(new Set(event.target.checked ? labels : []))}
        />
        All
      </label>
      {labels.map((label) => (
        <label key={label} className="inline-flex items-center gap-1 font-mono">
          <input
            type="checkbox"
            checked={chosen.has(label)}
            onChange={(event) => {
              const next = new Set(chosen);
              if (event.target.checked) next.add(label);
              else next.delete(label);
              setChosen(next);
            }}
          />
          {label}
        </label>
      ))}
      <Button
        size="xs"
        variant="primary"
        disabled={disabled || chosen.size === 0}
        onClick={() => {
          // "All" is stored as `[]`: shared by every configuration, including
          // one added later — which is what a shared row means.
          onSave(all ? [] : labels.filter((label) => chosen.has(label)));
          setOpen(false);
        }}
      >
        Save
      </Button>
      {edited && readAs && (
        <Button
          size="xs"
          variant="quiet"
          disabled={disabled}
          onClick={() => {
            onSave(null);
            setOpen(false);
          }}
        >
          Put the reading back ({readAs.length === 0 ? "none" : readAs.join(" · ")})
        </Button>
      )}
      <Button size="xs" variant="quiet" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
  );
}

/**
 * One item, or several things to make — the manual `codeGroups.relationship`
 * for a card whose configurations are its PAGES.
 */
export function PagesAreControl({
  split,
  read,
  byReviewer,
  disabled,
  onSet,
}: {
  split: boolean;
  /** What the model said, or null where it was never asked (version 1). */
  read: "one_item" | "configurations" | "unclear" | null;
  byReviewer: "one_item" | "configurations" | null;
  disabled: boolean;
  onSet: (answer: "one_item" | "configurations" | null) => void;
}) {
  const said = read === null ? "counted by page" : read === "one_item" ? "one item" : read === "configurations" ? "configurations" : "unclear";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
      These pages are:
      <Button
        size="xs"
        variant={split ? "quiet" : "secondary"}
        disabled={disabled || !split}
        aria-pressed={!split}
        onClick={() => onSet("one_item")}
      >
        one item
      </Button>
      <Button
        size="xs"
        variant={split ? "secondary" : "quiet"}
        disabled={disabled || split}
        aria-pressed={split}
        onClick={() => onSet("configurations")}
      >
        separate configurations
      </Button>
      {byReviewer && (
        <>
          <span>
            — read as {said}; you set {byReviewer === "one_item" ? "one item" : "configurations"}.
          </span>
          <Button size="xs" variant="quiet" disabled={disabled} onClick={() => onSet(null)}>
            Put the reading back
          </Button>
        </>
      )}
    </span>
  );
}
