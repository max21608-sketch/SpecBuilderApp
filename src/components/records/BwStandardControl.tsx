"use client";

// The BW standard on the record's Specs tab: what we will make, beside what
// the client specified (0041).
//
// ============================================================================
// THE CLIENT'S WORDS STAY WHERE THEY ARE. The value cell above this line goes
// on printing what the document said; this line prints BW's answer to it, its
// state, and the two acts that move it -- Set… and Client agreed. Max,
// 2026-09-23: the client specifies "30% oak", BW proposes "25% oak", the
// client agrees, and both stay visible for ever.
//
// Two pieces, because a table row cannot hold an editor: the SUMMARY sits in
// the value cell, and the PANEL is its own `<tr>` spanning the table -- never
// an extra `<td colSpan>` beside the data cells, which squeezes the editor
// into a ribbon (CLAUDE.md, "A link goes somewhere; a button does something").
//
// The option is sent by VALUE; the server resolves which option row it is
// against the field's own palette, and refuses anything else in words.
// ============================================================================
import { useState } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import EvidenceUpload, { type UploadedEvidence } from "@/components/history/EvidenceUpload";
import { apiFetch } from "@/lib/api-fetch";
import { isOfferable, paletteFromRow, type Palette, type PaletteRow } from "@/lib/palettes";
import { STANDARD_STATE_LABELS, isStandardState, type StandardState } from "@/lib/bw-standard";

/** The columns of an attribute this control reads, as `/api/records/[id]` sends them. */
export type StandardAttribute = {
  id: string;
  label: string;
  version: number;
  value: string | null;
  json_id: number | null;
  standard_value?: string | null;
  standard_state?: string | null;
  standard_set_by?: string | null;
  standard_evidence_filename?: string | null;
  standard_evidence_change_set_id?: string | null;
};

/** The palette a BWS field offers, from the record payload's register. */
export function paletteForJsonId(
  palettes: readonly PaletteRow[],
  paletteByQuestion: readonly { json_id: number | null; palette_key: string }[],
  jsonId: number | null,
): Palette | null {
  if (jsonId === null) return null;
  const key = paletteByQuestion.find((row) => row.json_id !== null && row.json_id === jsonId)?.palette_key;
  const row = key ? palettes.find((palette) => palette.key === key) : undefined;
  return row ? paletteFromRow(row) : null;
}

function stateOf(attribute: StandardAttribute): StandardState | null {
  return isStandardState(attribute.standard_state) ? attribute.standard_state : null;
}

/**
 * "BW standard: BW Oak Grey – Open grain 10% (proposed)  [Change…] [Client agreed]".
 *
 * Rendered only where there is something to say: a field with a BWS list, or
 * a standard already on the row (a register that could not be read must not
 * hide a proposal somebody made).
 */
export function BwStandardSummary({
  attribute,
  palette,
  onSet,
  onAgree,
}: {
  attribute: StandardAttribute;
  palette: Palette | null;
  onSet: () => void;
  onAgree: () => void;
}) {
  const state = stateOf(attribute);
  if (!state && !(palette && isOfferable(palette))) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <span className="text-neutral-500">BW standard:</span>
      {state === null ? (
        <span className="text-neutral-400">—</span>
      ) : state === "tbc" ? (
        <Chip tone="warn">{STANDARD_STATE_LABELS.tbc}</Chip>
      ) : (
        <>
          <span className="text-neutral-900" title="This is what the BWS file ships for this field, in place of the client's words above.">
            {attribute.standard_value}
          </span>
          <Chip tone={state === "agreed" ? "good" : "warn"}>{STANDARD_STATE_LABELS[state]}</Chip>
          {state === "agreed" && attribute.standard_evidence_change_set_id && (
            <a
              href={`/api/change-sets/${encodeURIComponent(attribute.standard_evidence_change_set_id)}/evidence`}
              className="text-blue-700 underline"
            >
              {attribute.standard_evidence_filename ?? "the client's email"}
            </a>
          )}
        </>
      )}
      {(palette && isOfferable(palette)) || state !== null ? (
        <Button variant="quiet" size="xs" onClick={onSet}>
          {state === null ? "Set…" : "Change…"}
        </Button>
      ) : null}
      {state === "proposed" && (
        <Button size="xs" onClick={onAgree}>
          Client agreed
        </Button>
      )}
    </span>
  );
}

const NONE = "__none__";
const TBC = "__tbc__";

/**
 * The editor, as its own `<tr>`. `mode` says which act: choosing the standard,
 * or recording the client's agreement to the one proposed.
 */
export function BwStandardPanel({
  attribute,
  palette,
  projectId,
  mode,
  span,
  onClose,
  onSaved,
}: {
  attribute: StandardAttribute;
  palette: Palette | null;
  projectId: string;
  mode: "set" | "agree";
  span: number;
  onClose: () => void;
  /** Reload, then report. Null is success with nothing more to say. */
  onSaved: (message: string | null, ok: boolean) => Promise<void> | void;
}) {
  const state = stateOf(attribute);
  const current = state === null ? NONE : state === "tbc" ? TBC : (attribute.standard_value ?? NONE);
  const [choice, setChoice] = useState<string>(current);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<UploadedEvidence | null>(null);
  const [busy, setBusy] = useState(false);

  // Changing or withdrawing what the CLIENT agreed to asks why -- the route's
  // own rule (`standard_change`). Everything else takes an optional note.
  const needsReason = mode === "set" && state === "agreed";
  const unchanged = mode === "set" && choice === current;

  async function save() {
    setBusy(true);
    try {
      const body =
        mode === "agree"
          ? { action: "agree", version: attribute.version, reason: reason.trim() || null, evidence }
          : {
              action: "set",
              version: attribute.version,
              standard:
                choice === NONE ? null : choice === TBC ? { state: "tbc" } : { state: "proposed", value: choice },
              reason: reason.trim() || null,
              evidence,
            };
      const res = await apiFetch(`/api/attributes/${encodeURIComponent(attribute.id)}/standard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Reload first, report after -- the record screen clears its banner on a
      // successful load, and a message set first would vanish with it.
      await onSaved(res.ok ? null : res.error, res.ok);
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
              The client agreed to {attribute.standard_value} for “{attribute.label}”
            </p>
            <p className="mt-0.5 text-xs text-neutral-600">
              They specified: {attribute.value?.trim() || "nothing in words"}. Both stay on the record; the BWS file
              ships the standard. Attach their email if there is one.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-900">BW standard for “{attribute.label}”</p>
            <p className="mt-0.5 text-xs text-neutral-600">
              What BW will make, beside what the client specified ({attribute.value?.trim() || "nothing in words"}). The
              client&rsquo;s words are never changed; the BWS file ships the standard, and it holds the item at TBC until
              the client agrees.
            </p>
          </>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-3">
          {mode === "set" && (
            <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
              {palette?.name ?? "BW standard"}
              <select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                className="min-w-[20rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
              >
                <option value={NONE}>No BW standard — ship the client&rsquo;s words</option>
                <option value={TBC}>TBC — BW to propose one</option>
                {(palette?.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
            {needsReason ? "Why is the agreed standard changing?" : "Note (optional)"}
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
            {busy ? "Saving…" : mode === "agree" ? "Record the agreement" : "Save the standard"}
          </Button>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}
