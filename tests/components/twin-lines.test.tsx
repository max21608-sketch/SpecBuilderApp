// The record screen's twin controls (0060): the "also on its twin" tick under
// Add a spec, and the Twin lines card that links and unlinks.
//
// What it holds: a twin that leaves the slot free is offered TICKED and the
// request names it; a twin that holds the slot is offered UNTICKED with its
// value, and ticking it sends the row it replaces; a configuration is offered
// nothing; the card links with a reason and unlinks with one.
//
// No database: `apiFetch` is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";
import type { TwinAttribute, TwinWithAttributes } from "@/lib/twin-offer";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const calls = vi.hoisted(() => ({ list: [] as { url: string; method: string; body: unknown }[] }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.list.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === "GET" && url.endsWith("/twins")) {
      return {
        ok: true,
        status: 200,
        data: {
          ok: true,
          twins: [],
          candidates: [
            { recordId: "rec-desk", label: "ZZ1-002", itemDescription: "Example desk", area: null, runName: "Main", boqCodes: ["ZG-FUR-14"] },
            { recordId: "rec-pl", label: "ZZ1-003", itemDescription: "Example stool", area: "Example suite", runName: "Main", boqCodes: ["ZP-FUR-13"] },
          ],
        },
      };
    }
    return { ok: true, status: 200, data: { ok: true } };
  },
}));

beforeEach(() => {
  calls.list = [];
});

import AddSpec from "@/components/records/AddSpec";
import TwinLinesPanel from "@/components/records/TwinLinesPanel";

const width = (value: string): TwinAttribute => ({
  id: "pl-width",
  version: 3,
  attrGroup: "dimension",
  label: "Width",
  value,
  unit: "mm",
  qualifier: null,
  state: "confirmed",
  dimensionSlot: "W",
  specFieldId: null,
});

const twin = (attributes: TwinAttribute[]): TwinWithAttributes => ({
  twinId: "link-1",
  version: 2,
  reason: "Same stool",
  createdBy: "qa",
  createdAt: "2026-11-07",
  recordId: "rec-pl",
  label: "ZZ1-003",
  itemDescription: "Example stool",
  boqCodes: ["ZP-FUR-13"],
  runId: "run",
  runName: "Main",
  area: "Example suite",
  qty: 2,
  qtyRaw: null,
  attributes,
});

function fillWidth() {
  fireEvent.change(screen.getByRole("combobox", { name: "Group" }), { target: { value: "dimension" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Label" }), { target: { value: "Width" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "540" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Slot" }), { target: { value: "W" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Unit" }), { target: { value: "mm" } });
}

describe("Add a spec on a line with a twin", () => {
  it("ticks a twin whose slot is free, and sends it", async () => {
    render(<AddSpec recordId="rec-gr" specFields={[]} onAdded={() => undefined} open twins={[twin([])]} />);
    fillWidth();
    const tick = screen.getByRole("checkbox", { name: /Also on ZP-FUR-13/ });
    expect(tick).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0]!.body).toMatchObject({
      recordId: "rec-gr",
      dimensionSlot: "W",
      alsoRecords: [{ recordId: "rec-pl", attributeId: null, version: null }],
    });
  });

  it("offers a twin that holds the slot UNTICKED, and ticking it names the row it replaces", async () => {
    render(<AddSpec recordId="rec-gr" specFields={[]} onAdded={() => undefined} open twins={[twin([width("560")])]} />);
    fillWidth();
    const tick = screen.getByRole("checkbox", { name: /ZP-FUR-13 holds W 560mm\. Tick to replace it there too\./ });
    expect(tick).not.toBeChecked();
    fireEvent.click(tick);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect((calls.list[0]!.body as { alsoRecords: unknown }).alsoRecords).toEqual([
      { recordId: "rec-pl", attributeId: "pl-width", version: 3 },
    ]);
  });

  it("sends nothing to a twin when unticked, and offers none without twins", async () => {
    const { unmount } = render(<AddSpec recordId="rec-gr" specFields={[]} onAdded={() => undefined} open twins={[twin([])]} />);
    fillWidth();
    fireEvent.click(screen.getByRole("checkbox", { name: /Also on ZP-FUR-13/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect((calls.list[0]!.body as Record<string, unknown>).alsoRecords).toBeUndefined();
    unmount();
    render(<AddSpec recordId="rec-gr" specFields={[]} onAdded={() => undefined} open />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("the Twin lines card", () => {
  it("links a line with a reason", async () => {
    const reloadThen = vi.fn(async () => undefined);
    render(<TwinLinesPanel record={{ id: "rec-gr", parent_id: null }} twins={[]} reloadThen={reloadThen} />);
    fireEvent.click(screen.getByRole("button", { name: "Link a twin line" }));
    const select = await screen.findByRole("combobox", { name: "The line this one is a twin of" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search the project's lines" }), { target: { value: "ZP-" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "— choose a line —",
      "ZP-FUR-13 · Example stool · Example suite · Main",
    ]);
    fireEvent.change(select, { target: { value: "rec-pl" } });
    const link = screen.getByRole("button", { name: "Link" });
    expect(link).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Why these lines are one item" }), { target: { value: "Same stool" } });
    fireEvent.click(link);
    await waitFor(() => expect(calls.list.some((call) => call.method === "POST")).toBe(true));
    expect(calls.list.find((call) => call.method === "POST")).toEqual({
      url: "/api/records/rec-gr/twins",
      method: "POST",
      body: { otherId: "rec-pl", reason: "Same stool" },
    });
    expect(reloadThen).toHaveBeenCalledWith(null);
  });

  it("unlinks a twin with a reason, at the link's version", async () => {
    render(<TwinLinesPanel record={{ id: "rec-gr", parent_id: null }} twins={[twin([])]} reloadThen={async () => undefined} />);
    expect(screen.getByRole("link", { name: "ZP-FUR-13" })).toHaveAttribute("href", "/dashboard/records/rec-pl");
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Why ZP-FUR-13 is not a twin" }), { target: { value: "Different stools" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Unlink" })[0]!);
    await waitFor(() => expect(calls.list).toHaveLength(1));
    expect(calls.list[0]).toEqual({
      url: "/api/twins/link-1",
      method: "PATCH",
      body: { status: "retired", version: 2, reason: "Different stools" },
    });
  });

  it("on a configuration, names its bill line's twins and offers no link", () => {
    render(<TwinLinesPanel record={{ id: "rec-cfg", parent_id: "rec-gr" }} twins={[twin([])]} reloadThen={async () => undefined} />);
    expect(screen.getByText(/Its bill line is one item on 2 lines/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link a twin line" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });
});
