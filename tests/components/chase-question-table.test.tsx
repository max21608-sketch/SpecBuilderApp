// The chase screen, as a table of furniture lines.
//
// What these assert is the behaviour the flat list got wrong: a line is one
// row until you open it, its two counts are its own whatever the filter says,
// and a question that is ticked but hidden is still asked — and said to be.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChaseQuestionTable, { type TableQuestion } from "@/components/drafts/ChaseQuestionTable";

let n = 0;
function question(over: Partial<TableQuestion> = {}): TableQuestion {
  n += 1;
  return {
    recordId: "line-1",
    requirementId: `req-${n}`,
    recordLabel: "AP364c-011",
    prompt: `Question ${n}`,
    fieldLabel: "COM 1",
    requirementKind: "spec_field",
    tier: "to_quote",
    state: "missing",
    waiting: null,
    refs: "S-301",
    itemDescription: "Desk chair",
    level: "hero",
    qty: 45,
    runId: "run-1",
    runName: "MAIN RUN",
    parentId: null,
    variantLabel: null,
    parentRefs: "",
    parentQty: null,
    groupNo: 11,
    groupLabel: "AP364c-011",
    variantCount: 0,
    contactId: "c-1",
    contactName: "Claire Beaumont",
    ...over,
  };
}

/** The table with the page's own selection behaviour around it. */
function Harness({ questions }: { questions: TableQuestion[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <ChaseQuestionTable
      questions={questions}
      selected={selected}
      onToggle={(recordId, requirementId) =>
        setSelected((prev) => {
          const next = new Set(prev);
          const k = `${recordId}:${requirementId}`;
          if (next.has(k)) next.delete(k);
          else next.add(k);
          return next;
        })
      }
      onToggleMany={(list, on) =>
        setSelected((prev) => {
          const next = new Set(prev);
          for (const q of list) {
            const k = `${q.recordId}:${q.requirementId}`;
            if (on) next.add(k);
            else next.delete(k);
          }
          return next;
        })
      }
      generating={false}
      onGenerate={() => {}}
    />
  );
}

const line = () => screen.getByText("Desk chair").closest("tr")!;

describe("the furniture line is the row", () => {
  it("shows one row per line, with no questions until it is opened", async () => {
    render(<Harness questions={[question(), question(), question()]} />);
    expect(screen.getByText("S-301")).toBeTruthy();
    expect(screen.queryByText("Question 1")).toBeNull();

    await userEvent.click(screen.getByText("Desk chair"));
    expect(screen.getByText("Question 1")).toBeTruthy();
  });

  it("prints the line's own two counts, and the bill's quantity", () => {
    render(
      <Harness
        questions={[question(), question({ tier: "later" }), question({ requirementKind: "readiness" })]}
      />,
    );
    const cells = within(line()).getAllByRole("cell");
    // … Qty … To quote … Also
    expect(cells.map((cell) => cell.textContent)).toContain("45");
    // One blocks a quote; the later one and the readiness one are "also".
    expect(within(line()).getByText("1")).toBeTruthy();
    expect(within(line()).getByText("2")).toBeTruthy();
  });

  it("sends a level-less line to its record, in a new tab, rather than asking here", () => {
    render(<Harness questions={[question({ level: null })]} />);
    const link = screen.getByRole("link", { name: "Set level" });
    expect(link.getAttribute("href")).toBe("/dashboard/records/line-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("finish options", () => {
  const withOptions = () => [
    question({ variantCount: 2 }),
    question({
      recordId: "opt-a",
      variantLabel: "A",
      parentId: "line-1",
      refs: "",
      parentRefs: "S-301",
      qty: null,
      parentQty: 45,
    }),
    question({
      recordId: "opt-b",
      variantLabel: "B",
      parentId: "line-1",
      refs: "",
      parentRefs: "S-301",
      qty: null,
      parentQty: 45,
    }),
  ];

  it("nests them under their bill line, named as they are said out loud", async () => {
    render(<Harness questions={withOptions()} />);
    expect(screen.queryByText("S-301 A")).toBeNull();
    await userEvent.click(screen.getByText("Desk chair"));
    expect(screen.getByText("S-301 A")).toBeTruthy();
    expect(screen.getByText("S-301 B")).toBeTruthy();
  });

  it("says the bill line is a heading, and never apportions its quantity", async () => {
    render(<Harness questions={withOptions()} />);
    await userEvent.click(screen.getByText("Desk chair"));
    expect(screen.getByText(/This bill line is a heading/)).toBeTruthy();
    expect(screen.getAllByText(/quantity not allocated/).length).toBe(2);
  });

  it("ticks one finish option without ticking the other", async () => {
    render(<Harness questions={withOptions()} />);
    await userEvent.click(screen.getByText("Desk chair"));
    const optionA = screen.getByText("S-301 A").closest("tr")!;
    await userEvent.click(within(optionA).getByRole("checkbox"));
    // A's question only — B's is untouched, and the button says what it would
    // produce rather than leaving the count to be inferred.
    expect(screen.getByRole("button", { name: "Generate 1 draft (1 question)" })).toBeTruthy();
  });
});

describe("a filter narrows what is listed, never what is asked", () => {
  it("keeps the line's counts and reports what the search left", async () => {
    render(<Harness questions={[question({ prompt: "Stitching spec" }), question({ prompt: "Stud spec" })]} />);
    await userEvent.type(screen.getByPlaceholderText(/Search a code/), "stitching");
    // The count still says 2 — the filter only adds what is shown beside it.
    expect(within(line()).getByText("2")).toBeTruthy();
    expect(within(line()).getByText("1 shown")).toBeTruthy();
    expect(screen.getByText("Stitching spec")).toBeTruthy();
    expect(screen.queryByText("Stud spec")).toBeNull();
  });

  it("says so when a selected question is hidden, rather than dropping it", async () => {
    render(<Harness questions={[question({ prompt: "Stitching spec" }), question({ prompt: "Stud spec" })]} />);
    await userEvent.click(screen.getByText("Desk chair"));
    await userEvent.click(within(line()).getByRole("checkbox"));
    await userEvent.type(screen.getByPlaceholderText(/Search a code/), "stitching");
    expect(screen.getByText(/hidden by the filters/)).toBeTruthy();
    expect(screen.getByText(/will still be asked/)).toBeTruthy();
  });

  it("hides readiness questions by default without calling them settled", async () => {
    render(<Harness questions={[question({ requirementKind: "readiness", prompt: "Deposit received?" })]} />);
    await userEvent.click(screen.getByText("Desk chair"));
    expect(screen.queryByText("Deposit received?")).toBeNull();
    // Still counted as outstanding on the line.
    expect(within(line()).getByText("1")).toBeTruthy();
    await userEvent.click(screen.getByLabelText("Show readiness questions"));
    expect(screen.getByText("Deposit received?")).toBeTruthy();
  });

  it("does not say n shown just because the default view hides readiness", () => {
    render(<Harness questions={[question(), question({ requirementKind: "readiness" })]} />);
    expect(within(line()).queryByText(/shown$/)).toBeNull();
  });
});

describe("what would be generated", () => {
  it("counts the recipients, not just the questions", async () => {
    render(
      <Harness
        questions={[
          question(),
          question({ recordId: "line-2", refs: "S-402", itemDescription: "Bench", groupNo: 14, groupLabel: "AP364c-014", contactId: "c-2", contactName: "Ahmed Karim" }),
        ]}
      />,
    );
    await userEvent.click(screen.getByText("Select everything shown"));
    expect(screen.getByText(/2 recipients/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate 2 drafts/ })).toBeTruthy();
  });
});
