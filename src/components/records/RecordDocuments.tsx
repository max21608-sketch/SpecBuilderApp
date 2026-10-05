"use client";

// The Documents tab: every document behind this item, one row each.
//
// Max, 2026-10-05: "within the individual line item … you can also see all the
// documents relating to that line item." Which documents, and what each one
// gave the item, is decided by `src/lib/record-documents.ts` — this component
// only lays the list out, so the screen cannot describe a link the loader did
// not find.
//
// ---- LINKS GO SOMEWHERE, DOWNLOADS ARE BUTTON-SHAPED ----------------------
//
// Opening a PDF at the page it was read from is navigation, so it is a plain
// link, in a new tab so the record stays where it was. A download — every
// email, every spreadsheet — is fetched by the browser, so it stays an
// `<a href>` but wears `buttonClass` (Button.tsx's rule). An email is NEVER a
// link that renders: the loader only ever points it at the two routes that
// force a download.
//
// ---- LOADED WHEN THE TAB OPENS ---------------------------------------------
//
// The Versions tab's arrangement: the record payload is loaded on every visit
// and this list is wanted only here. The tab's count therefore appears once
// the list has loaded — `onCount` hands it up — rather than a number the
// record route would have to compute a second way, which is how two counts of
// one thing come to disagree.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import { buttonClass } from "@/components/ui/Button";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import type { Tone } from "@/components/ui/tone";
import type { RecordDocument, RecordDocumentKind, RecordDocumentsResult } from "@/lib/record-documents";

/** A timestamp, not a `date` column — so `Date` is safe here. */
function arrived(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The bill is where the item came from; evidence is a person's attachment; the rest are plain. */
function kindTone(kind: RecordDocumentKind): Tone {
  if (kind === "bill") return "info";
  return "plain";
}

/** The empty state, saying only what is true of THIS record. */
function emptyText(origin: RecordDocumentsResult["origin"]): string {
  const lead = "No document has been confirmed onto this item yet.";
  if (origin.mockup) return `${lead} It was added to the mock-up phase from another item, so it came off no bill row.`;
  if (origin.noBill) return `${lead} It was typed in by hand.`;
  return lead;
}

function OpenLink({ document }: { document: RecordDocument }) {
  const open = document.open;
  if (!open) return null;
  if (open.inline) {
    return (
      <a href={open.href} target="_blank" rel="noreferrer" className="text-blue-700 no-underline hover:underline">
        {document.pages.length > 0 ? `Open at page ${document.pages[0]}` : "Open"}
      </a>
    );
  }
  return (
    <a href={open.href} download className={buttonClass("quiet", "xs", "no-underline")}>
      Download
    </a>
  );
}

export function RecordDocumentsTable({ result }: { result: RecordDocumentsResult }) {
  const { documents, origin } = result;
  return (
    <>
      <Card
        flush
        title={
          <>
            Documents
            <CardHeadingNote>
              {documents.length === 1 ? "1 document" : `${documents.length} documents`}
            </CardHeadingNote>
          </>
        }
      >
        {documents.length === 0 ? (
          <p className="px-4 py-6 text-sm text-neutral-600">{emptyText(origin)}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>What it gave this item</Th>
                <Th>Arrived</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <Tr key={document.key}>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-medium text-neutral-900">
                        {document.filename ?? "File not kept"}
                      </span>
                      <Chip tone={kindTone(document.kind)}>{document.kindLabel}</Chip>
                    </div>
                    {document.subject && <div className="mt-0.5 text-xs text-neutral-500">{document.subject}</div>}
                  </Td>
                  <Td>
                    <ul className="space-y-0.5">
                      {document.relations.map((relation) => (
                        <li key={relation}>{relation}</li>
                      ))}
                    </ul>
                  </Td>
                  <Td muted className="whitespace-nowrap">
                    {arrived(document.arrivedAt)}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <OpenLink document={document} />
                      {document.reviews.map((review) => (
                        <Link
                          key={review.runId}
                          href={`/dashboard/imports/${review.runId}`}
                          className="text-blue-700 no-underline hover:underline"
                        >
                          {document.reviews.length === 1 ? "Review" : `Review (${review.label})`}
                        </Link>
                      ))}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Note tone="info">
        Documents whose specs are still waiting for review are not listed until they are confirmed.
      </Note>
    </>
  );
}

export default function RecordDocuments({
  recordId,
  reloadKey = 0,
  onCount,
}: {
  recordId: string;
  /** Changes when the record screen saves something, so a retire shows here too. */
  reloadKey?: number;
  /** The number of documents, once known, for the tab's count. */
  onCount?: (count: number) => void;
}) {
  const [data, setData] = useState<RecordDocumentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<RecordDocumentsResult>(`/api/records/${recordId}/documents`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
    onCount?.(res.data.documents?.length ?? 0);
  }, [recordId, onCount]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error && !data) return <Note tone="danger">{error}</Note>;
  if (!data) return <Spinner label="Loading the documents" />;
  return (
    <>
      {error && <Note tone="danger">{error}</Note>}
      <RecordDocumentsTable result={{ documents: data.documents ?? [], origin: data.origin ?? { mockup: false, noBill: false } }} />
    </>
  );
}
