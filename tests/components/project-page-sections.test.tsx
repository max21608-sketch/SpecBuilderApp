// The project page, section by section, before and after it was split into
// components (audit 5.3, cut B, 2026-11-07).
//
// A CHARACTERISATION, written to pin what the page does while its body moves
// into DocumentsTab, NotesCard, PhaseTabs, HistoryCard and LevelsBanner. Every
// assertion is something a person reads or a request a control sends, so a
// move that dropped a branch, a prop or a reload fails here rather than in a
// screenshot nobody compares.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectOverviewPage from "@/app/dashboard/projects/[id]/page";
import { EMPTY_SUMMARY } from "@/lib/project-summary-shape";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const PROJECT = "project-7";
const url = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-7" }),
  useSearchParams: () => new URLSearchParams(url.search),
  usePathname: () => "/dashboard/projects/project-7",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

type Call = { url: string; method: string; body: unknown };
const calls = vi.hoisted(() => [] as Call[]);
const routes = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (target: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: target, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method !== "GET") return { ok: true, status: 200, data: {} };
    const body = routes.current[target.split("?")[0]!];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

function doc(over: Record<string, unknown>) {
  return {
    id: "doc-x",
    source_kind: "spec_document",
    document_kind: "shop_drawings",
    status: "parsed",
    error: null,
    created_at: "2026-09-14T09:00:00.000Z",
    created_by: "qa",
    filename: "drawing.pdf",
    source_preserved: true,
    batch_id: "batch-1",
    batch_label: "First pack",
    batch_created_at: "2026-09-14T09:00:00.000Z",
    specs_applied: 0,
    runs_created: 0,
    records_created: 0,
    ...over,
  };
}

const RUN = {
  id: "run-1",
  name: "MAIN RUN",
  version: 4,
  source_sheet: "Seating",
  boq_revision: "B",
  boq_date: "14-Sep-26",
  header_notes: ["Prices exclude VAT"],
  bill_without_codes: true,
  record_count: "14",
  attribute_count: "3",
};

function project(over: Record<string, unknown> = {}) {
  return {
    id: PROJECT,
    bws_project_number: "T90001",
    name: "Invented Hotel",
    client: "Invented Client",
    shared_inbox: null,
    order_date: null,
    specs_agreed_by: "2026-12-01",
    delivery_date: null,
    default_dimension_unit: null,
    finish_code_prefix: null,
    status: "active",
    archived_at: null,
    archived_by: null,
    version: 3,
    ...over,
  };
}

function serve(over: { project?: Record<string, unknown>; documents?: unknown[] } = {}) {
  routes.current = {
    [`/api/projects/${PROJECT}`]: {
      project: project(over.project),
      completion: { records: 14, uncategorised: 2, outstanding: 40, complete: false },
      summary: {
        ...EMPTY_SUMMARY,
        records: 14,
        itemsWithQuestions: 12,
        uncategorised: 2,
        noLevel: 3,
        levelSuggested: 3,
        toQuote: 30,
        toQuoteItems: 8,
        projectWide: 2,
        alsoOutstandingItems: 5,
        settledItems: 1,
        missing: 20,
        tbc: 4,
        finishes: 6,
        finishesNoKind: 2,
        documentsReading: 1,
        tgqFromMatrix: 9,
        tgqFromFallback: 3,
        disagreements: 2,
        disagreementRunId: "run-1",
      },
      state: "active",
      documents: over.documents ?? [
        doc({ id: "doc-1", filename: "bill.xlsx", source_kind: "boq_xlsx", document_kind: null, status: "confirmed", runs_created: 1, records_created: 14 }),
        doc({ id: "doc-2", filename: "a.pdf", status: "failed", error: "The queue refused it" }),
        doc({ id: "doc-3", filename: "b.pdf", status: "parsed", specs_applied: 4 }),
        doc({ id: "doc-4", filename: "c.pdf", status: "confirmed", specs_applied: 7 }),
        doc({ id: "doc-5", filename: "d.pdf", status: "queued" }),
        doc({ id: "doc-6", filename: "e.pdf", status: "parsed" }),
        doc({ id: "doc-7", filename: "f.pdf", status: "parsed", created_at: "2026-09-14T10:00:00.000Z" }),
        doc({ id: "doc-8", filename: "old.pdf", batch_id: null, batch_label: null, batch_created_at: null, document_kind: "preamble", status: "confirmed", source_preserved: false }),
      ],
      runs: [RUN],
      notes: [
        { id: "note-1", topic: "Fire", title: "Flame retardancy", body: "All upholstery to an invented standard. ".repeat(4), flagged: true, source_page: 3, source_filename: "preamble.pdf", version: 1 },
        { id: "note-2", topic: "General", title: null, body: "Short.", flagged: false, source_page: null, source_filename: null, version: 2 },
      ],
      unlinkedFinishCodes: ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07"].map((code) => ({ code, records: 1 })),
      failedDocuments: 1,
      designerCodes: { DES: 4, OTHER: 1 },
    },
    [`/api/projects/${PROJECT}/contacts`]: {
      contacts: [
        { id: "c-1", name: "Invented Designer", email: "d@example.test", organisation: "Studio", role: "designer", designer_code: "DES", version: 1, capsule_party_id: null, capsule_party_type: null, capsule_synced_at: null },
      ],
    },
    [`/api/projects/${PROJECT}/contacts-outstanding`]: {
      contactsOutstanding: {
        byContact: [{ contactId: "c-1", contactName: "Invented Designer", toQuote: 3, alsoOutstanding: 2, noTier: 0 }],
        unassigned: { toQuote: 0, alsoOutstanding: 0, noTier: 0, records: 0 },
        noLevel: { toQuote: 0, alsoOutstanding: 0, noTier: 0, records: 0 },
      },
    },
    "/api/email-messages": { messages: [] },
  };
  return render(<ProjectOverviewPage />);
}

const sent = (method: string, fragment: string) =>
  calls.filter((call) => call.method === method && call.url.includes(fragment));

beforeEach(() => {
  calls.length = 0;
  url.search = "";
});

describe("the overview", () => {
  it("prints the tiles, the specification rows and the placeholder note", async () => {
    serve();
    await screen.findByRole("heading", { level: 1, name: /T90001/ });
    expect(screen.getByText("Documents disagree")).toBeInTheDocument();
    expect(screen.getByText(/3 of these 12 items are/)).toBeInTheDocument();
    expect(screen.getByText("and 1 more")).toBeInTheDocument();
    expect(screen.getByText("Still being read")).toBeInTheDocument();
    expect(screen.getAllByText(/specs due/).length).toBeGreaterThan(0);
  });

  it("accepts every suggested level in one request", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Accept 3" }));
    expect(sent("POST", "/levels/accept")[0]?.body).toEqual({ runId: null });
  });

  it("groups documents by pack, folds the sixth, and says what each produced", async () => {
    serve();
    await screen.findByText("First pack");
    expect(screen.getByText("Not part of a pack")).toBeInTheDocument();
    expect(screen.getByText("Review all 6 drawings together")).toBeInTheDocument();
    expect(screen.getByText("1 phase · 14 records")).toBeInTheDocument();
    expect(screen.queryByText("f.pdf")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "2 more in this pack" }));
    expect(screen.getByText("f.pdf")).toBeInTheDocument();
  });

  it("retries a failed specification document through /extract", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(sent("POST", "/api/imports/doc-2/extract")).toHaveLength(1);
  });

  it("opens the preamble notes, flags one and retires one", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Show the 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("Short.", { selector: "p.whitespace-pre-line" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Untitled requirement/ }));
    await userEvent.click(screen.getByRole("button", { name: "☆ Flag" }));
    expect(sent("PATCH", "/notes/note-2")[0]?.body).toEqual({ flagged: true, version: 2 });
    await userEvent.click(screen.getAllByRole("button", { name: "Retire" })[0]!);
    expect(sent("PATCH", "/notes/note-1")[0]?.body).toEqual({ status: "retired", version: 1 });
  });

  it("opens the history card's controls from its heading", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Name this point" }));
    await userEvent.click(screen.getByRole("button", { name: "Compare two points" }));
    expect(screen.getAllByText(/History/).length).toBeGreaterThan(0);
  });

  it("archives, and offers Restore on an archived project", async () => {
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Archive this project" }));
    expect(sent("PATCH", `/api/projects/${PROJECT}`)[0]?.body).toEqual({ status: "archived", version: 3 });
  });

  it("says what archiving did, with Restore it", async () => {
    serve({ project: { status: "archived", archived_at: "2026-10-01T00:00:00.000Z", archived_by: "qa" } });
    await screen.findByText(/This project is archived/);
    await userEvent.click(screen.getByRole("button", { name: "Restore it" }));
    expect(sent("PATCH", `/api/projects/${PROJECT}`)[0]?.body).toEqual({ status: "active", version: 3 });
  });
});

describe("a phase tab", () => {
  it("prints where the phase came from and retires it with a reason and its version", async () => {
    url.search = "tab=run-1";
    serve();
    await screen.findByText(/from sheet/);
    expect(screen.getByText(/The bill said: Prices exclude VAT/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retire this phase" }));
    const retire = screen.getByRole("button", { name: "Retire the phase" });
    expect(retire).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/Superseded by the Rev B bill/), "Replaced");
    await userEvent.click(retire);
    expect(sent("PATCH", "/runs/run-1")[0]?.body).toEqual({ status: "retired", reason: "Replaced", version: 4 });
  });

  it("closes the retire box on Keep it", async () => {
    url.search = "tab=run-1";
    serve();
    await userEvent.click(await screen.findByRole("button", { name: "Retire this phase" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Retire this phase" })).toBeInTheDocument();
  });
});

describe("the tabs that are also cards", () => {
  it("renders the documents card on its own tab", async () => {
    url.search = "tab=documents";
    serve();
    const card = (await screen.findAllByText("Source documents"))[0]!;
    expect(card).toBeInTheDocument();
    expect(screen.getAllByText("bill.xlsx").length).toBeGreaterThan(0);
  });

  it("renders the history card on its own tab", async () => {
    url.search = "tab=history";
    serve();
    expect((await screen.findAllByRole("button", { name: "Name this point" })).length).toBeGreaterThan(0);
  });

  it("renders the finishes tab", async () => {
    url.search = "tab=finishes";
    serve();
    await screen.findByRole("heading", { level: 1, name: /T90001/ });
    expect(within(document.body).getAllByText(/Finishes/).length).toBeGreaterThan(0);
  });
});

describe("while a document is being read", () => {
  it("polls the documents on a five-second tick, asking for the documents only", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      serve();
      await screen.findByText("First pack");
      // Count the poll's OWN request, not every GET under the project: the
      // cards mounted by the first load fetch their own slices (batches,
      // project-wide, contacts) in effects that land before this line on a
      // fast machine and inside the five-second advance on CI's runner, where
      // "before + 1" read 5 and failed run #271 (2026-11-07) with nothing
      // wrong on the page.
      const slice = () => calls.filter((call) => call.method === "GET" && call.url === `/api/projects/${PROJECT}?only=documents`);
      expect(slice().length).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      // The SLICE, not the whole payload (audit G13): the tick keeps the
      // documents and the failed count, so that is all it asks for, once.
      expect(slice().length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
