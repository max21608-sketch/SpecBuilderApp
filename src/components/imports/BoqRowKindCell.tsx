"use client";

// What kind of row a bill line is, said on the line itself.
//
// ============================================================================
// ONE SMALL SELECT, AND A SECOND ONE ONLY FOR A FABRIC LINE.
//
// Item / Fabric for… / Section heading / Subtotal / Blank. A fabric line is not
// a record: the confirm writes it as the next free COM spec on its item, so
// "Fabric for…" opens a second select offering the item lines ABOVE it,
// nearest first (`fabricParentOptions`) — the layout that asked for this puts a
// fabric directly under its item, and a select listing all three hundred lines
// is one nobody can use. Nothing is written until an item is chosen.
//
// QUIET UNTIL CLICKED (2026-10-05). A bordered select on every one of three
// hundred rows reads as three hundred questions, so a settled line shows plain
// "Item ▾" — a quiet button — and a fabric line "Fabric ▾" with the row it
// belongs to and a "change" beside it. Either press opens the cell exactly as
// it always was: the same selects, the same options, the same validation. What
// moves is only what is shown BEFORE a click — and never a problem: a line the
// confirm would refuse (`problem`) or a fabric still waiting for its item opens
// on its own, so nothing the confirm would refuse sits behind a press. Who said
// so and why moves behind the Item cell's "why?" (`RowKindReasoning`, below).
//
// A FLAG DOES NOT OPEN IT. A flagged reading ("two lines carry the code the
// bracket names — this is the nearer one above; check it") is printed in amber
// in the ITEM cell instead, where the column is wide enough to read it: on the
// real pricing document every bracketed fabric is flagged, and opened in a
// 120px column each one stood 340px tall. Here the "for N" turns amber.
//
// WHO SAID IT IS SHOWN. The bracket rule (the bill naming its item) is plain;
// a model's reading is a yellow chip with its evidence; a flagged reading — two
// lines carry the code the bracket names — is amber, with the sentence. A
// section, subtotal or blank line is ignored by the same press, and says why
// beside its Include box; ticking that box brings it back.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import {
  BOQ_ROW_KINDS,
  BOQ_ROW_KIND_LABELS,
  fabricParentOptions,
  isBoqRowKind,
  type BoqRowKind,
  type RowKindFields,
} from "@/lib/boq-row-kinds";

export type KindCellLine = RowKindFields & {
  index: number;
  lineNo: number;
  code: string | null;
  itemDescription: string;
  ignored: boolean;
};

const SOURCE_CHIP: Record<string, { label: string; tone: "plain" | "guess" | "info" }> = {
  bill: { label: "the bill's bracket", tone: "plain" },
  model: { label: "read by the model", tone: "guess" },
  person: { label: "set by you", tone: "info" },
};

function parentLabel(line: { lineNo: number; code: string | null; itemDescription: string }): string {
  const what = line.itemDescription.split(/\s+/).slice(0, 5).join(" ");
  return `row ${line.lineNo} · ${line.code ?? "no code"}${what ? ` · ${what}` : ""}`;
}

export default function BoqRowKindCell({
  line,
  lines,
  editable,
  busy,
  problem,
  onSet,
}: {
  line: KindCellLine;
  /** Every line of the sheet, for the item lines a fabric can belong to. */
  lines: readonly KindCellLine[];
  editable: boolean;
  busy: boolean;
  /** Why this fabric line cannot be written, from `rowKindProblems`. */
  problem?: string | null;
  onSet: (kind: BoqRowKind, finishForRow: number | null) => void;
}) {
  const kind: BoqRowKind = line.rowKind ?? "item";
  // "Fabric for…" chosen and no item yet: held here, nothing written.
  const [choosingParent, setChoosingParent] = useState(false);
  // Opened by a press; which select the press was for gets the focus.
  const [opened, setOpened] = useState<null | "kind" | "parent">(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const parentRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (opened === "kind") kindRef.current?.focus();
    if (opened === "parent") parentRef.current?.focus();
  }, [opened]);
  // A fabric line that names no item is itself a problem, whatever `problem` says.
  const needsAPerson = Boolean(problem) || choosingParent || (kind === "finish_for" && !line.finishFor);
  const open = needsAPerson || (editable && opened !== null);
  /** Set the kind, and fold the cell back to its quiet state. */
  const set = (next: BoqRowKind, finishForRow: number | null) => {
    setOpened(null);
    onSet(next, finishForRow);
  };
  const showParent = kind === "finish_for" || choosingParent;
  const options = fabricParentOptions(lines, line);
  const current = line.finishFor ? lines.find((other) => other.lineNo === line.finishFor?.row) : undefined;
  const parentChoices = current && !options.includes(current) ? [current, ...options] : options;
  const chip = line.rowKindSource ? SOURCE_CHIP[line.rowKindSource] : null;

  if (!open) {
    const label = kind === "finish_for" ? "Fabric" : BOQ_ROW_KIND_LABELS[kind];
    return (
      <div>
        {editable ? (
          <Button
            variant="quiet"
            size="xs"
            className="-ml-2"
            aria-label={`Row ${line.lineNo} is ${label} — change`}
            disabled={busy}
            onClick={() => setOpened("kind")}
          >
            {label} ▾
          </Button>
        ) : (
          <span className="text-xs text-neutral-700">{label}</span>
        )}
        {kind === "finish_for" && line.finishFor && (
          <span className={`block text-[11px] ${line.rowKindFlag ? "text-amber-800" : "text-neutral-500"}`}>
            for {line.finishFor.row}
            {editable && (
              <>
                {" · "}
                <Button
                  variant="quiet"
                  size="xs"
                  className="-my-0.5 px-1 py-0 text-[11px]"
                  aria-label={`Change which item row ${line.lineNo} is the fabric of`}
                  disabled={busy}
                  onClick={() => setOpened("parent")}
                >
                  change
                </Button>
              </>
            )}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-[150px]">
      <select
        ref={kindRef}
        aria-label={`Row ${line.lineNo} is`}
        value={choosingParent ? "finish_for" : kind}
        disabled={!editable || busy}
        onChange={(event) => {
          const next = event.target.value;
          if (!isBoqRowKind(next)) return;
          if (next === "finish_for") {
            setChoosingParent(true);
            return;
          }
          setChoosingParent(false);
          set(next, null);
        }}
        className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs disabled:opacity-50"
      >
        {BOQ_ROW_KINDS.map((option) => (
          <option key={option} value={option}>
            {BOQ_ROW_KIND_LABELS[option]}
          </option>
        ))}
      </select>

      {showParent && (
        <select
          ref={parentRef}
          aria-label={`Row ${line.lineNo} is the fabric of`}
          value={choosingParent && kind !== "finish_for" ? "" : String(line.finishFor?.row ?? "")}
          disabled={!editable || busy}
          onChange={(event) => {
            const row = Number(event.target.value);
            if (!Number.isInteger(row) || row <= 0) return;
            setChoosingParent(false);
            set("finish_for", row);
          }}
          className={`mt-1 w-full rounded border px-1.5 py-1 text-xs disabled:opacity-50 ${
            line.rowKindFlag || problem ? "border-amber-400 bg-amber-50" : "border-neutral-300"
          }`}
        >
          <option value="">— which item? —</option>
          {parentChoices.map((option) => (
            <option key={option.lineNo} value={option.lineNo}>
              {parentLabel(option)}
            </option>
          ))}
        </select>
      )}
      {choosingParent && options.length === 0 && (
        <span className="mt-1 block text-[10.5px] text-amber-800">No item line above this one to belong to.</span>
      )}

      {kind === "finish_for" && line.finishFor && !choosingParent && (
        <span className="mt-1 block text-[10.5px] text-neutral-600">
          written as a spec on row {line.finishFor.row}
        </span>
      )}
      {chip && line.rowKind && (
        <span className="mt-1 block">
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </span>
      )}
      {line.rowKindEvidence && line.rowKindSource !== "person" && (
        <span className="mt-0.5 block text-[10.5px] text-neutral-500">{line.rowKindEvidence}</span>
      )}
      {line.rowKindFlag && (
        <span className="mt-0.5 block text-[10.5px] text-amber-800" role="note">
          {line.rowKindFlag}
        </span>
      )}
      {problem && (
        <span className="mt-0.5 block text-[10.5px] text-red-700" role="note">
          {problem}
        </span>
      )}
    </div>
  );
}

/**
 * WHY A LINE IS THE KIND IT IS, for the "why?" under a fabric line's item cell.
 *
 * The same words the open cell prints — who said so, what it was read from,
 * what the confirm writes — so the quiet state hides nothing it cannot show
 * again in one press. The flag and the problem are NOT here: those never sit
 * behind a press, and the cell opens itself for them.
 */
export function RowKindReasoning({ line }: { line: KindCellLine }) {
  const chip = line.rowKindSource ? SOURCE_CHIP[line.rowKindSource] : null;
  return (
    <span className="mt-1 block space-y-0.5 text-[11px] text-neutral-600">
      {chip && line.rowKind && (
        <span className="block">
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </span>
      )}
      {line.rowKindEvidence && line.rowKindSource !== "person" && (
        <span className="block text-neutral-500">{line.rowKindEvidence}</span>
      )}
      {line.rowKind === "finish_for" && line.finishFor && (
        <span className="block">
          Not a record — its description is written as a spec on row {line.finishFor.row}
          {line.finishFor.code ? ` (${line.finishFor.code})` : ""}, in the next free field of its kind.
        </span>
      )}
    </span>
  );
}
