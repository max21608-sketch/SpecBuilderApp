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
//
// EVERY CONTROL HERE IS A `Button`, and the one that is an anchor says why.
// The .eml is fetched by the browser, so it has to stay an `<a href>`, which is
// what `buttonClass` exists for; everything else changes something and looks
// like it. Before this it was eleven hand-rolled `<button>`s in four sizes, and
// "I've sent this" — the one act in this app that records a communication —
// was the same weight as Cancel.
import { Fragment, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Link from "next/link";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { TIER_LABELS } from "@/lib/tgq";
import Button, { buttonClass } from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import { Table, Th, Td, Tr } from "@/components/ui/Table";

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

  return (
    <Card
      title={
        <>
          {draft.contact_name}
          {/* The card heading is uppercase and tracked; a chip inside it is a
              VALUE, so it keeps its own case. */}
          <CardHeadingNote>
          {sent ? (
            <Chip tone="good">
              Sent{draft.sent_at ? ` ${new Date(draft.sent_at).toLocaleDateString("en-GB")}` : ""}
              {draft.sent_by ? ` by ${draft.sent_by}` : ""}
            </Chip>
          ) : voided ? (
            <Chip>Send confirmation withdrawn</Chip>
          ) : (
            <Chip>
              {draft.items.length} question{draft.items.length === 1 ? "" : "s"}
            </Chip>
          )}
          </CardHeadingNote>
          {draft.manually_edited_at && (
            <CardHeadingNote>
              <Chip tone="warn">
                Edited {new Date(draft.manually_edited_at).toLocaleDateString("en-GB")}
                {draft.manually_edited_by ? ` by ${draft.manually_edited_by}` : ""}
              </Chip>
            </CardHeadingNote>
          )}
        </>
      }
      actions={
        // AN ANCHOR, because the browser fetches the file. `buttonClass` is
        // what lets it look like the action it is without pretending to be a
        // `<button>`.
        <a
          href={`/api/drafts/${draft.id}/eml?version=${draft.version}`}
          onClick={() => setDownloadedVersion(draft.version)}
          className={buttonClass("secondary", "xs")}
        >
          Open in Outlook (.eml)
        </a>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 text-sm">
          <p className="text-neutral-700">
            {draft.recipient_email ? (
              <>To: {draft.recipient_email}</>
            ) : addingEmail ? (
              <span className="flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  autoFocus
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  placeholder="designer@example.com"
                  aria-label="Their email address"
                  className="rounded border border-neutral-300 px-2 py-0.5 text-sm"
                />
                <Button
                  variant="primary"
                  size="xs"
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
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button variant="quiet" size="xs" onClick={() => setAddingEmail(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <span className="text-red-700">
                No email on file
                {editable && (
                  <>
                    {" — "}
                    <Button size="xs" variant="secondary" onClick={() => setAddingEmail(true)}>
                      Add one now
                    </Button>{" "}
                    <span className="text-neutral-500">(also saves to the contact if it is blank)</span>
                  </>
                )}
              </span>
            )}
          </p>
          {/* A DRAFT WITH NO Cc IS A CHASE NOBODY ELSE CAN SEE, so the empty
              case stays in words rather than rendering as a blank. */}
          <p className="text-xs text-neutral-500">
            Cc: {draft.cc_email ?? <span className="text-amber-700">none — no project inbox set</span>}
          </p>
          <p className="mt-1 text-sm text-neutral-700">{draft.subject}</p>
        </div>
      </div>

      {voided && draft.void_reason && <p className="mt-1 text-xs text-neutral-500">{draft.void_reason}</p>}

      {/* ---- staleness -------------------------------------------------- */}
      {editable && draft.staleCount > 0 && (
        <Note tone="warn">
          {draft.staleCount} question{draft.staleCount === 1 ? "" : "s"} changed since this was written — regenerate
          so the email describes the current picture.
        </Note>
      )}

      {error && (
        <Note tone="danger">
          {error}
          {diff && diff.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {diff.map((row, index) => (
                <li key={index}>
                  <span className="font-medium">{row.recordLabel}</span> {row.prompt}
                  {row.why ? ` — ${row.why}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Note>
      )}

      {/* ---- covered questions ------------------------------------------ */}
      <div className="mt-3 rounded-[10px] border border-neutral-200 bg-white">
        <Table scroll>
          <thead>
            <tr>
              <Th className="w-[18%]">Record</Th>
              <Th>Question</Th>
              <Th className="w-[16%]">BWS field</Th>
              <Th className="w-[16%]">Asked as</Th>
              <Th className="w-[20%]" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, startsTier }) => (
              <Fragment key={`${item.recordId}:${item.requirementId}`}>
                {startsTier && (
                  <tr>
                    <td
                      colSpan={5}
                      className={`border-b border-neutral-200 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                        startsTier === "to_quote" ? "bg-red-50 text-red-800" : "bg-neutral-50 text-neutral-500"
                      }`}
                    >
                      {startsTier === "to_quote" ? "TGQ — needed before we can quote" : TIER_LABELS[startsTier]}
                    </td>
                  </tr>
                )}
                <Tr tone={item.staleReasons.length ? "warn" : "plain"}>
                  <Td>
                    <Link
                      href={`/dashboard/records/${item.recordId}`}
                      className="font-mono text-blue-700 no-underline hover:underline"
                    >
                      {item.recordLabel}
                    </Link>{" "}
                    {item.refs && <span className="font-mono text-neutral-900">{item.refs}</span>}
                  </Td>
                  <Td>{item.prompt}</Td>
                  <Td muted>{item.fieldLabel?.trim() ?? "—"}</Td>
                  <Td muted>{item.currentValueText ?? "—"}</Td>
                  <Td className="text-right">
                    {item.staleReasons.length > 0 && (
                      <Chip tone="warn" className="mr-2">
                        {item.staleReasons.map((reason) => STALE_TEXT[reason] ?? reason).join(", ")}
                      </Chip>
                    )}
                    {/* ADVISORY, never a blocker: a question moving between the
                        two halves is a reading of the gate model, not a claim
                        about the answer. */}
                    {item.tierChanged && item.staleReasons.length === 0 && (
                      <Chip tone="warn" className="mr-2">
                        {item.tier === "to_quote" ? "no longer blocking the quote" : "now blocking the quote"} —
                        regenerate to re-order
                      </Chip>
                    )}
                    {editable && (
                      <Button size="xs" variant="quiet" disabled={busy} onClick={() => void removeQuestion(item)}>
                        Remove
                      </Button>
                    )}
                  </Td>
                </Tr>
              </Fragment>
            ))}
          </tbody>
        </Table>
      </div>

      {/* ---- the email --------------------------------------------------- */}
      <div className="mt-3 rounded-[10px] border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2">
          {editable && !editing && (
            <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
              Edit wording
            </Button>
          )}
          {editable && editing && (
            <span className="flex flex-wrap items-center gap-2">
              <Button size="xs" variant="primary" disabled={busy} onClick={() => void saveEdit()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button size="xs" variant="quiet" disabled={busy} onClick={cancelEdit}>
                Cancel
              </Button>
              {/* The question table is GENERATED from the coverage rows, which
                  is what makes the body and the coverage provably the same
                  set. There is no whole-body editor and there must not be. */}
              <span className="text-xs text-neutral-500">
                The question table is generated — edit the questions above.
              </span>
            </span>
          )}
        </div>

        {editing ? (
          <div className="space-y-2 p-3">
            <label className="block text-xs text-neutral-500">Opening</label>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={5}
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <label className="block text-xs text-neutral-500">Closing</label>
            <textarea
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              rows={2}
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editable && !confirming && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {downloadedVersion !== draft.version && (
              <span className="text-xs text-neutral-500">Open it in Outlook before confirming.</span>
            )}
            <Button
              variant="primary"
              disabled={busy || noRecipient || downloadedVersion !== draft.version}
              onClick={() => setConfirming(true)}
              title={
                noRecipient
                  ? "Add an email address first"
                  : downloadedVersion !== draft.version
                    ? "Download this version first"
                    : undefined
              }
            >
              I&rsquo;ve sent this
            </Button>
          </span>
        )}
        {editable && confirming && (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            Record that you sent these {draft.items.length} question
            {draft.items.length === 1 ? "" : "s"} to {draft.recipient_email}?
            <Button
              variant="primary"
              size="xs"
              disabled={busy}
              onClick={async () => {
                const ok = await post(`/api/drafts/${draft.id}/confirm-sent`, {
                  version: draft.version,
                  attestation: true,
                });
                if (ok) setConfirming(false);
              }}
            >
              {busy ? "Recording…" : "Yes, I sent it"}
            </Button>
            <Button variant="quiet" size="xs" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        )}

        {sent && !undoing && (
          <Button variant="danger" size="sm" className="ml-auto" onClick={() => setUndoing(true)}>
            Undo send confirmation
          </Button>
        )}
        {sent && undoing && (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <span className="text-neutral-600">This does not recall the email.</span>
            <input
              value={undoReason}
              onChange={(e) => setUndoReason(e.target.value)}
              placeholder="Why? (optional)"
              aria-label="Why the send confirmation is being withdrawn"
              className="rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <Button
              variant="danger"
              size="xs"
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
            >
              {busy ? "Withdrawing…" : "Withdraw"}
            </Button>
            <Button variant="quiet" size="xs" disabled={busy} onClick={() => setUndoing(false)}>
              Cancel
            </Button>
          </span>
        )}
      </div>
    </Card>
  );
}
