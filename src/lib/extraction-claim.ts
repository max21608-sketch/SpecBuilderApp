// The states a document row moves through before a result exists.
//
// 'pending' is NOT queued work: it means nobody has asked for the document to
// be read yet. That is why 'queued' has to be its own value rather than being
// folded into 'pending' -- the screen shows a different thing for each, and
// only 'queued' has a message in flight.
//
//   pending -> queued (route enqueues) -> processing (consumer claims)
//           -> extracted | failed
//
// A claim older than this window belonged to an invocation that was killed
// before it could write a terminal status. Without a reclaim window such a row
// stays 'processing' forever, because no other transition accepts that status.
export const STALE_CLAIM_MINUTES = 15;

// What a run did with the row it was handed. Only `failed` and `extracted`
// write a terminal status; `skipped` means another invocation owns the run and
// this one must not touch it.
export type ExtractionRunOutcome =
  | { outcome: "extracted" }
  | { outcome: "failed"; error: string }
  | { outcome: "skipped"; reason: string };
