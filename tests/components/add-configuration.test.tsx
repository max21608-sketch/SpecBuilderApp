// The "Add a configuration" panel.
//
// What it must show BEFORE Add: every statement the bill line holds with the
// right default tick (the differing fields unticked and first), a refusal in
// words for a name already used, and the sentence saying what stops being
// exported. And what it must SEND: ids and versions only, never values.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddConfiguration from "@/components/records/AddConfiguration";
import type { CarryItem } from "@/lib/configuration-carry";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

const item = (overrides: Partial<CarryItem> & Pick<CarryItem, "id" | "label">): CarryItem => ({
  kind: "attribute",
  version: 1,
  value: null,
  qualifier: null,
  state: "confirmed",
  jsonId: null,
  source: null,
  differing: false,
  ...overrides,
});

const offer = {
  billLine: { id: "bill", name: "S-301", runName: "MAIN", qty: 45, version: 4 },
  offered: [
    item({ id: "w", label: "W · Width", value: "840 mm", group: "dimension", source: { filename: "S-301.pdf", page: 3 } }),
    item({ id: "d", label: "D · Depth", value: "790 mm", group: "dimension", source: { filename: "S-301.pdf", page: 3 } }),
    item({ id: "com1", label: "SEAT", value: "Tibor Blob Amber Fern", jsonId: 1, differing: true, source: { filename: "S-301.pdf", page: 3 } }),
    item({ id: "stitch", kind: "answer", label: "Stitching spec", value: "Plain stitch", version: 2 }),
  ],
  taken: [
    { label: "A", status: "active" },
    { label: "B", status: "retired" },
  ],
  alreadySplit: false,
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? { ok: true, status: 200, data: { recordId: "new", label: "TYPE 2", carriedSpecs: 1, carriedAnswers: 1 } }
      : { ok: true, status: 200, data: offer },
  );
});

describe("adding a configuration", () => {
  it("keeps the differing field open and unticked, and folds the rest into counted groups", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    expect(await screen.findByRole("checkbox", { name: "Carry SEAT on MAIN" })).not.toBeChecked();
    expect(screen.getByText(/Usually different between configurations/)).toBeInTheDocument();
    // Folded: a count per group, and no tick visible until show.
    expect(screen.getByText("Dimensions — 2 carried")).toBeInTheDocument();
    expect(screen.getByText("Checklist answers — 1 carried")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Carry W · Width on MAIN" })).toBeNull();
    expect(screen.getByText(/quantity not allocated/)).toBeInTheDocument();
  });

  it("reveals a group's ticks on show, still ticked, with where each came from", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Show Dimensions on MAIN" }));
    const width = screen.getByRole("checkbox", { name: "Carry W · Width on MAIN" });
    expect(width).toBeChecked();
    expect(screen.getAllByText("S-301.pdf, page 3").length).toBeGreaterThanOrEqual(2);
    await userEvent.click(width);
    expect(screen.getByText("Dimensions — 1 of 2 carried")).toBeInTheDocument();
    expect(screen.getByText(/S-301 becomes a heading/)).toHaveTextContent("W · Width");
  });

  it("puts Add in the footer, beside what stops being exported", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    const effect = await screen.findByTestId("export-effect");
    expect(effect).toHaveTextContent("S-301 becomes a heading");
    const footer = effect.parentElement!;
    expect(within(footer).getByRole("button", { name: "Add the configuration" })).toBeInTheDocument();
    expect(footer.className).toContain("sticky");
  });

  it("says what stops being exported, and follows the ticks", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    await screen.findByRole("checkbox", { name: "Carry SEAT on MAIN" });
    expect(screen.getByText(/S-301 becomes a heading/)).toHaveTextContent(
      "1 thing you left unticked will stop being exported: SEAT.",
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Carry SEAT on MAIN" }));
    expect(screen.getByText(/S-301 becomes a heading/)).toHaveTextContent("nothing stops being exported");
  });

  it("refuses a name already used, and a retired one, in words, and will not add", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    const box = await screen.findByPlaceholderText("Type 2");
    await userEvent.type(box, "a");
    expect(screen.getByRole("alert")).toHaveTextContent("S-301 already has a configuration called A.");
    expect(screen.getByRole("button", { name: "Add the configuration" })).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, "b");
    expect(screen.getByRole("alert")).toHaveTextContent("never reused");
  });

  it("sends ids and versions, never values", async () => {
    const onAdded = vi.fn();
    render(<AddConfiguration billLineId="bill" onAdded={onAdded} onCancel={() => {}} />);
    await userEvent.type(await screen.findByPlaceholderText("Type 2"), "Type 2");
    await userEvent.click(screen.getByRole("button", { name: "Add the configuration" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.name).toBe("Type 2");
    expect(body.shown).toHaveLength(4);
    // Folded rows are still ticked, and still sent.
    expect(body.carry).toEqual([
      { kind: "attribute", id: "w", version: 1 },
      { kind: "attribute", id: "d", version: 1 },
      { kind: "answer", id: "stitch", version: 2 },
    ]);
    expect(body.phases).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Plain stitch");
  });
});

describe("the same bill line on the other phases", () => {
  const ve = {
    billLine: { id: "bill-ve", name: "S-301", runName: "MAIN - VE", qty: 20, version: 1 },
    offered: [
      // The VE phase's OWN width, not MAIN's: phases can differ.
      item({ id: "w-ve", label: "W · Width", value: "800 mm", group: "dimension", source: { filename: "S-301 VE.pdf", page: 1 } }),
      item({ id: "com1-ve", label: "SEAT", value: "Kolda", jsonId: 1, differing: true }),
    ],
    taken: [{ label: "TYPE 2", status: "retired" }],
    alreadySplit: false,
  };
  const withPhases = {
    ...offer,
    otherPhases: [
      { runId: "run-ve", runName: "MAIN - VE", billLineId: "bill-ve", lineCount: 1, offer: ve },
      { runId: "run-mur", runName: "MUR", billLineId: null, lineCount: 2, offer: null },
    ],
  };

  beforeEach(() => {
    apiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: true, status: 200, data: { recordId: "new", label: "TYPE 3", carriedSpecs: 1, carriedAnswers: 1 } }
        : { ok: true, status: 200, data: withPhases },
    );
  });

  it("offers each other phase as one ticked line, its OWN specs behind show, and says why an ambiguous one is offered nothing", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    await userEvent.type(await screen.findByPlaceholderText("Type 2"), "Type 3");
    expect(screen.getByRole("checkbox", { name: "Also add TYPE 3 to MAIN - VE" })).toBeChecked();
    expect(screen.getByText(/1 spec carried, 1 left on the bill line/)).toBeInTheDocument();
    expect(screen.queryByText(/800 mm/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show what is carried on MAIN - VE" }));
    await userEvent.click(screen.getByRole("button", { name: "Show Dimensions on MAIN - VE" }));
    expect(screen.getByRole("checkbox", { name: "Carry W · Width on MAIN - VE" })).toBeChecked();
    expect(screen.getByText(/800 mm/)).toBeInTheDocument();
    expect(screen.getByText(/S-301 is on 2 lines of MUR, so nothing is added there/)).toBeInTheDocument();
  });

  it("refuses the whole act, naming the phase, when the name is used there", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    await userEvent.type(await screen.findByPlaceholderText("Type 2"), "type 2");
    expect(screen.getByRole("alert")).toHaveTextContent("On MAIN - VE: S-301 had a configuration called TYPE 2");
    expect(screen.getByRole("button", { name: /Add on 2 phases/ })).toBeDisabled();
  });

  it("sends each phase's own ids and versions", async () => {
    const onAdded = vi.fn();
    render(<AddConfiguration billLineId="bill" onAdded={onAdded} onCancel={() => {}} />);
    await userEvent.type(await screen.findByPlaceholderText("Type 2"), "Type 3");
    await userEvent.click(screen.getByRole("button", { name: "Add on 2 phases" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.phases).toEqual([
      {
        billLineId: "bill-ve",
        shown: [
          { kind: "attribute", id: "w-ve", version: 1 },
          { kind: "attribute", id: "com1-ve", version: 1 },
        ],
        carry: [{ kind: "attribute", id: "w-ve", version: 1 }],
      },
    ]);
  });

  it("leaves a phase out when it is unticked", async () => {
    const onAdded = vi.fn();
    render(<AddConfiguration billLineId="bill" onAdded={onAdded} onCancel={() => {}} />);
    await userEvent.type(await screen.findByPlaceholderText("Type 2"), "Type 3");
    await userEvent.click(screen.getByRole("checkbox", { name: "Also add TYPE 3 to MAIN - VE" }));
    await userEvent.click(screen.getByRole("button", { name: "Add the configuration" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).phases).toEqual([]);
  });
});
