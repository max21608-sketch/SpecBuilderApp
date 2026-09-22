// The infill screen's second tab: one row per QUESTION.
//
// "Show me all the jobs with dimensions missing." What these assert is that
// the heading is the question, the rows under it are the ITEMS, the rows
// arrive when a heading is opened, and an area filter narrows what is listed
// without touching the counts beside a heading.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionGroups, { type ApplyToRows, type QuestionSummary } from "@/components/infill/QuestionGroups";
import { NO_FILTERS, type Filters } from "@/components/infill/InfillTable";
import type { InfillQuestion } from "@/lib/infill";

function group(over: Partial<QuestionSummary> = {}): QuestionSummary {
  return {
    key: "field:3",
    requirementIds: ["req-1", "req-2"],
    heading: "Dimensions",
    fieldLabel: "Dimensions",
    toQuote: 3,
    rows: 4,
    records: 4,
    areas: ["Signature Suite", "Lobby"],
    ...over,
  };
}

function row(over: Partial<InfillQuestion> = {}): InfillQuestion {
  return {
    recordId: "rec-1",
    requirementId: "req-1",
    recordLabel: "DEMO-300-001",
    itemDescription: "Armchair, lounge",
    variantLabel: null,
    area: "Signature Suite",
    prompt: "Dimensions",
    fieldLabel: "Dimensions",
    section: null,
    jsonId: 3,
    localKey: null,
    requirementKind: "spec_field",
    tier: "to_quote",
    state: "missing",
    currentValue: null,
    answerId: "ans-1",
    answerVersion: 1,
    waiting: null,
    sisters: [],
    finishNote: null,
    dimensions: [],
    composed: null,
    ...over,
  };
}

function Harness({
  questions,
  areas = [
    { key: "signature suite", label: "Signature Suite", count: 3 },
    { key: "lobby", label: "Lobby", count: 2 },
  ],
  rowsByQuestion = {},
  onOpenQuestion = vi.fn(),
  onApply = vi.fn(async () => ({ ok: true as const, message: "Recorded." })),
}: {
  questions: QuestionSummary[];
  areas?: { key: string; label: string; count: number }[];
  rowsByQuestion?: Record<string, InfillQuestion[]>;
  onOpenQuestion?: (group: QuestionSummary) => void;
  onApply?: ApplyToRows;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  return (
    <QuestionGroups
      questions={questions}
      areas={areas}
      filters={filters}
      onFilters={setFilters}
      rowsByQuestion={rowsByQuestion}
      loadingQuestion={null}
      questionError={{}}
      onOpenQuestion={onOpenQuestion}
      onReloadQuestion={async () => {}}
      paletteFor={() => null}
      onSaveAnswer={async () => ({ ok: true, message: "Recorded." })}
      onSaveDimension={async () => ({ ok: true, message: "Recorded." })}
      onApply={onApply}
    />
  );
}

describe("QuestionGroups", () => {
  it("is one row per question, with how many items owe it", () => {
    render(<Harness questions={[group(), group({ key: "field:1", heading: "COM 1", records: 9, toQuote: 9, rows: 9 })]} />);
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
    expect(screen.getByText("COM 1")).toBeInTheDocument();
    expect(screen.queryByText("Armchair, lounge")).not.toBeInTheDocument();
  });

  it("says how many categories ask it, so a fold does not read as a duplicate", () => {
    render(<Harness questions={[group({ requirementIds: ["a", "b", "c"] })]} />);
    expect(screen.getByText("asked by 3 categories")).toBeInTheDocument();
  });

  it("fetches the items when a heading is opened, and not before", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<Harness questions={[group()]} onOpenQuestion={open} />);
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByText("Dimensions"));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "field:3" }));
  });

  it("names the ITEM on each row, because the heading already named the question", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        questions={[group()]}
        rowsByQuestion={{ "field:3": [row(), row({ recordId: "rec-2", recordLabel: "DEMO-300-002" })] }}
      />,
    );
    await user.click(screen.getByText("Dimensions"));
    expect(screen.getByRole("link", { name: "DEMO-300-001" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "DEMO-300-002" })).toBeInTheDocument();
    // And the edit control is the same one the by-item view uses.
    expect(screen.getAllByLabelText(/Which dimension/)).toHaveLength(2);
  });

  it("shows per-row tiers where a question blocks a quote on some items only", () => {
    render(<Harness questions={[group({ toQuote: 3, rows: 4 })]} />);
    expect(screen.getByText("TGQ on 3 of 4")).toBeInTheDocument();
  });

  it("AN AREA FILTER NARROWS WHAT IS LISTED AND CHANGES NO COUNT", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        questions={[
          group(),
          group({ key: "field:1", heading: "COM 1", areas: ["Lobby"], records: 2, rows: 2, toQuote: 2 }),
        ]}
        rowsByQuestion={{ "field:3": [row(), row({ recordId: "rec-2", recordLabel: "DEMO-300-002", area: "Lobby" })] }}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Filter by area"), "signature suite");
    expect(screen.getByText("Dimensions")).toBeInTheDocument();
    expect(screen.queryByText("COM 1")).not.toBeInTheDocument();
    // The heading's own numbers, untouched.
    const heading = screen.getByText("Dimensions").closest("tr")!;
    expect(within(heading).getByText("4")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 questions shown")).toBeInTheDocument();
  });

  it("says in words how many items the filters are hiding inside an opened heading", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        questions={[group()]}
        rowsByQuestion={{ "field:3": [row(), row({ recordId: "rec-2", recordLabel: "DEMO-300-002", area: "Lobby" })] }}
      />,
    );
    await user.click(screen.getByText("Dimensions"));
    await user.selectOptions(screen.getByLabelText("Filter by area"), "signature suite");
    expect(screen.getByText(/1 more item owes this, hidden by your filters/)).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness questions={[group()]} />);
    await user.type(screen.getByLabelText("Search the questions"), "nothing like this");
    expect(screen.getByText("Nothing matches those filters.")).toBeInTheDocument();
  });
});

// ============================================================================
// THE APPLY-TO-ALL BAR (FIU 2026-09-22)
//
// "Access has been approved for everything." What these assert is the part
// that turns this into a worse screen if it is got wrong: what "all" MEANS —
// the rows drawn under the heading, never the ones a filter is hiding — that
// the bar says which number that is, that unticking one takes it out of the
// press, and that a dimension heading offers no tick at all.
// ============================================================================
describe("QuestionGroups — one value on the ticked items", () => {
  const access = () =>
    group({ key: "field:6", heading: "Access", fieldLabel: "Access", toQuote: 3, rows: 3, records: 3, areas: ["Signature Suite", "Lobby"] });

  /** Three items owing Access, two of them in the Signature Suite. */
  const accessRows = () => [
    row({ recordId: "rec-1", requirementId: "req-a", recordLabel: "DEMO-300-001", jsonId: 6, prompt: "Is access ok?" }),
    row({ recordId: "rec-2", requirementId: "req-a", recordLabel: "DEMO-300-002", jsonId: 6, prompt: "Is access ok?" }),
    row({
      recordId: "rec-3",
      requirementId: "req-b",
      recordLabel: "DEMO-300-003",
      jsonId: 6,
      prompt: "Is access ok?",
      area: "Lobby",
    }),
  ];

  it("ticks only the LOADED, VISIBLE rows, and says which number that is", async () => {
    const user = userEvent.setup();
    render(<Harness questions={[access()]} rowsByQuestion={{ "field:6": accessRows() }} />);
    await user.click(screen.getByText("Access"));

    await user.click(screen.getByLabelText("Select every item shown under Access"));
    expect(screen.getByText(/3 of the 3 items shown here are ticked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record on 3 items" })).toBeInTheDocument();
  });

  it("A FILTER NARROWS WHAT SELECT-ALL REACHES, AND THE BAR SAYS SO", async () => {
    const user = userEvent.setup();
    const apply = vi.fn<ApplyToRows>(async () => ({ ok: true as const, message: "Recorded." }));
    render(<Harness questions={[access()]} rowsByQuestion={{ "field:6": accessRows() }} onApply={apply} />);
    await user.click(screen.getByText("Access"));
    await user.selectOptions(screen.getByLabelText("Filter by area"), "signature suite");

    await user.click(screen.getByLabelText("Select every item shown under Access"));
    // Two on screen, one hidden — and the hidden one is NOT written.
    expect(screen.getByText(/2 of the 2 items shown here are ticked/)).toBeInTheDocument();
    expect(screen.getByText(/1 more owe this question and is hidden by your filters/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Record on 2 items" }));
    expect(apply).toHaveBeenCalledTimes(1);
    const sent = apply.mock.calls[0]![0];
    expect(sent.map((entry) => entry.recordId)).toEqual(["rec-1", "rec-2"]);
  });

  it("unticking one takes it out of the press", async () => {
    const user = userEvent.setup();
    const apply = vi.fn<ApplyToRows>(async () => ({ ok: true as const, message: "Recorded." }));
    render(<Harness questions={[access()]} rowsByQuestion={{ "field:6": accessRows() }} onApply={apply} />);
    await user.click(screen.getByText("Access"));
    await user.click(screen.getByLabelText("Select every item shown under Access"));
    await user.click(screen.getByLabelText("Include DEMO-300-002"));

    expect(screen.getByText(/2 of the 3 items shown here are ticked/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record on 2 items" }));
    const sent = apply.mock.calls[0]![0];
    expect(sent.map((entry) => entry.recordId)).toEqual(["rec-1", "rec-3"]);
  });

  it("sends the value that is in the box, and reports what came back", async () => {
    const user = userEvent.setup();
    const apply = vi.fn<ApplyToRows>(async () => ({
      ok: true as const,
      message: "Recorded on 3 items, under one change. 1 left alone: DEMO-300-009 — already answered.",
    }));
    render(<Harness questions={[access()]} rowsByQuestion={{ "field:6": accessRows() }} onApply={apply} />);
    await user.click(screen.getByText("Access"));
    await user.click(screen.getByLabelText("Select every item shown under Access"));
    await user.type(screen.getAllByPlaceholderText("Value")[0]!, "Approved");
    await user.click(screen.getByRole("button", { name: "Record on 3 items" }));

    expect(apply.mock.calls[0]![1]).toEqual({ value: "Approved", state: "confirmed" });
    expect(screen.getByText(/1 left alone: DEMO-300-009 — already answered\./)).toBeInTheDocument();
  });

  it("NEVER ON A DIMENSION HEADING, and says why instead", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        questions={[group()]}
        rowsByQuestion={{ "field:3": [row(), row({ recordId: "rec-2", recordLabel: "DEMO-300-002" })] }}
      />,
    );
    await user.click(screen.getByText("Dimensions"));
    expect(screen.queryByLabelText(/Select every item shown/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Include DEMO-300-001")).not.toBeInTheDocument();
    expect(screen.getByText(/Dimensions are recorded one item at a time/)).toBeInTheDocument();
  });

  it("offers no tick on an answer already settled", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        questions={[access()]}
        rowsByQuestion={{
          "field:6": [
            row({ recordId: "rec-1", requirementId: "req-a", recordLabel: "DEMO-300-001", jsonId: 6 }),
            row({
              recordId: "rec-2",
              requirementId: "req-a",
              recordLabel: "DEMO-300-002",
              jsonId: 6,
              state: "confirmed",
              currentValue: "Approved",
            }),
          ],
        }}
      />,
    );
    await user.click(screen.getByText("Access"));
    expect(screen.getByLabelText("Include DEMO-300-001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Include DEMO-300-002")).not.toBeInTheDocument();
    expect(screen.getByText("already answered — change that one on its own")).toBeInTheDocument();
    expect(screen.getByText(/1 cannot be included and say why on the row/)).toBeInTheDocument();
  });
});
