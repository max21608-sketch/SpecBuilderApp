// The fill-in page: the area card and the open rows beside it (chase review
// C3 and C7, 2026-11-21).
//
// C7: an area save reloaded only the summary, so a line left open still held
// the question the card had just answered, with its old version — the next
// edit there was refused once for a reason nobody could see. And a row save
// did not reload the card, so its next press was refused whole once ("the
// items … changed since this card loaded"). Both were safe and both read as
// faults. Each now reloads the other.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InfillPage from "@/app/dashboard/projects/[id]/infill/page";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "p1" }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/projects/p1/infill",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

type Call = { url: string; method: string; body: unknown };
const calls = vi.hoisted(() => [] as Call[]);

const lineSummary = {
  lineId: "line-1",
  recordLabel: "T1-001",
  code: "S-301",
  itemDescription: "Desk chair",
  qty: 4,
  runId: "run-1",
  runName: "MAIN RUN",
  level: "simple",
  area: "Restaurant",
  counts: { toQuote: 1, later: 0, waiting: 0 },
  states: { missing: 1, tbc: 0 },
  optionCount: 0,
  options: [],
};

const question = {
  recordId: "line-1",
  requirementId: "req-1",
  recordLabel: "T1-001",
  itemDescription: "Desk chair",
  variantLabel: null,
  area: "Restaurant",
  prompt: "Main fabric",
  fieldLabel: "COM 1",
  section: "Upholstery",
  jsonId: 1,
  localKey: null,
  requirementKind: "spec_field",
  tier: "to_quote",
  state: "missing",
  currentValue: null,
  answerId: "ans-1",
  answerVersion: 1,
  waiting: null,
  sisters: [],
  finishNote: null,
  dimensions: null,
  composed: null,
  audience: "client",
  seedAudience: "client",
  questionKey: "field:1",
};

const areaQuestion = {
  key: "area:restaurant\u0000field:130",
  area: "Restaurant",
  heading: "Indoor/ Outdoor",
  fieldLabel: null,
  rows: [
    {
      recordId: "line-1",
      recordLabel: "T1-001",
      itemDescription: "Desk chair",
      requirementId: "req-130",
      answerId: "ans-130",
      answerVersion: 1,
      state: "missing",
      value: null,
      tier: "to_quote",
      specShips: null,
      projection: false,
    },
  ],
  items: 1,
  settled: 0,
  outstanding: 1,
  toQuoteOutstanding: 1,
  tier: "to_quote",
  values: [],
  palette: null,
  phases: [{ runId: "run-1", name: "MAIN RUN", items: 1 }],
};

const summary = {
  project: { id: "p1", bws_project_number: "T1", name: "Test" },
  provisionalNotes: [],
  lines: [lineSummary],
  questions: [],
  questionAreas: [],
  phases: [
    { id: "run-1", name: "MAIN RUN" },
    { id: "run-2", name: "MUR" },
  ],
  totals: { questions: 1, toQuote: 1, projectWide: 0, later: 0, noLevel: 0, waiting: 0 },
  uncategorised: [],
  categories: [],
  palettes: [],
  paletteByQuestion: [],
};

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (target: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: target, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET") {
      if (target === "/api/projects/p1/infill") return { ok: true, status: 200, data: summary };
      if (target === "/api/projects/p1/infill?line=line-1") return { ok: true, status: 200, data: { questions: [question] } };
      if (target.startsWith("/api/projects/p1/area-wide")) return { ok: true, status: 200, data: { questions: [areaQuestion] } };
      if (target === "/api/projects/p1/changes") return { ok: true, status: 200, data: { open: null } };
    }
    if (method === "POST" && target === "/api/projects/p1/area-wide") {
      return { ok: true, status: 200, data: { written: 1, overridden: 0, records: 1 } };
    }
    if (method === "PATCH" && target === "/api/answers/ans-1") {
      return { ok: true, status: 200, data: { answer: { id: "ans-1", version: 2, value: "Velvet", state: "confirmed" } } };
    }
    return { ok: false, status: 404, error: "no such route", data: null };
  },
}));

const count = (url: string, method = "GET") => calls.filter((call) => call.url === url && call.method === method).length;

beforeEach(() => {
  calls.length = 0;
});

describe("the fill-in page", () => {
  it("re-reads every open line after an area save, so the next edit there is not refused for a stale version", async () => {
    const user = userEvent.setup();
    render(<InfillPage />);
    await user.click(await screen.findByText("Desk chair"));
    await screen.findByText("Main fabric");
    expect(count("/api/projects/p1/infill?line=line-1")).toBe(1);

    await user.click(await screen.findByText("Answer"));
    const boxes = screen.getAllByPlaceholderText("Value");
    // The card's box is the one inside the area card's form, opened last.
    await user.type(boxes[0]!, "Indoor");
    await user.tab();
    await user.click(screen.getByRole("button", { name: /^Save on 1 item/ }));

    await waitFor(() => expect(count("/api/projects/p1/area-wide", "POST")).toBe(1));
    await waitFor(() => expect(count("/api/projects/p1/infill?line=line-1")).toBe(2));
  });

  it("re-reads the area card after a row save, so its next press is not refused whole", async () => {
    const user = userEvent.setup();
    render(<InfillPage />);
    await screen.findByText("Restaurant", { selector: "span" });
    expect(count("/api/projects/p1/area-wide")).toBe(1);

    await user.click(await screen.findByText("Desk chair"));
    await user.type(await screen.findByPlaceholderText("Value"), "Velvet");
    await user.tab();

    await waitFor(() => expect(count("/api/answers/ans-1", "PATCH")).toBe(1));
    await waitFor(() => expect(count("/api/projects/p1/area-wide")).toBe(2));
  });

  // C3: the phase filter on "By item" reaches the card.
  it("hands the By item phase filter to the area card", async () => {
    const user = userEvent.setup();
    render(<InfillPage />);
    await user.selectOptions(await screen.findByLabelText("Filter by phase"), "run-2");
    await waitFor(() => expect(count("/api/projects/p1/area-wide?runId=run-2")).toBe(1));
    expect(await screen.findByText(/Filtered to the phase MUR/)).toBeInTheDocument();
  });
});
