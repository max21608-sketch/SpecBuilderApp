// What a pack of documents adds up to, in ONE line.
//
// ============================================================================
// ONE LINE FOR THE PACK, NOT ONE NOTICE PER DOCUMENT.
//
// found-in-use 5, the catchup of 2026-09-18: the pack screen carried a white or
// yellow notice per document, and Max said it unprompted — "if you were doing a
// larger order it would just stack up and you'd have like 300." Matthew checked
// they carried nothing that needed reviewing, and they did not: what needs
// reviewing is on the document's own row, where the chip, the failure message
// and the Try again button already live.
//
// The simplest version is to delete the notices. The TRAP is the failure: a
// read that failed is a charged retry, the row that carries it may be under the
// fold on a pack of thirty, and a person who never scrolls never learns they
// are a document short. So the failure count is in this line, red, with the
// control beside it — and the control is offered whenever ANYTHING failed, not
// only when everything did, because one failure of eleven is the case nobody
// would see.
//
// It is a SENTENCE and not four more tiles. The tiles are in the approved
// mock-up and stay; they are four numbers to compare, and this is the one
// reading of the pack that a person takes away.
//
// THE PARTS ADD UP, and that is why `packTally` counts `pending` and why an
// unaccounted state is printed. Four labelled tiles never claimed to be
// exhaustive; one sentence does, and "11 documents · 8 reviewed · 1 waiting"
// over a pack holding two more in some state nobody named is the empty
// programme error in a new place.
// ============================================================================
import Button from "@/components/ui/Button";
import { packTally } from "@/lib/intake-status";

export default function PackSummary({
  runs,
  onRetryFailed,
  busy = false,
}: {
  /** The pack's documents. Re-tallied on every render, so a poll moves it. */
  runs: { status: string }[];
  /** Retries every failed read, in sequence. Absent where nothing may retry. */
  onRetryFailed?: () => void;
  busy?: boolean;
}) {
  const tally = packTally(runs);
  if (tally.total === 0) return null;

  const counted = tally.reviewed + tally.toReview + tally.reading + tally.failed + tally.notRead;
  const other = tally.total - counted;
  // With one document the state needs no number — "1 document · 1 reviewed"
  // reads as two facts about two things.
  const n = (count: number, label: string) => (tally.total === 1 ? label : `${count} ${label}`);

  const parts: { key: string; text: string; danger?: boolean }[] = [];
  if (tally.reviewed > 0) parts.push({ key: "reviewed", text: n(tally.reviewed, "reviewed") });
  if (tally.toReview > 0) parts.push({ key: "toReview", text: n(tally.toReview, "waiting for you") });
  if (tally.reading > 0) parts.push({ key: "reading", text: n(tally.reading, "still being read") });
  if (tally.notRead > 0) parts.push({ key: "notRead", text: n(tally.notRead, "not read yet") });
  if (tally.failed > 0) parts.push({ key: "failed", text: n(tally.failed, "read failed"), danger: true });
  if (other > 0) parts.push({ key: "other", text: `${other} in another state` });

  // Every document failed: the line itself is the alarm, not one word inside it.
  const allFailed = tally.failed === tally.total;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className={`text-sm ${allFailed ? "font-medium text-red-800" : "text-neutral-600"}`}>
        {tally.total} document{tally.total === 1 ? "" : "s"}
        {parts.map((part) => (
          <span key={part.key} className={!allFailed && part.danger ? "text-red-800" : undefined}>
            {" · "}
            {part.text}
          </span>
        ))}
      </p>
      {tally.failed > 0 && onRetryFailed && (
        // `danger` is what the per-row Try again already uses for a failed read:
        // it overrides nothing, but it spends money, and the label says how
        // many times.
        <Button variant="danger" size="sm" disabled={busy} onClick={onRetryFailed}>
          {busy ? "Retrying…" : `Retry ${tally.failed} failed read${tally.failed === 1 ? "" : "s"} · charges again`}
        </Button>
      )}
    </div>
  );
}
