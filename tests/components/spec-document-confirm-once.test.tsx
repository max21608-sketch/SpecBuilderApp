// One press of the email / specification review's Confirm sends one confirm
// (prod-ready review F5, 2026-11-20).
//
// `confirmAll` awaited the unsaved edits' saves BEFORE it set `busy`, and
// `busy` is state, so a second press while a save was away started a second
// confirm-all: every card was sent again, the server refused the repeats
// (nothing was written twice), and a red "0 answers written. Refused on …"
// appeared after a confirm that had succeeded. The drawings screens closed the
// same window the same day with a `pressing` ref (807a5e4); this is that, here.
// "Ignore the rest" had the same window and takes the same guard. Every code
// and value is invented.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import { resolveProposals, type AttributeEntry, type RecordEntry, type Registers } from "@/lib/spec-document";
import type { RawProposal } from "@/lib/extraction-schema";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

type Answer = { ok: boolean; status?: number; error?: string; data: unknown };
const server = vi.hoisted(() => ({
  calls: [] as { url: string; method: string; body: Record<string, unknown> | null }[],
  held: [] as ((answer: Answer) => void)[],
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    server.calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "PATCH") return new Promise<Answer>((resolve) => server.held.push(resolve));
    return { ok: true, status: 200, data: {} };
  },
}));

const chair: RecordEntry = {
  id: "rec-zz04",
  recordNo: 4,
  label: "P90000-004",
  itemDescription: "Desk chair",
  categoryId: null,
  categoryName: null,
  refs: ["ZZ-FUR-04"],
  boqCodes: ["ZZ-FUR-04"],
  runId: "run-main",
  runName: "CASEGOODS",
  parentId: null,
  variantLabel: null,
  version: 1,
};

const billWidth: AttributeEntry = {
  id: "bill-w",
  recordId: "rec-zz04",
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

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;

function specImport(): SpecImport {
  const registers: Registers = {
    records: [chair],
    requirements: [],
    answers: [],
    attributes: [billWidth],
    specFields: [],
    documentKind: "ffe_schedule",
  };
  const raw: RawProposal = {
    refRaw: "ZZ-FUR-04",
    attributeRaw: "Size",
    valueRaw: "W540 mm",
    page: 9,
    sourceSheet: null,
    sourceRow: null,
    confidence: "high",
    note: null,
  };
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
    project_name: "__QA Confirm once",
    filename: "Schedule.pdf",
    parsed: { schemaVersion: 1, lines: resolveProposals([raw], registers, ids), documentNotes: null, filename: "Schedule.pdf" },
  };
}

/** Open the row and choose this document's value, which starts a save that is held open. */
async function editStillSaving() {
  const data = specImport();
  render(
    <SpecDocumentReview
      data={{ import: data, registers: { records: [chair], requirements: [] } }}
      reload={async () => {}}
      quietReload={async () => {}}
      crumb={{ label: "Pack", href: "/x" }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Size" }));
  const panel = screen.getByText("Disagrees with the bill", { selector: "p" }).closest("div")!;
  await userEvent.click(within(panel).getByRole("radio", { name: /Use this document’s instead/ }));
  await waitFor(() => expect(server.held).toHaveLength(1));
  return data.parsed!.lines[0]!.id;
}

const posted = (action: string) =>
  server.calls.filter((call) => call.url.endsWith("/confirm") && call.body?.action === action);

describe("two presses while an edit is still saving", () => {
  beforeEach(() => {
    server.calls = [];
    server.held = [];
  });

  it("Confirm sends one confirm, and no refusal is reported", async () => {
    const proposalId = await editStillSaving();
    const confirm = screen.getByRole("button", { name: "Confirm" });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    await act(async () => {
      server.held[0]!({ ok: true, status: 200, data: { proposal: { id: proposalId, version: 2 }, version: 4 } });
    });

    await waitFor(() => expect(posted("confirm")).toHaveLength(1));
    // Give a second press every chance to have sent its own.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(posted("confirm")).toHaveLength(1);
    expect(screen.queryByText(/Refused on/)).toBeNull();
  });

  it("Ignore the rest sends one ignore", async () => {
    const proposalId = await editStillSaving();
    const ignore = screen.getByRole("button", { name: "Ignore the rest" });
    await userEvent.click(ignore);
    await userEvent.click(ignore);
    await act(async () => {
      server.held[0]!({ ok: true, status: 200, data: { proposal: { id: proposalId, version: 2 }, version: 4 } });
    });

    await waitFor(() => expect(posted("ignore")).toHaveLength(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(posted("ignore")).toHaveLength(1);
  });
});
