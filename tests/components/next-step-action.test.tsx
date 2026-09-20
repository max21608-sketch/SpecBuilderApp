// The next step, on the screens a person is actually on.
//
// ============================================================================
// ONE ANSWER, RENDERED THE SAME EVERYWHERE.
//
// `nextStep()`'s own precedence is proved in the pure tier. What these assert
// is the half a pure test cannot reach: that the project overview's header, the
// bill review's success state and the drawings review's Review complete box
// each print THE STEP and nothing else as their emphatic control — which is the
// whole of item 1.11. Matthew could do every one of these things and could not
// find the way in; a step visible on one screen is a step he has to know to go
// and look for.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import NextStepAction from "@/components/ui/NextStepAction";
import type { NextStep } from "@/lib/next-step";

const PROJECT = "project-9";

const search = { current: "" };
const routeId = { current: PROJECT };
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: routeId.current }),
  useSearchParams: () => new URLSearchParams(search.current),
  usePathname: () => `/dashboard/projects/${PROJECT}`,
  useRouter: () => ({ replace, push: vi.fn() }),
}));

/**
 * What each endpoint answers, matched on the PATH and never on a prefix: the
 * overview mounts half a dozen panels, and `/api/projects/<id>/history` starts
 * with `/api/projects/<id>`. Anything not named here fails the way a real
 * endpoint may, which is also how the screens' own failure paths get exercised.
 */
const routes = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string) => {
    const path = url.split("?")[0]!;
    const body = routes.current[path];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

function step(over: Partial<NextStep> = {}): NextStep {
  return {
    kind: "to_quote",
    label: "Review 14 items — 5 to-quote specs outstanding",
    href: "/dashboard/projects/project-9?tab=run-1&focus=tgq",
    count: 5,
    tone: "danger",
    pending: false,
    ...over,
  };
}

describe("the next-step control", () => {
  it("is a link that reads what it leads to", () => {
    render(<NextStepAction step={step()} />);
    const link = screen.getByRole("link", { name: "Review 14 items — 5 to-quote specs outstanding" });
    expect(link.getAttribute("href")).toBe("/dashboard/projects/project-9?tab=run-1&focus=tgq");
  });

  // A PENDING STEP IS NEVER THE PRIMARY. "Reading 3 documents…" is the true
  // answer and nobody is wanted for it; emphasising it teaches people that the
  // emphatic control sometimes does nothing.
  it("does not emphasise a step the app is doing by itself", () => {
    render(<NextStepAction step={step({ kind: "reading", label: "Reading 3 documents…", pending: true })} />);
    const link = screen.getByRole("link", { name: "Reading 3 documents…" });
    expect(link.className).not.toContain("bg-neutral-900");
    expect(link.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders nothing for a kind the screen already carries", () => {
    const { container } = render(<NextStepAction step={step({ kind: "export" })} suppress={["export"]} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when no step applies", () => {
    const { container } = render(<NextStepAction step={null} />);
    expect(container.textContent).toBe("");
  });
});

// ---- the project overview ---------------------------------------------------

import ProjectOverviewPage from "@/app/dashboard/projects/[id]/page";

function overview(over: { summary?: Record<string, number>; documents?: unknown[]; runs?: unknown[] } = {}) {
  routes.current = {
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

describe("the project overview's header", () => {
  beforeEach(() => {
    search.current = "";
  });

  it("makes the next step its primary action", async () => {
    overview();
    const link = await screen.findByRole("link", { name: "Review 14 items — 5 to-quote specs outstanding" });
    expect(link.getAttribute("href")).toBe(`/dashboard/projects/${PROJECT}?tab=run-1&focus=tgq`);
    // ONE EMPHATIC CONTROL. The step is it; Chase stays beside it, secondary.
    expect(link.className).toContain("bg-neutral-900");
    expect(screen.getByRole("link", { name: "Chase 5" }).className).not.toContain("bg-neutral-900");
  });

  // ONE PRIMARY PER BAND. The export cluster's "Spec upload" is normally the
  // emphatic control on this screen; with a step beside it two black controls
  // sat side by side and neither read as the thing to do.
  it("gives up the export cluster's emphasis while a step is showing", async () => {
    overview();
    await screen.findByRole("link", { name: "Review 14 items — 5 to-quote specs outstanding" });
    const specUpload = screen.getByText("Spec upload");
    expect(specUpload.className).not.toContain("bg-neutral-900");
  });

  it("keeps it where the step IS the export, which is suppressed", async () => {
    overview({ summary: { toQuote: 0 } });
    await screen.findByRole("link", { name: "Chase 0" });
    // Nothing else is emphatic, so the file is the thing to do and says so.
    expect(screen.getByText("Spec upload").className).toContain("bg-neutral-900");
  });

  it("asks for the pack where nothing has arrived", async () => {
    overview({ documents: [], runs: [], summary: { records: 0, toQuote: 0 } });
    const link = await screen.findByRole("link", { name: "Upload the pack" });
    expect(link.getAttribute("href")).toBe(`/dashboard/projects/${PROJECT}?tab=documents`);
  });

  it("names the failed read rather than the records behind it", async () => {
    overview({
      documents: [
        {
          id: "import-2",
          source_kind: "spec_document",
          document_kind: "shop_drawings",
          status: "failed",
          error: "the model timed out",
          created_at: "2026-09-14T00:00:00.000Z",
          created_by: null,
          filename: "S-100.pdf",
          source_preserved: true,
          batch_id: "batch-1",
          batch_label: null,
          batch_created_at: "2026-09-14T00:00:00.000Z",
          specs_applied: 0,
          runs_created: 0,
          records_created: 0,
        },
      ],
      summary: { documentsFailed: 1 },
    });
    const link = await screen.findByRole("link", { name: "Retry the failed read" });
    expect(link.getAttribute("href")).toBe(`/dashboard/projects/${PROJECT}/intake/batch-1`);
  });

  // THE EXPORT CLUSTER IS ALREADY IN THIS BAND. A second control saying the
  // same thing would make this the one header in the app with two primaries.
  it("leaves the export to the export cluster", async () => {
    overview({ summary: { toQuote: 0 } });
    await screen.findByRole("link", { name: "Chase 0" });
    expect(screen.queryByRole("link", { name: "Export" })).toBeNull();
  });
});

// ---- the bill review's success state ----------------------------------------

import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

describe("a bill that is already confirmed", () => {
  beforeEach(() => {
    search.current = "";
    routeId.current = "import-1";
  });

  // THE OTHER HALF OF THE CONFIRM. Confirming pushes straight to the phase
  // tabs, where the header's primary is this same step. This is the screen
  // somebody comes BACK to: it said "This import has already been confirmed"
  // and offered nothing to do about it.
  it("says what to do next instead of only that it is done", async () => {
    routes.current = {
      "/api/imports/import-1": {
        ok: true,
        import: {
          id: "import-1",
          status: "confirmed",
          version: 2,
          error: null,
          source_kind: "boq_xlsx",
          document_kind: null,
          project_id: PROJECT,
          bws_project_number: "AP364",
          project_name: "Panther",
          filename: "bill.xlsx",
          parsed: { schemaVersion: 3, filename: "bill.xlsx", sourcePreserved: true, sheets: [] },
        },
        runs: [],
        reconciliation: {},
      },
      [`/api/projects/${PROJECT}`]: {
        ok: true,
        summary: { records: 14, uncategorised: 6, toQuote: 40, documentsReading: 0, documentsFailed: 0 },
        documents: [
          { id: "import-1", status: "confirmed", source_kind: "boq_xlsx", document_kind: null, batch_id: "batch-1" },
        ],
        runs: [{ id: "run-1" }],
      },
    };
    render(<ReviewImportPage />);
    expect(await screen.findByText("This import has already been confirmed.")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Categorise 6 items" });
    expect(link.getAttribute("href")).toBe(`/dashboard/projects/${PROJECT}?tab=run-1&focus=no_category`);
  });
});
