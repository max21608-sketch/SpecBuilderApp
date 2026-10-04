"use client";

// Reviewing a finishes schedule: which of its finishes go into the project's
// library, BEFORE any drawing is read (Matthew's D1).
//
// The unit is the FINISH, not a record proposal. Each row is one entry the
// schedule defines, with what the library makes of its code — the vocabulary
// `BulkAddFinishes` already uses for a pasted list (new / already held /
// repeated), plus the two a document can add that a paste cannot: a held code
// with nothing described yet (this FILLS it), and a held code the library
// already describes DIFFERENTLY (a conflict, written nowhere, for a person).
//
// The verdict comes from the server, computed by the same function the confirm
// runs (`reviewFinishSchedule`), so this screen cannot promise a write the
// confirm will not make. The kind is SUGGESTED and filed only by a click — the
// finishes page's rule — and the click files it on the staged entry, which the
// confirm then writes.
//
// NO MOCK-UP EXISTS FOR THIS SCREEN. It is the preamble review's pattern (the
// same three bands, the same primitives) with the finishes page's table and
// kind control, because those are the two jobs it is. Not accepted by anybody.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { usePoll } from "@/lib/use-poll";
import Spinner from "@/components/ui/Spinner";
import Disclosure, { DisclosureList } from "@/components/ui/Disclosure";
import PageHeader from "@/components/ui/PageHeader";
import PageBody from "@/components/ui/PageBody";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Note from "@/components/ui/Note";
import Chip from "@/components/ui/Chip";
import Button from "@/components/ui/Button";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import type { Tone } from "@/components/ui/tone";
import DocumentState from "@/components/imports/DocumentState";
import { WAITING_FOR_SLOT_MESSAGE } from "@/lib/intake-status";
import { DOCUMENT_KIND_LABELS } from "@/lib/spec-vocab";
import { FINISH_KINDS, FINISH_KIND_LABELS, type FinishKind } from "@/lib/finishes";
import {
  VERDICT_LABELS,
  type FinishScheduleEntry,
  type ScheduleReviewRow,
  type ScheduleVerdict,
  type StagedFinishSchedule,
} from "@/lib/finish-schedule";

type Run = {
  id: string;
  status: string;
  version: number;
  error: string | null;
  filename: string | null;
  claim_live: boolean | null;
  within_deadline: boolean | null;
  claim_count: number;
  waitingForSlot?: boolean | null;
  parsed: StagedFinishSchedule | null;
};

const VERDICT_TONE: Record<ScheduleVerdict["status"], Tone> = {
  new: "good",
  fills: "info",
  agrees: "plain",
  conflict: "warn",
  repeated: "blocked",
  no_code: "blocked",
};

/** The verdicts a tick can do something with. The rest write nothing and stay for a person. */
const TICKABLE: ReadonlySet<ScheduleVerdict["status"]> = new Set(["new", "fills", "agrees"]);

export default function FinishScheduleReview({
  importId,
  crumb,
  project,
}: {
  importId: string;
  crumb: { label: string; href: string };
  project: { id: string; number: string; name: string };
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [review, setReview] = useState<ScheduleReviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const [showApplied, setShowApplied] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ import: Run; review?: ScheduleReviewRow[] }>(`/api/imports/${importId}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRun(res.data.import);
    setReview(res.data.review ?? []);
  }, [importId]);

  /** Reload first, report afterwards — `load()` clears the banner. */
  async function reloadThen(failure: string | null, info: string | null = null) {
    await load();
    if (failure) setError(failure);
    if (info) setNotice(info);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = run?.status === "queued" || run?.status === "parsing";
  const deferred = run?.status === "pending" && Boolean(run?.waitingForSlot);
  usePoll(load, { intervalMs: 3000, active: Boolean(waiting || deferred) });

  const byEntry = useMemo(() => new Map(review.map((row) => [row.entryId, row])), [review]);

  // Everything a tick can file is ticked on arrival: a schedule is read to be
  // kept, and the reviewer's job is to drop what does not belong.
  useEffect(() => {
    if (!run?.parsed) return;
    setSelected(
      new Set(
        run.parsed.entries
          .filter((entry) => {
            const verdict = byEntry.get(entry.id)?.verdict;
            return entry.reviewStatus === "pending" && verdict && TICKABLE.has(verdict.status);
          })
          .map((entry) => entry.id),
      ),
    );
  }, [run?.parsed, byEntry]);

  async function startExtraction(action: "start" | "retry-dispatch" | "restart-expired") {
    if (!run) return;
    setBusy("extract");
    setError(null);
    try {
      const res = await apiFetch<{ waiting?: boolean; note?: string }>(`/api/imports/${importId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version, requestId: crypto.randomUUID(), action }),
      });
      const held = res.ok && res.data.waiting === true;
      await reloadThen(res.ok ? null : res.error, held ? (res.data.note ?? WAITING_FOR_SLOT_MESSAGE) : null);
    } finally {
      setBusy(null);
    }
  }

  async function fileKind(entry: FinishScheduleEntry, kind: FinishKind | null) {
    setBusy(`kind:${entry.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/imports/${importId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, expectedVersion: entry.version, changes: { kind } }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      setBusy(null);
    }
  }

  async function act(entries: FinishScheduleEntry[], action: "confirm" | "ignore" | "restore") {
    if (entries.length === 0) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{
        created: number;
        filled: number;
        unchanged: number;
        skipped: { code: string | null; why: string }[];
      }>(`/api/imports/${importId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, entries: entries.map((entry) => ({ id: entry.id, version: entry.version })) }),
      });
      let info: string | null = null;
      if (res.ok && action === "confirm") {
        const said = [
          `${res.data.created} added to the library`,
          res.data.filled > 0 ? `${res.data.filled} filled in` : null,
          res.data.unchanged > 0 ? `${res.data.unchanged} already held and agreeing` : null,
        ].filter(Boolean);
        info = `${said.join(", ")}.`;
        if (res.data.skipped.length > 0) {
          info += ` ${res.data.skipped.length} wrote nothing and still wait for you.`;
        }
      }
      await reloadThen(res.ok ? null : res.error, info);
    } finally {
      setBusy(null);
    }
  }

  const shell = (children: React.ReactNode) => (
    <>
      <PageHeader
        crumbs={[crumb]}
        title={run?.filename ?? "Finishes schedule"}
        subtitle={
          <>
            {DOCUMENT_KIND_LABELS.finishes_schedule} · on{" "}
            <Link href={`/dashboard/projects/${project.id}`} className="text-blue-700 no-underline hover:underline">
              {project.number} — {project.name}
            </Link>{" "}
            ·{" "}
            <a
              href={`/api/imports/${importId}/source`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 no-underline hover:underline"
            >
              open the original
            </a>{" "}
            ·{" "}
            <Link
              href={`/dashboard/projects/${project.id}?tab=finishes`}
              className="text-blue-700 no-underline hover:underline"
            >
              the finishes library
            </Link>
          </>
        }
      />
      <PageBody>{children}</PageBody>
    </>
  );

  if (!run) return error ? <Note tone="danger">{error}</Note> : <Spinner label="Loading" />;

  if (run.status === "pending" || run.status === "failed") {
    return shell(
      <Card title={deferred ? "This schedule is waiting for a slot" : "This schedule has not been read"}>
        <p className="text-neutral-600">
          {run.filename ?? "This document"} · {DOCUMENT_KIND_LABELS.finishes_schedule}
        </p>
        <div className="mt-2">
          <DocumentState run={{ status: run.status, waitingForSlot: run.waitingForSlot }} />
        </div>
        {run.status === "failed" && run.error && <Note tone="danger">{run.error}</Note>}
        <p className="mt-3 text-neutral-700">
          {deferred ? (
            <>{WAITING_FOR_SLOT_MESSAGE} Reading it sends it to the model, which is what costs money.</>
          ) : (
            <>
              Reading this sends it to the model, which is the step that{" "}
              {run.status === "failed" ? "charges again." : "costs money."}
            </>
          )}
        </p>
        <Button
          variant={deferred ? "secondary" : "primary"}
          className="mt-3"
          onClick={() => void startExtraction("start")}
          disabled={busy !== null}
        >
          {busy === "extract"
            ? "Starting…"
            : deferred
              ? "Read it now"
              : run.status === "failed"
                ? "Retry extraction"
                : "Read the schedule"}
        </Button>
        {notice && <Note tone="info">{notice}</Note>}
        {error && <Note tone="danger">{error}</Note>}
      </Card>,
    );
  }

  if (waiting) {
    const restartable =
      (run.status === "parsing" && run.claim_live === false) ||
      (run.status === "queued" && run.within_deadline === false) ||
      run.claim_count >= 4;
    const dispatchable = run.status === "queued" && run.claim_count === 0 && run.within_deadline !== false;
    return shell(
      <Card title="Being read">
        <Spinner label="Reading the finishes schedule" />
        <p className="mt-3 text-neutral-600">You can leave this page — it carries on without you.</p>
        <div className="mt-3 flex gap-2">
          {dispatchable && (
            <Button
              onClick={() => void startExtraction("retry-dispatch")}
              disabled={busy !== null}
              title="Sends the same request again. It charges nothing new, and it will not disturb a worker that already has it."
            >
              {busy === "extract" ? "Retrying…" : "Retry dispatch"}
            </Button>
          )}
          {restartable && (
            <Button variant="danger" onClick={() => void startExtraction("restart-expired")} disabled={busy !== null}>
              Start again (may be charged again)
            </Button>
          )}
        </div>
      </Card>,
    );
  }

  const staged = run.parsed;
  if (!staged || staged.entries.length === 0) {
    return shell(
      <Card title="No finishes found">
        <p className="text-neutral-700">The model found no finish entries in this document.</p>
        {staged?.documentNotes && <Note tone="plain">The model noted: {staged.documentNotes}</Note>}
      </Card>,
    );
  }

  return shell(
    <FinishScheduleTable
      importId={importId}
      staged={staged}
      byEntry={byEntry}
      selected={selected}
      setSelected={setSelected}
      busy={busy}
      error={error}
      notice={notice}
      onKind={(entry, kind) => void fileKind(entry, kind)}
      onAct={(entries, action) => void act(entries, action)}
      showIgnored={showIgnored}
      setShowIgnored={setShowIgnored}
      showApplied={showApplied}
      setShowApplied={setShowApplied}
    />,
  );
}

/**
 * The list itself, apart from the loading states so the component tier can
 * render it from a staged document and a review without a network.
 */
export function FinishScheduleTable({
  importId,
  staged,
  byEntry,
  selected,
  setSelected,
  busy,
  error,
  notice,
  onKind,
  onAct,
  showIgnored,
  setShowIgnored,
  showApplied,
  setShowApplied,
}: {
  importId: string;
  staged: StagedFinishSchedule;
  byEntry: Map<string, ScheduleReviewRow>;
  selected: Set<string>;
  setSelected: (update: (current: Set<string>) => Set<string>) => void;
  busy: string | null;
  error: string | null;
  notice: string | null;
  onKind: (entry: FinishScheduleEntry, kind: FinishKind | null) => void;
  onAct: (entries: FinishScheduleEntry[], action: "confirm" | "ignore" | "restore") => void;
  showIgnored: boolean;
  setShowIgnored: (update: (value: boolean) => boolean) => void;
  showApplied: boolean;
  setShowApplied: (update: (value: boolean) => boolean) => void;
}) {
  const pending = staged.entries.filter((entry) => entry.reviewStatus === "pending");
  const chosen = pending.filter((entry) => selected.has(entry.id));
  const count = (status: ScheduleVerdict["status"]) =>
    chosen.filter((entry) => byEntry.get(entry.id)?.verdict?.status === status).length;
  const waitingOnPerson = pending.filter((entry) => {
    const verdict = byEntry.get(entry.id)?.verdict;
    return verdict && !TICKABLE.has(verdict.status);
  }).length;
  const writes = count("new") + count("fills");

  return (
    <>
      {error && <Note tone="danger">{error}</Note>}
      {notice && <Note tone="good">{notice}</Note>}
      {staged.documentNotes && <Note tone="plain">The model noted: {staged.documentNotes}</Note>}

      <Card
        flush
        title={
          <>
            {staged.entries.length} finish{staged.entries.length === 1 ? "" : "es"} in this schedule
            <CardHeadingNote>{pending.length} still to review</CardHeadingNote>
          </>
        }
      >
        <Table>
          <thead>
            <tr>
              <Th className="w-8" />
              <Th className="w-[16%]">Code</Th>
              <Th>What the schedule says</Th>
              <Th className="w-[16%]">Kind</Th>
              <Th className="w-[22%]">The library</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pending.map((entry) => {
              const row = byEntry.get(entry.id);
              const verdict = row?.verdict ?? null;
              const tickable = verdict !== null && TICKABLE.has(verdict.status);
              return (
                <Tr key={entry.id} tone={verdict?.status === "conflict" ? "warn" : "plain"}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={tickable && selected.has(entry.id)}
                      disabled={!tickable}
                      aria-label={`Add ${row?.code ?? entry.codeRaw ?? "this finish"} to the library`}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(entry.id);
                          else next.delete(entry.id);
                          return next;
                        })
                      }
                    />
                  </Td>
                  <Td>
                    {row?.code ? (
                      <Chip mono>{row.code}</Chip>
                    ) : (
                      <span className="text-neutral-500">no code</span>
                    )}
                    {/* The page's own spelling, where the library files it
                        differently (stacked boxes read hyphenated). */}
                    {entry.codeRaw && row?.code && entry.codeRaw.trim() !== row.code && (
                      <span className="mt-1 block text-[11px] text-neutral-500">printed {entry.codeRaw}</span>
                    )}
                    {entry.page && (
                      <a
                        href={`/api/imports/${importId}/source#page=${entry.page}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-[11px] text-neutral-500 underline hover:text-neutral-900"
                      >
                        page {entry.page}
                      </a>
                    )}
                  </Td>
                  <Td>
                    <span className="text-neutral-900">{row?.composed.description ?? "—"}</span>
                    {(row?.composed.supplierRaw || row?.composed.reference) && (
                      <span className="mt-1 block text-[11.5px] text-neutral-600">
                        {[row.composed.supplierRaw, row.composed.reference].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {row?.composed.notes && (
                      <span className="mt-1 block text-[11px] text-neutral-500">{row.composed.notes}</span>
                    )}
                  </Td>
                  <Td>
                    <KindControl
                      entry={entry}
                      row={row}
                      verdict={verdict}
                      busy={busy === `kind:${entry.id}`}
                      onKind={onKind}
                    />
                  </Td>
                  <Td>
                    <VerdictCell verdict={verdict} />
                  </Td>
                  <Td>
                    <Button variant="quiet" size="xs" disabled={busy !== null} onClick={() => onAct([entry], "ignore")}>
                      Ignore
                    </Button>
                  </Td>
                </Tr>
              );
            })}
            {pending.length === 0 && (
              <tr>
                <Td colSpan={6} muted>
                  Every finish in this schedule has been reviewed.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>

        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-[#fcfcfc] px-4 py-3">
          <span className="text-neutral-600">
            {count("new")} new, {count("fills")} filling in a held code, {count("agrees")} already agreeing.
            {waitingOnPerson > 0 && (
              <> {waitingOnPerson} cannot be added as they stand — each says why.</>
            )}{" "}
            Every finish arrives TBC; confirm it on the library.
          </span>
          <span className="flex-1" />
          <Button
            variant="primary"
            onClick={() => onAct(chosen, "confirm")}
            disabled={busy !== null || chosen.length === 0}
          >
            {busy === "confirm"
              ? "Adding…"
              : writes > 0
                ? `Add ${writes} to the library`
                : `Close ${chosen.length} already held`}
          </Button>
        </div>
      </Card>

      <Collapsed
        title="Ignored"
        open={showIgnored}
        onToggle={() => setShowIgnored((value) => !value)}
        entries={staged.entries.filter((entry) => entry.reviewStatus === "ignored")}
        byEntry={byEntry}
        onRestore={(entry) => onAct([entry], "restore")}
      />
      <Collapsed
        title="Added"
        open={showApplied}
        onToggle={() => setShowApplied((value) => !value)}
        entries={staged.entries.filter((entry) => entry.reviewStatus === "applied")}
        byEntry={byEntry}
      />
    </>
  );
}

function VerdictCell({ verdict }: { verdict: ScheduleVerdict | null }) {
  if (!verdict) return null;
  return (
    <>
      <Chip tone={VERDICT_TONE[verdict.status]}>{VERDICT_LABELS[verdict.status]}</Chip>
      {verdict.status === "fills" && (
        <span className="mt-1 block text-[11.5px] text-neutral-600">
          Fills its empty {verdict.fills.join(", ")} — nothing already there changes.
        </span>
      )}
      {verdict.status === "agrees" && verdict.finish.code !== verdict.code && (
        <span className="mt-1 block text-[11.5px] text-neutral-600">held as {verdict.finish.code}</span>
      )}
      {verdict.status === "conflict" && (
        <span className="mt-1 block text-[11.5px] text-amber-900">
          The library says “{verdict.finish.description}”. Nothing is written — decide which is out of date, on the
          library or by ignoring this.
        </span>
      )}
      {verdict.status === "repeated" && (
        <span className="mt-1 block text-[11.5px] text-neutral-600">Only the first entry with this code is filed.</span>
      )}
      {verdict.status === "no_code" && (
        <span className="mt-1 block text-[11.5px] text-neutral-600">Nothing to file it under.</span>
      )}
    </>
  );
}

/**
 * The kind: filed by a person, offered by the app with its evidence.
 *
 * Only where the confirm will WRITE it — a new code, or a held one with no
 * kind yet. On a conflict or an agreeing row the library already has its
 * answer, and offering a control that changes nothing would be a lie.
 */
function KindControl({
  entry,
  row,
  verdict,
  busy,
  onKind,
}: {
  entry: FinishScheduleEntry;
  row: ScheduleReviewRow | undefined;
  verdict: ScheduleVerdict | null;
  busy: boolean;
  onKind: (entry: FinishScheduleEntry, kind: FinishKind | null) => void;
}) {
  const writable =
    verdict?.status === "new" || (verdict?.status === "fills" && !verdict.finish.kind);
  if (verdict && (verdict.status === "agrees" || verdict.status === "conflict" || verdict.status === "fills") && verdict.finish.kind) {
    return <Chip>{FINISH_KIND_LABELS[verdict.finish.kind]}</Chip>;
  }
  if (!writable) return <span className="text-neutral-400">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {entry.kind ? (
        <Chip tone="good">{FINISH_KIND_LABELS[entry.kind]}</Chip>
      ) : row?.suggestion ? (
        <SuggestButton
          value={FINISH_KIND_LABELS[row.suggestion.kind]}
          evidence={row.suggestion.reason}
          busy={busy}
          onAccept={() => onKind(entry, row.suggestion!.kind)}
        />
      ) : (
        <span className="text-[11.5px] text-neutral-500">nothing written down says</span>
      )}
      {/* ITS VALUE IS ALWAYS EMPTY, so choosing the kind already shown still
          fires a change — the level picker's trap. */}
      <select
        value=""
        disabled={busy}
        aria-label={`Kind of ${row?.code ?? "this finish"}`}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "__none") onKind(entry, null);
          else if (value) onKind(entry, value as FinishKind);
        }}
        className="rounded border border-neutral-300 px-1 py-0.5 text-[11.5px] text-neutral-700"
      >
        <option value="">{entry.kind ? "Change…" : "Choose…"}</option>
        {FINISH_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {FINISH_KIND_LABELS[kind]}
          </option>
        ))}
        {entry.kind && <option value="__none">No kind</option>}
      </select>
    </div>
  );
}

function Collapsed({
  title,
  open,
  onToggle,
  entries,
  byEntry,
  onRestore,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  entries: FinishScheduleEntry[];
  byEntry: Map<string, ScheduleReviewRow>;
  onRestore?: (entry: FinishScheduleEntry) => void;
}) {
  return (
    <Disclosure title={title} count={entries.length} open={open} onToggle={onToggle}>
      <DisclosureList>
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="font-mono text-neutral-900">{byEntry.get(entry.id)?.code ?? entry.codeRaw ?? "no code"}</span>
            <span className="flex-1 truncate text-neutral-600">{byEntry.get(entry.id)?.composed.description ?? ""}</span>
            {entry.applied && (
              <span className="text-xs text-neutral-500">
                {entry.applied.outcome === "created"
                  ? "added"
                  : entry.applied.outcome === "filled"
                    ? "filled in"
                    : "already held"}
              </span>
            )}
            {onRestore && (
              <Button variant="quiet" size="xs" onClick={() => onRestore(entry)}>
                Restore
              </Button>
            )}
          </li>
        ))}
      </DisclosureList>
    </Disclosure>
  );
}
