// The project header's "Inbox n" (plan any-bill, step 7).
//
// The count is the inbox's own To review count — `inboxBuckets` over the
// inbox's own payload, asked for with this project's id — and the link goes to
// the inbox narrowed to this project. A count that could not be read leaves the
// link uncounted rather than reading zero.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectOverviewPage from "@/app/dashboard/projects/[id]/page";

const PROJECT = "project-9";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: PROJECT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/dashboard/projects/${PROJECT}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const routes = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const asked = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    asked.push(url);
    const path = url.split("?")[0]!;
    const body = routes.current[path];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

const mail = (over: Record<string, unknown>) => ({
  routing_status: "assigned",
  run_status: "parsed",
  waiting_for_slot: false,
  found: { nothingToRecord: false },
  triage: "open",
  ...over,
});

function overview(inbox: unknown) {
  const over: { summary?: Record<string, number>; documents?: unknown[]; runs?: unknown[] } = {};
  routes.current = {
    "/api/email-messages": inbox,
    [`/api/projects/${PROJECT}`]: {
      ok: true,
      project: {
        id: PROJECT,
        bws_project_number: "AP364",
        name: "Panther",
        client: "Argenta",
        shared_inbox: null,
        order_date: null,
        specs_agreed_by: null,
        delivery_date: null,
        default_dimension_unit: null,
        status: "active",
        archived_at: null,
        archived_by: null,
        version: 1,
      },
      completion: { records: 0, outstanding: 0, uncategorised: 0 },
      summary: {
        records: 14,
        uncategorised: 0,
        noLevel: 0,
        levelSuggested: 0,
        toQuote: 5,
        missing: 0,
        tbc: 0,
        settled: 0,
        finishes: 0,
        finishesNoKind: 0,
        documentsReading: 0,
        documentsFailed: 0,
        tgqFromMatrix: 14,
        tgqFromFallback: 0,
        ...(over.summary ?? {}),
      },
      state: "active",
      documents: over.documents ?? [
        {
          id: "import-1",
          source_kind: "boq_xlsx",
          document_kind: null,
          status: "confirmed",
          error: null,
          created_at: "2026-09-14T00:00:00.000Z",
          created_by: null,
          filename: "bill.xlsx",
          source_preserved: true,
          batch_id: "batch-1",
          batch_label: null,
          batch_created_at: "2026-09-14T00:00:00.000Z",
          specs_applied: 0,
          runs_created: 1,
          records_created: 14,
        },
      ],
      runs: over.runs ?? [
        {
          id: "run-1",
          name: "MAIN RUN",
          source_sheet: null,
          boq_revision: null,
          boq_date: null,
          header_notes: [],
          sort_order: 0,
          status: "active",
          version: 1,
          created_at: "2026-09-14T00:00:00.000Z",
          record_count: "14",
          attribute_count: "0",
        },
      ],
      notes: [],
      contactsOutstanding: { byContact: [], unassigned: {}, noLevel: {} },
      unlinkedFinishCodes: [],
      failedDocuments: 0,
    },
  };
  return render(<ProjectOverviewPage />);
}

describe("the project header's inbox link", () => {
  it("counts what the inbox's To review tab counts, and links to this project's inbox", async () => {
    overview({
      ok: true,
      messages: [
        mail({}),
        mail({ run_status: "pending", found: null }), // still reading: in To review
        mail({ found: { nothingToRecord: true } }), // nothing to record: not
        mail({ run_status: "failed", found: null }), // failed: its own queue
        mail({ triage: "not_specification" }), // ruled on: not
      ],
    });
    const link = await screen.findByRole("link", { name: "Inbox 2" });
    expect(link.getAttribute("href")).toBe(`/dashboard/inbox?project=${PROJECT}`);
    expect(asked).toContain(`/api/email-messages?projectId=${PROJECT}`);
  });

  it("leaves the link uncounted when the count cannot be read", async () => {
    overview(undefined);
    const link = await screen.findByRole("link", { name: "Inbox" });
    expect(link.getAttribute("href")).toBe(`/dashboard/inbox?project=${PROJECT}`);
  });
});
