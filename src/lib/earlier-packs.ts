// What an EARLIER pack already did for the project, for the pack screen's
// "The order these are read in" (pilot walk, 2026-10-12).
//
// A drawings-only pack said "The bill of quantities: Not in this pack" while
// the project's bill had been confirmed in the pack before it. True of the
// pack, and it read as "no bill". Pure: it reads the project's own document
// list, which the screen already fetches, and decides wording only.
import { formatDay } from "@/lib/format-day";

export type ProjectDocument = {
  id: string;
  source_kind: string;
  document_kind: string | null;
  status: string;
  batch_id: string | null;
  batch_created_at: string | null;
  created_at?: string | null;
  records_created?: number | string | null;
};

/** The most recent confirmed document of a kind in ANOTHER pack, or null. */
function latestElsewhere(
  documents: readonly ProjectDocument[],
  batchId: string,
  is: (doc: ProjectDocument) => boolean,
): ProjectDocument | null {
  const found = documents
    .filter((doc) => doc.batch_id !== batchId && doc.status === "confirmed" && is(doc))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return found[0] ?? null;
}

function whichPack(doc: ProjectDocument): string {
  return doc.batch_created_at ? `in the pack of ${formatDay(String(doc.batch_created_at).slice(0, 10))}` : "earlier";
}

/** "Confirmed in the pack of 5 Oct 2026 — 67 records", or null where no other pack confirmed a bill. */
export function billFromEarlierPack(documents: readonly ProjectDocument[], batchId: string): string | null {
  const bill = latestElsewhere(documents, batchId, (doc) => doc.source_kind === "boq_xlsx");
  if (!bill) return null;
  const records = Number(bill.records_created ?? 0);
  return `Not in this pack. The project's bill was confirmed ${whichPack(bill)} — ${records} record${records === 1 ? "" : "s"}.`;
}

/** Where the project's finishes library already comes from, or null where it holds nothing yet. */
export function finishesFromEarlierPack(
  documents: readonly ProjectDocument[],
  batchId: string,
  libraryCodes: number,
): string | null {
  const schedule = latestElsewhere(documents, batchId, (doc) => doc.document_kind === "finishes_schedule");
  if (schedule) return `Not in this pack. A finishes schedule was confirmed ${whichPack(schedule)}.`;
  if (libraryCodes > 0) {
    return `Not in this pack. The project's finishes library already holds ${libraryCodes} code${libraryCodes === 1 ? "" : "s"}.`;
  }
  return null;
}
