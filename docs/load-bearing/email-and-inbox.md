# Email, the inbox and the upload

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### An email is a specification document whose page is a sentence

`src/lib/email-envelope.ts`, `src/lib/email-routing.ts`,
`src/lib/email-registration.ts`, `src/lib/confirm-spec-document.ts`,
`db/migrations/0021_email_intake.sql`

Specification information arrives by email constantly, and until now none of it
reached a record except by somebody reading the message and retyping the value —
after which the record held a value and said nothing about where it came from.

An email is therefore a `document_kind`, not a pipeline: it is staged as the
same `StagedSpecDocument` proposals, reviewed on the same screen, and confirmed
through the same route, so the review gate, the blockers, the per-proposal
versions and the change set are inherited rather than rebuilt. 0007's rule
holds — the kind goes under `source_kind = 'spec_document'`, never beside it.

Five things are load-bearing:

- **Assignment is the spend point.** An unassigned email is never read: there
  are no registers to resolve it against. `assignMessage` is the ONLY thing that
  puts a message on a project, because it is also what opens the attempt and
  dispatches the charged read, and two places doing that is two places to forget
  one half. `registration_request_id` is `email:<messageId>:<projectId>`
  (audit A1, 2026-11-06 — it was `email:<messageId>`, so a message taken off
  the wrong project and assigned to the right one found the OLD project's run
  by the key, linked it, never set `project_id`, and read nothing: the only
  remedy the gate promises did not work). Assigning a message to a project it
  already has a run on RE-LINKS that run and reads nothing (a run that
  unassign settled goes back to `parsed`, or to `failed` with the reason if it
  was never read); any other project is a new run, a new copy of the `.eml`
  under that project (an upload is copied from the project it was uploaded
  to, and only that one), and a new charged read, which the inbox's button
  says before the click ("Put it back" / "Reading it again on P… is a charged
  read", `email-assign-cost.ts`, the route's `read_on`). `unassignMessage`
  clears `mime_attachment_id`. Keys stored in the old form are read only on
  their own run's project. **The same email twice is one row** (audit B8):
  every arrival writes `mime_sha256`; before recording, the inbox is asked by
  Message-ID and then by bytes under advisory locks
  (`recordMessageUnlessKnown`, `findDuplicateMessage`); an upload answers 200
  with `duplicateOf`, and the Graph path deletes its own stub. **Since 2.11
  (2026-09-21) the Graph
  ingestion path assigns automatically on `autoAssignDecision`** — a pure
  function in `email-routing.ts` that says yes ONLY for `forwarded_from_inbox`
  and `recipient_is_inbox`, under actor `system:router`; `sender_is_contact`
  and the subject signals are HELD with routing's sentence and the project
  NAMED but not chosen. Before it, that path auto-assigned on EVERY `assigned`
  outcome, weakest signal included — the trap the gate names, one flag away
  from spending money on a contact who works on two projects. The decision is
  shared; the ACT stays at the arrival caller and is not inside
  `recordMessage`, because a deliberate upload must never be stamped `auto`.
  A placement that fails (a refused copy, an archived project) holds the
  message with the reason rather than burning a delivery. `assignMessage`
  opens no change set: the trail carries `system:router` through the audit
  layer's `updated_by`, not a `change_sets` row.
- **Routing never breaks its own tie.** Signals run in order — a project inbox
  in the forwarding headers, then in To/Cc, then a project number or code in the
  subject, then the sender being a contact on exactly one project — and the
  FIRST signal naming any project decides. Two projects at that strength is
  `ambiguous` and is HELD for a person; a weaker signal is never allowed to
  arbitrate, because a confident wrong answer is worse than an unplaced one.
  Both Exchange forwarding shapes are covered: a redirect keeps the original
  sender and stamps the loop headers, a rule-forward replaces the sender and is
  trusted only alongside `X-MS-Exchange-Organization-AutoForwarded`.
- **Confirmed is not a hard closure.** `proposalBlockers` already refuses a
  proposal over a `confirmed` or `na` answer until the reviewer acknowledges it,
  whatever the new state is — so confirmed → a different value AND confirmed →
  TBC both require the acknowledgement, tied to the version that was shown. That
  blocker is what makes "they confirmed it in March and changed their mind in
  September" safe rather than silent. `changeIntent: "withdraws_to_tbc"` is the
  one reading the wording alone cannot produce, because the value being
  withdrawn carries no TBC token.
- **The change carries the email.** A confirm off an email opens an
  `email_confirm` change whose reason names the sender, the date and the
  subject, and whose `evidence_attachment_id` is the `.eml` itself. "The client
  says they never asked for this" is answered by opening the message. Nothing
  renders it: an `.eml` body is untrusted HTML a stranger wrote, so both routes
  that serve one set `content-disposition: attachment` and `nosniff`.
- **A message arrives before it has a project, so it is COPIED when it gets
  one.** `mailboxStoragePath` stores an arriving `.eml` under `mailbox/`,
  because no project is known yet, and every read in `blob-source.ts` is scoped
  to `projects/<id>/`. Assignment attached the arrival path verbatim, so the
  run it started could never be read — "That file does not belong to this
  project", the worker refusing a mailbox path under a project scope. The
  comment beside the attachment insert already said "under the project's own
  prefix": it described the UPLOAD path, where the browser had already put the
  file there, and nothing had ever walked the mailbox path. `planMimeLocation`
  decides (pure, so it is provable without a store) and `assignMessage` runs
  the store's own server-side `copy` OUTSIDE the transaction, because blob I/O
  inside one holds a row lock across a network call. Copied, never moved: the
  mailbox path is the arrival record and `unassignMessage` must leave the
  message something to have come from. Found 2026-09-17 by fake mail staged
  through the real Graph path; it would have been the first real message.
- **`spec_answers.source_kind = 'email'`** has been allowed by 0002's CHECK
  since the beginning and had never been written. It puts the answer out of
  reach of `applyAnswerFills` and `applyAnswerRetractions`, exactly like
  `'manual'` — a person confirming a value off a message, with the message
  attached, is a decision and not a document's reading.

`quotedText` replaces the page number: an email has no page to turn to, so the
sentence the value was read from is what makes the proposal checkable. Quoted
history is kept and MARKED, never stripped — a reply quotes the question it
answers — and the prompt tells the model to record from it only where the new
text does not restate the value.

### One email, one code, three runs — and one row per spec

`src/lib/spec-document.ts` (`resolveProposals`, `rematchProposals`),
`src/lib/spec-review-rows.ts`, `src/lib/spec-change.ts`,
`src/app/api/imports/[id]/rematch/route.ts`

The first real email review was a wall: seven specification values, every one
reading **ambiguous match** against three identical candidates, each with a
paragraph of the model's own reasoning under it and two dropdowns to fill in by
hand. Nothing about the email was ambiguous. `S-201` is on the mock-up run, the
main run and the VE run, and `resolveProposals` counted three matches and gave
up — `matchedRecords.length === 1 ? … : null`.

`resolveDrawingTargets` has had the right rule since 0007 and says so in its own
header: **one record per RUN is a fan-out; two records in ONE run is the
`SX11A` case and stays ambiguous.** The two pipelines matching a code
differently was the whole defect, and the fix is that rule in a second place —
not new thinking.

Six things are load-bearing:

- **The fan-out is N PROPOSALS, not one proposal with N targets.** A proposal
  carries a target SNAPSHOT the confirm checks for edits underneath the
  reviewer, so a multi-target proposal would need N snapshots, N overwrite
  acknowledgements and N version checks inside one row. One proposal per record
  keeps `proposalBlockers`, the per-record confirm and the `duplicate_target`
  clash working unchanged, and **the record stays the unit of commit**.
- **`sourceOrdinal` is no longer unique, and that is its job.** The fan-out
  members share the ordinal of the observation they came from, which is the key
  `groupIntoSpecRows` groups a screen row by. Seven specs over three runs is
  seven rows, not twenty-one.
- **A run that collides is the only run the reviewer is asked about.** A code on
  two lines of the VE bill leaves the main run resolved and asks about VE alone,
  and the candidates offered are THAT RUN'S — offering the main run's record
  there would let somebody resolve the collision onto a record another proposal
  is already writing.
- **Re-matching is FREE and it never overwrites a decision.** A spec document
  resolves in the worker, not at read time, so a corrected rule is not
  retro-active and the pilot email would otherwise need a billed re-read to fix
  an app defect. Every staged proposal carries its own `raw`, so
  `rematchProposals` re-resolves from what is already on record — touching only
  what is still `pending`, still at `version === 1` and still unresolved, and
  returning the ORIGINAL row unchanged when nothing resolves differently, so
  running it twice is a no-op. The button says it costs nothing, because every
  other button on that screen that touches extraction spends money.
- **The verb comes from the RECORD, never from the wording.** `describeChange`
  reads the target snapshot — provides / confirms / changes / repeats / puts
  back to TBC — so an email the model read as `confirms_tbc` over a value the
  record already holds is reported as a CHANGE, which is what is about to
  happen. `changeIntent` is kept for the one case wording alone cannot carry, a
  settled value being withdrawn, and that already reaches the state through
  `emailAwareState`. The label never stands in for a blocker: `changes` still
  requires the overwrite acknowledgement.
- **"Item not found" and "question not matched" are different jobs.**
  Collapsing them produced a row that contradicted itself — *3 runs* in the
  Applies to column beside *Not yet placed*. Once the fan-out lands, the item is
  the half that resolves and the question is the half that does not, because
  `requirement_aliases` is empty and "Seat height" scores nothing against a
  category that asks "Dimensions". The blocker names the half that is missing.

**The row is a summary and every control is still one click inside it.** The
question picker, the value box, the state select and the overwrite
acknowledgement are unchanged in `ProposalRow`, per run. A table that could only
confirm or ignore would make correcting a misread value impossible, which is the
reviewer's whole job. Blockers render ON the row, not only on the disabled
button at the bottom — a 400 in a banner at the top of the page is nowhere near
the row it is about. And the per-run panel is a `<div>` holding a `<ul>`, because
`ProposalRow` renders its own `<li>` and nesting one in another is a hydration
error.

**A configuration is DETECTED and never resolved.** `detectConfiguration` reads
the `A` out of "Fabric (A configuration)" and the row badges it yellow. It
refuses a bare letter — "Fabric A" is a grade far more often than one of 0024's
configurations — and nothing is written from it, because a configuration carries
no client ref, may not exist, and `ensureVariant` refuses a bill line that
already holds confirmed specs. **STILL OPEN:** the pilot email states fabrics for
configurations A and B of `S-201`, which has none, and what should happen then —
flag it, offer to create them, or something else — is Max's decision and has not
been taken.

### The upload works out what each file is

`src/lib/document-classify.ts`, `src/app/api/imports/classify/route.ts`,
`src/components/projects/IntakeBatchUpload.tsx`

The same thesis at the other end. Eleven dropdowns stood between a pack and the
app because "a BOQ and an FF&E schedule are both .xlsx", and a filename hint sat
beside each row as grey text the screen refused to act on. One press now stores
each file, asks what it is, fills the box in and reads it.

- **The model answers in TRADE terms and code files it.** `DOCUMENT_GENRES` is
  what somebody in furniture manufacturing would call the document;
  `KIND_FROM_GENRE` maps it onto `importType` and `DocumentKind`. The model is
  never shown `ffe_schedule` — the exact step, unchanged by the §6 revision.
- **Unsure fills nothing in.** `unclear`, and anything the model is not certain
  of, produces no decision: the file is uploaded, held on the screen, and NOT
  read. The prompt says outright that a spreadsheet which could be a bill or a
  schedule must come back unclear, because the cost is not symmetric.
- **Every answer is flagged with its evidence**, and a person's choice always
  beats the suggestion.
- **The kind still arrives DECLARED** at `/api/imports`, which is untouched. The
  classify route creates no run, opens no attempt and stages nothing.
- **A scanned, image-only PDF is refused at classify time** (`91360b6`,
  2026-09-21): `pdfHasTextLayer` scans the stream objects, inflates a lone
  `/FlateDecode`, treats image codecs as known-not-text, and answers NULL for
  anything it cannot decode — a filter chain, an unimplemented codec, no
  visible page — so the refusal fires only on a CERTAIN "no text anywhere"
  and the naive test (no `Tj` in the raw bytes) that would have called every
  compressed real drawing "scanned" is the trap it exists to avoid. The
  sentence goes on the upload row, nothing registers, no model call.
  Registration itself does not yet check it (logged): a hand-declared kind on
  an image-only PDF still spends the read.
- A `.eml` costs nothing — it is unambiguously an email. Haiku, not the
  extraction model. The blob is addressed by PATHNAME and scoped to the project
  before a byte is read.
