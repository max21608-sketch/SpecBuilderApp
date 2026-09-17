// Records, and the refs a document names them by.
//
// A LEAF MODULE: it imports nothing of this app's, on purpose. `spec-document`
// and `drawing-document` both need these, and `drawing-document` used to reach
// into `spec-document` for them — which was harmless until the email pipeline
// needed `classifyCallout` back out of `drawing-document`, and the two modules
// became a cycle. A cycle between them works right up until one is read at
// import time by the other, and then fails somewhere unrelated.
//
// Everything here is re-exported by `spec-document`, so no existing caller had
// to change.

export type RecordEntry = {
  id: string;
  recordNo: number;
  label: string; // 'P17231-014'
  itemDescription: string;
  categoryId: string | null;
  categoryName: string | null;
  refs: string[];
  /**
   * The `boq_code` refs alone. A drawing's item code is a BOQ code, and
   * matching it against every ref system would let a COS code or a job number
   * that happens to read the same claim the drawing.
   */
  boqCodes: string[];
  /** Which run (BOQ tab) this record belongs to. Drawings fan out across runs. */
  runId: string;
  runName: string;
  /**
   * The bill line a CONFIGURATION hangs off, and its letter (0024).
   *
   * Both null on an ordinary record. A configuration carries no client ref of
   * its own, so `findRecordsByRef` never returns one — it is only ever reached
   * through its parent, which is why the resolver has to look for it by
   * `parentId` rather than by matching.
   */
  parentId: string | null;
  variantLabel: string | null;
  version: number;
};

// ---- refs ------------------------------------------------------------------

/**
 * The fallback pass for a ref the document writes differently: `FU-209-15` vs
 * `FU 209 15`. Aggressive on purpose — a collision it creates produces AMBIGUITY
 * (two candidates, no choice made), never a wrong pick, so the cost of being
 * too loose here is a question, and the cost of being too strict is a miss.
 */
export function normaliseRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Records whose refs match. Exact first, then normalised, and ALWAYS a list.
 * Two records legitimately carry the same ref; returning both is the point.
 */
export function findRecordsByRef(refRaw: string | null, records: RecordEntry[]): RecordEntry[] {
  if (!refRaw || !refRaw.trim()) return [];
  const wanted = refRaw.trim();
  const exact = records.filter((record) => record.refs.some((ref) => ref.trim() === wanted));
  if (exact.length > 0) return exact;

  const normalised = normaliseRef(wanted);
  if (!normalised) return [];
  const byRef = records.filter((record) => record.refs.some((ref) => normaliseRef(ref) === normalised));
  if (byRef.length > 0) return byRef;

  // The app's OWN identifier, `P17726-014`. A client document never uses it,
  // but an email does: it is what our chase tables print, so a reply quoting
  // the question quotes the label back. Checked last, because a client ref is
  // always the better answer where there is one.
  return records.filter((record) => normaliseRef(record.label) === normalised);
}
