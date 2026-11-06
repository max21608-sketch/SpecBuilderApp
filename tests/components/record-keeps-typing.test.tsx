// The record screen keeps what is being typed (audit G2, G3, G9, 2026-11-06).
//
// G2. Every checklist input was keyed on the page's reload counter, which every
// save bumps. Type in A, tab to B, type: A's reload lands, every input
// remounts, B shows the server's value and the typed text is gone with no blur
// to save it. CLAUDE.md records this trap for the details panel.
//
// G3. A qualifier-only edit on a configuration's differing fields that needed a
// reason was replayed WITHOUT the qualifier when the reason was given, and the
// box closed as though it had saved.
//
// G9. The page component is reused across record ids, so an open correction on
// one record was still open on the next, over the previous record's data,
// until the fetch landed.
//
// Rendered through the real page with the network mocked. Invented values.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordPage from "@/app/dashboard/records/[id]/page";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const nav = vi.hoisted(() => ({ id: "rec-1", search: "tab=checklist" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: nav.id }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => `/dashboard/records/${nav.id}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

type Answer = { ok: boolean; status: number; error?: string; data: unknown };
const server = vi.hoisted(() => ({
  calls: [] as { url: string; method: string; body: Record<string, unknown> | null }[],
  payloads: {} as Record<string, unknown>,
  /** Writes are answered in order from here; an empty queue holds the write open. */
  answers: [] as Answer[],
  held: [] as ((answer: Answer) => void)[],
  /** A GET for these ids is held open too. */
  holdGet: new Set<string>(),
}));

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    server.calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET") {
      const id = url.match(/^\/api\/records\/([^/?]+)$/)?.[1];
      if (id && server.payloads[id]) {
        if (server.holdGet.has(id)) return new Promise(() => undefined);
        return { ok: true, status: 200, data: server.payloads[id] };
      }
      return { ok: false, status: 404, error: "not here", data: null };
    }
    const next = server.answers.shift();
    if (next) return next;
    return new Promise<Answer>((resolve) => server.held.push(resolve));
  },
}));

function answer(over: Record<string, unknown>) {
  return {
    requirement_id: "q",
    kind: "spec_field",
    prompt: "A question",
    help_text: null,
    section: "Upholstery",
    tgq_levels: ["simple", "complex", "hero"],
    field_name: null,
    json_id: null,
    field_category: null,
    answer_id: "a",
    value: null,
    qualifier: null,
    state: "missing",
    version: 1,
    local_key: null,
    confirmed_by: null,
    confirmed_at: null,
    ...over,
  };
}

function payload(id: string, description: string, over: { record?: Record<string, unknown>; answers?: unknown[] } = {}) {
  return {
    ok: true,
    record: {
      id,
      project_id: "proj-1",
      bws_project_number: "ZZ900",
      project_name: "Invented",
      run_id: "run-1",
      run_name: "MAIN",
      record_no: 11,
      item_description: description,
      product_reference: null,
      area: null,
      qty: 4,
      designer: null,
      category_id: "cat-1",
      category_name: "Armchairs",
      category_slug: "armchairs",
      requirements_authored: false,
      level: "simple",
      level_suggested: null,
      level_suggested_reason: null,
      spec_description: null,
      internal_notes: null,
      dimension_note: null,
      status: "active",
      parent_id: null,
      variant_label: null,
      split_reason: null,
      version: 2,
      attribute_count: "1",
      refs: "ZZ-100",
      ...over.record,
    },
    refs: [],
    attributes: [
      {
        id: `${id}-attr`,
        attr_group: "dimension",
        label: "Width",
        value: "900",
        unit: "mm",
        qualifier: null,
        finish_id: null,
        finish_code: null,
        finish_description: null,
        finish_state: null,
        dimension_slot: "W",
        material_code: null,
        state: "confirmed",
        sort_order: 0,
        version: 1,
        source_page: 2,
        source_run_id: "intake-1",
        created_by: "qa",
        field_name: null,
        json_id: null,
        field_category: null,
        source_filename: "ZZ.pdf",
        source_document_kind: "shop_drawings",
      },
    ],
    retiredAttributes: [],
    answers: over.answers ?? [],
    categories: [{ id: "cat-1", name: "Armchairs" }],
    specFields: [],
    palettes: [],
    paletteByQuestion: [],
    family: [],
    gates: null,
    tgqMatrix: null,
    waiting: {},
    designerContact: null,
    designerContactAmbiguous: false,
    quoteReadiness: {
      toQuote: 0,
      toChase: 0,
      alsoOutstanding: 0,
      outstanding: 2,
      settled: 0,
      notApplicable: 0,
      noLevel: false,
    },
    matrixFields: null,
  };
}

beforeEach(() => {
  server.calls = [];
  server.payloads = {};
  server.answers = [];
  server.held = [];
  server.holdGet = new Set();
  nav.id = "rec-1";
  nav.search = "tab=checklist";
});

describe("the checklist keeps what is being typed (G2)", () => {
  it("a reload after A's save leaves the text typed into B", async () => {
    const a = answer({ requirement_id: "qa", answer_id: "ans-a", prompt: "Seat upholstery build" });
    const b = answer({ requirement_id: "qb", answer_id: "ans-b", prompt: "Stitching spec" });
    server.payloads["rec-1"] = payload("rec-1", "Armchair", { answers: [a, b] });
    render(<RecordPage />);

    const boxes = await screen.findAllByPlaceholderText("Value");
    expect(boxes).toHaveLength(2);
    await userEvent.type(boxes[0]!, "Fixed seat");
    await userEvent.tab();
    await waitFor(() => expect(server.held).toHaveLength(1));
    await userEvent.type(screen.getAllByPlaceholderText("Value")[1]!, "Plain stitch");

    // A's save lands; the reload brings A back at version 2.
    server.payloads["rec-1"] = payload("rec-1", "Armchair", {
      answers: [{ ...a, value: "Fixed seat", state: "confirmed", version: 2 }, b],
    });
    await act(async () => {
      server.held[0]!({ ok: true, status: 200, data: {} });
    });
    await waitFor(() => expect(server.calls.filter((call) => call.method === "GET").length).toBeGreaterThan(1));

    const after = screen.getAllByPlaceholderText("Value") as HTMLInputElement[];
    expect(after[0]!.value).toBe("Fixed seat");
    expect(after[1]!.value).toBe("Plain stitch");
  });

  it("a refused save puts that one box back to what the server holds", async () => {
    const a = answer({ requirement_id: "qa", answer_id: "ans-a", prompt: "Seat upholstery build" });
    server.payloads["rec-1"] = payload("rec-1", "Armchair", { answers: [a] });
    server.answers = [{ ok: false, status: 409, error: "That answer was edited elsewhere.", data: null }];
    render(<RecordPage />);
    const box = await screen.findByPlaceholderText("Value");
    await userEvent.type(box, "Fixed seat");
    await userEvent.tab();
    expect(await screen.findByText("That answer was edited elsewhere.")).toBeTruthy();
    expect((screen.getByPlaceholderText("Value") as HTMLInputElement).value).toBe("");
  });
});

describe("a qualifier that needs a reason (G3)", () => {
  it("is carried through the reason box", async () => {
    nav.search = "tab=specs";
    const com1 = answer({
      requirement_id: "q-com1",
      answer_id: "ans-com1",
      prompt: "COM 1",
      field_name: "COM 1",
      json_id: 1,
      value: "Invented velvet",
      state: "confirmed",
      version: 3,
    });
    server.payloads["rec-1"] = payload("rec-1", "Armchair", {
      record: { parent_id: "rec-0", variant_label: "A" },
      answers: [com1],
    });
    server.answers = [
      { ok: false, status: 400, error: "Say why.", data: { ok: false, code: "reason_required", error: "Say why." } },
      { ok: true, status: 200, data: {} },
    ];
    render(<RecordPage />);
    const where = await screen.findByPlaceholderText("Where on the item");
    await userEvent.type(where, "Seat and back");
    await userEvent.tab();
    await userEvent.type(await screen.findByPlaceholderText("Hayley confirmed the new fabric on 14 Sep"), "Client email");
    await userEvent.click(screen.getByRole("button", { name: "Save the change" }));

    await waitFor(() => expect(server.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    const [first, second] = server.calls.filter((call) => call.method === "PATCH");
    expect(first!.body!.qualifier).toBe("Seat and back");
    expect(second!.body).toMatchObject({ qualifier: "Seat and back", reason: "Client email", value: "Invented velvet" });
  });
});

describe("moving to another record (G9)", () => {
  it("drops the open correction and the old record's data", async () => {
    nav.search = "tab=specs";
    server.payloads["rec-1"] = payload("rec-1", "Armchair one");
    server.payloads["rec-2"] = payload("rec-2", "Armchair two");
    server.holdGet.add("rec-2");
    const view = render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit value" }));
    expect(await screen.findByRole("button", { name: "Save the correction" })).toBeTruthy();

    nav.id = "rec-2";
    view.rerender(<RecordPage />);
    await waitFor(() => expect(server.calls.some((call) => call.url === "/api/records/rec-2")).toBe(true));
    expect(screen.queryByRole("button", { name: "Save the correction" })).toBeNull();
    expect(screen.queryByText("Armchair one")).toBeNull();
  });
});
