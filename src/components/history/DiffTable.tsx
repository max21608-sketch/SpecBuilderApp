"use client";

// One change, as a table a person can read against the pack.
//
// The sections are in the order somebody asks about them: what the item IS,
// then what documents said about it, then the checklist, then what the export
// cell became. The export cells come LAST and are collapsed by default,
// because they are derived from the three above and a reader who opens a
// version wants to know what somebody did, not what fell out of it.
import { useState } from "react";
import type { FieldChange, ListChange, SnapshotDiff } from "@/lib/snapshot-diff";

function Value({ text, tone }: { text: string | null; tone: "was" | "now" }) {
  if (text === null) {
    return <span className="text-neutral-400 italic">{tone === "was" ? "not set" : "cleared"}</span>;
  }
  return <span className={tone === "was" ? "text-neutral-500 line-through decoration-neutral-300" : "text-neutral-900"}>{text}</span>;
}

function Rows({ changes }: { changes: FieldChange[] }) {
  return (
    <>
      {changes.map((change) => (
        <tr key={change.field} className="border-t border-neutral-100">
          <td className="py-1 pr-3 align-top text-neutral-500 whitespace-nowrap">{change.label}</td>
          <td className="py-1 pr-3 align-top"><Value text={change.was} tone="was" /></td>
          <td className="py-1 align-top"><Value text={change.now} tone="now" /></td>
        </tr>
      ))}
    </>
  );
}

const CHANGE_LABEL: Record<ListChange["change"], string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
};

const CHANGE_CLASS: Record<ListChange["change"], string> = {
  added: "text-green-700 bg-green-50 border-green-200",
  removed: "text-red-700 bg-red-50 border-red-200",
  changed: "text-amber-800 bg-amber-50 border-amber-200",
};

function Section({ title, items }: { title: string; items: ListChange[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{title}</h4>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {items.map((item) => (
            <tr key={`${item.change}:${item.key}`} className="align-top border-t border-neutral-100">
              <td className="py-1 pr-3 w-44">
                <span className="text-neutral-900">{item.label}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded border ${CHANGE_CLASS[item.change]}`}>
                  {CHANGE_LABEL[item.change]}
                </span>
              </td>
              <td className="py-1">
                <table className="w-full text-sm">
                  <tbody>
                    <Rows changes={item.fields} />
                  </tbody>
                </table>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DiffTable({ diff }: { diff: SnapshotDiff }) {
  const [showCells, setShowCells] = useState(false);

  if (diff.isEmpty) {
    // Not nothing: a change that produced no difference is worth saying out
    // loud, because the alternative reading is that the screen failed to load.
    return <p className="mt-2 text-sm text-neutral-500">Nothing on this record changed.</p>;
  }

  return (
    <div className="mt-2">
      {diff.core.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">The item</h4>
          <table className="mt-1 w-full text-sm">
            <tbody>
              <Rows changes={diff.core} />
            </tbody>
          </table>
        </div>
      )}
      <Section title="Client refs" items={diff.refs} />
      <Section title="Specs captured" items={diff.attributes} />
      <Section title="Checklist" items={diff.answers} />

      {diff.cells.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowCells((value) => !value)}
            className="text-xs text-neutral-600 hover:text-neutral-900"
          >
            {showCells ? "▾" : "▸"} {diff.cells.length} BWS export cell{diff.cells.length === 1 ? "" : "s"} changed
          </button>
          {showCells && (
            <>
              {/* Composed with TODAY's rules at both ends, not read from what
                  was stored — so a change shown here is always a change in the
                  data and never a change in how a cell is written. */}
              <table className="mt-1 w-full text-sm">
                <tbody>
                  <Rows changes={diff.cells} />
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
