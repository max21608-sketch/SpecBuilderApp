// The "Add a configuration" panel.
//
// What it must show BEFORE Add: every statement the bill line holds with the
// right default tick (the differing fields unticked and first), a refusal in
// words for a name already used, and the sentence saying what stops being
// exported. And what it must SEND: ids and versions only, never values.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  billLine: { id: "bill", name: "S-301", qty: 45, version: 4 },
  offered: [
    item({ id: "w", label: "W · Width", value: "840 mm", source: { filename: "S-301.pdf", page: 3 } }),
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
  it("lists what the bill line holds, the differing field unticked, with where each came from", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    const width = await screen.findByRole("checkbox", { name: "Carry W · Width" });
    expect(width).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Carry Stitching spec" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Carry SEAT" })).not.toBeChecked();
    expect(screen.getAllByText("S-301.pdf, page 3")).toHaveLength(2);
    expect(screen.getByText(/Usually different between configurations/)).toBeInTheDocument();
    expect(screen.getByText(/quantity not allocated/)).toBeInTheDocument();
  });

  it("says what stops being exported, and follows the ticks", async () => {
    render(<AddConfiguration billLineId="bill" onAdded={() => {}} onCancel={() => {}} />);
    await screen.findByRole("checkbox", { name: "Carry SEAT" });
    expect(screen.getByText(/S-301 becomes a heading/)).toHaveTextContent(
      "1 thing you left unticked will stop being exported: SEAT.",
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Carry SEAT" }));
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
    expect(body.shown).toHaveLength(3);
    expect(body.carry).toEqual([
      { kind: "attribute", id: "w", version: 1 },
      { kind: "answer", id: "stitch", version: 2 },
    ]);
    expect(JSON.stringify(body)).not.toContain("Plain stitch");
  });
});
