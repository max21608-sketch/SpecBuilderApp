// A tracker's furniture on the review screen (2026-10-05): a value that
// disagrees with the BILL is red, shows both, and keeps the bill's by default;
// a statement no question matched is kept as a note; and a finishes schedule
// offers to read its furniture once. Rendered from staged data as the GET
// returns it, with no network. Every code is invented, shaped like the Aman
// bill's.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import FinishScheduleReview from "@/components/imports/FinishScheduleReview";
import { resolveProposals, type AttributeEntry, type RecordEntry, type Registers } from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const gr04: RecordEntry = {
  id: "rec-gr04",
  recordNo: 4,
  label: "P90000-004",
  itemDescription: "Desk chair",
  categoryId: null,
  categoryName: null,
  refs: ["GR-FUR-04"],
  boqCodes: ["GR-FUR-04"],
  runId: "run-main",
  runName: "CASEGOODS",
  parentId: null,
  variantLabel: null,
  version: 1,
};

const billWidth: AttributeEntry = {
  id: "bill-w",
  recordId: "rec-gr04",
  attrGroup: "dimension",
  slot: "W",
  specFieldId: null,
  label: "Sizes (ft-in)",
  value: '21"',
  unit: "in",
  state: "confirmed",
  version: 1,
  fromBill: true,
};

function observation(overrides: Partial<RawProposal>): RawProposal {
  return {
    refRaw: "GR-FUR-04",
    attributeRaw: "Size",
    valueRaw: "W540 mm",
    page: 9,
    sourceSheet: null,
    sourceRow: null,
    confidence: "high",
    note: null,
    ...overrides,
  };
}

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

function specImport(): SpecImport {
  const registers: Registers = {
    records: [gr04],
    requirements: [],
    answers: [],
    attributes: [billWidth],
    specFields: [],
    documentKind: "ffe_schedule",
  };
  const lines = resolveProposals(
    [observation({}), observation({ attributeRaw: "Supplier", valueRaw: "WEWOOD, Porto" })],
    registers,
    ids,
  );
  return {
    id: "run-ffe",
    project_id: "proj-1",
    status: "parsed",
    version: 3,
    error: null,
    document_kind: "ffe_schedule",
    model: null,
    model_metadata: null,
    attempt_id: null,
    claim_count: 1,
    within_deadline: null,
    claim_live: null,
    bws_project_number: "P90000",
    project_name: "__QA Tracker",
    filename: "Tracker.pdf",
    parsed: { schemaVersion: 1, lines, documentNotes: null, filename: "Tracker.pdf" },
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("a value that disagrees with the bill", () => {
  it("is red with both values, keeps the bill's by default, and switches to the document's on one click", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { proposal: { version: 2 }, version: 4 } });
    const data = specImport();
    render(
      <SpecDocumentReview
        data={{ import: data, registers: { records: [gr04], requirements: [] } }}
        reload={async () => {}}
        quietReload={async () => {}}
        crumb={{ label: "Pack", href: "/x" }}
      />,
    );

    expect(screen.getByText("Disagrees with the bill")).toBeTruthy();
    expect(screen.getByText(/the bill says W 21" \(533mm\)/)).toBeTruthy();
    expect(screen.getAllByText("Kept as a note").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Size" }));
    const panel = screen.getByText("Disagrees with the bill", { selector: "p" }).closest("div")!;
    expect(within(panel).getByText('W 21" (533mm)')).toBeTruthy();
    expect(within(panel).getByText("W540mm")).toBeTruthy();
    const keep = within(panel).getByRole("radio", { name: /Keep the bill’s, record this beside it/ }) as HTMLInputElement;
    const use = within(panel).getByRole("radio", { name: /Use this document’s instead/ }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    expect(use.checked).toBe(false);
    // No replace tick and no blocker: it commits as it stands.
    expect(screen.queryByText(/Confirm you mean to replace it/)).toBeNull();

    await userEvent.click(use);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, init] = apiFetch.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/imports/run-ffe");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body).changes).toEqual({ overwriteAcknowledged: true });
  });
});

describe("a finishes schedule's furniture", () => {
  it("is offered as one charged read, and becomes a link once it exists", async () => {
    const run = {
      id: "run-fin",
      status: "pending",
      version: 1,
      error: null,
      filename: "Tracker.pdf",
      claim_live: null,
      within_deadline: null,
      claim_count: 0,
      parsed: null,
    };
    let furnitureRunId: string | null = null;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/imports/run-fin/read-furniture" && init?.method === "POST") {
        furnitureRunId = "run-furniture";
        return { ok: true, data: { importId: "run-furniture", reused: false, autoRead: { dispatched: true } } };
      }
      return { ok: true, data: { import: run, review: [], furnitureRunId } };
    });

    render(
      <FinishScheduleReview importId="run-fin" crumb={{ label: "Pack", href: "/x" }} project={{ id: "p", number: "P1", name: "x" }} />,
    );
    const button = await screen.findByRole("button", { name: /Also read its furniture as an FF&E schedule — one charged read/ });
    await userEvent.click(button);
    const link = await screen.findByRole("link", { name: /Its furniture, read as an FF&E schedule/ });
    expect(link.getAttribute("href")).toBe("/dashboard/imports/run-furniture");
    expect(screen.queryByRole("button", { name: /Also read its furniture/ })).toBeNull();
  });
});
