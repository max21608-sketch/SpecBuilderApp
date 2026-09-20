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
import QuestionGroups, { type QuestionSummary } from "@/components/infill/QuestionGroups";
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
}: {
  questions: QuestionSummary[];
  areas?: { key: string; label: string; count: number }[];
  rowsByQuestion?: Record<string, InfillQuestion[]>;
  onOpenQuestion?: (group: QuestionSummary) => void;
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
