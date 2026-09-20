// The Correct control on the record's Specs tab.
//
// ============================================================================
// THE CONTROL LIVES BESIDE THE VALUE, AND IT HAD TO BE FINDABLE.
//
// Matthew went looking for confirm-or-update on a confirmed record and neither
// he nor Max found it, because there was no such verb: a spec could be RETIRED
// or a new one TYPED with no page. What these assert is the half a db-tier test
// cannot reach — that the control is on every active row, that opening it fills
// the boxes in with what the row currently says, that Save posts ONCE, and that
// a response which is not JSON leaves the button alive.
//
// PRE-FILLING IS RIGHT HERE and the level picker's trap does not apply: that
// rule is about a control whose ACTION is the selection, where a select already
// reading "Simple" fires no change event when somebody picks Simple. The action
// here is the Save.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordPage from "@/app/dashboard/records/[id]/page";

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

describe("correcting a spec from the record", () => {
  it("offers Correct beside Retire on every active spec", async () => {
    serve(payload());
    render(<RecordPage />);
    expect(await screen.findByRole("button", { name: "Correct" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retire" })).toBeTruthy();
  });

  // A RETIRED ROW IS HISTORY. Correcting one would assert a replacement for a
  // statement nobody is standing behind any more; the way back is Put back.
  it("offers neither on a retired spec", async () => {
    serve(
      payload({
        attributes: [],
        retiredAttributes: [
          { ...attribute({ id: "attr-old" }), retired_at: "2026-09-19", retired_by: "max", superseded_by_id: null },
        ],
      }),
    );
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: /retired spec/ }));
    expect(await screen.findByRole("button", { name: "Put back" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
  });

  it("opens filled in with what the row currently says", async () => {
    serve(payload());
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Correct" }));
    expect((await screen.findByLabelText("Value")) as HTMLInputElement).toHaveValue("1900");
    expect(screen.getByLabelText("Unit")).toHaveValue("mm");
    expect(screen.getByLabelText("State")).toHaveValue("confirmed");
    // NOT pre-filled: the reason is the one thing nobody can guess, and a
    // default would be twenty rows in the trail reading the same sentence.
    expect(screen.getByLabelText("Why")).toHaveValue("");
    // And Save is refused until there is one, the way Retire is.
    expect(screen.getByRole("button", { name: "Save the correction" })).toBeDisabled();
  });

  it("posts the correction once, with the version it was opened at", async () => {
    serve(payload());
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Correct" }));
    const value = await screen.findByLabelText("Value");
    await userEvent.clear(value);
    await userEvent.type(value, "1090");
    await userEvent.type(screen.getByLabelText("Why"), "Misread off page 4");
    await userEvent.click(screen.getByRole("button", { name: "Save the correction" }));

    const posts = apiFetch.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe("/api/attributes/attr-1/correct");
    expect(JSON.parse(String(posts[0]![1].body))).toMatchObject({
      value: "1090",
      unit: "mm",
      state: "confirmed",
      version: 3,
      reason: "Misread off page 4",
    });
  });

  // THE UI MUST SURVIVE A RESPONSE THAT IS NOT JSON. `apiFetch` already turns
  // an HTML error page into `ok: false`; what must not happen is the busy flag
  // sticking, which leaves the one control on the panel dead with no way back.
  it("keeps the button alive when the server answers with something else", async () => {
    serve(payload(), {
      ok: false,
      status: 500,
      error: "The server returned an error (500). Try again, or check the deployment logs.",
      data: null,
    });
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Correct" }));
    await userEvent.type(await screen.findByLabelText("Why"), "Misread");
    await userEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    // RELOADED FIRST, REPORTED AFTER — the message survives the reload the
    // refusal triggered rather than flashing for a few milliseconds.
    expect(await screen.findByText(/server returned an error/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save the correction" });
    expect(save).toBeEnabled();
    // And the panel is still open, so the typed correction is not lost.
    expect(screen.getByLabelText("Value")).toBeTruthy();
  });

  // A FABRIC CARRIES NO UNIT. 0007 refuses one on anything but a dimension, so
  // an empty select beside a fabric would read as a question nobody can answer.
  it("asks for a unit only on a dimension", async () => {
    serve(
      payload({
        attributes: [
          attribute({
            id: "attr-fab",
            attr_group: "material",
            label: "SOFA",
            value: "Yarn Tessarae",
            unit: null,
            dimension_slot: null,
          }),
        ],
      }),
    );
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Correct" }));
    await screen.findByLabelText("Value");
    expect(screen.queryByLabelText("Unit")).toBeNull();
  });

  // THE OLD ROW STAYS VISIBLE, and it names what took over rather than
  // asserting "a later drawing" — which, since the correction verb exists, it
  // may not have been.
  it("shows a superseded spec with the value that replaced it", async () => {
    serve(
      payload({
        attributes: [attribute({ id: "attr-new", value: "1090" })],
        retiredAttributes: [
          {
            ...attribute({ id: "attr-old", value: "1900" }),
            retired_at: "2026-09-19",
            retired_by: "max",
            superseded_by_id: "attr-new",
          },
        ],
      }),
    );
    render(<RecordPage />);
    await userEvent.click(await screen.findByRole("button", { name: /retired spec/ }));
    const list = (await screen.findByText(/superseded by/)).closest("li") as HTMLElement;
    expect(within(list).getByText(/superseded by “1090mm”/)).toBeTruthy();
    // No way back: restoring would leave the item holding both values with
    // nothing to say which is current.
    expect(within(list).queryByRole("button", { name: "Put back" })).toBeNull();
  });
});
