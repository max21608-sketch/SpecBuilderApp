"use client";

// One chase draft, fully expanded. There is no list/detail split: a draft is
// something you read in full before you send it, so it is rendered in full.
//
// Only the intro and closing are editable, as plain text. The question table is
// generated from the coverage rows on the server. That is not a UI shortcut —
// it is what makes "the email says exactly what the app thinks it asked" a
// structural fact rather than a hope, and the send gate depends on it.
//
// Downloading the .eml records nothing. "Confirm sent" is a separate,
// explicit act, and it is refused if anything the email described has changed.
import { Fragment, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { TIER_LABELS } from "@/lib/tgq";
import Button from "@/components/ui/Button";

export type DraftItem = {
  recordId: string;
  requirementId: string;
  recordLabel: string;
  refs: string;
  prompt: string;
  fieldLabel: string | null;
  currentValueText: string | null;
  liveState: string | null;
  staleReasons: string[];
  /** Which half of the email this question printed under. */
  tier: "to_quote" | "later" | null;
  /**
   * The question has moved between the two halves since the email was written.
   * ADVISORY, never a blocker: the tier is a reading of the gate model, not a
   * claim about an answer, so a TGQ re-seed must not invalidate every draft.
   */
  tierChanged: boolean;
};

export type Draft = {
  id: string;
  status: "draft" | "sent" | "voided" | "superseded";
  subject: string;
  body: string;
  body_format: string;
  intro_text: string;
  closing_text: string;
  recipient_name: string | null;
  recipient_email: string | null;
  cc_email: string | null;
  project_label: string;
  contact_name: string;
  contact_email: string | null;
  generated_at: string;
  version: number;
  manually_edited_at: string | null;
  manually_edited_by: string | null;
  sent_at: string | null;
  sent_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  items: DraftItem[];
  staleCount: number;
};

const STALE_TEXT: Record<string, string> = {
  answerAppeared: "now answered",
  answerRemoved: "answer removed",
  answerChanged: "answer changed",
  answerSettled: "now settled",
  recordChanged: "record changed",
  recordRetired: "record retired",
  contextChanged: "question or record details changed",
  questionGone: "question no longer exists",
};

export default function ChaseDraftCard({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ recordLabel?: string; prompt?: string; why?: string }[] | null>(null);

  const [editing, setEditing] = useState(false);
  const [intro, setIntro] = useState(draft.intro_text);
  const [closing, setClosing] = useState(draft.closing_text);

  const [addingEmail, setAddingEmail] = useState(false);
  const [emailValue, setEmailValue] = useState("");

  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState("");

  // Downloading is what makes confirming meaningful: you cannot honestly say
  // you sent a version you never opened. Cleared whenever the draft changes.
  const [downloadedVersion, setDownloadedVersion] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const dirty = editing && (intro !== draft.intro_text || closing !== draft.closing_text);
  // The hook covers unload and in-app link clicks. It does NOT cover Cancel or
  // a programmatic navigation, which is why Cancel asks for itself below.
  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    setIntro(draft.intro_text);
    setClosing(draft.closing_text);
    setDownloadedVersion((current) => (current === draft.version ? current : null));
  }, [draft.intro_text, draft.closing_text, draft.version]);

  const sent = draft.status === "sent";
  const voided = draft.status === "voided";
  const editable = draft.status === "draft";

  // Coverage rows in stored order, with a marker on the first row of each half.
  // The email prints the same two sections; the card showing one flat list is
  // how a reviewer stops being able to tell which questions block the quote.
  const rows = draft.items.map((item, index) => ({
    item,
    startsTier:
      item.tier && item.tier !== (draft.items[index - 1]?.tier ?? null) ? item.tier : null,
  }));
  const noRecipient = !draft.recipient_email;

  async function post(path: string, payload: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    setDiff(null);
    try {
      const res = await apiFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(res.error);
        if (Array.isArray(res.data?.diff)) {
          setDiff(res.data.diff as { recordLabel?: string; prompt?: string; why?: string }[]);
        }
        onChanged();
        return false;
      }
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const ok = await post(`/api/drafts/${draft.id}/edit`, {
      version: draft.version,
      introText: intro,
      closingText: closing,
      questions: draft.items.map((item) => ({ recordId: item.recordId, requirementId: item.requirementId })),
    });
    if (ok) setEditing(false);
  }

  function cancelEdit() {
    if (dirty && !window.confirm("Discard your changes to this email?")) return;
    setIntro(draft.intro_text);
    setClosing(draft.closing_text);
    setEditing(false);
  }

  async function removeQuestion(item: DraftItem) {
    const remaining = draft.items.filter(
      (row) => !(row.recordId === item.recordId && row.requirementId === item.requirementId),
    );
    if (remaining.length === 0) {
      setError("A chase email has to ask at least one question. Delete the draft instead by regenerating.");
      return;
    }
    await post(`/api/drafts/${draft.id}/edit`, {
      version: draft.version,
      introText: intro,
      closingText: closing,
      questions: remaining.map((row) => ({ recordId: row.recordId, requirementId: row.requirementId })),
    });
  }

  const border = sent
    ? "border-neutral-200 bg-neutral-50"
    : voided
      ? "border-neutral-200 bg-neutral-50"
      : noRecipient
        ? "border-red-400 bg-red-50"
        : "border-neutral-300";

  return (
    <div className={`border rounded-lg p-4 ${border}`}>
      {/* ---- header ---------------------------------------------------- */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-neutral-900">{draft.contact_name}</p>
          <div className="text-sm text-neutral-600">
            {draft.recipient_email ? (
              <>To: {draft.recipient_email}</>
            ) : addingEmail ? (
              <span className="flex items-center gap-2">
                <input
                  type="email"
                  autoFocus
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  placeholder="designer@example.com"
                  className="border border-neutral-300 rounded px-2 py-0.5 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !emailValue.trim()}
                  onClick={async () => {
                    const ok = await post(`/api/drafts/${draft.id}/set-recipient`, {
                      version: draft.version,
                      email: emailValue.trim(),
                    });
                    if (ok) {
                      setAddingEmail(false);
                      setEmailValue("");
                    }
                  }}
                  className="px-2 py-0.5 rounded bg-neutral-900 text-white text-xs disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingEmail(false)}
                  className="px-2 py-0.5 rounded border border-neutral-300 text-xs"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="text-red-700">
                No email on file
                {editable && (
                  <>
                    {" — "}
                    <Button size="xs" variant="quiet" onClick={() => setAddingEmail(true)}>
                      Add one now
                    </Button>{" "}
                    <span className="text-neutral-500">(also saves to the contact if it is blank)</span>
                  </>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            Cc: {draft.cc_email ?? <span className="text-amber-700">none — no project inbox set</span>}
          </p>
          <p className="text-sm text-neutral-700 mt-1">{draft.subject}</p>
        </div>

        <div className="text-right shrink-0 text-xs">
          <p
            className={
              sent ? "text-green-700 font-medium" : voided ? "text-neutral-500" : "text-neutral-500"
            }
          >
            {sent
              ? `Sent${draft.sent_at ? ` ${new Date(draft.sent_at).toLocaleString()}` : ""}${draft.sent_by ? ` by ${draft.sent_by}` : ""}`
              : voided
                ? "Send confirmation withdrawn"
                : `${draft.items.length} question${draft.items.length === 1 ? "" : "s"}`}
          </p>
          {voided && draft.void_reason && <p className="text-neutral-500 mt-0.5">{draft.void_reason}</p>}
          {draft.manually_edited_at && (
            <p className="text-amber-700 mt-0.5">
              Edited {new Date(draft.manually_edited_at).toLocaleString()}
              {draft.manually_edited_by ? ` by ${draft.manually_edited_by}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* ---- staleness -------------------------------------------------- */}
      {editable && draft.staleCount > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          {draft.staleCount} question{draft.staleCount === 1 ? "" : "s"} changed since this was written —
          regenerate so the email describes the current picture.
        </p>
      )}

      {error && (
        <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
          {diff && diff.length > 0 && (
            <ul className="mt-1 list-disc list-inside">
              {diff.map((row, index) => (
                <li key={index}>
                  <span className="font-medium">{row.recordLabel}</span> {row.prompt}
                  {row.why ? ` — ${row.why}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---- covered questions ------------------------------------------ */}
      <div className="mt-3 overflow-x-auto border border-neutral-200 rounded bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="text-left font-medium px-3 py-1.5">Record</th>
              <th className="text-left font-medium px-3 py-1.5">Question</th>
              <th className="text-left font-medium px-3 py-1.5">BWS field</th>
              <th className="text-left font-medium px-3 py-1.5">Asked as</th>
              <th className="text-left font-medium px-3 py-1.5"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map(({ item, startsTier }) => (
              <Fragment key={`${item.recordId}:${item.requirementId}`}>
              {startsTier && (
                <tr>
                  <td
                    colSpan={5}
                    className={`px-3 py-1 text-xs font-medium ${
                      startsTier === "to_quote" ? "text-red-800 bg-red-50" : "text-neutral-600 bg-neutral-50"
                    }`}
                  >
                    {TIER_LABELS[startsTier]}
                  </td>
                </tr>
              )}
              <tr className={item.staleReasons.length ? "bg-amber-50" : undefined}>
                <td className="px-3 py-1.5 text-neutral-500 tabular-nums whitespace-nowrap">
                  <Link href={`/dashboard/records/${item.recordId}`} className="hover:underline">
                    {item.recordLabel}
                  </Link>{" "}
                  {item.refs && <span className="text-neutral-900">{item.refs}</span>}
                </td>
                <td className="px-3 py-1.5">{item.prompt}</td>
                <td className="px-3 py-1.5 text-neutral-600">{item.fieldLabel?.trim() ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{item.currentValueText ?? "—"}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {item.staleReasons.length > 0 && (
                    <span className="text-xs text-amber-800 mr-2">
                      {item.staleReasons.map((reason) => STALE_TEXT[reason] ?? reason).join(", ")}
                    </span>
                  )}
                  {item.tierChanged && item.staleReasons.length === 0 && (
                    <span className="text-xs text-amber-700 mr-2">
                      {item.tier === "to_quote" ? "no longer blocking the quote" : "now blocking the quote"} —
                      regenerate to re-order
                    </span>
                  )}
                  {editable && (
                    <Button size="xs" variant="quiet" disabled={busy} onClick={() => void removeQuestion(item)}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- the email --------------------------------------------------- */}
      <div className="mt-3 border border-neutral-200 rounded bg-white">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100">
          {editable && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-2 py-1 rounded text-xs border border-neutral-300 hover:bg-neutral-100"
            >
              Edit wording
            </button>
          )}
          {editable && editing && (
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveEdit()}
                className="px-2 py-1 rounded text-xs bg-neutral-900 text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={cancelEdit}
                className="px-2 py-1 rounded text-xs border border-neutral-300"
              >
                Cancel
              </button>
              <span className="text-xs text-neutral-500">
                The question table is generated — edit the questions above.
              </span>
            </span>
          )}
          <span className="ml-auto">
            <a
              href={`/api/drafts/${draft.id}/eml?version=${draft.version}`}
              onClick={() => setDownloadedVersion(draft.version)}
              className="px-2 py-1 rounded text-xs border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
            >
              Open in Outlook (.eml)
            </a>
          </span>
        </div>

        {editing ? (
          <div className="p-3 space-y-2">
            <label className="block text-xs text-neutral-500">Opening</label>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={5}
              className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
            />
            <label className="block text-xs text-neutral-500">Closing</label>
            <textarea
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              rows={2}
              className="w-full border border-neutral-300 rounded px-2 py-1 text-sm"
            />
          </div>
        ) : (
          // Server-generated and server-escaped: the prose is escaped by
          // chase-template.ts and the table is built from stored values. No
          // client HTML ever reaches this.
          <div ref={bodyRef} className="p-4 text-sm" dangerouslySetInnerHTML={{ __html: draft.body }} />
        )}
      </div>

      {/* ---- the gate ---------------------------------------------------- */}
      <div className="flex items-center gap-2 mt-3">
        {editable && !confirming && (
          <span className="ml-auto flex items-center gap-2">
            {downloadedVersion !== draft.version && (
              <span className="text-xs text-neutral-500">Open it in Outlook before confirming.</span>
            )}
            <button
              type="button"
              disabled={busy || noRecipient || downloadedVersion !== draft.version}
              onClick={() => setConfirming(true)}
              title={
                noRecipient
                  ? "Add an email address first"
                  : downloadedVersion !== draft.version
                    ? "Download this version first"
                    : undefined
              }
              className="px-3 py-1.5 rounded text-sm bg-neutral-900 text-white disabled:opacity-40"
            >
              I&rsquo;ve sent this
            </button>
          </span>
        )}
        {editable && confirming && (
          <span className="ml-auto flex items-center gap-2 text-sm">
            Record that you sent these {draft.items.length} question
            {draft.items.length === 1 ? "" : "s"} to {draft.recipient_email}?
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await post(`/api/drafts/${draft.id}/confirm-sent`, {
                  version: draft.version,
                  attestation: true,
                });
                if (ok) setConfirming(false);
              }}
              className="px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50"
            >
              {busy ? "Recording…" : "Yes, I sent it"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded border border-neutral-300"
            >
              Cancel
            </button>
          </span>
        )}

        {sent && !undoing && (
          <button
            type="button"
            onClick={() => setUndoing(true)}
            className="ml-auto px-2 py-1 rounded text-sm border border-neutral-300 hover:bg-neutral-100"
          >
            Undo send confirmation
          </button>
        )}
        {sent && undoing && (
          <span className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-neutral-600">This does not recall the email.</span>
            <input
              value={undoReason}
              onChange={(e) => setUndoReason(e.target.value)}
              placeholder="Why? (optional)"
              className="border border-neutral-300 rounded px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await post(`/api/drafts/${draft.id}/undo-confirm`, {
                  version: draft.version,
                  reason: undoReason.trim() || undefined,
                });
                if (ok) {
                  setUndoing(false);
                  setUndoReason("");
                }
              }}
              className="px-2 py-1 rounded bg-neutral-900 text-white disabled:opacity-50"
            >
              {busy ? "Withdrawing…" : "Withdraw"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setUndoing(false)}
              className="px-2 py-1 rounded border border-neutral-300"
            >
              Cancel
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
