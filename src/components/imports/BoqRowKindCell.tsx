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
// WHO SAID IT IS SHOWN. The bracket rule (the bill naming its item) is plain;
// a model's reading is a yellow chip with its evidence; a flagged reading — two
// lines carry the code the bracket names — is amber, with the sentence. A
// section, subtotal or blank line is ignored by the same press, and says why
// beside its Include box; ticking that box brings it back.
// ============================================================================
import { useState } from "react";
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
  const showParent = kind === "finish_for" || choosingParent;
  const options = fabricParentOptions(lines, line);
  const current = line.finishFor ? lines.find((other) => other.lineNo === line.finishFor?.row) : undefined;
  const parentChoices = current && !options.includes(current) ? [current, ...options] : options;
  const chip = line.rowKindSource ? SOURCE_CHIP[line.rowKindSource] : null;

  return (
    <div className="min-w-[150px]">
      <select
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
          onSet(next, null);
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
          aria-label={`Row ${line.lineNo} is the fabric of`}
          value={choosingParent && kind !== "finish_for" ? "" : String(line.finishFor?.row ?? "")}
          disabled={!editable || busy}
          onChange={(event) => {
            const row = Number(event.target.value);
            if (!Number.isInteger(row) || row <= 0) return;
            setChoosingParent(false);
            onSet("finish_for", row);
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
          written as the next free COM on row {line.finishFor.row}
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
