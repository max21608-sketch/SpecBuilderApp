// Every document behind one line item, one row per document.
//
// Max, 2026-10-05: "within the individual line item, when you click in and see
// its overview, you can also see all the documents relating to that line
// item." The record screen already named a document beside each spec it
// carried, but only spec by spec, and only the ACTIVE ones — so "which
// documents is this item built from" meant reading forty rows and deduplicating
// the filenames in your head, and the bill the item came off was named nowhere.
//
// ============================================================================
// A DOCUMENT IS LISTED BECAUSE SOMETHING ON RECORD POINTS AT IT. NOTHING ELSE.
//
// Five links exist, and each is a column a confirm wrote:
//
//   the bill        spec_records.source_import_id + source_line_no. A
//                   CONFIGURATION carries none of its own (variant-create.ts
//                   copies identity, never provenance), so it lists its PARENT
//                   bill line's bill, and says that is what it is.
//   a spec          record_attributes.source_run_id + source_page, active AND
//                   retired. A retired spec's document is still a document
//                   that said something about this item, and every dismissal
//                   here is reversible — so it is counted, apart.
//   an answer       spec_answers.source_id, which is the INTAKE RUN for both
//                   source_kind 'document' and 'email' (confirm-spec-document.ts
//                   writes run.runId in both branches; a manual answer writes
//                   null). An answer back at 'missing' is not counted: it no
//                   longer says anything, whatever its source column still holds.
//   evidence        change_sets.evidence_attachment_id, on a change that made a
//                   VERSION of this record (record_snapshots). The version is
//                   the proof the change touched this item; a change on the
//                   same project that did not is not this item's evidence.
//   a cause         change_sets.source_intake_run_id on the same changes. This
//                   is how a bill a REVISION replaced stays on the list:
//                   confirm-boq.ts rewrites source_import_id to the new bill,
//                   so the old one is reachable only through the change it
//                   made. Said ONLY where the document has no other relation —
//                   a drawing's confirm "caused version 3" is the same fact as
//                   its fourteen specs, and printing both reads as two.
//
// A document that merely MENTIONS this item's code, or one whose proposals for
// it are still staged, is NOT here: nothing has been confirmed from it onto the
// record, and listing it would be the app matching on a reviewer's behalf. The
// screen says so in words.
//
// ---- ONE ROW PER DOCUMENT, keyed by the STORED FILE ------------------------
//
// Not by intake run: a bill's specification read (bill-specifications.ts)
// registers the SAME attachment as a second run, and an email's change carries
// the run's own .eml as its evidence (email-registration.ts sets
// mime_attachment_id to the run's attachment). Keyed by run, both of those are
// one file printed twice. A run with no stored file keys by itself.
//
// ---- THE LINKS ---------------------------------------------------------------
//
// A PDF opens in THIS APP'S copy at the first page it was used at
// (`/api/imports/[id]/source#page=N`, which streams inline with range support —
// the costing sheet's rule). An email is NEVER opened by that route, which
// serves inline: it downloads through `/api/email-messages/[id]/mime` or
// `/api/change-sets/[id]/evidence`, the two routes that set attachment and
// nosniff, because an .eml body is markup a stranger wrote. Anything else is a
// download. An email run with no message row offers no Open at all rather than
// fall back to the inline route — its review screen still opens.
//
// ---- THE ORDER -------------------------------------------------------------
//
// The bill first, because it is where the item came from and what its record
// number refers to; then everything else NEWEST FIRST, because the newest
// document is the one most likely to have changed what the item says, and it
// is the one somebody comes here to find.
// ============================================================================
import { sql as defaultSql } from "@/lib/db";
import type { SqlLike } from "@/lib/record-atoms";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/spec-vocab";
import { CHANGE_SET_KIND_LABELS, type ChangeSetKind } from "@/lib/change-sets";

/** What a document IS, in the words a chip carries. */
export type RecordDocumentKind = "bill" | DocumentKind | "evidence";

export type RecordDocumentLink = {
  href: string;
  /** True for a PDF opened in the browser's own viewer; false for a download. */
  inline: boolean;
};

export type RecordDocument = {
  /** The stored file's id, or `run:<id>` for a run that kept no file. */
  key: string;
  filename: string | null;
  /** An email's subject, which says far more than `message.eml` does. */
  subject: string | null;
  kind: RecordDocumentKind;
  kindLabel: string;
  /** When it reached this app (a timestamp, so a Date is safe). */
  arrivedAt: string | null;
  /** What it gave this item, one phrase each: "Bill row 12", "14 specs, pages 2–3". */
  relations: string[];
  /** Every page a spec on this item was read from, sorted. */
  pages: number[];
  /** The review screens, one per intake run that holds this file. */
  reviews: { runId: string; label: string }[];
  open: RecordDocumentLink | null;
};

export type RecordDocumentsResult = {
  documents: RecordDocument[];
  /** Why the list might be empty, so the empty state says only what is true. */
  origin: {
    /** Added to the mock-up phase from another record (0043): it came off no bill row. */
    mockup: boolean;
    /** Neither this record nor its bill line came off a bill. */
    noBill: boolean;
  };
};

// ---- the facts the loader reads, for the pure assembly ---------------------

export type RunFact = {
  id: string;
  sourceKind: string;
  documentKind: string | null;
  createdAt: string | null;
  attachmentId: string | null;
  filename: string | null;
  contentType: string | null;
  /** The email_messages row an email run belongs to, where there is one. */
  messageId: string | null;
  messageSubject: string | null;
};

export type BillFact = { runId: string; lineNo: number | null; viaParent: boolean };
export type AttributeFact = { runId: string; status: "active" | "retired"; page: number | null; count: number };
export type AnswerFact = { runId: string; count: number };
export type ChangeFact = {
  changeSetId: string;
  kind: string;
  reason: string | null;
  label: string | null;
  snapshotNo: number;
  sourceRunId: string | null;
  evidenceAttachmentId: string | null;
};
export type AttachmentFact = { id: string; filename: string | null; contentType: string | null; createdAt: string | null };

export type RecordDocumentFacts = {
  runs: RunFact[];
  bills: BillFact[];
  attributes: AttributeFact[];
  answers: AnswerFact[];
  changes: ChangeFact[];
  /** Evidence files, by id. Only those a change in `changes` names. */
  attachments: AttachmentFact[];
};

/** "page 2", "pages 2–3", "pages 2, 4–6". Empty for no pages. */
export function describePages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const spans: string[] = [];
  let start = sorted[0]!;
  let end = start;
  for (const page of sorted.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    spans.push(start === end ? `${start}` : `${start}–${end}`);
    start = page;
    end = page;
  }
  spans.push(start === end ? `${start}` : `${start}–${end}`);
  return `${sorted.length === 1 ? "page" : "pages"} ${spans.join(", ")}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "version 3", "versions 1 and 3", "versions 1, 2 and 4". */
function describeVersions(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 1) return `version ${sorted[0]}`;
  return `versions ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

function isEmailFile(filename: string | null, contentType: string | null): boolean {
  const name = (filename ?? "").toLowerCase();
  const type = (contentType ?? "").toLowerCase();
  return name.endsWith(".eml") || name.endsWith(".msg") || type === "message/rfc822" || type === "application/vnd.ms-outlook";
}

function isPdf(filename: string | null, contentType: string | null): boolean {
  return (contentType ?? "").toLowerCase() === "application/pdf" || (filename ?? "").toLowerCase().endsWith(".pdf");
}

function runKind(run: RunFact): RecordDocumentKind {
  if (run.sourceKind === "boq_xlsx") return "bill";
  return run.documentKind && run.documentKind in DOCUMENT_KIND_LABELS ? (run.documentKind as DocumentKind) : "other";
}

export function kindLabel(kind: RecordDocumentKind): string {
  if (kind === "bill") return "Bill of quantities";
  if (kind === "evidence") return "Evidence";
  return DOCUMENT_KIND_LABELS[kind];
}

/** How a change is named in a sentence: its reason, else its baseline name, else what kind it was. */
function nameChange(change: ChangeFact): string {
  if (change.reason && change.reason.trim()) return `the change “${change.reason.trim()}”`;
  if (change.label && change.label.trim()) return `the baseline “${change.label.trim()}”`;
  const kind = CHANGE_SET_KIND_LABELS[change.kind as ChangeSetKind];
  return kind ? `the change “${kind}”` : "a change";
}

type Draft = {
  key: string;
  runs: RunFact[];
  evidence: { attachment: AttachmentFact; changeSetId: string } | null;
  bills: BillFact[];
  active: AttributeFact[];
  retired: AttributeFact[];
  answers: number;
  evidenceFor: ChangeFact[];
  caused: ChangeFact[];
};

/**
 * The rows, from facts already loaded. Pure, so the relation wording and the
 * de-duplication are provable without a database.
 *
 * A fact naming a run that is not in `runs` is DROPPED: the loader only returns
 * runs on the record's own project, so a dangling or foreign id has nothing to
 * show and must not become a row with no file.
 */
export function assembleRecordDocuments(facts: RecordDocumentFacts): RecordDocument[] {
  const runById = new Map(facts.runs.map((run) => [run.id, run]));
  const attachmentById = new Map(facts.attachments.map((attachment) => [attachment.id, attachment]));
  const drafts = new Map<string, Draft>();
  const runKey = (run: RunFact) => run.attachmentId ?? `run:${run.id}`;

  const draftFor = (key: string): Draft => {
    let draft = drafts.get(key);
    if (!draft) {
      draft = { key, runs: [], evidence: null, bills: [], active: [], retired: [], answers: 0, evidenceFor: [], caused: [] };
      drafts.set(key, draft);
    }
    return draft;
  };
  const draftForRun = (runId: string | null): Draft | null => {
    const run = runId ? runById.get(runId) : undefined;
    if (!run) return null;
    const draft = draftFor(runKey(run));
    if (!draft.runs.some((held) => held.id === run.id)) draft.runs.push(run);
    return draft;
  };

  for (const bill of facts.bills) draftForRun(bill.runId)?.bills.push(bill);
  for (const attribute of facts.attributes) {
    const draft = draftForRun(attribute.runId);
    if (draft) (attribute.status === "retired" ? draft.retired : draft.active).push(attribute);
  }
  for (const answer of facts.answers) {
    const draft = draftForRun(answer.runId);
    if (draft) draft.answers += answer.count;
  }
  for (const change of facts.changes) {
    if (change.evidenceAttachmentId) {
      const attachment = attachmentById.get(change.evidenceAttachmentId);
      if (attachment) {
        // The run's own file, where it is one (an email's .eml): merged into
        // that row rather than printed again as "Evidence".
        const draft = draftFor(attachment.id);
        if (!draft.evidence) draft.evidence = { attachment, changeSetId: change.changeSetId };
        draft.evidenceFor.push(change);
      }
    }
    if (change.sourceRunId) draftForRun(change.sourceRunId)?.caused.push(change);
  }

  const documents: RecordDocument[] = [];
  for (const draft of drafts.values()) {
    // The bill's run names the row where a file is both a bill and its own
    // specification read; otherwise the only run there is.
    const primary = [...draft.runs].sort((a, b) => (a.sourceKind === "boq_xlsx" ? -1 : 0) - (b.sourceKind === "boq_xlsx" ? -1 : 0))[0];
    const evidence = draft.evidence;
    if (!primary && !evidence) continue;

    const filename = primary?.filename ?? evidence?.attachment.filename ?? null;
    const contentType = primary?.contentType ?? evidence?.attachment.contentType ?? null;
    const kind: RecordDocumentKind = primary ? runKind(primary) : "evidence";
    const pages = [...new Set([...draft.active, ...draft.retired].flatMap((fact) => (fact.page === null ? [] : [fact.page])))].sort(
      (a, b) => a - b,
    );

    const relations: string[] = [];
    for (const bill of draft.bills) {
      const row = bill.lineNo === null ? "The bill this item came off" : `Bill row ${bill.lineNo}`;
      relations.push(bill.viaParent ? `${row}, for the bill line this configuration belongs to` : row);
    }
    const specPhrase = (facts: AttributeFact[], one: string, many: string) => {
      const count = facts.reduce((sum, fact) => sum + fact.count, 0);
      if (count === 0) return null;
      const where = describePages(facts.flatMap((fact) => (fact.page === null ? [] : [fact.page])));
      // No page is said by saying nothing: an email's page is a sentence and a
      // bill's is a row, and "no page recorded" beside either reads as a gap.
      return `${plural(count, one, many)}${where ? `, ${where}` : ""}`;
    };
    const activePhrase = specPhrase(draft.active, "spec", "specs");
    if (activePhrase) relations.push(activePhrase);
    const retiredPhrase = specPhrase(draft.retired, "retired spec", "retired specs");
    if (retiredPhrase) relations.push(retiredPhrase);
    if (draft.answers > 0) relations.push(plural(draft.answers, "checklist answer", "checklist answers"));
    if (draft.evidenceFor.length > 0) {
      const changes = [...new Map(draft.evidenceFor.map((change) => [change.changeSetId, change])).values()];
      relations.push(
        changes.length === 1
          ? `Evidence for ${nameChange(changes[0]!)} (${describeVersions([changes[0]!.snapshotNo])})`
          : `Evidence for ${changes.length} changes (${describeVersions(changes.map((change) => change.snapshotNo))})`,
      );
    }
    // Only where nothing else says why it is here — see the header.
    if (relations.length === 0 && draft.caused.length > 0) {
      relations.push(`Caused ${describeVersions(draft.caused.map((change) => change.snapshotNo))} of this item`);
    }
    if (relations.length === 0) continue;

    let open: RecordDocumentLink | null = null;
    if (isEmailFile(filename, contentType) || kind === "email") {
      const message = draft.runs.find((run) => run.messageId)?.messageId ?? null;
      if (message) open = { href: `/api/email-messages/${message}/mime`, inline: false };
      else if (evidence) open = { href: `/api/change-sets/${evidence.changeSetId}/evidence`, inline: false };
    } else if (primary && primary.attachmentId) {
      const base = `/api/imports/${primary.id}/source`;
      open = isPdf(filename, contentType)
        ? { href: pages.length > 0 ? `${base}#page=${pages[0]}` : base, inline: true }
        : { href: base, inline: false };
    } else if (evidence) {
      // An evidence PDF still downloads: that route is attachment-only by
      // design, and it is not this screen's to change.
      open = { href: `/api/change-sets/${evidence.changeSetId}/evidence`, inline: false };
    }

    const arrivals = [primary?.createdAt ?? null, evidence?.attachment.createdAt ?? null].filter(
      (value): value is string => Boolean(value),
    );
    documents.push({
      key: draft.key,
      filename,
      subject: draft.runs.find((run) => run.messageSubject)?.messageSubject ?? null,
      kind,
      kindLabel: kindLabel(kind),
      arrivedAt: arrivals.sort()[0] ?? null,
      relations,
      pages,
      reviews: [...draft.runs]
        .sort((a, b) => (a.sourceKind === "boq_xlsx" ? -1 : 0) - (b.sourceKind === "boq_xlsx" ? -1 : 0))
        .map((run) => ({ runId: run.id, label: kindLabel(runKind(run)) })),
      open,
    });
  }

  return documents.sort((a, b) => {
    const billA = a.kind === "bill" ? 0 : 1;
    const billB = b.kind === "bill" ? 0 : 1;
    if (billA !== billB) return billA - billB;
    return (b.arrivedAt ?? "").localeCompare(a.arrivedAt ?? "") || a.key.localeCompare(b.key);
  });
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The documents behind one record, or null where there is no such record.
 *
 * Every query is scoped to the record's own project as well as to the record:
 * a run or a change on another project can never become a row here, whatever a
 * source column happens to hold.
 */
export async function loadRecordDocuments(
  recordId: string,
  db: SqlLike = defaultSql,
): Promise<RecordDocumentsResult | null> {
  const records = await db`
    select r.id, r.project_id, r.parent_id, r.mockup_of, r.source_import_id, r.source_line_no,
           p.source_import_id as parent_import_id, p.source_line_no as parent_line_no
      from spec_records r
      left join spec_records p on p.id = r.parent_id and p.project_id = r.project_id
     where r.id = ${recordId}
  `;
  const record = records[0];
  if (!record) return null;
  const projectId = String(record.project_id);

  const bills: BillFact[] = [];
  if (record.source_import_id) {
    bills.push({
      runId: String(record.source_import_id),
      lineNo: record.source_line_no === null || record.source_line_no === undefined ? null : Number(record.source_line_no),
      viaParent: false,
    });
  }
  if (record.parent_import_id) {
    bills.push({
      runId: String(record.parent_import_id),
      lineNo: record.parent_line_no === null || record.parent_line_no === undefined ? null : Number(record.parent_line_no),
      viaParent: true,
    });
  }

  const [attributeRows, answerRows, changeRows] = await Promise.all([
    db`
      select source_run_id, status, source_page, count(*)::int as n
        from record_attributes
       where record_id = ${recordId} and source_run_id is not null
       group by source_run_id, status, source_page
    `,
    db`
      select source_id, count(*)::int as n
        from spec_answers
       where record_id = ${recordId}
         and source_id is not null
         and source_kind in ('document', 'email')
         and state <> 'missing'
       group by source_id
    `,
    db`
      select cs.id, cs.kind, cs.reason, cs.label, cs.source_intake_run_id, cs.evidence_attachment_id,
             s.snapshot_no
        from record_snapshots s
        join change_sets cs on cs.id = s.change_set_id
       where s.record_id = ${recordId}
         and cs.project_id = ${projectId}
         and (cs.source_intake_run_id is not null or cs.evidence_attachment_id is not null)
       order by s.snapshot_no
    `,
  ]);

  const attributes: AttributeFact[] = attributeRows.map((row) => ({
    runId: String(row.source_run_id),
    status: String(row.status) === "retired" ? "retired" : "active",
    page: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
    count: Number(row.n),
  }));
  const answers: AnswerFact[] = answerRows.map((row) => ({ runId: String(row.source_id), count: Number(row.n) }));
  const changes: ChangeFact[] = changeRows.map((row) => ({
    changeSetId: String(row.id),
    kind: String(row.kind),
    reason: text(row.reason),
    label: text(row.label),
    snapshotNo: Number(row.snapshot_no),
    sourceRunId: text(row.source_intake_run_id),
    evidenceAttachmentId: text(row.evidence_attachment_id),
  }));

  const runIds = [
    ...new Set([
      ...bills.map((bill) => bill.runId),
      ...attributes.map((fact) => fact.runId),
      ...answers.map((fact) => fact.runId),
      ...changes.flatMap((change) => (change.sourceRunId ? [change.sourceRunId] : [])),
    ]),
  ];
  const evidenceIds = [...new Set(changes.flatMap((change) => (change.evidenceAttachmentId ? [change.evidenceAttachmentId] : [])))];

  const [runRows, attachmentRows] = await Promise.all([
    runIds.length === 0
      ? Promise.resolve([])
      : db`
          select ir.id, ir.source_kind, ir.document_kind, ir.created_at, ir.attachment_id,
                 at.filename, at.content_type,
                 em.id as message_id, em.subject as message_subject
            from intake_runs ir
            left join attachments at on at.id = ir.attachment_id
            left join lateral (
              select m.id, m.subject from email_messages m
               where m.intake_run_id = ir.id and m.project_id = ir.project_id
               order by m.created_at limit 1
            ) em on true
           where ir.id = any(${runIds}::uuid[]) and ir.project_id = ${projectId}
        `,
    evidenceIds.length === 0
      ? Promise.resolve([])
      : db`
          select id, filename, content_type, created_at from attachments where id = any(${evidenceIds}::uuid[])
        `,
  ]);

  const runs: RunFact[] = runRows.map((row) => ({
    id: String(row.id),
    sourceKind: String(row.source_kind),
    documentKind: text(row.document_kind),
    createdAt: iso(row.created_at),
    attachmentId: text(row.attachment_id),
    filename: text(row.filename),
    contentType: text(row.content_type),
    messageId: text(row.message_id),
    messageSubject: text(row.message_subject),
  }));
  const attachments: AttachmentFact[] = attachmentRows.map((row) => ({
    id: String(row.id),
    filename: text(row.filename),
    contentType: text(row.content_type),
    createdAt: iso(row.created_at),
  }));

  return {
    documents: assembleRecordDocuments({ runs, bills, attributes, answers, changes, attachments }),
    origin: {
      mockup: record.mockup_of !== null && record.mockup_of !== undefined,
      noBill: bills.length === 0,
    },
  };
}
