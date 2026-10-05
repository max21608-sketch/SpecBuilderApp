"use client";

// BW's own finish for a client CODE, on the finishes library (0045).
//
// ============================================================================
// SET ONCE, ON THE CODE, AND IT REACHES EVERY ITEM.
//
// Max, 2026-10-05: "BW own finishes should be set once per code in the
// finishes library." The record screen's per-item control (0041) became a
// read-only line on every spec filed under a code; this is where the choice
// is made instead. It is the same workflow -- propose BW's option, or say BW
// will propose one, and record the client's yes with their email -- and the
// same two pieces, because a table row cannot hold an editor: the SUMMARY sits
// in the row's BW finish cell, and the PANEL is its own `<tr>` spanning the
// table, never an extra `<td colSpan>` beside the data cells.
//
// THE COUNT IS THE TOTAL. "Applies to 11 items" is what the choice reaches,
// whatever the phase filter is showing -- the library's blast-radius rule. A
// filtered number beside a control that reaches every phase is how somebody
// changes BW's oak believing it reaches two chairs when it reaches eleven.
//
// THE LIST HAS NO "Other…". This is BW's own range, read from BWS; "Other" is
// for a client's words, and the client's words stay on each item untouched.
// Which list a code offers is the server's reading (`paletteForFinish`), and
// where there is none the cell says why in words rather than offering an
// empty dropdown.
// ============================================================================
import { useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import EvidenceUpload, { type UploadedEvidence } from "@/components/history/EvidenceUpload";
import { apiFetch } from "@/lib/api-fetch";
import { isOfferable, paletteOptionFor, type Palette } from "@/lib/palettes";
import { STANDARD_STATE_LABELS, isStandardState, type StandardState } from "@/lib/bw-standard";

/** The columns of a library row this control reads, as the finishes GET sends them. */
export type StandardFinish = {
  id: string;
  code: string;
  version: number;
  standard_value?: string | null;
  standard_state?: string | null;
  standard_set_by?: string | null;
  standard_evidence_filename?: string | null;
  standard_evidence_change_set_id?: string | null;
  bw_palette_key?: string | null;
  bw_palette_why?: string | null;
  bw_palette_mixed?: boolean | null;
  used_on: { recordId: string; itemStandardValue?: string | null; itemStandardState?: string | null }[];
};

function stateOf(finish: StandardFinish): StandardState | null {
  return isStandardState(finish.standard_state) ? finish.standard_state : null;
}

/** How many ITEMS the code is on: one record carrying it twice is one item. */
export function itemsCarrying(finish: Pick<StandardFinish, "used_on">): number {
  return new Set(finish.used_on.map((use) => use.recordId)).size;
}

/**
 * The per-item standard the code's items already carry from before 0045, when
 * they all agree and it is on the code's list -- offered back as a suggestion,
 * never written on its own. Null where they disagree, carry none, or carry one
 * the list does not hold.
 */
export function earlierItemChoice(
  finish: Pick<StandardFinish, "used_on">,
  palette: Palette | null,
): { value: string; items: number } | null {
  if (!palette) return null;
  const chosen = finish.used_on.filter(
    (use) => (use.itemStandardState === "proposed" || use.itemStandardState === "agreed") && use.itemStandardValue,
  );
  const values = [...new Set(chosen.map((use) => String(use.itemStandardValue)))];
  if (values.length !== 1) return null;
  const option = paletteOptionFor(palette, values[0]!);
  if (!option) return null;
  return { value: option.value, items: new Set(chosen.map((use) => use.recordId)).size };
}

/**
 * The BW finish cell: "BW Oak Grey – Open grain 10%  [proposed]  applies to 11
 * items  [Change…] [Client agreed]", or why there is nothing to choose.
 */
export function FinishStandardCell({
  finish,
  palette,
  busy,
  onSet,
  onAgree,
  onAdopt,
}: {
  finish: StandardFinish;
  palette: Palette | null;
  busy: boolean;
  onSet: () => void;
  onAgree: () => void;
  /** Propose the earlier per-item choice for the code, in one click. */
  onAdopt: (value: string) => void;
}) {
  const state = stateOf(finish);
  const offerable = Boolean(palette && isOfferable(palette));
  const items = itemsCarrying(finish);

  // NOTHING TO CHOOSE, and nothing chosen: say why, in words.
  if (!offerable && state === null) {
    return (
      <span className="block text-[11px] text-neutral-500" data-bw-finish="none">
        {finish.bw_palette_why ?? "No BW finish is offered for this code."}
      </span>
    );
  }

  const earlier = state === null ? earlierItemChoice(finish, palette) : null;
  return (
    <span className="flex flex-col gap-1 text-xs" data-bw-finish={state ?? "unset"}>
      <span className="flex flex-wrap items-center gap-1.5">
        {state === null ? (
          <span className="text-neutral-400">Not set</span>
        ) : state === "tbc" ? (
          <Chip tone="warn">{STANDARD_STATE_LABELS.tbc}</Chip>
        ) : (
          <>
            <span
              className="text-neutral-900"
              title="What the BWS file ships for this code on every item carrying it, in place of the client's words."
            >
              {finish.standard_value}
            </span>
            <Chip tone={state === "agreed" ? "good" : "warn"}>{STANDARD_STATE_LABELS[state]}</Chip>
            {state === "agreed" && finish.standard_evidence_change_set_id && (
              <a
                href={`/api/change-sets/${encodeURIComponent(finish.standard_evidence_change_set_id)}/evidence`}
                className="text-blue-700 underline"
              >
                {finish.standard_evidence_filename ?? "the client's email"}
              </a>
            )}
          </>
        )}
      </span>
      {/* THE TOTAL, whatever the phase filter shows: this is what it reaches. */}
      <span className="text-[11px] text-neutral-500">
        applies to {items} item{items === 1 ? "" : "s"}
      </span>
      {finish.bw_palette_mixed && (
        <span className="text-[11px] text-amber-800">{finish.bw_palette_why}</span>
      )}
      {earlier && (
        <SuggestButton
          value={earlier.value}
          evidence={`chosen on ${earlier.items} of its item${earlier.items === 1 ? "" : "s"} before the library held BW finishes`}
          busy={busy}
          onAccept={() => onAdopt(earlier.value)}
        />
      )}
      <span className="flex flex-wrap items-center gap-1.5">
        {(offerable || state !== null) && (
          <Button variant="quiet" size="xs" disabled={busy} onClick={onSet}>
            {state === null ? "Set…" : "Change…"}
          </Button>
        )}
        {state === "proposed" && (
          <Button size="xs" disabled={busy} onClick={onAgree}>
            Client agreed
          </Button>
        )}
      </span>
    </span>
  );
}

const NONE = "__none__";
const TBC = "__tbc__";

/**
 * The editor, as its own `<tr>`. `mode` says which act: choosing BW's finish,
 * or recording the client's agreement to the one proposed.
 */
export function FinishStandardPanel({
  finish,
  palette,
  projectId,
  mode,
  span,
  onClose,
  onSaved,
}: {
  finish: StandardFinish;
  palette: Palette | null;
  projectId: string;
  mode: "set" | "agree";
  span: number;
  onClose: () => void;
  /** Reload, then report. */
  onSaved: (message: string | null, ok: boolean) => Promise<void> | void;
}) {
  const state = stateOf(finish);
  const current = state === null ? NONE : state === "tbc" ? TBC : (finish.standard_value ?? NONE);
  const [choice, setChoice] = useState<string>(current);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<UploadedEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const items = itemsCarrying(finish);

  // Changing or withdrawing what the CLIENT agreed to asks why -- the route's
  // own rule (`standard_change`). Everything else takes an optional note.
  const needsReason = mode === "set" && state === "agreed";
  const unchanged = mode === "set" && choice === current;

  async function save() {
    setBusy(true);
    try {
      const body =
        mode === "agree"
          ? { action: "agree", version: finish.version, reason: reason.trim() || null, evidence }
          : {
              action: "set",
              version: finish.version,
              standard:
                choice === NONE ? null : choice === TBC ? { state: "tbc" } : { state: "proposed", value: choice },
              reason: reason.trim() || null,
            };
      const res = await apiFetch<{ recordsTouched: number }>(
        `/api/projects/${encodeURIComponent(projectId)}/finishes/${encodeURIComponent(finish.id)}/standard`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      // Reload first, report after -- a reload clears the banner.
      await onSaved(
        res.ok
          ? `BW finish for ${finish.code} ${mode === "agree" ? "agreed" : "saved"} — on ${res.data.recordsTouched} item${
              res.data.recordsTouched === 1 ? "" : "s"
            }.`
          : res.error,
        res.ok,
      );
    } finally {
      // Always, so an HTML error page cannot leave the button dead.
      setBusy(false);
    }
  }

  return (
    <tr className="bg-blue-50/50">
      <td colSpan={span} className="border-b border-blue-200 px-4 py-3">
        {mode === "agree" ? (
          <>
            <p className="text-sm font-medium text-neutral-900">
              The client agreed to {finish.standard_value} for {finish.code}
            </p>
            <p className="mt-0.5 text-xs text-neutral-600">
              On all {items} item{items === 1 ? "" : "s"} carrying it. Each item keeps the client&rsquo;s own words; the
              BWS file ships BW&rsquo;s finish. Attach their email if there is one.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-900">BW finish for {finish.code}</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              What BW will make, on all {items} item{items === 1 ? "" : "s"} carrying this code, on every phase. The
              client&rsquo;s words on each item are never changed; the BWS file ships BW&rsquo;s finish, and it holds
              each item at TBC until the client agrees.
            </p>
          </>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-3">
          {mode === "set" && (
            <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
              {palette?.name ?? "BW finish"}
              <select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                className="min-w-[20rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
              >
                <option value={NONE}>No BW finish — ship the client&rsquo;s words</option>
                <option value={TBC}>TBC — we&rsquo;ll propose one</option>
                {(palette?.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
            {needsReason ? "Why is the agreed BW finish changing?" : "Note (optional)"}
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={needsReason ? "The client has since asked for the darker oak" : ""}
              className="w-full min-w-[16rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
            />
          </label>
        </div>
        {mode === "agree" && (
          <div className="mt-2">
            <EvidenceUpload projectId={projectId} onUploaded={setEvidence} />
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || unchanged || (needsReason && !reason.trim())}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : mode === "agree" ? "Record the agreement" : "Save the BW finish"}
          </Button>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}
