// The infill screen's list of furniture lines.
//
// The rules under test are the chase screen's, in a second place: a line is
// ONE row until you open it, a filter narrows what is LISTED and never the
// counts beside it, the finish-option count is the true one, and a line's
// questions arrive when it is opened rather than with the page.
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InfillTable, { NO_FILTERS, type Filters } from "@/components/infill/InfillTable";
import type { InfillLineSummary, InfillQuestion } from "@/lib/infill";

function line(over: Partial<InfillLineSummary> = {}): InfillLineSummary {
  return {
    lineId: "line-1",
    recordLabel: "AP364c-011",
    code: "S-301",
    itemDescription: "Desk chair",
    qty: 45,
    runId: "run-1",
    runName: "MAIN RUN",
    level: "hero",
    area: "Signature Suite",
    counts: { toQuote: 4, later: 9, waiting: 0 },
    states: { missing: 12, tbc: 1 },
    optionCount: 0,
    options: [],
    ...over,
  };
}

function question(over: Partial<InfillQuestion> = {}): InfillQuestion {
  return {
    recordId: "line-1",
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
    answerVersion: 1,
    waiting: null,
    sisters: [],
    finishNote: null,
    dimensions: null,
    composed: null,
    ...over,
  };
}

/** Filters live on the page, so the harness holds them the way the page does. */
function Harness({
  lines,
  questionsByLine = {},
  onOpenLine = vi.fn(),
}: {
  lines: InfillLineSummary[];
  questionsByLine?: Record<string, InfillQuestion[]>;
  onOpenLine?: (lineId: string) => void;
}) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  return (
    <InfillTable
      lines={lines}
      phases={[{ id: "run-1", name: "MAIN RUN" }, { id: "run-2", name: "MUR" }]}
      filters={filters}
      onFilters={setFilters}
      questionsByLine={questionsByLine}
      loadingLine={null}
      lineError={{}}
      onOpenLine={onOpenLine}
      onReloadLine={async () => {}}
      paletteFor={() => null}
      onSaveAnswer={async () => ({ ok: true, message: "Recorded." })}
      onSaveDimension={async () => ({ ok: true, message: "Recorded." })}
      answered={{}}
    />
  );
}

describe("InfillTable", () => {
  it("is one row per furniture line, collapsed, with the line's own two counts", () => {
    render(<Harness lines={[line(), line({ lineId: "line-2", code: "S-100", recordLabel: "AP364c-012" })]} />);
    expect(screen.getByRole("link", { name: "S-301" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "S-100" })).toBeInTheDocument();
    // No questions until a line is opened.
    expect(screen.queryByText("Main fabric")).not.toBeInTheDocument();
  });

  it("fetches a line's questions when it is opened, and not before", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(<Harness lines={[line()]} onOpenLine={open} />);
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByText("Desk chair"));
    expect(open).toHaveBeenCalledWith("line-1");
  });

  it("shows the questions it has been given, with the edit box in them", async () => {
    const user = userEvent.setup();
    render(<Harness lines={[line()]} questionsByLine={{ "line-1": [question()] }} />);
    await user.click(screen.getByText("Desk chair"));
    expect(screen.getByText("Main fabric")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Value")).toBeInTheDocument();
  });

  it("A FILTER NARROWS WHAT IS LISTED AND CHANGES NO COUNT", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        lines={[
          line(),
          line({ lineId: "line-2", code: "S-100", itemDescription: "Sofa", recordLabel: "AP364c-012" }),
        ]}
      />,
    );
    await user.type(screen.getByLabelText("Search what is outstanding"), "sofa");
    expect(screen.queryByRole("link", { name: "S-301" })).not.toBeInTheDocument();
    const row = screen.getByRole("link", { name: "S-100" }).closest("tr")!;
    // The line's own numbers, untouched by the filter that hid its neighbour.
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("9")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 items shown")).toBeInTheDocument();
  });

  it("hides a line with nothing in the half being filtered for, and keeps one that has some", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        lines={[
          line({ counts: { toQuote: 0, later: 3, waiting: 0 } }),
          line({ lineId: "line-2", code: "S-100", counts: { toQuote: 2, later: 0, waiting: 0 } }),
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Filter by what blocks a quote"), "to_quote");
    expect(screen.queryByRole("link", { name: "S-301" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "S-100" })).toBeInTheDocument();
  });

  it("narrows by state using the line's own state counts, before anything is opened", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        lines={[
          line({ states: { missing: 3, tbc: 0 } }),
          line({ lineId: "line-2", code: "S-100", states: { missing: 0, tbc: 2 } }),
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Filter by answer state"), "tbc");
    expect(screen.queryByRole("link", { name: "S-301" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "S-100" })).toBeInTheDocument();
  });

  it("prints the TRUE number of finish options, including one with nothing outstanding", () => {
    render(
      <Harness
        lines={[
          line({
            optionCount: 2,
            options: [{ recordId: "opt-a", label: "A", name: "S-301 A", counts: { toQuote: 2, later: 0, waiting: 0 } }],
          }),
        ]}
      />,
    );
    expect(screen.getByText(/2 finish options/)).toBeInTheDocument();
    expect(screen.getByText(/1 has nothing outstanding/)).toBeInTheDocument();
  });

  it("never apportions a quantity to a finish option", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        lines={[
          line({
            optionCount: 1,
            options: [{ recordId: "opt-a", label: "A", name: "S-301 A", counts: { toQuote: 1, later: 0, waiting: 0 } }],
          }),
        ]}
        questionsByLine={{ "line-1": [question({ recordId: "opt-a", variantLabel: "A" })] }}
      />,
    );
    await user.click(screen.getByText("Desk chair"));
    expect(screen.getByText(/quantity not allocated/)).toBeInTheDocument();
  });

  it("AN AREA FILTER NARROWS WHAT IS LISTED AND CHANGES NO COUNT", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        lines={[
          line({ area: "Signature Suite" }),
          // Same room, spelled differently by the bill. One option, or picking
          // either hides half the room.
          line({ lineId: "line-2", code: "S-100", area: "signature suite" }),
          line({ lineId: "line-3", code: "S-402", area: "Lobby" }),
          line({ lineId: "line-4", code: "S-500", area: null }),
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Filter by area"), "signature suite");
    expect(screen.getByRole("link", { name: "S-301" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "S-100" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "S-402" })).not.toBeInTheDocument();
    const row = screen.getByRole("link", { name: "S-301" }).closest("tr")!;
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 items shown")).toBeInTheDocument();
  });

  it("a line with no area is REACHABLE rather than dropped", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        lines={[line({ area: "Lobby" }), line({ lineId: "line-2", code: "S-500", area: null })]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Filter by area"), "__none__");
    expect(screen.getByRole("link", { name: "S-500" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "S-301" })).not.toBeInTheDocument();
  });

  it("sends a level-less line to the record, because a level is a decision taken there", () => {
    render(<Harness lines={[line({ level: null })]} />);
    expect(screen.getByRole("link", { name: "Set level" })).toHaveAttribute("href", "/dashboard/records/line-1");
  });

  it("says so when the filters match nothing at all", async () => {
    const user = userEvent.setup();
    render(<Harness lines={[line()]} />);
    await user.type(screen.getByLabelText("Search what is outstanding"), "nothing like this");
    expect(screen.getByText("Nothing matches those filters.")).toBeInTheDocument();
  });
});
