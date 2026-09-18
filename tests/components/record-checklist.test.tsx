// The checklist tab: four tiles that filter, and a right-hand column that is
// the next action rather than provenance alone.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordChecklist, {
  type ChecklistAnswer,
  type ChecklistAttribute,
} from "@/components/records/RecordChecklist";

const answer = (over: Partial<ChecklistAnswer> & { requirement_id: string }): ChecklistAnswer => ({
  prompt: "A question",
  help_text: null,
  section: "Dimensions and construction",
  tgq_levels: ["simple", "complex", "hero"],
  field_name: null,
  json_id: null,
  local_key: null,
  answer_id: `a-${over.requirement_id}`,
  value: null,
  qualifier: null,
  state: "missing",
  version: 1,
  ...over,
});

const ANSWERS: ChecklistAnswer[] = [
  answer({ requirement_id: "q1", prompt: "Dimensions", json_id: 3, state: "confirmed", value: "W720 x D780mm" }),
  answer({ requirement_id: "q2", prompt: "Seat upholstery build", state: "missing" }),
  answer({ requirement_id: "q3", prompt: "Stitching spec", state: "tbc", tgq_levels: [] }),
  answer({ requirement_id: "q4", prompt: "Delivery week", state: "na", section: "Commercial" }),
];

const ATTRIBUTES: ChecklistAttribute[] = [
  {
    json_id: 3,
    dimension_slot: "W",
    finish_state: null,
    source_run_id: "run-1",
    source_page: 4,
    source_filename: "Issue A.pdf",
  },
];

const READINESS = {
  toQuote: 1,
  alsoOutstanding: 1,
  outstanding: 2,
  settled: 1,
  notApplicable: 1,
  noLevel: false,
};

function renderChecklist(over: Partial<Parameters<typeof RecordChecklist>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <RecordChecklist
      recordId="rec-1"
      projectId="proj-1"
      answers={ANSWERS}
      level="simple"
      tgqMatrix={null}
      matrixFields={[
        { gate: "TGQ", jsonId: 3, localKey: null, fieldName: "Dimensions" },
        { gate: "TG1", jsonId: 3, localKey: null, fieldName: "Dimensions" },
      ]}
      palettes={[]}
      paletteByQuestion={[]}
      waiting={{}}
      designerContact={{ name: "Hayley Ross", designer_code: "PDS" }}
      attributes={ATTRIBUTES}
      readiness={READINESS}
      savingId={null}
      reloadKey={0}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave };
}

describe("the record checklist", () => {
  it("opens filtered to the questions that block a quote, and says so in words", () => {
    renderChecklist();
    // The filter is repeated as a removable chip and the footer counts it: a
    // filter you cannot see is a filter you forget you set.
    expect(screen.getByText("TGQ ✕")).toBeInTheDocument();
    expect(screen.getByText("showing 1 of 4")).toBeInTheDocument();
    expect(screen.getByText("Seat upholstery build")).toBeInTheDocument();
    expect(screen.queryByText("Delivery week")).not.toBeInTheDocument();
  });

  it("does not open filtered where the record has no level, because the number does not exist", () => {
    // `toQuote` null means the fallback model with no level. Filtering to a
    // number that does not exist would show an empty screen with no reason.
    renderChecklist({ readiness: { ...READINESS, toQuote: null, alsoOutstanding: null, noLevel: true } });
    expect(screen.getByText("showing 4 of 4")).toBeInTheDocument();
    expect(screen.getByText("no level, so nothing is tiered")).toBeInTheDocument();
  });

  it("narrows what is LISTED and never the record's own counts", async () => {
    renderChecklist();
    await userEvent.click(screen.getByRole("button", { name: /Settled/ }));
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
    expect(screen.queryByText("Seat upholstery build")).not.toBeInTheDocument();
    // The tiles still report the record, not the list.
    expect(screen.getByText("showing 1 of 4")).toBeInTheDocument();
    const tgq = screen.getByRole("button", { name: /TGQ/ });
    expect(within(tgq).getByText("1")).toBeInTheDocument();
  });

  it("splits also-outstanding into what nobody looked at and what somebody deferred", () => {
    // Missing and TBC are two different things: nobody has looked, versus a
    // person actively said not yet.
    renderChecklist();
    expect(screen.getByText("0 unlooked · 1 TBC")).toBeInTheDocument();
  });

  it("links a settled answer to the page it came from", () => {
    renderChecklist({ readiness: { ...READINESS, toQuote: 0 } });
    const link = screen.getByRole("link", { name: /Issue A.pdf p4/ });
    expect(link).toHaveAttribute("href", "/api/imports/run-1/source#page=4");
  });

  it("offers the person who owes an unanswered one, and says when it was last chased", () => {
    renderChecklist({
      readiness: { ...READINESS, toQuote: 0 },
      waiting: {
        "rec-1:q2:0": { draftId: "d1", sentAt: "2026-09-15T09:00:00.000Z", contactName: "Hayley Ross" },
      },
    });
    expect(screen.getByRole("link", { name: "chased 15 Sept 2026" })).toBeInTheDocument();
    // The one with no chase against it names the person instead.
    expect(screen.getByRole("link", { name: "Ask Hayley" })).toBeInTheDocument();
  });

  it("says where a field sits at two gates, because answering it once satisfies both", () => {
    renderChecklist({ readiness: { ...READINESS, toQuote: 0 } });
    expect(screen.getByText("TGQ and TG1 both")).toBeInTheDocument();
  });

  it("keeps the state a control, so TBC and N/A can still be recorded", async () => {
    const { onSave } = renderChecklist({ readiness: { ...READINESS, toQuote: 0 } });
    const state = screen.getByLabelText("State of Seat upholstery build");
    await userEvent.selectOptions(state, "tbc");
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ requirement_id: "q2" }), "", "tbc");
  });

  it("says in words that an uncategorised record has no questions rather than none outstanding", () => {
    renderChecklist({ answers: [] });
    expect(screen.getByText(/No checklist yet/)).toBeInTheDocument();
  });
});
