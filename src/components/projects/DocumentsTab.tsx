"use client";

// The project's source documents, grouped by the pack they arrived in, and the
// poll that keeps them current while one is being read. Moved out of
// src/app/dashboard/projects/[id]/page.tsx on 2026-11-07 (audit 5.3, cut B).
//
// THE STATE IS A HOOK THE PAGE CALLS, AND THE CARD IS TOLD. The page renders
// this card twice (on the Overview, and on the Documents tab, where the hidden
// Overview copy stays mounted), and needs the list itself for the next step,
// the tab's count and the first pack's link. State held inside the card would
// be two lists and two sets of open packs; `useProjectDocuments` keeps one.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";
import { intakeStatusLabel, intakeStatusTone, isIntakeRunInFlight, isIntakeRunWorking } from "@/lib/intake-status";
import { usePoll } from "@/lib/use-poll";
import Button, { buttonClass } from "@/components/ui/Button";
import Tip from "@/components/ui/Tip";
import Chip from "@/components/ui/Chip";
import Card from "@/components/ui/Card";
import { Table, Td, Tr } from "@/components/ui/Table";
import { formatDay } from "@/lib/format-day";
import BillColumnsAction, { isStuckBill, type StuckBill } from "@/components/imports/BillColumnsAction";
import ReadBillSpecsAction from "@/components/imports/ReadBillSpecsAction";

export type DocumentRun = {
  id: string;
  source_kind: string;
  document_kind: string | null;
  status: string;
  error: string | null;
  created_at: string;
  created_by: string | null;
  filename: string | null;
  source_preserved: boolean;
  /** A bill waiting for somebody to say which column is which. */
  needs_columns?: boolean | null;
  structure_read?: boolean | null;
  // Null on anything uploaded before 0007, which is why the grouping below
  // keeps a home for runs that belong to no pack.
  batch_id: string | null;
  batch_label: string | null;
  batch_created_at: string | null;
  /** Promised a read and waiting for a slot: it will start on its own. */
  waiting_for_slot?: boolean | null;
  /** A confirmed bill's specification read, where one was asked for. */
  bill_specs_run_id?: string | null;
  /** A confirmed bill whose confirm read its description cells: no charged read is offered. */
  descriptions_read?: boolean;
  /** What this document PRODUCED, counted off the FKs the confirm wrote. */
  specs_applied: string | number | null;
  runs_created: string | number | null;
  records_created: string | number | null;
};

/** A document row, as the bill action reads it. */
function billOf(run: DocumentRun): StuckBill {
  return {
    id: run.id,
    sourceKind: run.source_kind,
    status: run.status,
    needsColumns: run.needs_columns,
    structureRead: run.structure_read,
    sourcePreserved: run.source_preserved,
  };
}

/** One delivery, and the runs that arrived in it. */
export type Pack = {
  id: string | null;
  label: string | null;
  createdAt: string;
  runs: DocumentRun[];
};

const SOURCE_LABELS: Record<string, string> = { boq_xlsx: "BOQ", spec_document: "Specification document" };

// A document's kind is what a person calls it; the source kind is only which
// pipeline read it.
const KIND_LABELS: Record<string, string> = {
  preamble: "Preamble",
  shop_drawings: "Shop drawings",
  ffe_schedule: "FF&E schedule",
  spec_bible: "Specification bible",
  finishes_schedule: "Finishes schedule",
  fabric_schedule: "Fabric schedule",
  other: "Other document",
};

/** How many files a pack shows before the rest fold behind a link. */
const PACK_FILES_SHOWN = 5;

/** The documents list and what the card's two copies share; see the header. */
export function useProjectDocuments() {
  const [documents, setDocuments] = useState<DocumentRun[] | null>(null);
  const [failedDocuments, setFailedDocuments] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
  const [retryingDocument, setRetryingDocument] = useState<string | null>(null);

  // Runs grouped into the packs they arrived in, newest first, each pack's own
  // runs oldest first so they read in the order the work happens.
  //
  // Pre-0007 runs have no batch and are collected under a single null pack at
  // the end -- they are real documents somebody imported and must not vanish
  // because a later migration gave their successors a grouping.
  const packs = useMemo<Pack[]>(() => {
    if (!documents) return [];
    const byBatch = new Map<string, Pack>();
    const loose: DocumentRun[] = [];
    for (const run of documents) {
      if (!run.batch_id) {
        loose.push(run);
        continue;
      }
      const existing = byBatch.get(run.batch_id);
      if (existing) {
        existing.runs.push(run);
        continue;
      }
      byBatch.set(run.batch_id, {
        id: run.batch_id,
        label: run.batch_label,
        createdAt: run.batch_created_at ?? run.created_at,
        runs: [run],
      });
    }
    const grouped = [...byBatch.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const pack of grouped) pack.runs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (loose.length > 0) {
      grouped.push({ id: null, label: null, createdAt: loose[loose.length - 1]?.created_at ?? "", runs: loose });
    }
    return grouped;
  }, [documents]);

  return {
    documents,
    setDocuments,
    failedDocuments,
    setFailedDocuments,
    packs,
    uploading,
    setUploading,
    expandedPacks,
    setExpandedPacks,
    retryingDocument,
    setRetryingDocument,
  };
}

export type ProjectDocuments = ReturnType<typeof useProjectDocuments>;

/**
 * The documents poll, called by the page where it always ran: after the
 * page's own load effect, so the order the effects are declared in is the
 * order it was.
 */
export function useDocumentsPoll(projectId: string, docs: ProjectDocuments) {
  const { documents, setDocuments, setFailedDocuments } = docs;
  // THE OVERVIEW POLLS ITS DOCUMENTS while any is being read or waiting for a
  // slot (found-in-use 2026-09-23: "you have to reload the page to get it to
  // switch ... to ready"). It refreshes the DOCUMENTS ONLY, never through
  // load(). That used to be because load() reset the details form; the form
  // is now its own component and out of load()'s reach (audit G6), and a
  // poll still sets only what it came for, so nothing else on the screen
  // moves every five seconds.
  const documentsInFlight = (documents ?? []).some((run) =>
    isIntakeRunInFlight({ status: run.status, waitingForSlot: run.waiting_for_slot }),
  );
  const pollDocuments = useCallback(async () => {
    // THE SLICE, NOT THE PAYLOAD (audit G13): the tick keeps the documents and
    // the failed count, so that is all it asks the route for.
    const res = await apiFetch<{ documents: DocumentRun[]; failedDocuments: number }>(
      `/api/projects/${encodeURIComponent(projectId)}?only=documents`,
    );
    if (!res.ok) return; // a failed tick is retried by the next one; load() owns the banner
    setDocuments(res.data.documents);
    setFailedDocuments(Number(res.data.failedDocuments ?? 0));
  }, [projectId, setDocuments, setFailedDocuments]);
  usePoll(pollDocuments, { intervalMs: 5000, active: documentsInFlight });
}

export default function DocumentsTab({
  projectId,
  docs,
  onReload,
  onError,
}: {
  projectId: string;
  docs: ProjectDocuments;
  /** The page's whole load: an upload, a registration or a retry changes more than this list. */
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const { documents, packs, uploading, setUploading, expandedPacks, setExpandedPacks, retryingDocument, setRetryingDocument } =
    docs;

  /**
   * Ask for a failed document to be read again.
   *
   * IT CHARGES. The read was dispatched on arrival and the queue refused it, so
   * this is a second billed model call and the button says so on hover. There
   * is no exactly-once billing guarantee anywhere in this pipeline.
   */
  async function retryDocument(run: DocumentRun) {
    setRetryingDocument(run.id);
    try {
      const res = await apiFetch(`/api/imports/${run.id}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      await onReload();
      if (!res.ok) onError(res.error);
    } finally {
      setRetryingDocument(null);
    }
  }

  return (
    <Card
      title={
        <>
          Source documents
          <Tip>
            {/* IT SAID "each file's kind is declared on upload", which is the
                impression 4a.3 exists to remove: the name is read the moment a
                file lands, the document is read at the press, and what a person
                picks beats both. The declaring still happens — at registration,
                where it always has. */}
            Drop a pack and the app works out what each file is — from its name straight away, then from the document
            itself when you press. Every answer says what it was read from, and your own choice always wins.
          </Tip>
        </>
      }
      flush
      actions={
        <Button size="xs" variant={uploading ? "secondary" : "primary"} onClick={() => setUploading((v) => !v)}>
          {uploading ? "Close" : "Add documents"}
        </Button>
      }
    >
      {uploading && (
        <div className="border-b border-neutral-200 px-4 py-3">
          <IntakeBatchUpload
            projectId={projectId}
            onUploaded={() => {
              setUploading(false);
              void onReload();
            }}
            onRegistered={() => void onReload()}
          />
        </div>
      )}
      {/* GROUPED BY PACK, and each pack links to its own screen.
          A delivery's runs used to be listed flat, so the two screens that
          read a whole pack -- the pack screen with its Read all, and the
          combined drawings review, which is the ONLY place a record described
          by two documents is named -- were reachable solely from the redirect
          that fires once after upload. Navigate away and there was no route
          back to either except browser history. */}
      {documents === null ? (
        <div className="p-4"><Spinner label="Loading documents" /></div>
      ) : packs.length === 0 ? (
        <p className="px-4 py-3 text-sm text-neutral-600">
          Nothing imported yet. Start with the bill of quantities — it creates this project&rsquo;s spec records.
        </p>
      ) : (
        packs.map((pack) => {
          const drawings = pack.runs.filter((run) => run.document_kind === "shop_drawings");
          const reading = pack.runs.filter((run) => isIntakeRunWorking(run.status) || run.status === "pending");
          const ready = pack.runs.filter((run) => run.status === "parsed");
          const key = pack.id ?? "unpacked";
          const expanded = expandedPacks.has(key);
          const shown = expanded ? pack.runs : pack.runs.slice(0, PACK_FILES_SHOWN);
          const folded = pack.runs.length - shown.length;
          return (
            <div key={key}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-neutral-200 bg-[#fcfcfc] px-4 py-2.5">
                <b className="text-[13px]">
                  {pack.id
                    ? (pack.label ?? `${pack.runs.length} document${pack.runs.length === 1 ? "" : "s"}`)
                    : "Not part of a pack"}
                </b>
                <span className="text-xs text-neutral-500">
                  {pack.id ? (
                    <>
                      delivered {formatDay(String(pack.createdAt).slice(0, 10))}
                      {reading.length > 0 && (
                        <span className="text-blue-700"> · {reading.length} still being read</span>
                      )}
                      {ready.length > 0 && <> · {ready.length} ready to review</>}
                    </>
                  ) : (
                    <>Uploaded before deliveries were grouped. Nothing is wrong with them.</>
                  )}
                </span>
                {pack.id && (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {/* Only when there is more than one, because the combined
                        screen exists for what can only be seen ACROSS
                        documents. One drawing has nothing to compare. */}
                    {drawings.length > 1 && (
                      <Link
                        href={`/dashboard/projects/${projectId}/intake/${pack.id}/drawings`}
                        className={buttonClass("primary", "xs", "no-underline")}
                      >
                        Review all {drawings.length} drawings together
                      </Link>
                    )}
                    <Link
                      href={`/dashboard/projects/${projectId}/intake/${pack.id}`}
                      className={buttonClass("secondary", "xs", "no-underline")}
                    >
                      Open the pack
                    </Link>
                  </span>
                )}
              </div>
              <Table>
                <tbody>
                  {shown.map((run) => {
                    const specs = Number(run.specs_applied ?? 0);
                    const madeRuns = Number(run.runs_created ?? 0);
                    const madeRecords = Number(run.records_created ?? 0);
                    /* WHAT IT PRODUCED. A state says what the app did to the
                       file; this says what the file did to the project, which
                       is the question somebody scanning eleven filenames has.
                       Each branch is counted, never guessed, and a document
                       that produced nothing yet says which of the two reasons
                       that is. */
                    const produced =
                      run.status === "failed"
                        ? (run.error ?? "the queue refused it")
                        : isIntakeRunWorking(run.status) || run.status === "pending"
                          ? `started ${new Date(run.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · nothing to do`
                          : madeRuns > 0
                            ? `${madeRuns} phase${madeRuns === 1 ? "" : "s"} · ${madeRecords} record${madeRecords === 1 ? "" : "s"}`
                            : specs > 0
                              ? `${specs} spec${specs === 1 ? "" : "s"} applied`
                              : run.status === "parsed"
                                ? "staged, nothing applied yet"
                                : "nothing applied";
                    return (
                      <Tr key={run.id}>
                        <Td className="w-[46%]">
                          <Link
                            href={`/dashboard/imports/${run.id}`}
                            className="text-blue-700 no-underline hover:underline"
                          >
                            {run.filename ?? "Unnamed file"}
                          </Link>
                          <p className="text-xs text-neutral-500">
                            {(run.document_kind && KIND_LABELS[run.document_kind]) ??
                              SOURCE_LABELS[run.source_kind] ??
                              run.source_kind}
                            {" · "}
                            {new Date(run.created_at).toLocaleString("en-GB")}
                            {run.created_by ? ` · ${run.created_by}` : ""}
                            {run.source_preserved ? "" : " · original not kept"}
                          </p>
                        </Td>
                        <Td className="w-[16%]">
                          <Chip tone={intakeStatusTone(run.status)} dot={isIntakeRunWorking(run.status)}>
                            {intakeStatusLabel(run.status)}
                          </Chip>
                        </Td>
                        <Td muted className="w-[22%]">
                          {produced}
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            {/* A BILL IS NEVER RETRIED THROUGH /extract, which
                                refuses one: a stuck bill goes to its review. */}
                            {isStuckBill(billOf(run)) ? (
                              <BillColumnsAction run={billOf(run)} />
                            ) : run.status === "failed" ? (
                              <Button
                                size="xs"
                                disabled={retryingDocument === run.id}
                                title="Reads the document again. This is a second charged model call."
                                onClick={() => void retryDocument(run)}
                              >
                                {retryingDocument === run.id ? "Trying…" : "Try again"}
                              </Button>
                            ) : run.status === "parsed" ? (
                              <Link
                                href={`/dashboard/imports/${run.id}`}
                                className={buttonClass("secondary", "xs", "no-underline")}
                              >
                                Review
                              </Link>
                            ) : run.source_kind === "boq_xlsx" && run.status === "confirmed" && run.source_preserved ? (
                              <ReadBillSpecsAction
                                billRunId={run.id}
                                specsRunId={run.bill_specs_run_id ?? null}
                                descriptionsRead={run.descriptions_read === true}
                                onRead={() => void onReload()}
                              />
                            ) : isIntakeRunWorking(run.status) || run.status === "pending" ? (
                              <span className="text-[11.5px] text-neutral-500">it will appear here</span>
                            ) : (
                              <Link
                                href={`/dashboard/imports/${run.id}`}
                                className={buttonClass("quiet", "xs", "no-underline")}
                              >
                                Open
                              </Link>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              {folded > 0 && (
                <div className="border-b border-neutral-200 px-4 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPacks((current) => {
                        const next = new Set(current);
                        next.add(key);
                        return next;
                      })
                    }
                    className="text-[12px] text-blue-700 hover:underline"
                  >
                    {folded} more in this pack
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </Card>
  );
}
