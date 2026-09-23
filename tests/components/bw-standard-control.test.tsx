// The BW standard control on the record's Specs tab (0041).
//
// What a db-tier test cannot reach: that the line says both halves, offers
// the acts that apply to the state it is in, posts ONCE with the option named
// by value, asks why only when an AGREED standard is being changed, and that a
// refused request leaves the button alive.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BwStandardPanel, BwStandardSummary, type StandardAttribute } from "@/components/records/BwStandardControl";
import type { Palette } from "@/lib/palettes";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

const timber: Palette = {
  key: "bws_timber_finish",
  name: "BWS timber finish palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: null,
  syncedAt: "2026-09-22T00:00:00.000Z",
  options: [
    { value: "BW Oak Grey - Open grain 10%", label: "BW Oak Grey - Open grain 10%", sortOrder: 1, isDefault: false, code: null },
    { value: "BW Walnut Dark", label: "BW Walnut Dark", sortOrder: 2, isDefault: false, code: null },
  ],
};

const attribute = (over: Partial<StandardAttribute> = {}): StandardAttribute => ({
  id: "attr-1",
  label: "SOFA FEET",
  version: 4,
  value: "feet dark tinted wood as per approved sample",
  json_id: 4,
  standard_value: null,
  standard_state: null,
  ...over,
});

function inTable(node: React.ReactNode) {
  return render(
    <table>
      <tbody>{node}</tbody>
    </table>,
  );
}

beforeEach(() => apiFetch.mockReset());

describe("the summary line", () => {
  it("offers Set… where the field has a list and nothing is set", () => {
    const onSet = vi.fn();
    render(<BwStandardSummary attribute={attribute()} palette={timber} onSet={onSet} onAgree={vi.fn()} />);
    expect(screen.getByText("BW standard:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Client agreed" })).toBeNull();
    return userEvent.click(screen.getByRole("button", { name: "Set…" })).then(() => expect(onSet).toHaveBeenCalledOnce());
  });

  it("shows a proposal with its state and offers Client agreed", () => {
    render(
      <BwStandardSummary
        attribute={attribute({ standard_value: "BW Walnut Dark", standard_state: "proposed" })}
        palette={timber}
        onSet={vi.fn()}
        onAgree={vi.fn()}
      />,
    );
    expect(screen.getByText("BW Walnut Dark")).toBeInTheDocument();
    expect(screen.getByText("proposed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Client agreed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeInTheDocument();
  });

  it("links the agreeing email and offers no second agreement", () => {
    render(
      <BwStandardSummary
        attribute={attribute({
          standard_value: "BW Walnut Dark",
          standard_state: "agreed",
          standard_evidence_change_set_id: "cs-1",
          standard_evidence_filename: "yes.eml",
        })}
        palette={timber}
        onSet={vi.fn()}
        onAgree={vi.fn()}
      />,
    );
    expect(screen.getByText("agreed by the client")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "yes.eml" })).toHaveAttribute("href", "/api/change-sets/cs-1/evidence");
    expect(screen.queryByRole("button", { name: "Client agreed" })).toBeNull();
  });

  it("says nothing on a field with no list and no standard", () => {
    const { container } = render(
      <BwStandardSummary attribute={attribute({ json_id: 1 })} palette={null} onSet={vi.fn()} onAgree={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the panel", () => {
  it("posts the option by value, once, and reloads", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    const onSaved = vi.fn();
    inTable(
      <BwStandardPanel
        attribute={attribute()}
        palette={timber}
        projectId="proj-1"
        mode="set"
        span={5}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    // The client's words are named in the panel, never edited by it.
    expect(screen.getByText(/feet dark tinted wood as per approved sample/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save the standard" });
    // Nothing chosen yet: saving would change nothing.
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole("combobox"), "BW Walnut Dark");
    await userEvent.click(save);

    expect(apiFetch).toHaveBeenCalledOnce();
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/attributes/attr-1/standard");
    expect(JSON.parse(String(init.body))).toMatchObject({
      action: "set",
      version: 4,
      standard: { state: "proposed", value: "BW Walnut Dark" },
    });
    expect(onSaved).toHaveBeenCalledWith(null, true);
  });

  it("asks why before an AGREED standard can be changed", async () => {
    inTable(
      <BwStandardPanel
        attribute={attribute({ standard_value: "BW Walnut Dark", standard_state: "agreed" })}
        palette={timber}
        projectId="proj-1"
        mode="set"
        span={5}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "__tbc__");
    const save = screen.getByRole("button", { name: "Save the standard" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why is the agreed standard changing/), "Client changed their mind");
    expect(save).toBeEnabled();
  });

  it("records an agreement, and a refused request leaves the button alive", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, error: "The server returned an error (500).", data: null });
    const onSaved = vi.fn();
    inTable(
      <BwStandardPanel
        attribute={attribute({ standard_value: "BW Walnut Dark", standard_state: "proposed" })}
        palette={timber}
        projectId="proj-1"
        mode="agree"
        span={5}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    const cell = screen.getByRole("cell");
    expect(within(cell).getByText(/The client agreed to BW Walnut Dark/)).toBeInTheDocument();
    const record = screen.getByRole("button", { name: "Record the agreement" });
    await userEvent.click(record);
    expect(JSON.parse(String(apiFetch.mock.calls[0]![1].body))).toMatchObject({ action: "agree", version: 4 });
    expect(onSaved).toHaveBeenCalledWith("The server returned an error (500).", false);
    expect(record).toBeEnabled();
  });
});
