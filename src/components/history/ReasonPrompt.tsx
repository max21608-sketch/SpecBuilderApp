"use client";

// Asked for ONLY when an edit overrides a settled answer.
//
// The obvious design is a reason box beside every field. It does not survive
// contact with the work: `save()` fires on every blur and every state change,
// so transcribing twenty answers off a drawing would ask twenty times, and
// what comes back is twenty rows reading "update". The reason for typing a
// value into a blank is the value.
//
// So the server decides. It refuses only the edit that changes a `confirmed`
// answer to something else, and this appears carrying that edit — nothing is
// retyped, and the reviewer can also attach the email that asked for it.
import { useState } from "react";
import type { AnswerState } from "@/lib/spec-vocab";
import EvidenceUpload, { type UploadedEvidence } from "@/components/history/EvidenceUpload";
import Button from "@/components/ui/Button";

export type PendingReason = {
  prompt: string;
  answerId: string;
  value: string;
  state: AnswerState;
  version: number;
};

export default function ReasonPrompt({
  pending,
  projectId,
  onCancel,
  onSubmit,
}: {
  pending: PendingReason;
  projectId: string;
  onCancel: () => void;
  onSubmit: (reason: string, evidence: UploadedEvidence | null) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<UploadedEvidence | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onSubmit(reason.trim(), evidence);
    } finally {
      // Always reset: a non-JSON error response must not leave this stuck.
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border border-amber-300 bg-amber-50 rounded-lg px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        “{pending.prompt}” is already confirmed. Say why it is changing.
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        This is recorded against the item, so a later “we never asked for this” can be answered. Attach the email or
        drawing if there is one.
      </p>
      <textarea
        value={reason}
        autoFocus
        rows={2}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Hayley confirmed the new fabric on 14 Sep"
        className="mt-2 w-full border border-amber-300 rounded px-2 py-1 text-sm bg-white"
      />
      <div className="mt-2">
        <EvidenceUpload projectId={projectId} onUploaded={setEvidence} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        {/* A button, because it OVERRIDES a confirmed answer — the one thing
            `danger` grades. It was a bordered div and a line of underlined
            text, which read as a link. */}
        <Button variant="danger" size="sm" disabled={!reason.trim() || busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Save the change"}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Leave it as it is
        </Button>
      </div>
    </div>
  );
}
