// BW's own finish, set once per code (0045): the library's BW finish cell and
// the record screen's read-only line.
//
// What a db-tier test cannot reach: that the cell says each state in words --
// including WHY a code offers no list -- offers the acts that apply, counts
// the TOTAL items whatever the phase filter shows, offers an earlier per-item
// choice back as a suggestion rather than writing it, posts the option by
// value with no "Other…", and asks why only when an AGREED one changes; and
// that the record screen states the library's choice with a link to the code
// instead of offering a per-item control.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FinishStandardCell,
  FinishStandardPanel,
  earlierItemChoice,
  type StandardFinish,
} from "@/components/finishes/FinishStandard";
import { BwFinishFromLibrary } from "@/components/records/BwStandardControl";
import FinishesLibrary from "@/components/finishes/FinishesLibrary";
import type { Palette } from "@/lib/palettes";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

const OAK = "BW Oak Grey - Open grain 10%";
const WALNUT = "BW Walnut Dark";
const timber: Palette = {
  key: "bws_timber_finish",
  name: "BWS timber finish palette",
  owner: "bws",
  allowsFreeText: true,
  sourceNote: null,
  syncedAt: "2026-09-22T00:00:00.000Z",
  options: [
    { value: OAK, label: OAK, sortOrder: 1, isDefault: false, code: null },
    { value: WALNUT, label: WALNUT, sortOrder: 2, isDefault: false, code: null },
  ],
};

const finish = (over: Partial<StandardFinish> = {}): StandardFinish => ({
  id: "fin-1",
  code: "WD-05",
  version: 3,
  standard_value: null,
  standard_state: null,
  bw_palette_key: "bws_timber_finish",
  bw_palette_why: "From Main timber finish, where its items sit.",
  bw_palette_mixed: false,
  // Three uses on two items: the count is ITEMS.
  used_on: [{ recordId: "rec-1" }, { recordId: "rec-1" }, { recordId: "rec-2" }],
  ...over,
});

function cell(over: Partial<StandardFinish> = {}, palette: Palette | null = timber) {
  const handlers = { onSet: vi.fn(), onAgree: vi.fn(), onAdopt: vi.fn() };
  render(<FinishStandardCell finish={finish(over)} palette={palette} busy={false} {...handlers} />);
  return handlers;
}

beforeEach(() => apiFetch.mockReset());

describe("the library's BW finish cell", () => {
  it("says why there is nothing to choose, and offers nothing", () => {
    cell({ bw_palette_key: null, bw_palette_why: "A fabric has no BW finish — the COM fields carry no BWS list." }, null);
    expect(screen.getByText(/A fabric has no BW finish/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unset: Set…, and how many items it would apply to", () => {
    const { onSet } = cell();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("applies to 2 items")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Client agreed" })).toBeNull();
    screen.getByRole("button", { name: "Set…" }).click();
    expect(onSet).toHaveBeenCalled();
  });

  it("proposed: the option, its state, Change… and Client agreed", () => {
    const { onAgree } = cell({ standard_value: OAK, standard_state: "proposed" });
    expect(screen.getByText(OAK)).toBeInTheDocument();
    expect(screen.getByText("proposed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeInTheDocument();
    screen.getByRole("button", { name: "Client agreed" }).click();
    expect(onAgree).toHaveBeenCalled();
  });

  it("agreed: settled, with the client's email, and no second agreement", () => {
    cell({
      standard_value: OAK,
      standard_state: "agreed",
      standard_evidence_change_set_id: "cs-1",
      standard_evidence_filename: "yes.eml",
    });
    expect(screen.getByText("agreed by the client")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "yes.eml" })).toHaveAttribute("href", "/api/change-sets/cs-1/evidence");
    expect(screen.queryByRole("button", { name: "Client agreed" })).toBeNull();
  });

  it("TBC: BW will propose one", () => {
    cell({ standard_state: "tbc" });
    expect(screen.getByText("TBC — BW to propose one")).toBeInTheDocument();
  });

  it("items in fields that disagree: says the BW finish goes into every one of them", () => {
    cell({ bw_palette_mixed: true, bw_palette_why: "Its items sit in different fields (A, B), so its kind decides." });
    expect(screen.getByText(/different fields/)).toBeInTheDocument();
  });

  it("offers an earlier per-item choice back as a suggestion, and writes nothing until pressed", () => {
    const { onAdopt } = cell({
      used_on: [
        { recordId: "rec-1", itemStandardValue: WALNUT, itemStandardState: "agreed" },
        { recordId: "rec-2", itemStandardValue: WALNUT, itemStandardState: "proposed" },
      ],
    });
    expect(screen.getByText(/chosen on 2 of its items before the library held BW finishes/)).toBeInTheDocument();
    expect(onAdopt).not.toHaveBeenCalled();
    screen.getByRole("button", { name: /BW Walnut Dark/ }).click();
    expect(onAdopt).toHaveBeenCalledWith(WALNUT);
  });

  it("offers nothing back where the items disagree, or chose an option off the list", () => {
    expect(
      earlierItemChoice(
        {
          used_on: [
            { recordId: "rec-1", itemStandardValue: WALNUT, itemStandardState: "agreed" },
            { recordId: "rec-2", itemStandardValue: OAK, itemStandardState: "agreed" },
          ],
        },
        timber,
      ),
    ).toBeNull();
    expect(
      earlierItemChoice({ used_on: [{ recordId: "rec-1", itemStandardValue: "Not BWS", itemStandardState: "agreed" }] }, timber),
    ).toBeNull();
  });
});

describe("the library's BW finish panel", () => {
  function panel(over: Partial<StandardFinish> = {}, mode: "set" | "agree" = "set") {
    const onSaved = vi.fn();
    render(
      <table>
        <tbody>
          <FinishStandardPanel
            finish={finish(over)}
            palette={timber}
            projectId="proj-1"
            mode={mode}
            span={8}
            onClose={vi.fn()}
            onSaved={onSaved}
          />
        </tbody>
      </table>,
    );
    return { onSaved };
  }

  it("offers BW's list, TBC and none -- and no Other…", () => {
    panel();
    const select = screen.getByRole("combobox");
    const labels = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(labels).toEqual(["No BW finish — ship the client’s words", "TBC — we’ll propose one", OAK, WALNUT]);
    expect(labels.some((label) => label?.includes("Other"))).toBe(false);
    expect(screen.getByText(/on all 2 items carrying this code, on every phase/)).toBeInTheDocument();
  });

  it("posts the option BY VALUE to the code's own route", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: { recordsTouched: 2 } });
    const user = userEvent.setup();
    const { onSaved } = panel();
    await user.selectOptions(screen.getByRole("combobox"), OAK);
    await user.click(screen.getByRole("button", { name: "Save the BW finish" }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/projects/proj-1/finishes/fin-1/standard");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      action: "set",
      version: 3,
      standard: { state: "proposed", value: OAK },
      reason: null,
    });
    expect(onSaved).toHaveBeenCalledWith("BW finish for WD-05 saved — on 2 items.", true);
  });

  it("changing an AGREED one asks why, inline, before it will save", async () => {
    const user = userEvent.setup();
    panel({ standard_value: OAK, standard_state: "agreed" });
    await user.selectOptions(screen.getByRole("combobox"), WALNUT);
    const save = screen.getByRole("button", { name: "Save the BW finish" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Why is the agreed BW finish changing?")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "The client asked for walnut");
    expect(save).toBeEnabled();
  });

  it("a refused request reports, and leaves the button alive", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: "That finish changed as you saved." });
    const user = userEvent.setup();
    const { onSaved } = panel();
    await user.selectOptions(screen.getByRole("combobox"), OAK);
    await user.click(screen.getByRole("button", { name: "Save the BW finish" }));
    expect(onSaved).toHaveBeenCalledWith("That finish changed as you saved.", false);
    expect(screen.getByRole("button", { name: "Save the BW finish" })).toBeEnabled();
  });
});

describe("the record screen's line on a spec filed under a code", () => {
  it("states the library's BW finish and links to the code, with no control", () => {
    render(
      <BwFinishFromLibrary
        projectId="proj-1"
        attribute={{ finish_code: "WD-05", finish_standard_value: OAK, finish_standard_state: "proposed" }}
      />,
    );
    expect(screen.getByText(OAK)).toBeInTheDocument();
    expect(screen.getByText("proposed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WD-05" })).toHaveAttribute(
      "href",
      "/dashboard/projects/proj-1?tab=finishes&finish=WD-05",
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/earlier choice/)).toBeNull();
  });

  it("says none is set, where the library has none", () => {
    render(<BwFinishFromLibrary projectId="proj-1" attribute={{ finish_code: "WD-05" }} />);
    expect(screen.getByText("none set")).toBeInTheDocument();
  });

  it("says once that the item's own earlier choice is replaced by the library's", () => {
    render(
      <BwFinishFromLibrary
        projectId="proj-1"
        attribute={{
          finish_code: "WD-05",
          finish_standard_value: OAK,
          finish_standard_state: "agreed",
          standard_value: WALNUT,
          standard_state: "agreed",
        }}
      />,
    );
    expect(screen.getByText(/The item’s own earlier choice/)).toHaveTextContent(
      `The item’s own earlier choice, ${WALNUT} (agreed by the client), is replaced by the library’s.`,
    );
  });
});

describe("the cell inside the library", () => {
  const use = (recordId: string, runId: string) => ({
    recordId,
    label: `P1-00${recordId.slice(-1)}`,
    itemDescription: "Chair",
    runId,
    runName: runId === "run-ve" ? "VE" : "MAIN",
    attributeLabel: "Main timber finish",
    jsonId: 4,
    fieldName: "Main timber finish",
  });
  const PAYLOAD = {
    project: { id: "proj-1", number: "P1", name: "__QA" },
    runs: [
      { id: "run-main", name: "MAIN" },
      { id: "run-ve", name: "VE" },
    ],
    unlinked: [],
    palettes: { bws_timber_finish: timber },
    finishes: [
      {
        ...finish({ standard_value: OAK, standard_state: "proposed" }),
        code_norm: "WD-05",
        code_origin: "client",
        kind: "timber",
        description: "Oak",
        supplier_raw: null,
        reference: null,
        colour: null,
        notes: null,
        state: "tbc",
        status: "active",
        retired_at: null,
        retired_by: null,
        updated_at: "2026-10-05T00:00:00.000Z",
        updated_by: null,
        swatch_attachment_id: null,
        used_on: [use("rec-1", "run-main"), use("rec-2", "run-main"), use("rec-3", "run-ve")],
      },
    ],
  };

  it("counts the TOTAL items, whatever the phase filter shows, and lands on a code from the link", async () => {
    apiFetch.mockResolvedValue({ ok: true, data: PAYLOAD });
    const user = userEvent.setup();
    render(<FinishesLibrary projectId="proj-1" initialQuery="WD-05" />);
    expect(await screen.findByText("applies to 3 items")).toBeInTheDocument();
    expect(screen.getByLabelText("Search the finishes library")).toHaveValue("WD-05");
    await user.selectOptions(screen.getByLabelText("Filter by phase"), "run-ve");
    expect(screen.getByText("applies to 3 items")).toBeInTheDocument();
    expect(screen.getByText(OAK)).toBeInTheDocument();
  });
});
