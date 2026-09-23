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
import { naturalConfigurationOrder, normaliseVariantLabel, variantLabelProblem } from "@/lib/record-variants";
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

/** "TYPE 1 and TYPE 5", "TYPE 1, TYPE 2 and TYPE 5". */
function andList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A title block naming rooms is not a split — said in words, with a way out.
 *
 * S-100's shop drawing is titled "SOFA MUR 1 & TYPO 5" and nothing on its pages
 * differs between the two, so the card is ONE item and confirms onto the bill
 * line (`configurationsDistinguishSomething`). The reviewer who knows the
 * document means two sofas splits it by those names, as a C1 edit.
 */
export function UnsplitNote({
  names,
  disabled,
  onSplit,
}: {
  names: readonly string[];
  disabled: boolean;
  onSplit?: () => void;
}) {
  return (
    <p className="mt-1.5 flex max-w-3xl flex-wrap items-center gap-2 text-xs text-neutral-600">
      <span>
        The pages name {andList(names)} but give them nothing different, so this is read as one item. Split it by hand if
        the document means it.
      </span>
      {onSplit && (
        <Button size="xs" variant="quiet" disabled={disabled} onClick={onSplit}>
          Split into {andList(names)}
        </Button>
      )}
    </p>
  );
}

/**
 * WHICH CONFIGURATION IS THIS? — one or more of the bill line's live ones, or
 * a new one (plan step 5).
 *
 * A MULTI-SELECT, because a page can be more than one: the drawing set's page
 * titled "MUR 1 & TYPO 5 DESK CHAIR" is TYPE 1 AND TYPE 5, and its rows then
 * write to both. "A new configuration" stands alone: ticking it clears the
 * others, and it is unavailable where the name already exists (rename first).
 * Every change is saved as the reviewer's `configurationPairs`; nothing is
 * paired for them.
 */
export function PairChoice({
  label,
  where,
  namesRaw,
  existing,
  collides,
  chosen,
  disabled,
  onChange,
  why,
}: {
  label: string;
  /** "on MAIN RUN", "(page 8) on MAIN RUN". */
  where: string;
  namesRaw: readonly string[];
  existing: readonly string[];
  collides: boolean;
  /** undefined: not chosen yet; null: a new configuration; else the existing ones. */
  chosen: readonly string[] | null | undefined;
  disabled: boolean;
  onChange: (pairWith: string[] | null) => void;
  /** Why this question is asked on its own — "MAIN RUN - VE has different configurations". */
  why?: string | null;
}) {
  const words = namesRaw.filter((raw) => normaliseVariantLabel(raw) !== label);
  const picked = new Set(chosen ?? []);
  // The order a person counts in: TYPE 1, TYPE 2 … not first mention.
  existing = naturalConfigurationOrder(existing);
  return (
    <fieldset className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <legend className="mb-0.5 basis-full">
        <span className="font-mono font-medium">{label}</span>
        {words.length > 0 && <> — the page says {words.join(" / ")} (read as {label})</>} {where} is:
        {why && <span className="ml-1 font-normal text-amber-800">({why})</span>}
      </legend>
      {existing.map((name) => (
        <label key={name} className="inline-flex items-center gap-1 font-mono">
          <input
            type="checkbox"
            checked={picked.has(name)}
            disabled={disabled}
            onChange={(event) => {
              const next = new Set(picked);
              if (event.target.checked) next.add(name);
              else next.delete(name);
              const list = existing.filter((entry) => next.has(entry));
              if (list.length > 0) onChange(list);
            }}
          />
          {name}
        </label>
      ))}
      <label className="inline-flex items-center gap-1">
        <input
          type="checkbox"
          checked={chosen === null}
          disabled={disabled || collides}
          onChange={(event) => {
            if (event.target.checked) onChange(null);
          }}
        />
        a new configuration{collides ? " (rename it first — that name exists)" : ""}
      </label>
    </fieldset>
  );
}

/** One pairing question, covering every phase whose bill line holds the same configurations. */
export type PairQuestion = {
  label: string;
  recordIds: string[];
  where: string;
  why: string | null;
  namesRaw: string[];
  existing: string[];
  collides: boolean;
  chosen: string[] | null | undefined;
};

/**
 * Per-phase pairing rows, folded into ONE question per configuration where the
 * phases agree about which configurations their bill lines hold. A phase that
 * holds DIFFERENT ones gets its own question and says so — answering one for
 * it would be answering a different question.
 */
export function groupPairQuestions(
  rows: readonly {
    recordId: string;
    label: string;
    existing: string[];
    namesRaw: string[];
    collides: boolean;
    chosen: string[] | null | undefined;
  }[],
  runNameOf: (recordId: string) => string,
): PairQuestion[] {
  const byLabel = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) byLabel.set(row.label, [...(byLabel.get(row.label) ?? []), row]);
  const out: PairQuestion[] = [];
  for (const [label, entries] of byLabel) {
    const bySet = new Map<string, (typeof rows)[number][]>();
    for (const entry of entries) {
      const key = [...entry.existing].sort().join("\u0000");
      bySet.set(key, [...(bySet.get(key) ?? []), entry]);
    }
    const groups = [...bySet.values()].sort((a, b) => b.length - a.length);
    groups.forEach((group, index) => {
      const phases = group.map((entry) => runNameOf(entry.recordId));
      const same = (a: string[] | null | undefined, b: string[] | null | undefined) => JSON.stringify(a) === JSON.stringify(b);
      const chosen = group.every((entry) => same(entry.chosen, group[0]!.chosen)) ? group[0]!.chosen : undefined;
      out.push({
        label,
        recordIds: group.map((entry) => entry.recordId),
        where: `on ${phases.join(" and ")}`,
        why:
          groups.length > 1 && index > 0
            ? `${phases.join(" and ")} ${phases.length === 1 ? "has" : "have"} different configurations`
            : null,
        namesRaw: group[0]!.namesRaw,
        existing: group[0]!.existing,
        collides: group.some((entry) => entry.collides),
        chosen,
      });
    });
  }
  return out;
}
