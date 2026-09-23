// A split bill line's Specs and Checklist tabs: what its configurations have
// in common, where they differ, a tab each — and that a common edit sends
// EVERY row and version the screen showed, which is what lets the server
// refuse it if any one of them moved.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BillLineConfigurations from "@/components/records/BillLineConfigurations";
import CommonChecklist from "@/components/records/CommonChecklist";
import type { ConfigurationFamily, FamilyAttribute } from "@/lib/configuration-family";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

let id = 0;
function attribute(overrides: Partial<FamilyAttribute>): FamilyAttribute {
  id += 1;
  return {
    id: `attr-${id}`,
    version: 1,
    attrGroup: "dimension",
    label: "Seat height",
    value: "440",
    unit: "mm",
    qualifier: null,
    state: "confirmed",
    dimensionSlot: "SH",
    specFieldId: null,
    fieldName: null,
    sortOrder: id,
    jsonId: null,
    materialCode: null,
    finishId: null,
    finishCode: null,
    finishState: null,
    sourceRunId: null,
    sourcePage: null,
    sourceFilename: null,
    ...overrides,
  };
}

function family(): ConfigurationFamily {
  return {
    lineId: "line-12",
    lineRecordNo: 12,
    projectId: "p",
    configurations: [1, 2, 3].map((n) => ({
      recordId: `conf-${n}`,
      recordNo: 33 + n,
      variantOrdinal: n,
      number: `12.${n}`,
      variantLabel: `TYPE ${n}`,
      version: 1,
      attributes: [
        attribute({ version: n }),
        attribute({
          attrGroup: "material",
          label: "SEAT",
          value: `Cloth ${n}`,
          unit: null,
          dimensionSlot: null,
          specFieldId: "field-com1",
          fieldName: "COM 1",
          jsonId: 1,
        }),
      ],
      answers: [
        {
          answerId: `ans-${n}`,
          requirementId: "req-access",
          prompt: "Access to site",
          jsonId: null,
          localKey: null,
          value: null,
          qualifier: null,
          state: "missing",
          version: 10 + n,
        },
      ],
    })),
  };
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, status: 200, data: { written: [] } });
});

describe("the bill line's Specs tab", () => {
  it("shows what is common, what differs with each value, and a tab per configuration", async () => {
    render(<BillLineConfigurations lineId="line-12" family={family()} specFields={[]} onDone={() => undefined} />);

    expect(screen.getByText("Common to all 3 configurations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correct on all 3" })).toBeInTheDocument();
    // The composed cell over the common slots, by the one composer.
    expect(screen.getByText("SH440mm")).toBeInTheDocument();

    const differs = screen.getByText("Differs between configurations").closest("section, div")!;
    expect(differs).toBeTruthy();
    for (const n of [1, 2, 3]) expect(screen.getAllByText(`Cloth ${n}`).length).toBeGreaterThan(0);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringContaining("12.1"),
      expect.stringContaining("12.2"),
      expect.stringContaining("12.3"),
    ]);
    await userEvent.click(tabs[1]!);
    const open = screen.getByRole("link", { name: "Open 12.2" });
    expect(open).toHaveAttribute("href", "/dashboard/records/conf-2");
  });

  it("offers no edit on a row that differs", () => {
    render(<BillLineConfigurations lineId="line-12" family={family()} specFields={[]} onDone={() => undefined} />);
    // One common row, one Correct: the differing COM 1 has none.
    expect(screen.getAllByRole("button", { name: /Correct on all/ })).toHaveLength(1);
  });

  it("sends every row and version the screen showed with a common correction", async () => {
    const onDone = vi.fn();
    const shown = family();
    render(<BillLineConfigurations lineId="line-12" family={shown} specFields={[]} onDone={onDone} />);

    await userEvent.click(screen.getByRole("button", { name: "Correct on all 3" }));
    const value = screen.getByLabelText("Value");
    await userEvent.clear(value);
    await userEvent.type(value, "450");
    await userEvent.type(screen.getByLabelText("Why"), "Re-measured");
    await userEvent.click(screen.getByRole("button", { name: "Save on all 3" }));

    const posts = apiFetch.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]![0]).toBe("/api/records/line-12/common");
    const body = JSON.parse(String(posts[0]![1].body));
    expect(body).toMatchObject({
      op: "correct",
      groupKey: "slot:SH",
      value: "450",
      unit: "mm",
      state: "confirmed",
      reason: "Re-measured",
      configurations: ["conf-1", "conf-2", "conf-3"],
    });
    const seatHeights = shown.configurations.map((configuration) => configuration.attributes[0]!);
    expect(body.seen).toEqual(seatHeights.map((row) => ({ attributeId: row.id, version: row.version })));
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it("shows the refusal and leaves the buttons alive when the server says no", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 409, error: "Seat height on 12.2 changed since the screen loaded.", data: null });
    const onDone = vi.fn();
    render(<BillLineConfigurations lineId="line-12" family={family()} specFields={[]} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Retire" }));
    await userEvent.type(screen.getByLabelText("Why"), "Not on Rev B");
    await userEvent.click(screen.getByRole("button", { name: "Retire from all 3" }));
    expect(onDone).toHaveBeenCalledWith("Seat height on 12.2 changed since the screen loaded.");
    expect(screen.getByRole("button", { name: "Retire from all 3" })).toBeEnabled();
  });
});

describe("the bill line's Checklist tab", () => {
  it("answers a common question once, sending every configuration's answer and version", async () => {
    const onDone = vi.fn();
    render(
      <CommonChecklist lineId="line-12" family={family()} palettes={[]} paletteByQuestion={[]} onDone={onDone} />,
    );
    expect(screen.getByText("Answered the same on all 3 configurations")).toBeInTheDocument();
    const row = screen.getByText("Access to site").closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Answer on all 3" }));
    const input = screen.getByPlaceholderText("Value");
    await userEvent.type(input, "Lift to level 3");
    await userEvent.click(screen.getByRole("button", { name: "Save on all 3" }));

    const posts = apiFetch.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0]![1].body));
    expect(body).toMatchObject({ op: "answer", requirementId: "req-access", value: "Lift to level 3", state: "confirmed" });
    expect(body.seen).toEqual([
      { answerId: "ans-1", version: 11 },
      { answerId: "ans-2", version: 12 },
      { answerId: "ans-3", version: 13 },
    ]);
  });
});
