// The email review over a row staged before its two lines were linked as twins
// (prod-ready review F2, 2026-11-20): the screen reads the links its registers
// carry, so the row says Re-match (free) and never asks which line. The rules
// themselves are proved pure in tests/lib/spec-twins-since-read.test.ts; this
// is the wiring. Every code here is invented.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import { resolveProposals, type RecordEntry, type Registers } from "@/lib/spec-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => ({ ok: true, status: 200, data: {} }) }));

const chair = (id: string, recordNo: number, twinIds?: string[]): RecordEntry => ({
  id,
  recordNo,
  label: `ZZ001-00${recordNo}`,
  itemDescription: "Lounge chair",
  categoryId: "cat-uph",
  categoryName: "Armchairs, Benches, Stools, Sofas",
  refs: ["ZZ-CH-02"],
  boqCodes: ["ZZ-CH-02"],
  runId: "run-gr",
  runName: "Guest Rooms",
  parentId: null,
  variantLabel: null,
  version: 1,
  ...(twinIds ? { twinIds } : {}),
});

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

function mount(live: RecordEntry[]) {
  // READ BEFORE THE LINK: the lines carry no twins, so the code stages as a question.
  const asRead: Registers = {
    records: [chair("rec-a", 2), chair("rec-b", 3)],
    requirements: [],
    answers: [],
    attributes: [],
    specFields: [],
    documentKind: "email",
  };
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
    filename: "Lounge chair.eml",
    parsed: {
      schemaVersion: 1,
      lines: resolveProposals(
        [
          {
            refRaw: "ZZ-CH-02",
            attributeRaw: "Swivel",
            valueRaw: "no swivel",
            page: null,
            sourceSheet: null,
            sourceRow: null,
            confidence: "high",
            note: null,
            quotedText: "ZZ-CH-02 lounge chair: no swivel.",
          },
        ],
        asRead,
        ids,
      ),
      documentNotes: null,
      filename: "Lounge chair.eml",
    },
  };
  return render(
    <SpecDocumentReview
      data={{ import: data, registers: { records: live, requirements: [] }, message: null }}
      reload={async () => {}}
      quietReload={async () => {}}
      crumb={{ label: "Documents", href: "/dashboard/projects/proj-1?tab=documents" }}
    />,
  );
}

const SAYS = "ZZ-CH-02 is on 2 lines of Guest Rooms, linked as twins since this was read — Re-match (free)";

describe("a row staged before its lines were linked as twins", () => {
  it("says Re-match (free) on the row, and never asks which line", () => {
    mount([chair("rec-a", 2, ["rec-b"]), chair("rec-b", 3, ["rec-a"])]);
    expect(screen.getByText(SAYS)).toBeTruthy();
    expect(screen.getByText(`${SAYS} to put it on each line.`)).toBeTruthy();
    expect(screen.queryByText(/choose which/)).toBeNull();
  });

  it("asks which line, as before, where the lines are not linked", () => {
    mount([chair("rec-a", 2), chair("rec-b", 3)]);
    expect(screen.getByText("ZZ-CH-02 is on 2 lines of Guest Rooms — choose which")).toBeTruthy();
    expect(screen.queryByText(/linked as twins since this was read/)).toBeNull();
  });
});
