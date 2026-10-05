// The record's Specs tab: a later document's value, in red, under the one that
// stands, and a person settling it.
//
// Component tier: no database, `apiFetch` stubbed. What only a screen can show:
// the statement names its document and page and reads a feet-and-inches figure
// as printed with its millimetres; both answers are offered and NEITHER presses
// without a reason; what is sent is the decision, the reason and both versions
// the screen read; and a refusal stays on the row AFTER the reload it causes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenDisagreementRow, SettledDisagreementItem } from "@/components/records/DisagreementRows";
import type { Disagreement } from "@/lib/disagreements";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

function disagreement(over: Partial<Disagreement> = {}): Disagreement {
  return {
    id: "dis-1",
    recordId: "rec-1",
    projectId: "p1",
    version: 3,
    status: "open",
    attrGroup: "dimension",
    label: "Width",
    value: "540",
    unit: "mm",
    dimensionSlot: "W",
    specFieldId: null,
    specFieldName: null,
    materialCode: null,
    state: "confirmed",
    sourceRunId: "run-tracker",
    sourcePage: 9,
    sourceFilename: "OMS and FF&E Tracker.pdf",
    sourceDocumentKind: "ffe_schedule",
    createdAt: "2026-10-05T10:00:00Z",
    heldAttributeId: "att-held",
    heldStatus: "active",
    heldVersion: 2,
    heldLabel: "Width",
    heldValue: '21"',
    heldUnit: "in",
    heldSourceDocumentKind: null,
    heldSourceFilename: "Bill.xlsx",
    heldFromBill: true,
    currentAttributeId: "att-held",
    resolvedAt: null,
    resolvedBy: null,
    resolvedAttributeId: null,
    changeSetId: null,
    reason: null,
    ...over,
  };
}

function inTable(node: React.ReactNode) {
  return render(
    <table>
      <tbody>{node}</tbody>
    </table>,
  );
}

beforeEach(() => apiFetch.mockReset());

describe("an open disagreement on the record", () => {
  it("names the document and page, in red, with both answers and the reason required", async () => {
    const onReload = vi.fn(async () => {});
    inTable(<OpenDisagreementRow disagreement={disagreement()} span={5} onReload={onReload} />);

    const source = screen.getByRole("link", { name: "OMS and FF&E Tracker.pdf, page 9" });
    expect(source).toHaveAttribute("href", "/api/imports/run-tracker/source#page=9");
    expect(screen.getByText("W540mm")).toBeInTheDocument();
    expect(screen.getByRole("row")).toHaveClass("bg-red-50/60");

    const keep = screen.getByRole("button", { name: "Keep the bill's" });
    const use = screen.getByRole("button", { name: "Use this instead" });
    // NO REASON, NO DECISION — the box is always there and always required.
    expect(keep).toBeDisabled();
    expect(use).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Why/ })).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: /Why/ }), "The tracker of 24 Aug supersedes the bill");
    expect(keep).toBeEnabled();
    expect(use).toBeEnabled();

    apiFetch.mockResolvedValue({ ok: true, status: 200, data: {} });
    await userEvent.click(use);
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/disagreements/dis-1/resolve");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      decision: "used_this",
      reason: "The tracker of 24 Aug supersedes the bill",
      version: 3,
      heldVersion: 2,
    });
    expect(onReload).toHaveBeenCalled();
  });

  it("reads a feet-and-inches statement as printed, with its millimetres and the chip", () => {
    inTable(
      <OpenDisagreementRow
        disagreement={disagreement({ value: "1'-10 5/8\"", unit: "in", dimensionSlot: "D", label: "Depth" })}
        span={5}
        onReload={async () => {}}
      />,
    );
    expect(screen.getByText('D 1\'-10 5/8" (575mm)')).toBeInTheDocument();
    expect(screen.getByText("converted from ft-in")).toBeInTheDocument();
  });

  it("keeps a refusal on the row after the reload it causes", async () => {
    const order: string[] = [];
    const onReload = vi.fn(async () => {
      order.push("reload");
    });
    apiFetch.mockResolvedValue({
      ok: false,
      status: 409,
      error: "This disagreement changed while you had it open. Reload before settling it.",
      data: { code: "disagreement_version_stale" },
    });
    inTable(<OpenDisagreementRow disagreement={disagreement()} span={5} onReload={onReload} />);
    await userEvent.type(screen.getByRole("textbox", { name: /Why/ }), "The bill is right");
    await userEvent.click(screen.getByRole("button", { name: "Keep the bill's" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed while you had it open/);
    expect(onReload).toHaveBeenCalledTimes(1);
    // The reason somebody typed survives too.
    expect(screen.getByRole("textbox", { name: /Why/ })).toHaveValue("The bill is right");
  });

  it("can only be kept once the value it disagreed with has been replaced", async () => {
    inTable(
      <OpenDisagreementRow
        disagreement={disagreement({ heldStatus: "retired", currentAttributeId: "att-newer" })}
        span={5}
        onReload={async () => {}}
      />,
    );
    expect(screen.getByText(/now replaced/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Why/ }), "Checked against the new value");
    expect(screen.getByRole("button", { name: "Keep the bill's" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use this instead" })).toBeDisabled();
  });

  it("says 'held value' rather than 'the bill's' where the held value did not come off a bill", () => {
    inTable(
      <OpenDisagreementRow disagreement={disagreement({ heldFromBill: false })} span={5} onReload={async () => {}} />,
    );
    expect(screen.getByRole("button", { name: "Keep the held value" })).toBeInTheDocument();
  });
});

describe("a settled disagreement", () => {
  it("names the decision, who, when and why, in grey", () => {
    render(
      <ul>
        <SettledDisagreementItem
          disagreement={disagreement({
            status: "kept_held",
            resolvedBy: "max@example.com",
            resolvedAt: "2026-10-05T12:00:00Z",
            reason: "The bill is the contract",
          })}
        />
      </ul>,
    );
    expect(screen.getByText(/kept the held value by max@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/The bill is the contract/)).toBeInTheDocument();
  });
});
