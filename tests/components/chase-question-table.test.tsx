// The chase screen, as a table of furniture lines.
//
// What these assert is the behaviour the flat list got wrong: a line is one
// row until you open it, its two counts are its own whatever the filter says,
// and a question that is ticked but hidden is still asked — and said to be.
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChaseQuestionTable, { type TableQuestion } from "@/components/drafts/ChaseQuestionTable";
import { defaultSelection } from "@/lib/chase-selection";

// ===========================================================================
// THE ROUTER, BECAUSE THE AREA FILTER LIVES IN THE URL
//
// `useUrlTab` reads the query string on every render rather than seeding state
// from it once, which is what makes a pasted `?area=` survive. A bare mount
// has no router, so this stands in for one — and unlike the mock in
// `use-url-tab.test.tsx` it is REACTIVE: `replace` writes the new query back
// and wakes every mounted `useSearchParams`, so choosing an area in a test
// narrows the table the way it does in the browser. A mock that recorded the
// call and left the query alone would let a filter that never applies pass.
// ===========================================================================
const replace = vi.fn();
let search = "";
const listeners = new Set<() => void>();

vi.mock("next/navigation", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useSearchParams: () => {
      const [, bump] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        listeners.add(bump);
        return () => {
          listeners.delete(bump);
        };
      }, []);
      return new URLSearchParams(search);
    },
    usePathname: () => "/dashboard/drafts",
    useRouter: () => ({
      replace: (url: string) => {
        replace(url);
        search = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
        for (const listener of [...listeners]) listener();
      },
    }),
  };
});

beforeEach(() => {
  replace.mockClear();
  search = "";
});

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
    area: "Dressing area",
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

  // A CONFIGURATION'S QUANTITY IS READ, NEVER APPORTIONED — and never assumed
  // absent either. This row printed "quantity not allocated" unconditionally,
  // which was true only for as long as nothing had set one; `PATCH
  // /api/records/[id]`'s `details` has accepted a configuration's qty since
  // 0028, and the phase table has always shown it. Three screens disagreeing
  // about one number is the finding this holds closed.
  it("says the quantity somebody set on a finish option, and still divides nothing", async () => {
    render(
      <Harness
        questions={[
          question({ variantCount: 2 }),
          question({
            recordId: "opt-a",
            variantLabel: "A",
            parentId: "line-1",
            refs: "",
            parentRefs: "S-301",
            qty: 12,
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
        ]}
      />,
    );
    await userEvent.click(screen.getByText("Desk chair"));
    expect(within(optionRow("S-301 A")).getByText(/qty 12/)).toBeTruthy();
    expect(within(optionRow("S-301 B")).getByText(/quantity not allocated/)).toBeTruthy();
    // Nothing anywhere says 33, or 22.5, or any other share of the bill's 45.
    expect(screen.queryByText(/33/)).toBeNull();
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
// THE AREA FILTER
//
// Sebastian, 2026-09-18: "if you could filter by that, that'd be quite handy".
// It is the same rule as every other filter on this screen — it narrows what
// is LISTED and never what is asked — and the cases below are the ones the
// simple version gets wrong: two spellings of one room, and a line nobody has
// placed anywhere.
// ===========================================================================
describe("filtering by area", () => {
  const acrossAreas = () => [
    question({ area: "Dressing area" }),
    question({
      recordId: "line-2",
      refs: "S-402",
      itemDescription: "Bench",
      area: "dressing  AREA",
      groupNo: 14,
      groupLabel: "AP364c-014",
    }),
    question({
      recordId: "line-3",
      refs: "S-100",
      itemDescription: "Sofa",
      area: "Living room",
      groupNo: 15,
      groupLabel: "AP364c-015",
    }),
    question({
      recordId: "line-4",
      refs: "S-500",
      itemDescription: "Stool",
      area: null,
      groupNo: 16,
      groupLabel: "AP364c-016",
    }),
  ];

  it("offers one option per area, spelled as the bill wrote it, with no-area last", () => {
    render(<Harness questions={acrossAreas()} />);
    const select = screen.getByLabelText("Filter by area") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "All areas (4)",
      "Dressing area (2)",
      "Living room (1)",
      "No area given (1)",
    ]);
  });

  it("narrows the lines it lists, and merges the two spellings of one room", async () => {
    render(<Harness questions={acrossAreas()} />);
    await userEvent.selectOptions(screen.getByLabelText("Filter by area"), "dressing area");
    expect(screen.getByText("Desk chair")).toBeTruthy();
    expect(screen.getByText("Bench")).toBeTruthy();
    expect(screen.queryByText("Sofa")).toBeNull();
    expect(screen.getByText(/2 lines shown of 4/)).toBeTruthy();
  });

  it("finds a line nobody has placed, rather than dropping it", async () => {
    render(<Harness questions={acrossAreas()} />);
    await userEvent.selectOptions(screen.getByLabelText("Filter by area"), "__none__");
    expect(screen.getByText("Stool")).toBeTruthy();
    expect(screen.queryByText("Desk chair")).toBeNull();
  });

  it("finds an area by typing it in the search box, which is what makes 35 of them usable", async () => {
    render(<Harness questions={acrossAreas()} />);
    await userEvent.type(screen.getByPlaceholderText(/Search a code/), "living");
    expect(screen.getByText("Sofa")).toBeTruthy();
    expect(screen.queryByText("Desk chair")).toBeNull();
  });

  it("keeps the line's own counts and never touches the selection", async () => {
    render(<Harness seed contactId="c-1" questions={acrossAreas()} />);
    // Four lines, one to-quote question each, all ticked by the preselection.
    expect(screen.getByText(/4 questions ticked/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Filter by area"), "living room");
    expect(screen.getByText(/4 questions ticked/)).toBeTruthy();
    // The line still on screen reports ITS OWN count, not what the filter left.
    expect(within(screen.getByText("Sofa").closest("tr")!).getByText("1")).toBeTruthy();
    // And the three it hid are said out loud rather than silently dropped.
    expect(screen.getByText(/3 ticked questions are hidden by your filters/)).toBeTruthy();
    expect(screen.getByText(/will still be asked/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft it · 1 draft" })).toBeTruthy();
  });

  it("keeps the chosen area in the URL, replacing rather than pushing", async () => {
    render(<Harness questions={acrossAreas()} />);
    await userEvent.selectOptions(screen.getByLabelText("Filter by area"), "living room");
    expect(replace).toHaveBeenCalledWith("/dashboard/drafts?area=living+room");
  });

  it("renders what a pasted link says, and leaves an area it does not carry alone", () => {
    search = "area=living room";
    render(<Harness questions={acrossAreas()} />);
    expect(screen.getByText("Sofa")).toBeTruthy();
    expect(screen.queryByText("Desk chair")).toBeNull();

    cleanup();
    // An area this contact's lines do not carry: every line is listed, and the
    // URL is NOT corrected — the inventory may still be arriving.
    search = "area=basement";
    render(<Harness questions={acrossAreas()} />);
    expect(screen.getByText("Desk chair")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
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

  // The 71-beside-70 finding (found-in-use 2026-09-20). The line's own column
  // counts a question already asked, because it is still outstanding; the
  // preselection excludes it. Both right, and the footer named only two of the
  // three sets.
  it("names the questions it left because somebody is already waiting on a reply", () => {
    render(
      <Harness
        seed
        contactId="c-1"
        questions={[
          question(),
          question({ waiting: { draftId: "d-1", sentAt: null, contactName: "Claire" } }),
        ]}
      />,
    );
    expect(screen.getByText(/1 to-quote question preselected/)).toBeTruthy();
    expect(screen.getByText(/1 awaiting a reply, not selected/)).toBeTruthy();
    // The SELECTION did not move. Only what the footer says did.
    expect(screen.getByText(/1 question ticked/)).toBeTruthy();
  });

  it("says nothing about a third bucket when there is not one", () => {
    render(<Harness seed contactId="c-1" questions={[question(), question({ tier: "later" })]} />);
    expect(screen.queryByText(/awaiting a reply, not selected/)).toBeNull();
  });

  it("asks for a contact before it ticks anything", () => {
    // The Everyone tab: one press would draft an email to each of them.
    render(<Harness seed questions={[question(), question({ contactId: "c-2" })]} />);
    expect(screen.getByText(/Nobody chosen/)).toBeTruthy();
    expect(screen.queryByText(/preselected/)).toBeNull();
  });
});
