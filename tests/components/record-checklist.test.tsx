// The checklist tab: four tiles that filter, and a right-hand column that is
// the next action rather than provenance alone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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

const attribute = (over: Partial<ChecklistAttribute> = {}): ChecklistAttribute => ({
  json_id: 3,
  dimension_slot: "W",
  value: "720",
  unit: "mm",
  state: "confirmed",
  finish_state: null,
  source_run_id: "run-1",
  source_page: 4,
  source_filename: "Issue A.pdf",
  ...over,
});

const ATTRIBUTES: ChecklistAttribute[] = [attribute()];

/** Matthew's rows 4-7: one BWS id, four slots. Row 32 re-checks the whole cell. */
const DIMENSION_MATRIX = [
  { gate: "TGQ" as const, jsonId: 3, localKey: null, fieldName: "Width - W", dimensionSlot: "W" as const },
  { gate: "TGQ" as const, jsonId: 3, localKey: null, fieldName: "Depth - D", dimensionSlot: "D" as const },
  { gate: "TGQ" as const, jsonId: 3, localKey: null, fieldName: "Height - H", dimensionSlot: "H" as const },
  { gate: "TGQ" as const, jsonId: 3, localKey: null, fieldName: "Seat height - SH", dimensionSlot: "SH" as const },
  { gate: "TG1" as const, jsonId: 3, localKey: null, fieldName: "Dimensions confirmed", dimensionSlot: null },
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
  const onRecordDimension = vi.fn().mockResolvedValue(true);
  render(
    <RecordChecklist
      recordId="rec-1"
      projectId="proj-1"
      answers={ANSWERS}
      level="simple"
      tgqMatrix={null}
      matrixFields={[
        { gate: "TGQ", jsonId: 3, localKey: null, fieldName: "Dimensions", dimensionSlot: null },
        { gate: "TG1", jsonId: 3, localKey: null, fieldName: "Dimensions", dimensionSlot: null },
      ]}
      palettes={[]}
      paletteByQuestion={[]}
      waiting={{}}
      designerContact={{ name: "Hayley Ross", designer_code: "PDS" }}
      attributes={ATTRIBUTES}
      readiness={READINESS}
      savingId={null}
      reloadKey={0}
      dimensionNote={null}
      onSave={onSave}
      onRecordDimension={onRecordDimension}
      {...over}
    />,
  );
  return { onSave, onRecordDimension };
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

  // FIU 9. The row printed `BWS 1 · COM 1`, and on a row whose field had no
  // name, a bare `3 ·`. The ordinal is the export's key and means nothing to
  // the person answering the question.
  it("prints the BWS field NAME and never its ordinal, keeping the ordinal on hover", () => {
    renderChecklist({
      readiness: { ...READINESS, toQuote: 0 },
      answers: [answer({ requirement_id: "q9", prompt: "Main fabric", json_id: 1, field_name: "COM 1 " })],
    });
    expect(screen.getByText("COM 1")).toBeInTheDocument();
    expect(screen.queryByText(/BWS 1/)).not.toBeInTheDocument();
    expect(screen.queryByText("1 · COM 1")).not.toBeInTheDocument();
    expect(screen.getByTitle("BWS field 1")).toHaveTextContent("COM 1");
  });

  // ---- 2.8 step 1: the project-wide section, folded ------------------------
  //
  // Matthew: *"you do that once for the project presumably?"* Nothing about
  // the data changes — the questions are still asked of this record and still
  // counted in the tiles. What changes is that they are not the first thing on
  // the tab.
  const WITH_PROJECT_WIDE: ChecklistAnswer[] = [
    answer({ requirement_id: "p1", prompt: "TOE agreement", section: "Project / commercial", state: "missing" }),
    answer({ requirement_id: "p2", prompt: "Sales folder", section: "Project / commercial", state: "confirmed", value: "Set" }),
    answer({ requirement_id: "i1", prompt: "Seat height", section: "Dimensions and construction", state: "missing" }),
  ];

  it("folds the project-wide section, last and closed, with its outstanding count on the toggle", () => {
    renderChecklist({
      answers: WITH_PROJECT_WIDE,
      readiness: { ...READINESS, toQuote: 0, alsoOutstanding: 2, outstanding: 2, settled: 1, notApplicable: 0 },
    });
    expect(screen.getByText("Project-wide — the same answer applies to every item")).toBeInTheDocument();
    // Closed: the rows inside are not on the page.
    expect(screen.queryByText("TOE agreement")).not.toBeInTheDocument();
    expect(screen.getByText("Seat height")).toBeInTheDocument();
    // THE COUNT IS ON THE TOGGLE. A closed fold with no number on it is how an
    // outstanding question stops being seen at all.
    expect(screen.getByText(/1 outstanding · 2 of 2 here/)).toBeInTheDocument();
    // And it is the LAST card on the tab.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent ?? "");
    expect(headings[headings.length - 1]).toContain("Project-wide");
  });

  it("opens the fold on a click, leaving everything else where it was", async () => {
    renderChecklist({
      answers: WITH_PROJECT_WIDE,
      readiness: { ...READINESS, toQuote: 0, alsoOutstanding: 2, outstanding: 2, settled: 1, notApplicable: 0 },
    });
    await userEvent.click(screen.getByRole("button", { name: /1 outstanding/ }));
    expect(screen.getByText("TOE agreement")).toBeInTheDocument();
    expect(screen.getByText("Sales folder")).toBeInTheDocument();
    expect(screen.getByText("Seat height")).toBeInTheDocument();
  });

  it("draws no fold at all for a category that asks nothing project-wide", () => {
    renderChecklist({ readiness: { ...READINESS, toQuote: 0 } });
    expect(screen.queryByText(/Project-wide/)).not.toBeInTheDocument();
  });

  it("reads 0 outstanding, and stays closed, once every project-wide question is settled", () => {
    renderChecklist({
      answers: [
        answer({ requirement_id: "p1", prompt: "TOE agreement", section: "Project / commercial", state: "confirmed", value: "Signed" }),
        answer({ requirement_id: "p2", prompt: "Sales folder", section: "Project / commercial", state: "na" }),
        answer({ requirement_id: "i1", prompt: "Seat height", section: "Dimensions and construction", state: "missing" }),
      ],
      readiness: { ...READINESS, toQuote: 0, alsoOutstanding: 1, outstanding: 1, settled: 1, notApplicable: 1 },
    });
    expect(screen.getByText(/0 outstanding · 2 of 2 here/)).toBeInTheDocument();
    expect(screen.queryByText("TOE agreement")).not.toBeInTheDocument();
  });

  it("prints nothing extra for a readiness question, which has no BWS field at all", () => {
    renderChecklist({
      readiness: { ...READINESS, toQuote: 0 },
      answers: [answer({ requirement_id: "q10", prompt: "Headboard fitted?", local_key: "headboard_fitted" })],
    });
    expect(screen.getByText("Headboard fitted?")).toBeInTheDocument();
    // Never "BWS null" and never a naked separator.
    expect(screen.queryByText(/BWS/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/BWS field/)).not.toBeInTheDocument();
  });
});

// ============================================================================
// ARRIVING BY AN ANCHOR SHOWS EVERY ROW, SO EVERY ROW HAS TO RENDER.
//
// A LINK FROM THE PHASE TABLE'S DISCLOSURE (1.12) TOOK THE SCREEN DOWN:
// `?tab=checklist#q-<id>` rendered "Application error: a client-side
// exception has occurred", and `?tab=checklist` alone and `#q-<id>` alone were
// both fine. The COMBINATION is the whole of it. The hash clears the default
// TGQ filter — a linked question is routinely one the filter would hide — so
// rows that are otherwise never listed reach the screen, and one of them
// carried a state the tone map had no entry for. `TONE[undefined].chip` threw.
//
// The state was NULL, off `GET /api/records/[id]`: it drives its answers off
// the requirements table with a LEFT JOIN and did not coalesce, so a question
// with no answer row came back stateless. Every filter tests the state, so
// such a row was silently dropped from every view except the unfiltered one —
// which is why only the anchor could reach it.
//
// Both halves are fixed: the route coalesces to `missing`, and
// `answerStateTone` falls back to `plain` rather than throwing. These hold the
// SCREEN's half, which is the one a payload cannot take away.
// ============================================================================
describe("the checklist reached by an anchor", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  /** Every state the vocabulary holds, plus the two a payload has produced. */
  const EVERY_STATE: ChecklistAnswer[] = [
    answer({ requirement_id: "s1", prompt: "Confirmed question", state: "confirmed", value: "Yes" }),
    answer({ requirement_id: "s2", prompt: "TBC question", state: "tbc" }),
    answer({ requirement_id: "s3", prompt: "Missing question", state: "missing" }),
    answer({ requirement_id: "s4", prompt: "N/A question", state: "na" }),
    // THE ROW THAT CRASHED IT. A question with no answer row at all: no id, no
    // version, and — before the route coalesced it — no state. The type says
    // this cannot happen and the database said otherwise.
    answer({
      requirement_id: "s5",
      prompt: "Question nobody has looked at",
      answer_id: null,
      state: null as unknown as ChecklistAnswer["state"],
    }),
  ];

  it("renders every state, including one the payload left stateless", () => {
    window.location.hash = "#q-s5";
    renderChecklist({ answers: EVERY_STATE, readiness: { ...READINESS, toQuote: 2, outstanding: 3 } });
    // The anchor clears the filter, so all five are on the page — which is the
    // point of clearing it, and the reason the crash was reachable.
    expect(screen.getByText("showing 5 of 5")).toBeInTheDocument();
    for (const prompt of [
      "Confirmed question",
      "TBC question",
      "Missing question",
      "N/A question",
      "Question nobody has looked at",
    ]) {
      expect(screen.getByText(prompt)).toBeInTheDocument();
    }
  });

  it("puts the linked question on the page with its own anchor to scroll to", () => {
    window.location.hash = "#q-s5";
    renderChecklist({ answers: EVERY_STATE, readiness: { ...READINESS, toQuote: 2, outstanding: 3 } });
    // The id the phase table's disclosure links to, and the row it names.
    const target = document.getElementById("q-s5");
    expect(target).not.toBeNull();
    expect(within(target as HTMLElement).getByText("Question nobody has looked at")).toBeInTheDocument();
  });

  // A STATE THE MAP DOES NOT HOLD IS PLAIN, NEVER A THROW. `intakeStatusTone`'s
  // rule, and the one that survives whatever a future payload does.
  // A DEEP LINK INTO THE FOLD OPENS IT. The gates tab, the phase table's
  // disclosure and the chase screen all link to one question by its anchor,
  // and four of Matthew's matrix rows live in the project-wide section — a
  // link that landed on a closed fold would look like a link to nothing.
  it("opens the project-wide fold when the anchor names a question inside it", () => {
    window.location.hash = "#q-p1";
    renderChecklist({
      answers: [
        answer({ requirement_id: "p1", prompt: "TOE agreement", section: "Project / commercial", state: "missing" }),
        answer({ requirement_id: "i1", prompt: "Seat height", section: "Dimensions and construction", state: "missing" }),
      ],
      readiness: { ...READINESS, toQuote: 0, alsoOutstanding: 2, outstanding: 2, settled: 0, notApplicable: 0 },
    });
    const target = document.getElementById("q-p1");
    expect(target).not.toBeNull();
    expect(within(target as HTMLElement).getByText("TOE agreement")).toBeInTheDocument();
  });

  it("leaves the fold closed for an anchor that names a question outside it", () => {
    window.location.hash = "#q-i1";
    renderChecklist({
      answers: [
        answer({ requirement_id: "p1", prompt: "TOE agreement", section: "Project / commercial", state: "missing" }),
        answer({ requirement_id: "i1", prompt: "Seat height", section: "Dimensions and construction", state: "missing" }),
      ],
      readiness: { ...READINESS, toQuote: 0, alsoOutstanding: 2, outstanding: 2, settled: 0, notApplicable: 0 },
    });
    expect(screen.getByText("Seat height")).toBeInTheDocument();
    expect(screen.queryByText("TOE agreement")).not.toBeInTheDocument();
  });

  it("colours a state it has never seen as plain rather than going white", () => {
    window.location.hash = "#q-s6";
    expect(() =>
      renderChecklist({
        answers: [
          answer({
            requirement_id: "s6",
            prompt: "Something new",
            state: "withdrawn" as unknown as ChecklistAnswer["state"],
          }),
        ],
        readiness: { ...READINESS, toQuote: 0, outstanding: 0 },
      }),
    ).not.toThrow();
    expect(screen.getByText("Something new")).toBeInTheDocument();
  });
});

// ============================================================================
// THE DIMENSIONS ROW IS ANSWERED SLOT BY SLOT, AND NEVER IN A BOX
//
// FIU 2026-09-21, the most consequential finding in the file: the Answer cell
// was a plain text box, `W1900 x D1400mm` was typed into it and marked
// Confirmed on an item with no height and no seat height, and the TGQ tile
// read 0. The string carries no W/D/H/SH, so nothing downstream could say the
// other two were never taken — and a typed answer is written `manual`, which
// puts the cell out of reach of every later drawing or email confirm.
//
// These hold the screen's half: the box is gone, the slots are listed with
// what the category needs, and a value somebody already typed is NAMED rather
// than replaced.
// ============================================================================
describe("the checklist's Dimensions row", () => {
  const DIMENSIONS_ONLY = [
    answer({ requirement_id: "q1", prompt: "Dimensions", json_id: 3, state: "confirmed", value: "W1900 x D1400mm" }),
  ];
  const READY = { ...READINESS, toQuote: 0, alsoOutstanding: 0, outstanding: 0, settled: 1, notApplicable: 0 };

  const renderDimensions = (over: Partial<Parameters<typeof RecordChecklist>[0]> = {}) =>
    renderChecklist({
      answers: DIMENSIONS_ONLY,
      readiness: READY,
      matrixFields: DIMENSION_MATRIX,
      attributes: [
        attribute({ dimension_slot: "W", value: "1900" }),
        attribute({ dimension_slot: "D", value: "1400" }),
      ],
      ...over,
    });

  it("offers the five slots and NO free-text box for the composed cell", () => {
    renderDimensions();
    // The cell is a projection, so it is shown and not edited — once as the
    // answer on record, once as what the slots now compose to. They can
    // legitimately differ, which is why both are printed.
    expect(screen.getAllByText("W1900 x D1400mm")).toHaveLength(2);
    expect(screen.queryByPlaceholderText("Value")).not.toBeInTheDocument();
    const slots = screen.getByLabelText("Which dimension of Dimensions");
    for (const label of ["Width", "Depth", "Height", "Seat height", "Diameter"]) {
      expect(within(slots).getByRole("option", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    // A slot already on record cannot be recorded twice.
    expect(within(slots).getByRole("option", { name: /Width — already recorded/ })).toBeDisabled();
  });

  it("marks the slots MATTHEW'S MATRIX asks of this category, and counts what is on record", () => {
    renderDimensions();
    // W and D are on record; H and SH are named as missing, Dia is not asked.
    expect(screen.getByText("2 of the 4 this item needs are on record")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Dimension slots for Dimensions" });
    const items = within(list)
      .getAllByRole("listitem")
      .map((node) => node.textContent?.replace(/\s+/g, " ").trim());
    expect(items).toEqual([
      "Width 1900mm",
      "Depth 1400mm",
      "Height not measured",
      "Seat height not measured",
      "Diameter —",
    ]);
  });

  it("requires NONE where his matrix does not reach the category, and says why", () => {
    // `gatesForRecord`'s rule in a second place: null is not an empty set.
    // "All four, always" would report a missing seat height on a bedside table.
    renderDimensions({ matrixFields: null });
    const list = screen.getByRole("list", { name: "Dimension slots for Dimensions" });
    expect(within(list).queryByText("not measured")).not.toBeInTheDocument();
    expect(screen.queryByText(/this item needs are on record/)).not.toBeInTheDocument();
    expect(screen.getByText(/matrix does not cover this category/)).toBeInTheDocument();
    // Still five slots to record, because nothing says they are wrong.
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });

  it("NAMES a value somebody typed with nothing behind it, and does not overwrite it", () => {
    // A person's own statement. Their next Record supersedes it; nothing else.
    renderDimensions({ attributes: [] });
    // ONCE only: there is nothing measured for the composer to work from, and
    // the gap between the two is the whole finding.
    expect(screen.getAllByText("W1900 x D1400mm")).toHaveLength(1);
    expect(screen.getByText("typed, with no measurements behind it")).toBeInTheDocument();
    expect(screen.getByText("0 of the 4 this item needs are on record")).toBeInTheDocument();
    // Nothing on the row can rewrite it: there is no box, and no control that
    // clears it.
    expect(screen.queryByPlaceholderText("Value")).not.toBeInTheDocument();
  });

  it("writes a slot, a figure and a unit — an ATTRIBUTE, never the answer", async () => {
    const user = userEvent.setup();
    const { onSave, onRecordDimension } = renderDimensions();
    await user.selectOptions(screen.getByLabelText("Which dimension of Dimensions"), "H");
    await user.type(screen.getByLabelText("Figure for Dimensions"), "760");
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(onRecordDimension).toHaveBeenCalledWith({ slot: "H", value: "760", unit: "mm" });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables itself while the write is in flight, so one slot is not posted twice", async () => {
    const user = userEvent.setup();
    let release: (ok: boolean) => void = () => {};
    const onRecordDimension = vi.fn().mockReturnValue(new Promise<boolean>((resolve) => (release = resolve)));
    renderDimensions({ onRecordDimension });
    await user.selectOptions(screen.getByLabelText("Which dimension of Dimensions"), "H");
    await user.type(screen.getByLabelText("Figure for Dimensions"), "760");
    await user.click(screen.getByRole("button", { name: "Record" }));
    // A second click before the first returns would post H twice, and the
    // second is refused as `slot_occupied` — which reads as a defect.
    expect(await screen.findByRole("button", { name: "Recording…" })).toBeDisabled();
    expect(onRecordDimension).toHaveBeenCalledTimes(1);
    await act(async () => release(true));
    expect(await screen.findByRole("button", { name: "Record" })).toBeInTheDocument();
  });

  it("keeps the composed cell honest: it is the app's one composer, note and all", () => {
    renderDimensions({ dimensionNote: "1250 L-shaped return" });
    expect(screen.getByText("W1900 x D1400mm (1250 L-shaped return)")).toBeInTheDocument();
  });
});
