// The email review's header says how the message came to be on the project,
// and counts its phases in the right number (prod-ready E2/E3, 2026-11-20).
//
// THE DEFECTS. An .eml a PERSON uploaded on the project's Documents tab read
// "auto · Nothing in this message names a project…" — the router's sentence
// about a decision it never took — while the Inbox said "assigned by hand" for
// the same message; its back link said "← Inbox"; and the note over the rows
// said "each landing on 1 phases". Every code and address here is invented.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import type { EmailMessage } from "@/components/imports/EmailHeader";
import { resolveProposals, type RecordEntry, type Registers } from "@/lib/spec-document";
import { emailArrival, cameFromUpload } from "@/lib/email-arrival";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => ({ ok: true, status: 200, data: {} }) }));

const REASON = "Nothing in this message names a project: no project inbox in its headers — so a person placed it";

const stool: RecordEntry = {
  id: "rec-st",
  recordNo: 12,
  label: "ZZ001-012",
  itemDescription: "Bar stool",
  categoryId: null,
  categoryName: null,
  refs: ["ZZ-ST-01"],
  boqCodes: ["ZZ-ST-01"],
  runId: "run-public",
  runName: "Public Areas",
  parentId: null,
  variantLabel: null,
  version: 1,
};

const message = (over: Partial<EmailMessage>): EmailMessage => ({
  id: "msg-1",
  from_addr: "designer@example.test",
  from_name: "A Designer",
  subject: "Bar stool",
  received_at: "2026-11-20T09:30:00.000Z",
  to_addrs: null,
  cc_addrs: null,
  attachments_meta: null,
  has_attachments: false,
  routing_reason: REASON,
  chase_match: null,
  chase_subject: null,
  chase_sent_at: null,
  chase_recipient_name: null,
  chase_question_count: null,
  triage: "assigned",
  version: 1,
  ...over,
});

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

function mount(msg: EmailMessage, ref = "ZZ-ST-01") {
  const registers: Registers = { records: [stool], requirements: [], answers: [], attributes: [], specFields: [], documentKind: "email" };
  const data: SpecImport = {
    id: "run-email",
    project_id: "proj-1",
    status: "parsed",
    version: 1,
    error: null,
    document_kind: "email",
    model: null,
    model_metadata: null,
    attempt_id: null,
    claim_count: 1,
    within_deadline: null,
    claim_live: null,
    bws_project_number: "ZZ001",
    project_name: "Example",
    filename: "Bar stool.eml",
    parsed: {
      schemaVersion: 1,
      lines: resolveProposals(
        [{ refRaw: ref, attributeRaw: "Seat height", valueRaw: "760mm", page: null, sourceSheet: null, sourceRow: null, confidence: "high", note: null }],
        registers,
        ids,
      ),
      documentNotes: null,
      filename: "Bar stool.eml",
    },
  };
  return render(
    <SpecDocumentReview
      data={{ import: data, registers: { records: [stool], requirements: [] }, message: msg }}
      reload={async () => {}}
      quietReload={async () => {}}
      crumb={{ label: "Documents", href: "/dashboard/projects/proj-1?tab=documents" }}
    />,
  );
}

describe("how an email came to be on the project", () => {
  it("says an uploaded message was uploaded, by whom — never the router's sentence", () => {
    mount(message({ origin: "upload", assignment_kind: "manual", assigned_by: "someone@example.test" }));
    expect(screen.getByText("uploaded to this project by someone@example.test")).toBeTruthy();
    expect(screen.queryByText(/auto ·/)).toBeNull();
    expect(screen.queryByText(/Nothing in this message names a project/)).toBeNull();
  });

  it("words the router's and a person's assignment as the Inbox does", () => {
    expect(emailArrival({ origin: "graph", assignment_kind: "auto", routing_reason: "The project inbox is in To — p1@x.test" })).toEqual({
      words: "assigned automatically · The project inbox is in To",
      title: "The project inbox is in To — p1@x.test",
    });
    expect(emailArrival({ origin: "graph", assignment_kind: "manual", assigned_by: "pm@example.test", routing_reason: REASON })).toEqual({
      words: "assigned by hand by pm@example.test",
      title: REASON,
    });
    expect(cameFromUpload({ origin: "upload" })).toBe(true);
    expect(cameFromUpload({ origin: "graph" })).toBe(false);
  });

  it("counts one phase as one phase, where nothing has landed yet too", () => {
    // A code the bill does not carry lands on no phase, and the note still
    // says "1": it said "1 phases".
    mount(message({ origin: "upload", assignment_kind: "manual", assigned_by: "someone@example.test" }), "ZZ-NOT-ON-BILL");
    expect(screen.getByText(/each landing on 1 phase\./)).toBeTruthy();
    expect(screen.queryByText(/1 phases/)).toBeNull();
  });
});
