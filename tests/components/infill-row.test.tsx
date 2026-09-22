// The infill screen's edit row — one per outstanding question.
//
// What these assert is the part a reviewer cannot see from the code: that a
// dimension does NOT write an answer, that a palette question offers the list
// with a way out, that a question already TBC shows what was recorded and can
// still be confirmed, and that a refusal reloads the row and says so rather
// than leaving a box disabled.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InfillRow, { type SaveOutcome } from "@/components/infill/InfillRow";
import type { InfillQuestion } from "@/lib/infill";
import type { Palette } from "@/lib/palettes";

function question(over: Partial<InfillQuestion> = {}): InfillQuestion {
  return {
    recordId: "rec-1",
    requirementId: "req-1",
    recordLabel: "AP364c-011",
    itemDescription: "Desk chair",
    variantLabel: null,
    area: "Signature Suite",
    prompt: "Main fabric",
    fieldLabel: "COM 1",
    section: "Upholstery",
    jsonId: 1,
    localKey: null,
    requirementKind: "spec_field",
    tier: "to_quote",
    state: "missing",
    currentValue: null,
    answerId: "ans-1",
    answerVersion: 2,
    waiting: null,
    sisters: [],
    finishNote: null,
    dimensions: null,
    composed: null,
    ...over,
  };
}

function palette(over: Partial<Palette> = {}): Palette {
  return {
    key: "outdoor",
    name: "Indoor / outdoor",
    owner: "app",
    allowsFreeText: true,
    sourceNote: null,
    syncedAt: null,
    options: [
      { value: "Indoor", label: "Indoor", sortOrder: 1, isDefault: false, code: null },
      { value: "Outdoor", label: "Outdoor", sortOrder: 2, isDefault: false, code: null },
    ],
    ...over,
  };
}

const OK: SaveOutcome = { ok: true, message: "Recorded." };

function renderRow(
  over: Partial<InfillQuestion> = {},
  handlers: {
    palette?: Palette | null;
    onSaveAnswer?: (...args: never[]) => Promise<SaveOutcome>;
    onSaveDimension?: (...args: never[]) => Promise<SaveOutcome>;
    onReload?: () => Promise<void>;
  } = {},
) {
  const saveAnswer = handlers.onSaveAnswer ?? vi.fn().mockResolvedValue(OK);
  const saveDimension = handlers.onSaveDimension ?? vi.fn().mockResolvedValue(OK);
  const reload = handlers.onReload ?? vi.fn().mockResolvedValue(undefined);
  render(
    <table>
      <tbody>
        <InfillRow
          question={question(over)}
          palette={handlers.palette ?? null}
          columns={7}
          pad="pl-10"
          onSaveAnswer={saveAnswer as never}
          onSaveDimension={saveDimension as never}
          onReload={reload}
        />
      </tbody>
    </table>,
  );
  return { saveAnswer, saveDimension, reload };
}

describe("InfillRow", () => {
  it("records a typed value as a confirmed answer, on blur", async () => {
    const user = userEvent.setup();
    const { saveAnswer } = renderRow();
    await user.type(screen.getByPlaceholderText("Value"), "Tibor Blob Amber Fern");
    await user.tab();
    expect(saveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ requirementId: "req-1" }),
      { value: "Tibor Blob Amber Fern", state: "confirmed", reason: null },
    );
    expect(await screen.findByText("Recorded.")).toBeInTheDocument();
  });

  it("offers a palette with a way out, and writes the option that was chosen", async () => {
    const user = userEvent.setup();
    const { saveAnswer } = renderRow({}, { palette: palette() });
    const select = screen.getByRole("combobox");
    expect(screen.getByRole("option", { name: "Other…" })).toBeInTheDocument();
    await user.selectOptions(select, "Outdoor");
    expect(saveAnswer).toHaveBeenCalledWith(expect.anything(), {
      value: "Outdoor",
      state: "confirmed",
      reason: null,
    });
  });

  it("A DIMENSION IS NOT AN ANSWER: it writes a slot, a figure and a unit", async () => {
    const user = userEvent.setup();
    const { saveAnswer, saveDimension } = renderRow({
      jsonId: 3,
      prompt: "Dimensions",
      fieldLabel: "Dimensions",
      dimensions: [],
    });
    await user.selectOptions(screen.getByLabelText(/Which dimension/), "W");
    await user.type(screen.getByLabelText(/^Figure for/), "840");
    await user.click(screen.getByRole("button", { name: "Record" }));

    expect(saveDimension).toHaveBeenCalledWith(expect.anything(), { slot: "W", value: "840", unit: "mm" });
    expect(saveAnswer).not.toHaveBeenCalled();
    expect(await screen.findByText("Recorded.")).toBeInTheDocument();
    // And the cell as it now reads, through the app's one composer.
    expect(screen.getByText("W840mm")).toBeInTheDocument();
  });

  it("will not offer a slot the record already holds", () => {
    renderRow({
      jsonId: 3,
      prompt: "Dimensions",
      dimensions: [{ slot: "W", value: "840", unit: "mm", state: "confirmed" }],
    });
    expect(screen.getByRole("option", { name: /Width — already recorded/ })).toBeDisabled();
    expect(screen.getByText("W840mm")).toBeInTheDocument();
  });

  it("shows what was recorded as TBC, and a typed value confirms it", async () => {
    const user = userEvent.setup();
    const { saveAnswer } = renderRow({ state: "tbc", currentValue: "TBC – Yarn Collective" });
    expect(screen.getByText("recorded as TBC: TBC – Yarn Collective")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TBC" })).toBeDisabled();

    const box = screen.getByPlaceholderText("Value");
    await user.clear(box);
    await user.type(box, "Yarn Collective Tessarae YC04158");
    await user.tab();
    expect(saveAnswer).toHaveBeenCalledWith(expect.anything(), {
      value: "Yarn Collective Tessarae YC04158",
      state: "confirmed",
      reason: null,
    });
  });

  it("records TBC as a state, which is not the same as nobody having looked", async () => {
    const user = userEvent.setup();
    const { saveAnswer } = renderRow();
    await user.click(screen.getByRole("button", { name: "TBC" }));
    expect(saveAnswer).toHaveBeenCalledWith(expect.anything(), { value: null, state: "tbc", reason: null });
  });

  it("on a 409 it reloads ITSELF, says what happened, and unfreezes the box", async () => {
    const user = userEvent.setup();
    const reload = vi.fn().mockResolvedValue(undefined);
    const { saveAnswer } = renderRow(
      {},
      {
        onReload: reload,
        onSaveAnswer: vi.fn().mockResolvedValue({
          ok: false,
          error: "“Main fabric” was changed by someone else while you were editing.",
          code: "answer_version_stale",
        }),
      },
    );
    await user.type(screen.getByPlaceholderText("Value"), "Leather");
    await user.tab();
    expect(saveAnswer).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(await screen.findByText(/was changed by someone else/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Value")).not.toBeDisabled();
  });

  it("asks for a reason INLINE when the answer has since been confirmed, and keeps the value", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "“Main fabric” is already confirmed.", code: "reason_required" })
      .mockResolvedValueOnce(OK);
    const reload = vi.fn().mockResolvedValue(undefined);
    renderRow({}, { onSaveAnswer: save, onReload: reload });

    await user.type(screen.getByPlaceholderText("Value"), "Leather");
    await user.tab();
    expect(await screen.findByText(/“Main fabric” is already confirmed/)).toBeInTheDocument();
    // NOT reloaded: the value is still wanted, and reloading would throw it away.
    expect(reload).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: /Say why it is changing/ }), "Hayley said so");
    await user.click(screen.getByRole("button", { name: "Record it" }));
    expect(save).toHaveBeenLastCalledWith(expect.anything(), {
      value: "Leather",
      state: "confirmed",
      reason: "Hayley said so",
    });
  });

  it("refuses to post where there is no checklist row, and sends them to the record", () => {
    renderRow({ answerId: null, answerVersion: null });
    expect(screen.getByText(/No checklist row for this question yet/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Value")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the item" })).toHaveAttribute(
      "href",
      "/dashboard/records/rec-1",
    );
  });

  it("shows a question awaiting a reply, still editable — a CAM may know it", () => {
    renderRow({ waiting: { draftId: "d-1", sentAt: "2026-09-15T09:00:00.000Z", contactName: "Claire" } });
    expect(screen.getByText(/asked/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Value")).not.toBeDisabled();
  });

  it("shows the sister configurations' values as REFERENCE, with nothing that copies them", () => {
    renderRow({
      sisters: [{ name: "S-301 A", value: "Tibor Blob Amber Fern" }],
      finishNote: "Yarn Collective Tessarae YC04158",
    });
    expect(screen.getByText("S-301 A: Tibor Blob Amber Fern")).toBeInTheDocument();
    expect(screen.getByText("In the library: Yarn Collective Tessarae YC04158")).toBeInTheDocument();
    // A value is never filled in from a sister item: there is no control here
    // that would do it, and the box is still empty.
    expect(screen.getByPlaceholderText("Value")).toHaveValue("");
  });
});
