"use client";

// A PDF bill code could not read, waiting for — or in the middle of — the
// model's transcription (workstream C2).
//
// ============================================================================
// ONCE, AUTOMATICALLY; AGAIN ONLY ON A PRESS. The upload row already said this
// PDF has no text a program can read and that the model will transcribe it as
// one charged read, so the first visit starts it — the structure read's rule.
// A FAILED transcription is never retried by the screen: "Transcribe again"
// says it is charged again, and a person presses it.
//
// While it runs (minutes, for a long bill) the panel says so in words and
// looks again quietly; another tab's transcription is waited on, not started a
// second time — the route's claim refuses that anyway.
//
// Done renders nothing here: from then on the bill is an ordinary bill, and
// every line on the table carries its own "transcribed · p.N" mark.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { transcriptionPending, type PdfTranscription, type TranscriptionRecord } from "@/lib/pdf-bill-checks";
import Button from "@/components/ui/Button";
import { TONE } from "@/components/ui/tone";

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

/** Roughly how long, in words: windows of two pages, six at a time, a few minutes a wave. */
function howLong(pages: number | null): string {
  if (!pages) return "a few minutes";
  const waves = Math.ceil(Math.ceil(pages / 2) / 6);
  return waves <= 1 ? "a few minutes" : `up to ${waves * 4} minutes`;
}

export default function PdfTranscriptionPanel({
  importId,
  version,
  transcription,
  record,
  pdfHref,
  reload,
}: {
  importId: string;
  version: number;
  transcription: PdfTranscription;
  record: TranscriptionRecord | null | undefined;
  /** Where the PDF opens, for a person to look at while it is read. */
  pdfHref: string | null;
  /** Reload the run quietly; the panel reports after it, never before. */
  reload: () => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${importId}/transcribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version, requestId: newRequestId() }),
      });
      await reload();
      if (!res.ok && (res.data as { code?: string } | null)?.code !== "transcription_running") setError(res.error);
    } finally {
      setRunning(false);
    }
  }, [importId, version, reload]);

  const waiting = transcription.state === "waiting";
  const otherTab = !running && transcriptionPending(record);
  const failed = record?.outcome && !record.outcome.ok ? record.outcome : null;

  // THE AUTOMATIC START: once per visit, never after a failure, never over another tab's.
  useEffect(() => {
    if (!waiting || autoStarted.current || otherTab || failed) return;
    autoStarted.current = true;
    void start();
  }, [waiting, otherTab, failed, start]);

  // Another tab is transcribing: look again quietly until its claim clears.
  useEffect(() => {
    if (!waiting || !otherTab) return;
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [waiting, otherTab, reload]);

  if (!waiting) return null;
  const pages = transcription.pageCount;
  const pdfLink = pdfHref ? (
    <a href={pdfHref} className="text-blue-700 no-underline hover:underline" target="_blank" rel="noreferrer">
      the PDF
    </a>
  ) : (
    "the PDF"
  );

  if (running || otherTab) {
    return (
      <section aria-live="polite" className={`mt-3 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-5 ${TONE.info.note}`}>
        <p className="font-semibold">
          <span className={`mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full ${TONE.info.dot}`} />
          The model is transcribing this PDF{pages ? ` (${pages} page${pages === 1 ? "" : "s"})` : ""} — {howLong(pages)}.
        </p>
        <p className="mt-0.5">
          {transcription.reason} Every line it writes will be marked as transcribed, with its page, for you to check against {pdfLink}.
          {otherTab ? " It was started in another tab or a moment ago; this screen shows the result when it lands." : " You can leave this page; the result is kept."}
        </p>
      </section>
    );
  }

  return (
    <section className={`mt-3 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-5 ${failed || error ? TONE.danger.note : TONE.warn.note}`}>
      <p className="font-semibold">{failed || error ? "The PDF could not be transcribed" : "This PDF is waiting to be transcribed"}</p>
      <p className="mt-0.5">
        {error ?? failed?.text ?? transcription.reason}
        {(failed?.charged || (!error && !failed)) && " "}
        {failed?.charged ? "That attempt was charged." : null}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void start()}>
          {failed || error ? "Transcribe again" : "Transcribe it"}
        </Button>
        <span className="text-[11.5px] opacity-80">One charged read by the model. Or ask for the bill as a spreadsheet and upload that instead.</span>
      </div>
    </section>
  );
}
