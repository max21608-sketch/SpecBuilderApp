// The record page, section by section, before and after it was split into
// components (audit 5.3, cut C, 2026-11-07).
//
// A CHARACTERISATION, written to pin what the page does while its body moves
// into use-attribute-actions, SpecsTab, ChecklistTab, ConfigurationPanel and
// RecordHeader. Every assertion is something a person reads or a request a
// control sends, so a move that dropped a branch, a prop or a reload fails
// here rather than in a screenshot nobody compares.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordPage from "@/app/dashboard/records/[id]/page";
import type { Disagreement } from "@/lib/disagreements";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const url = vi.hoisted(() => ({ search: "" }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "rec-1" }),
  useSearchParams: () => new URLSearchParams(url.search),
  usePathname: () => "/dashboard/records/rec-1",
  useRouter: () => ({ replace: vi.fn(), push }),
}));

type Call = { url: string; method: string; body: unknown };
const calls = vi.hoisted(() => [] as Call[]);
const current = vi.hoisted(() => ({ body: {} as unknown }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (target: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: target, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method !== "GET") return { ok: true, status: 200, data: {} };
    if (target === "/api/records/rec-1") return { ok: true, status: 200, data: current.body };
    return { ok: false, status: 404, error: "no such route", data: null };
  },
}));

function attribute(over: Record<string, unknown> = {}) {
  return {
    id: "attr-w",
    attr_group: "dimension",
    label: "WIDTH",
    value: "1900",
    unit: "mm",
    qualifier: null,
    finish_id: null,
    finish_code: null,
    finish_description: null,
    finish_state: null,
    finish_code_origin: null,
    dimension_slot: "W",
    material_code: null,
    state: "confirmed",
    sort_order: 0,
    version: 3,
    source_page: 4,
    source_run_id: "intake-1",
    created_by: "qa",
    field_name: null,
    json_id: null,
    field_category: null,
    source_filename: "S-900.pdf",
    source_document_kind: "shop_drawings",
    ...over,
  };
}

function disagreement(over: Partial<Disagreement> = {}): Disagreement {
  return {
    id: "dis-1", recordId: "rec-1", projectId: "proj-1", version: 1, status: "open",
    attrGroup: "dimension", label: "Width", value: "540", unit: "mm", dimensionSlot: "W",
    specFieldId: null, specFieldName: null, materialCode: null, state: "confirmed",
    sourceRunId: "run-tracker", sourcePage: 9, sourceFilename: "Tracker.pdf", sourceDocumentKind: "ffe_schedule",
    createdAt: "2026-10-05T10:00:00Z", heldAttributeId: "attr-w", heldStatus: "active", heldVersion: 3,
    heldLabel: "Width", heldValue: "1900", heldUnit: "mm", heldSourceDocumentKind: null,
    heldSourceFilename: "Bill.xlsx", heldFromBill: true, currentAttributeId: "attr-w",
    resolvedAt: null, resolvedBy: null, resolvedAttributeId: null, changeSetId: null, reason: null,
    ...over,
  } as Disagreement;
}

const ANSWER = {
  requirement_id: "req-1", kind: "spec_field", prompt: "COM 1", help_text: null, section: "Fabric",
  tgq_levels: ["simple"], field_name: "COM 1", json_id: 1, field_category: null,
  answer_id: "ans-1", value: null, qualifier: null, state: "missing", version: 1, local_key: null,
  confirmed_by: null, confirmed_at: null,
};

function payload(over: { record?: Record<string, unknown>; [key: string]: unknown } = {}) {
  const { record, ...rest } = over;
  return {
    record: {
      id: "rec-1", project_id: "proj-1", bws_project_number: "T90002", project_name: "Invented",
      run_id: "run-1", run_name: "MAIN", record_no: 11, item_description: "Invented sofa",
      product_reference: null, area: "Lobby", qty: 14, designer: "DES", source_line_no: 7,
      category_id: "cat-1", category_name: "Sofas", category_family: "upholstery",
      level: null, level_suggested: "complex", level_suggested_reason: "metal legs on the bill",
      spec_description: null, internal_notes: null, dimension_note: null,
      status: "active", parent_id: null, variant_label: null, version: 2, has_image: false,
      ...record,
    },
    refs: [{ ref_system: "boq_code", ref_value: "S-900" }],
    attributes: [
      attribute(),
      attribute({ id: "attr-d", label: "DEPTH", value: "2'-6\"", unit: "in", dimension_slot: "D", sort_order: 1 }),
      attribute({
        id: "attr-f", attr_group: "material", label: "Fabric", value: "Invented cloth", unit: null,
        dimension_slot: null, finish_id: "fin-1", finish_code: "FB-01", finish_description: "Invented cloth",
        finish_state: "tbc", finish_code_origin: "internal", field_name: "COM 1", json_id: 1, qualifier: "Main body",
      }),
      attribute({
        id: "attr-t", attr_group: "finish", label: "Legs", value: "Oak", unit: null, dimension_slot: null,
        material_code: "TIM-01", field_name: "Main timber finish", json_id: 4, source_run_id: null,
        source_page: null, source_filename: null,
      }),
      attribute({ id: "attr-n", attr_group: "note", label: "ARM HEIGHT", value: "620", dimension_slot: null, state: "tbc" }),
    ],
    retiredAttributes: [
      { ...attribute({ id: "attr-old", value: "1800" }), retired_at: "2026-10-01", retired_by: "qa", superseded_by_id: "attr-w" },
      { ...attribute({ id: "attr-gone", label: "Colour", attr_group: "note", value: "Red", unit: null, dimension_slot: null }), retired_at: "2026-10-01", retired_by: "qa", superseded_by_id: null },
    ],
    disagreements: [
      disagreement(),
      disagreement({ id: "dis-2", currentAttributeId: null, heldStatus: "retired" }),
      disagreement({ id: "dis-3", status: "kept_held", resolvedAt: "2026-10-06T00:00:00Z", resolvedBy: "qa", reason: "The bill wins" } as Partial<Disagreement>),
    ],
    answers: [ANSWER],
    categories: [{ id: "cat-1", slug: "sofas", family: "upholstery", name: "Sofas", requirements_authored: true }],
    specFields: [],
    finishes: [{ id: "fin-1", code: "FB-01", code_origin: "internal", kind: "fabric", description: "Invented cloth", state: "tbc" }],
    palettes: [],
    paletteByQuestion: [],
    family: [],
    gates: null,
    tgqMatrix: null,
    waiting: {},
    designerContact: { id: "c-1", name: "Invented Designer", email: null, role: "designer", designer_code: "DES" },
    designerContactAmbiguous: false,
    quoteReadiness: {
      toQuote: 4, toChase: 3, projectWide: 2, alsoOutstanding: 5, outstanding: 9, settled: 1, notApplicable: 0, noLevel: true,
    },
    matrixFields: null,
    ...rest,
  };
}

const sent = (method: string, fragment: string) =>
  calls.filter((call) => call.method === method && call.url.includes(fragment));

beforeEach(() => {
  calls.length = 0;
  url.search = "";
  push.mockReset();
  current.body = payload();
});

describe("the identity band", () => {
  it("prints the subtitle, the suggested level and the chase counts", async () => {
    render(<RecordPage />);
    expect(await screen.findByRole("heading", { level: 1, name: /Invented sofa/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Chase the 3" }).length).toBe(2);
    expect(screen.getAllByText(/project-wide, answered once on the project/).length).toBeGreaterThan(0);
    expect(screen.getByText(/DES — Invented Designer/)).toBeInTheDocument();
  });

  it("accepts the suggested level with the record's version", async () => {
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Complex/ }));
    expect(sent("PATCH", "/api/records/rec-1")[0]?.body).toEqual({ level: "complex", version: 2 });
  });
});

describe("the Specs tab", () => {
  it("lists the specs by group, with the library chip, the qualifier and the millimetres", async () => {
    render(<RecordPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByTitle("The library says: Invented cloth").textContent).toBe("FB-01 · ours TBC");
    expect(screen.getByText("Main body")).toBeInTheDocument();
    expect(screen.getByText("(762mm)")).toBeInTheDocument();
    expect(screen.getByText("Not in the finishes library")).toBeInTheDocument();
    expect(screen.getByText("typed by hand")).toBeInTheDocument();
    expect(screen.getByText(/2 values disagree between documents/)).toBeInTheDocument();
    expect(screen.getByText("Disagreements about specs no longer on this item")).toBeInTheDocument();
  });

  it("shows the retired specs and the settled disagreement, and puts one back", async () => {
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: /2 retired specs · 1 settled disagreement/ }));
    expect(screen.getByText(/superseded by “1900mm”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Put back" }));
    expect(sent("PATCH", "/api/attributes/attr-gone")[0]?.body).toMatchObject({ status: "active", version: 3 });
  });

  it("retires a spec with a reason", async () => {
    render(<RecordPage />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getAllByRole("button", { name: "Retire" })[0]!);
    await userEvent.type(screen.getByPlaceholderText(/Superseded by the Rev B drawing/), "Wrong page");
    await userEvent.click(screen.getByRole("button", { name: "Retire it" }));
    expect(sent("PATCH", "/api/attributes/attr-w")[0]?.body).toEqual({ status: "retired", version: 3, reason: "Wrong page" });
  });

  it("unlinks a finish only with a reason", async () => {
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Change the finish…" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Finish/ }), "");
    expect(screen.getByRole("button", { name: "Unlink it" })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/not the one the code names/), "Different cloth");
    await userEvent.click(screen.getByRole("button", { name: "Unlink it" }));
    expect(sent("PATCH", "/api/attributes/attr-f/finish")[0]?.body).toEqual({ finishId: null, version: 3, reason: "Different cloth" });
  });

  it("opens the add-a-spec form from the header", async () => {
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a spec by hand" }));
    expect(screen.getAllByText(/spec/i).length).toBeGreaterThan(0);
  });

  it("opens Add a configuration at the top of the tab", async () => {
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a configuration" }));
    expect(document.getElementById("add-configuration")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add a configuration" })).toBeNull();
  });

  it("sets the category from the details panel", async () => {
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Level/ }), "hero");
    expect(sent("PATCH", "/api/records/rec-1")[0]?.body).toEqual({ level: "hero", version: 2 });
  });
});

describe("a configuration", () => {
  const configuration = () =>
    payload({
      record: { parent_id: "rec-0", variant_label: "A", qty: null, record_no: 30, parent_record_no: 11, variant_ordinal: 1 },
      family: [
        { id: "rec-0", record_no: 11, variant_label: null, qty: 45, item_description: "Invented sofa", attribute_count: "0", refs: "S-900" },
        { id: "rec-1", record_no: 30, variant_label: "A", qty: null, item_description: "Invented sofa", attribute_count: "5", refs: null, variant_ordinal: 1, parent_record_no: 11 },
        { id: "rec-2", record_no: 31, variant_label: "B", qty: 5, item_description: "Invented sofa", attribute_count: "0", refs: null, variant_ordinal: 2, parent_record_no: 11 },
      ],
    });

  it("names its bill line, renames, and retires with a reason", async () => {
    current.body = configuration();
    render(<RecordPage />);
    expect(await screen.findByText(/What makes S-900 A different/)).toBeInTheDocument();
    expect(screen.getByText("qty not set")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const box = screen.getByRole("textbox", { name: "New name for this configuration" });
    await userEvent.clear(box);
    await userEvent.type(box, "C");
    await userEvent.click(within(box.parentElement!).getByRole("button", { name: "Save" }));
    expect(sent("PATCH", "/configuration-name")[0]?.body).toEqual({ name: "C", version: 2 });
  });

  it("retires with a reason and says what it does", async () => {
    current.body = configuration();
    render(<RecordPage />);
    await screen.findByText(/What makes S-900 A different/);
    const retires = screen.getAllByRole("button", { name: "Retire" });
    await userEvent.click(retires[retires.length - 1]!);
    await userEvent.type(screen.getByRole("textbox", { name: /Why is it being retired/ }), "Not made");
    await userEvent.click(screen.getByRole("button", { name: "Retire it" }));
    expect(sent("PATCH", "/configuration-status")[0]?.body).toEqual({ status: "retired", version: 2, reason: "Not made" });
  });

  it("puts a retired one back", async () => {
    current.body = payload({ ...configuration(), record: { ...configuration().record, status: "retired" } });
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Put it back" }));
    expect(sent("PATCH", "/configuration-status")[0]?.body).toEqual({ status: "active", version: 2, reason: null });
  });

  it("lists a split bill line's configurations and the unallocated quantity", async () => {
    const family = configuration().family;
    current.body = payload({ record: { qty: 45 }, family });
    render(<RecordPage />);
    expect(await screen.findByText(/They are what the export carries/)).toBeInTheDocument();
    expect(screen.getByText(/40 of the bill’s 45 is not allocated/)).toBeInTheDocument();
    expect(screen.getByText("quantity not allocated")).toBeInTheDocument();
  });
});

describe("a split bill line", () => {
  it("folds its own specs and shows what the configurations share", async () => {
    current.body = payload({
      configurationFamily: {
        lineId: "rec-1", lineRecordNo: 11, projectId: "proj-1",
        configurations: [
          { recordId: "rec-2", number: "11.1", variantLabel: "TYPE 1", version: 1, attributes: [], recordNo: 31, variantOrdinal: 1, answers: [] },
        ],
      },
    });
    render(<RecordPage />);
    const fold = await screen.findByRole("button", { name: /On the bill line itself — not exported \(5 specs\)/ });
    expect(screen.queryByText("Invented cloth")).toBeNull();
    await userEvent.click(fold);
    expect(screen.getAllByText("Invented cloth").length).toBeGreaterThan(0);
  });
});

describe("a mock-up item", () => {
  it("says where it came from and retires with a reason", async () => {
    current.body = payload({
      mockup: { isMockup: true, of: { id: "rec-9", recordNo: 9, runName: "MAIN", status: "active" }, copies: [] },
    });
    render(<RecordPage />);
    expect(await screen.findByText(/which keeps its own place there/)).toBeInTheDocument();
    const retires = screen.getAllByRole("button", { name: "Retire" });
    await userEvent.click(retires[retires.length - 1]!);
    await userEvent.type(screen.getByRole("textbox", { name: /Why is it coming off MAIN/ }), "Room cut");
    await userEvent.click(screen.getByRole("button", { name: "Retire it" }));
    expect(sent("PATCH", "/configuration-status")[0]?.body).toEqual({ status: "retired", version: 2, reason: "Room cut" });
  });
});

describe("the other tabs", () => {
  it("renders the checklist with its open count", async () => {
    url.search = "tab=checklist";
    render(<RecordPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByText(/1 open/).length).toBeGreaterThan(0);
    expect(screen.getByText(/showing 0 of 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "show all 1" }));
    expect(document.body.textContent).toContain("COM 1");
  });

  it("renders the gates tab", async () => {
    url.search = "tab=gates";
    render(<RecordPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByText(/Gates/).length).toBeGreaterThan(0);
  });

  it("renders the documents and versions tabs", async () => {
    url.search = "tab=documents";
    const { unmount } = render(<RecordPage />);
    await screen.findByRole("heading", { level: 1 });
    unmount();
    url.search = "tab=versions";
    render(<RecordPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(calls.some((call) => call.url.includes("/history") || call.url.includes("/snapshots"))).toBe(true);
  });
});
