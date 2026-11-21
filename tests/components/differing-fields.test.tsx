// The fields that make a configuration different (L3, 2026-11-21).
//
// A fabric question a seed added after the configuration was categorised has
// no answer row, and this panel disabled its box: a dead end at the top of the
// configuration's screen. The first answer now creates the row, through the
// same save the Checklist tab uses (`useChecklistSave` → `answerRequest`), so
// the box is open and its save carries the question.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DifferingFields, { type DifferingAnswer } from "@/components/records/DifferingFields";

function answer(over: Partial<DifferingAnswer> = {}): DifferingAnswer {
  return {
    answer_id: "ans-1",
    requirement_id: "req-1",
    prompt: "Main fabric",
    field_name: "COM 1",
    json_id: 1,
    local_key: null,
    value: null,
    qualifier: null,
    state: "missing",
    version: 1,
    ...over,
  };
}

describe("DifferingFields", () => {
  it("opens the box of a fabric question with no answer row yet, and saves it with its question", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const rowless = answer({ answer_id: null, requirement_id: "req-2", prompt: "Second fabric", field_name: "COM 2", json_id: 2 });
    render(
      <DifferingFields
        answers={[answer(), rowless]}
        palettes={[]}
        paletteByQuestion={[]}
        savingId={null}
        refusals={{}}
        onSave={onSave}
      />,
    );
    const boxes = screen.getAllByPlaceholderText("Value");
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toBeEnabled();
    await user.type(boxes[1]!, "Velvet");
    await user.tab();
    expect(onSave).toHaveBeenCalledWith(rowless, "Velvet", "confirmed");
  });

  it("disables only the box whose own save is in flight, row or no row", () => {
    const rowless = answer({ answer_id: null, requirement_id: "req-2", prompt: "Second fabric", field_name: "COM 2", json_id: 2 });
    render(
      <DifferingFields
        answers={[answer(), rowless]}
        palettes={[]}
        paletteByQuestion={[]}
        savingId="q:req-2"
        refusals={{}}
        onSave={vi.fn()}
      />,
    );
    const boxes = screen.getAllByPlaceholderText("Value");
    expect(boxes[0]).toBeEnabled();
    expect(boxes[1]).toBeDisabled();
  });
});
