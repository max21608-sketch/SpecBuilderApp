// Pure tier — which documents a record's Documents tab lists, and what each
// row says it gave the item. The loader's queries are held by the db tier
// (tests/db/record-documents.test.ts); this holds the wording, the
// de-duplication and the links, which are what a reviewer reads.
import { describe, expect, it } from "vitest";
import {
  assembleRecordDocuments,
  describePages,
  type RecordDocumentFacts,
  type RunFact,
} from "@/lib/record-documents";

const run = (over: Partial<RunFact> & { id: string }): RunFact => ({
  sourceKind: "spec_document",
  documentKind: "shop_drawings",
  createdAt: "2026-10-01T09:00:00.000Z",
  attachmentId: `att-${over.id}`,
  filename: `${over.id}.pdf`,
  contentType: "application/pdf",
  messageId: null,
  messageSubject: null,
  ...over,
});

const empty: RecordDocumentFacts = { runs: [], bills: [], attributes: [], answers: [], changes: [], attachments: [] };

describe("describePages", () => {
  it("names one page, a span and a gap", () => {
    expect(describePages([])).toBe("");
    expect(describePages([2])).toBe("page 2");
    expect(describePages([3, 2])).toBe("pages 2–3");
    expect(describePages([2, 4, 5, 6, 4])).toBe("pages 2, 4–6");
  });
});

describe("assembleRecordDocuments", () => {
  it("lists a drawing once, however many specs and pages it gave", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [run({ id: "dwg" })],
      attributes: [
        { runId: "dwg", status: "active", page: 2, count: 3 },
        { runId: "dwg", status: "active", page: 3, count: 1 },
        { runId: "dwg", status: "retired", page: 4, count: 1 },
      ],
      answers: [{ runId: "dwg", count: 2 }],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.relations).toEqual(["4 specs, pages 2–3", "1 retired spec, page 4", "2 checklist answers"]);
    expect(docs[0]?.pages).toEqual([2, 3, 4]);
    // A PDF opens inline, at the first page it was used at.
    expect(docs[0]?.open).toEqual({ href: "/api/imports/dwg/source#page=2", inline: true });
    expect(docs[0]?.reviews).toEqual([{ runId: "dwg", label: "Shop drawings" }]);
  });

  it("puts the bill first and the rest newest first", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [
        run({ id: "old", createdAt: "2026-09-01T00:00:00.000Z" }),
        run({ id: "new", createdAt: "2026-10-03T00:00:00.000Z" }),
        run({
          id: "bill",
          sourceKind: "boq_xlsx",
          documentKind: null,
          createdAt: "2026-08-01T00:00:00.000Z",
          filename: "bill.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ],
      bills: [{ runId: "bill", lineNo: 12, viaParent: false }],
      attributes: [
        { runId: "old", status: "active", page: 1, count: 1 },
        { runId: "new", status: "active", page: 1, count: 1 },
      ],
    });
    expect(docs.map((doc) => doc.key)).toEqual(["att-bill", "att-new", "att-old"]);
    expect(docs[0]?.relations).toEqual(["Bill row 12"]);
    expect(docs[0]?.kindLabel).toBe("Bill of quantities");
    // A spreadsheet is a download, not a page.
    expect(docs[0]?.open).toEqual({ href: "/api/imports/bill/source", inline: false });
  });

  it("says a configuration's bill is its bill line's", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [run({ id: "bill", sourceKind: "boq_xlsx", documentKind: null, filename: "bill.xlsx", contentType: null })],
      bills: [{ runId: "bill", lineNo: 7, viaParent: true }],
    });
    expect(docs[0]?.relations).toEqual(["Bill row 7, for the bill line this configuration belongs to"]);
  });

  it("never opens an email through the inline route, and merges its .eml evidence into its own row", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [
        run({
          id: "mail",
          documentKind: "email",
          attachmentId: "eml-1",
          filename: "reply.eml",
          contentType: "message/rfc822",
          messageId: "msg-1",
          messageSubject: "Re: invented armchair",
        }),
      ],
      answers: [{ runId: "mail", count: 1 }],
      changes: [
        {
          changeSetId: "cs-1",
          kind: "email_confirm",
          reason: "Invented email of the 14th",
          label: null,
          snapshotNo: 3,
          sourceRunId: "mail",
          evidenceAttachmentId: "eml-1",
        },
      ],
      attachments: [{ id: "eml-1", filename: "reply.eml", contentType: "message/rfc822", createdAt: null }],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.kind).toBe("email");
    expect(docs[0]?.subject).toBe("Re: invented armchair");
    expect(docs[0]?.relations).toEqual([
      "1 checklist answer",
      "Evidence for the change “Invented email of the 14th” (version 3)",
    ]);
    expect(docs[0]?.open).toEqual({ href: "/api/email-messages/msg-1/mime", inline: false });
  });

  it("offers no Open for an email run with no message row, rather than the inline route", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [run({ id: "mail", documentKind: "email", filename: "reply.eml", contentType: "message/rfc822" })],
      answers: [{ runId: "mail", count: 1 }],
    });
    expect(docs[0]?.open).toBeNull();
    expect(docs[0]?.reviews).toHaveLength(1);
  });

  it("lists evidence attached to a hand edit as its own row, downloaded through the change", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      changes: [
        {
          changeSetId: "cs-9",
          kind: "manual_edit",
          reason: null,
          label: null,
          snapshotNo: 2,
          sourceRunId: null,
          evidenceAttachmentId: "ev-1",
        },
      ],
      attachments: [{ id: "ev-1", filename: "note.pdf", contentType: "application/pdf", createdAt: "2026-10-02T00:00:00.000Z" }],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.kind).toBe("evidence");
    expect(docs[0]?.relations).toEqual(["Evidence for the change “Edited by hand” (version 2)"]);
    expect(docs[0]?.open).toEqual({ href: "/api/change-sets/cs-9/evidence", inline: false });
    expect(docs[0]?.reviews).toEqual([]);
  });

  it("names a replaced bill by the version it caused, and only where nothing else says why", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [run({ id: "dwg" }), run({ id: "old-bill", sourceKind: "boq_xlsx", documentKind: null, filename: "rev0.xlsx", contentType: null })],
      attributes: [{ runId: "dwg", status: "active", page: 5, count: 2 }],
      changes: [
        { changeSetId: "c1", kind: "boq_confirm", reason: null, label: null, snapshotNo: 1, sourceRunId: "old-bill", evidenceAttachmentId: null },
        { changeSetId: "c2", kind: "drawing_confirm", reason: null, label: null, snapshotNo: 2, sourceRunId: "dwg", evidenceAttachmentId: null },
      ],
    });
    const bill = docs.find((doc) => doc.key === "att-old-bill");
    const drawing = docs.find((doc) => doc.key === "att-dwg");
    expect(bill?.relations).toEqual(["Caused version 1 of this item"]);
    expect(drawing?.relations).toEqual(["2 specs, page 5"]);
  });

  it("is one row for a bill and its own specification read, which share a file", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      runs: [
        run({ id: "bill", sourceKind: "boq_xlsx", documentKind: null, attachmentId: "shared", filename: "bill.xlsx", contentType: null }),
        run({ id: "read", documentKind: "ffe_schedule", attachmentId: "shared", filename: "bill.xlsx", contentType: null }),
      ],
      bills: [{ runId: "bill", lineNo: 4, viaParent: false }],
      attributes: [{ runId: "read", status: "active", page: null, count: 3 }],
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.kind).toBe("bill");
    expect(docs[0]?.relations).toEqual(["Bill row 4", "3 specs"]);
    expect(docs[0]?.reviews.map((review) => review.runId)).toEqual(["bill", "read"]);
  });

  it("drops a fact naming a run the loader did not return", () => {
    const docs = assembleRecordDocuments({
      ...empty,
      attributes: [{ runId: "elsewhere", status: "active", page: 1, count: 1 }],
      answers: [{ runId: "elsewhere", count: 1 }],
    });
    expect(docs).toEqual([]);
  });
});
