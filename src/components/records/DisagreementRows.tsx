"use client";

// Where two documents disagree about one spec, and a person settles it.
//
// ============================================================================
// BOTH VALUES, IN RED, DIRECTLY UNDER THE ONE THAT STANDS.
//
// Max, 2026-10-05: "it needs to take in both ... keep them separate ...
// highlight them in red ... keep whatever's in the BOQ to begin with". So the
// held value stays in its row, exactly as it was, and every OPEN disagreement
// against it is its own red row directly beneath — "<document>, page n says:
// <value>" — with the two answers beside it. Red, not amber: amber is "needs a
// person" and this does too, but Max asked for red and the reason is real — two
// documents disagreeing about what is being priced is the case that sends the
// wrong item out, which is what red means in `tone.ts`.
//
// THE REASON BOX IS ALWAYS SHOWN AND ALWAYS REQUIRED — the correction screen's
// rule, and stronger here: both values stay on record whichever wins, so the
// reason is the only thing that ever says why. Neither button presses without
// it, and the route refuses one anyway (a hidden control is not a gate).
//
// A STALE VERSION IS SHOWN ON THE ROW, which then reloads itself. The row is
// keyed by the disagreement's id, so the sentence survives the reload that
// hands it the live version — reload first, report after, the drawings
// screens' rule (`reloadThen`).
//
// A spanning panel is its own `<tr>` (Table.tsx), never an extra `<td
// colSpan>` beside the data cells.
// ============================================================================
import { useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import { TONE } from "@/components/ui/tone";
import { apiFetch } from "@/lib/api-fetch";
import { composeDimensionCell } from "@/lib/dimensions";
import { DISAGREEMENT_DECISION_LABELS, type Disagreement, type DisagreementDecision } from "@/lib/disagreements";
import { isDimensionSlot, type AttributeState, type AttributeUnit } from "@/lib/spec-vocab";
import { ConvertedChip } from "@/components/records/ItemSpecChips";

/**
 * What the other document said, as a person reads it. A dimension is its slot
 * through the ONE composer in screen mode — `W 21" (533mm)` — so the figure
 * reads exactly as the cell above it would read if this value were used.
 */
export function disagreementValue(disagreement: Pick<
  Disagreement,
  "attrGroup" | "dimensionSlot" | "value" | "unit" | "state"
>): { text: string; fromImperial: boolean } {
  if (disagreement.attrGroup === "dimension" && disagreement.dimensionSlot && isDimensionSlot(disagreement.dimensionSlot)) {
    const cell = composeDimensionCell(
      [
        {
          slot: disagreement.dimensionSlot,
          value: disagreement.value,
          unit: (disagreement.unit ?? null) as AttributeUnit | null,
          state: disagreement.state as AttributeState,
          sortOrder: 0,
        },
      ],
      null,
      { mode: "screen" },
    );
    return { text: cell.text, fromImperial: cell.fromImperial === true };
  }
  const text = disagreement.value ?? "";
  return { text: disagreement.state === "tbc" ? `${text}${text ? " " : ""}TBC` : text, fromImperial: false };
}

/** "<document>, page n" as a link into this app's copy, or the plain words where there is no page. */
function SourceLink({ disagreement }: { disagreement: Disagreement }) {
  const name = disagreement.sourceFilename ?? "Another document";
  if (!disagreement.sourceRunId) return <span>A document since removed</span>;
  return (
    <a
      href={`/api/imports/${disagreement.sourceRunId}/source${disagreement.sourcePage ? `#page=${disagreement.sourcePage}` : ""}`}
      target="_blank"
      rel="noreferrer"
      className="font-medium underline"
    >
      {name}
      {disagreement.sourcePage ? `, page ${disagreement.sourcePage}` : ""}
    </a>
  );
}

function keepLabel(disagreement: Disagreement): string {
  return disagreement.heldFromBill ? "Keep the bill's" : "Keep the held value";
}

export function OpenDisagreementRow({
  disagreement,
  span,
  onReload,
}: {
  disagreement: Disagreement;
  span: number;
  /** Re-reads the record. Awaited before a refusal is shown, so the reload cannot clear it. */
  onReload: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<DisagreementDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = disagreementValue(disagreement);
  // THE VALUE IT DISAGREED WITH HAS GONE — corrected, or replaced by another
  // document's value. It is still undecided, and it may only be KEPT: using it
  // would retire a value nobody compared it with.
  const replaced = disagreement.heldStatus !== "active";
  const ready = reason.trim() !== "" && busy === null;

  async function settle(decision: DisagreementDecision) {
    if (!reason.trim()) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await apiFetch(`/api/disagreements/${encodeURIComponent(disagreement.id)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: reason.trim(),
          version: disagreement.version,
          heldVersion: replaced ? null : disagreement.heldVersion,
        }),
      });
      if (res.ok) {
        await onReload();
        return;
      }
      // A REFUSED REQUEST MEANS THIS SCREEN IS OUT OF DATE: reload, then say
      // why on the row. The row survives the reload (same key), and so does
      // the reason somebody typed.
      await onReload();
      setError(res.error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <tr className={TONE.danger.row} data-disagreement={disagreement.id}>
      <td colSpan={span} className="border-b border-red-200 px-4 py-2.5">
        <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm ${TONE.danger.text}`}>
          <Chip tone="danger">disagrees</Chip>
          <span>
            <SourceLink disagreement={disagreement} /> says:
          </span>
          <span className="font-mono font-semibold">{shown.text || "nothing"}</span>
          {disagreement.materialCode && disagreement.attrGroup !== "dimension" && (
            <Chip mono tone="danger">
              {disagreement.materialCode}
            </Chip>
          )}
          {shown.fromImperial && <ConvertedChip />}
        </div>
        {replaced && (
          <p className="mt-1 text-xs text-red-800">
            Was against {disagreement.heldFromBill ? "the bill's" : "the held"} value “{disagreement.heldValue ?? "TBC"}
            {disagreement.heldUnit && !/["']$/.test(disagreement.heldValue ?? "") ? disagreement.heldUnit : ""}”, now
            replaced. It can only be kept now — compare it with the value above first.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label={`Why — ${disagreement.label}`}
            placeholder="Why — e.g. the tracker of 24 Aug supersedes the bill"
            className="min-w-[18rem] flex-1 rounded border border-red-300 bg-white px-2 py-1 text-sm text-neutral-900"
          />
          <Button variant="secondary" size="xs" disabled={!ready} onClick={() => void settle("kept_held")}>
            {busy === "kept_held" ? "Saving…" : keepLabel(disagreement)}
          </Button>
          <Button
            variant="danger"
            size="xs"
            disabled={!ready || replaced}
            title={replaced ? "The value this disagreed with has already been replaced." : undefined}
            onClick={() => void settle("used_this")}
          >
            {busy === "used_this" ? "Saving…" : "Use this instead"}
          </Button>
        </div>
        {!reason.trim() && (
          <p className="mt-1 text-xs text-red-800">Say why first — both values stay on record either way.</p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-800">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

/**
 * A SETTLED disagreement, under "show retired": grey, naming the decision, who
 * and when, and why. Nothing to press — a decision is undone by deciding again
 * on the value itself (correct it, or retire it), which keeps the trail whole.
 */
export function SettledDisagreementItem({ disagreement }: { disagreement: Disagreement }) {
  const shown = disagreementValue(disagreement);
  const decision = disagreement.status === "open" ? null : DISAGREEMENT_DECISION_LABELS[disagreement.status];
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm text-neutral-500">
      <span className="w-40 shrink-0">{disagreement.label}</span>
      <span className="min-w-[10rem] flex-1">
        <SourceLink disagreement={disagreement} /> said <span className="font-mono">{shown.text || "nothing"}</span>
      </span>
      <span className="text-xs">
        {decision}
        {disagreement.resolvedBy ? ` by ${disagreement.resolvedBy}` : ""}
        {disagreement.resolvedAt ? ` on ${new Date(disagreement.resolvedAt).toLocaleDateString()}` : ""}
        {disagreement.reason ? ` — “${disagreement.reason}”` : ""}
      </span>
    </li>
  );
}
