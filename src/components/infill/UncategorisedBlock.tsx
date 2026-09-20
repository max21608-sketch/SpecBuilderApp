"use client";

// The items that cannot be filled in yet, and the one control that unblocks them.
//
// A record with no category has NO questions at all — the checklist is created
// from the category — so it contributes nothing to any outstanding count and
// would simply not appear on a screen listing what is outstanding. That is the
// `0 of 0 renders green` failure: the item nobody has classified is exactly the
// one a meeting should catch.
//
// So it is listed first, and the picker is BESIDE it rather than on a screen
// somebody has to know exists (§0.3, a control lives beside the thing it acts
// on). `PATCH /api/records/[id]` with a category is one decision under its own
// change-set kind, and it creates the checklist rows — which is why the list
// reloads afterwards and the item moves into the table below.
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Note from "@/components/ui/Note";

export type UncategorisedRecord = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  version: number;
};

export type CategoryOption = { id: string; family: string; name: string };

/** How many are listed before the fold. Enough to act on, not enough to bury the table. */
const SHOW_AT = 5;

export default function UncategorisedBlock({
  records,
  categories,
  onChanged,
}: {
  records: UncategorisedRecord[];
  categories: CategoryOption[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const listed = showAll ? records : records.slice(0, SHOW_AT);

  async function setCategory(record: UncategorisedRecord, categoryId: string) {
    if (!categoryId) return;
    setBusy(record.recordId);
    setError(null);
    try {
      const res = await apiFetch(`/api/records/${encodeURIComponent(record.recordId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, version: record.version }),
      });
      // Reload first, then report: the list refreshes itself, and a message
      // set before the reload would be cleared by it.
      onChanged();
      if (!res.ok) setError(res.error);
    } finally {
      // Always, so an HTML error page cannot leave a select disabled.
      setBusy(null);
    }
  }

  return (
    <Note
      tone="warn"
      title={`${records.length} item${records.length === 1 ? "" : "s"} cannot be filled in until categorised`}
    >
      <p className="text-xs">
        A category is what creates the questions, so these have none — and they are counted as nothing outstanding
        anywhere else.
      </p>
      {/* FOLDED WHERE THERE ARE MANY. The 300-line project carries 96 of these,
          and listing them all put ninety-six dropdowns above the table this
          screen is for — the item it took two seconds to render was below the
          fold. The count is on the toggle, so the block never implies there are
          fewer than there are. */}
      {records.length > SHOW_AT && (
        <button
          type="button"
          onClick={() => setShowAll((on) => !on)}
          aria-expanded={showAll}
          className="mt-1 text-xs text-amber-900 underline"
        >
          {showAll ? `▾ Hide the other ${records.length - SHOW_AT}` : `▸ Show all ${records.length}`}
        </button>
      )}
      <ul className="mt-1.5 space-y-1">
        {listed.map((record) => (
          <li key={record.recordId} className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/records/${record.recordId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline"
            >
              {record.recordLabel}
            </Link>
            <span className="text-neutral-800">{record.itemDescription}</span>
            {/* Starts empty, so choosing always fires a change event. A select
                pre-filled with a suggestion would make agreeing with it do
                nothing at all — the level picker's own trap. */}
            <select
              defaultValue=""
              disabled={busy === record.recordId}
              aria-label={`Category for ${record.recordLabel}`}
              onChange={(event) => void setCategory(record, event.target.value)}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
            >
              <option value="">— choose a category —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.family === "upholstery" ? "Uph" : "Cab"} · {category.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </Note>
  );
}
