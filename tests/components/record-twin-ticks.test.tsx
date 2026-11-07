// Edit value and Retire on a bill line with a twin (0060): the twin's row is
// offered TICKED where it says the same, sent with the version it was drawn
// at, and listed with no tick where it differs ("left alone"). Through the
// real record page, with `apiFetch` stubbed.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordPage from "@/app/dashboard/records/[id]/page";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

// This tier's 5s default is a bound about the MACHINE, and this file has gone
// red under a second concurrent suite while passing alone. See
// `tests/components/tier-timeout.ts` for the measurements and for why this is
// not the global default.
vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });


vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "rec-1" }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/records/rec-1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

function attribute(over: Record<string, unknown> = {}) {
  return {
    id: "attr-1",
    attr_group: "dimension",
    label: "Width",
    value: "1900",
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
    version: 3,
    source_page: 4,
    source_run_id: "intake-1",
    created_by: "qa",
    field_name: null,
    json_id: null,
    field_category: null,
    source_filename: "S-100.pdf",
    source_document_kind: "shop_drawings",
    ...over,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    record: {
      id: "rec-1",
      project_id: "proj-1",
      bws_project_number: "AP364",
      project_name: "Panther",
      run_id: "run-1",
      run_name: "MAIN",
      record_no: 11,
      item_description: "Sofa",
      product_reference: null,
      area: null,
      qty: 14,
      designer: null,
      category_id: null,
      category_name: null,
      category_slug: null,
      requirements_authored: false,
      level: null,
      level_suggested: null,
      level_suggested_reason: null,
      spec_description: null,
      internal_notes: null,
      status: "active",
      parent_id: null,
      variant_label: null,
      split_reason: null,
      version: 2,
      attribute_count: "1",
      refs: "S-100",
    },
    refs: [],
    attributes: [attribute()],
    retiredAttributes: [],
    answers: [],
    categories: [],
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
      toQuote: null,
      toChase: null,
      alsoOutstanding: null,
      outstanding: 0,
      settled: 0,
      notApplicable: 0,
      noLevel: true,
    },
    matrixFields: null,
    ...over,
  };
}

/** Every GET answers with the payload; writes answer with whatever is queued. */
function serve(body: Record<string, unknown>, write?: unknown) {
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) return { ok: true, status: 200, data: body };
    return write ?? { ok: true, status: 200, data: {} };
  });
}

beforeEach(() => {
  apiFetch.mockReset();
});

function twin(value: string) {
  return {
    twinId: "link-1",
    version: 1,
    reason: "Same sofa",
    createdBy: "qa",
    createdAt: "2026-11-07",
    recordId: "rec-2",
    label: "AP364-012",
    itemDescription: "Sofa",
    boqCodes: ["S-100B"],
    runId: "run-1",
    runName: "MAIN",
    area: "Example suite",
    qty: 2,
    qtyRaw: null,
    attributes: [
      {
        id: "twin-w",
        version: 5,
        attrGroup: "dimension",
        label: "Width",
        value,
        unit: "mm",
        qualifier: null,
        state: "confirmed",
        dimensionSlot: "W",
        specFieldId: null,
      },
    ],
  };
}

describe("a twin under Edit value and Retire", () => {
  it("corrects the twin's row too when it said the same", async () => {
    serve(payload({ twins: [twin("1900")] }));
    render(<RecordPage />);
    expect(await screen.findByRole("link", { name: /S-100B · Example suite/ })).toHaveAttribute("href", "/dashboard/records/rec-2");
    await userEvent.click(await screen.findByRole("button", { name: "Edit value" }));
    const tick = screen.getByRole("checkbox", { name: /Also on S-100B, which says the same/ });
    expect(tick).toBeChecked();
    await userEvent.type(screen.getByLabelText("Why"), "Misread off page 4");
    await userEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    const posts = apiFetch.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(JSON.parse(String(posts[0]![1].body)).alsoRecords).toEqual([
      { recordId: "rec-2", attributeId: "twin-w", version: 5 },
    ]);
  });

  it("leaves a twin that differs alone, with no tick", async () => {
    serve(payload({ twins: [twin("1950")] }));
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Retire" }));
    expect(screen.getByText(/S-100B reads W 1950mm: left alone\./)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.type(screen.getByPlaceholderText(/Superseded by/), "Wrong drawing");
    await userEvent.click(screen.getByRole("button", { name: "Retire it" }));
    const patches = apiFetch.mock.calls.filter((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(String(patches[0]![1].body)).alsoRecords).toBeUndefined();
  });
});
