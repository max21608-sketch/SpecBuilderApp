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
import { defaultSelection } from "@/lib/chase-selection";

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

/**
 * The table with the page's own selection behaviour around it.
 *
 * `contactId` and `seed` mirror what the page does: it hands the table the
 * chosen contact and seeds the selection with `defaultSelection` over the same
 * questions. A test that ticks by hand cannot see a preselection claim the
 * footer makes, which is the half this harness exists for.
 */
function Harness({
  questions,
  contactId,
  seed = false,
}: {
  questions: TableQuestion[];
  contactId?: string;
  seed?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() =>
    seed ? defaultSelection(questions, contactId ?? "") : new Set(),
  );
  return (
    <ChaseQuestionTable
      contactId={contactId}
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

/**
 * A finish option's row.
 *
 * `S-301 A` is two nodes now, because the LETTER is coloured the way the
 * drawings review colours it — A is always sky — so the name is matched by its
 * title rather than by its text.
 */
const optionRow = (name: string) => screen.getByTitle(name).closest("tr")!;

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
    expect(screen.queryByTitle("S-301 A")).toBeNull();
    await userEvent.click(screen.getByText("Desk chair"));
    expect(screen.getByTitle("S-301 A")).toBeTruthy();
    expect(screen.getByTitle("S-301 B")).toBeTruthy();
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
    const optionA = optionRow("S-301 A");
    await userEvent.click(within(optionA).getByRole("checkbox"));
    // A's question only — B's is untouched, and the footer says what would be
    // produced rather than leaving the count to be inferred.
    expect(screen.getByText(/1 question ticked/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft it · 1 draft" })).toBeTruthy();
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
    expect(screen.getByText(/hidden by your filters/)).toBeTruthy();
    expect(screen.getByText(/will still be asked/)).toBeTruthy();
    // AND THE TICKS THEMSELVES ARE UNTOUCHED. The count is the line's own
    // selection, not what the search left of it, and the question still on
    // screen is still ticked.
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();
    expect((within(line()).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("A FILTER CHANGE NEVER ALTERS THE PRESELECTION", async () => {
    // Seeded the way the page seeds it, then narrowed three different ways.
    // The selection is the truth; hiding a question does not untick it.
    render(
      <Harness
        seed
        contactId="c-1"
        questions={[question({ prompt: "Stitching spec" }), question({ prompt: "Stud spec" }), question({ tier: "later", prompt: "Packing" })]}
      />,
    );
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Filter by answer state"), "tbc");
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText(/Search a code/), "packing");
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();

    await userEvent.click(screen.getByLabelText("Show readiness questions"));
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();
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

// ===========================================================================
// THE FOLD IS NOT A FILTER
//
// A hero sofa has 37 outstanding questions and opening it filled the screen.
// The first few are listed and the rest are one click away — but they stay
// ticked, stay counted in the line's own totals and stay in the draft, which
// is the distinction a filter makes in words in the footer and this one makes
// by leaving everything alone.
// ===========================================================================
describe("a long line is folded", () => {
  const many = () => [
    question({ prompt: "COM 1" }),
    question({ prompt: "COM 2" }),
    question({ prompt: "COM 3" }),
    question({ prompt: "Stitching spec" }),
    question({ prompt: "Delivery date", tier: "later" }),
  ];

  it("lists the first few and counts the rest", async () => {
    render(<Harness questions={many()} />);
    await userEvent.click(screen.getByText("Desk chair"));
    expect(screen.getByText("COM 1")).toBeTruthy();
    expect(screen.queryByText("Stitching spec")).toBeNull();
    // One more TGQ and the later one, which sorts below it.
    expect(screen.getByRole("button", { name: "1 more TGQ · 1 also outstanding" })).toBeTruthy();
  });

  it("keeps the folded questions ticked and counted", async () => {
    render(<Harness questions={many()} />);
    await userEvent.click(screen.getByText("Desk chair"));
    await userEvent.click(within(line()).getByRole("checkbox"));
    // All five, not the three on screen, and the line's own counts are intact.
    expect(screen.getByText(/5 questions ticked/)).toBeTruthy();
    expect(within(line()).getByText("4")).toBeTruthy();
    // And nothing is claimed to be hidden by a filter, because none is set.
    expect(screen.queryByText(/hidden by your filters/)).toBeNull();
  });

  it("opens the rest on one click", async () => {
    render(<Harness questions={many()} />);
    await userEvent.click(screen.getByText("Desk chair"));
    await userEvent.click(screen.getByRole("button", { name: "1 more TGQ · 1 also outstanding" }));
    expect(screen.getByText("Stitching spec")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Draft it · 2 drafts" })).toBeTruthy();
  });
});

describe("what the screen ticked for you", () => {
  it("says how many block a quote and how many it left", () => {
    render(
      <Harness
        seed
        contactId="c-1"
        questions={[question(), question(), question({ tier: "later" }), question({ tier: "later" }), question({ tier: "later" })]}
      />,
    );
    expect(screen.getByText(/2 to-quote questions preselected/)).toBeTruthy();
    expect(screen.getByText(/3 also outstanding, not selected/)).toBeTruthy();
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();
  });

  it("says nothing blocks a quote for this contact rather than looking broken", () => {
    render(<Harness seed contactId="c-1" questions={[question({ tier: "later" })]} />);
    expect(screen.getByText(/Nothing needed to quote for this contact/)).toBeTruthy();
    expect(screen.getByText(/tick a question below to ask it anyway/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Draft it" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for a contact before it ticks anything", () => {
    // The Everyone tab: one press would draft an email to each of them.
    render(<Harness seed questions={[question(), question({ contactId: "c-2" })]} />);
    expect(screen.getByText(/Nobody chosen/)).toBeTruthy();
    expect(screen.queryByText(/preselected/)).toBeNull();
  });
});
