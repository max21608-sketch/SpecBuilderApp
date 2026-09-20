// The pack screen's one line — found-in-use 5, "you'd have like 300".
//
// The fixture is eleven documents in mixed states, which is the shape of the
// real Panther pack (a bill, a shop-drawing set, nine specification sheets) and
// carries nothing from it.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PackSummary from "@/components/imports/PackSummary";
import { packTally } from "@/lib/intake-status";

/** n documents in one state, as the pack payload carries them. */
const runs = (spec: Record<string, number>) =>
  Object.entries(spec).flatMap(([status, count]) => Array.from({ length: count }, () => ({ status })));

const ELEVEN = runs({ confirmed: 8, parsed: 1, parsing: 1, failed: 1 });

describe("the pack's summary line", () => {
  it("is ONE line for eleven documents, and says what each state is", () => {
    render(<PackSummary runs={ELEVEN} />);
    // One paragraph, not one notice per document. The whole sentence, read as
    // a person reads it.
    const paragraphs = document.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe(
      "11 documents · 8 reviewed · 1 waiting for you · 1 still being read · 1 read failed",
    );
  });

  it("renders NO per-document banner or notice", () => {
    const { container } = render(<PackSummary runs={ELEVEN} />);
    // A `Note` is the app's banner. Nothing here is one, and there is one
    // element per state at most — never one per document.
    expect(container.querySelectorAll('[role="note"], [role="alert"], [role="status"]')).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("names the failure in red so a document under the fold is not missed", () => {
    render(<PackSummary runs={ELEVEN} />);
    expect(screen.getByText("· 1 read failed")).toHaveClass("text-red-800");
    expect(screen.getByText("· 8 reviewed")).not.toHaveClass("text-red-800");
  });

  it("offers the retry whenever ANYTHING failed, not only when everything did", async () => {
    // The trap: one failure of eleven is the case nobody scrolls to.
    const onRetryFailed = vi.fn();
    render(<PackSummary runs={ELEVEN} onRetryFailed={onRetryFailed} />);
    const button = screen.getByRole("button", { name: /Retry 1 failed read/ });
    expect(button).toHaveTextContent("charges again");
    await userEvent.click(button);
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to press when nothing failed", () => {
    render(<PackSummary runs={runs({ confirmed: 11 })} onRetryFailed={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("p")?.textContent).toBe("11 documents · 11 reviewed");
  });
});

describe("VARIANCE: one document", () => {
  it("reads as one fact, with no count beside the state", () => {
    render(<PackSummary runs={runs({ confirmed: 1 })} />);
    expect(document.querySelector("p")?.textContent).toBe("1 document · reviewed");
  });

  it("still names a failure and still offers the retry", () => {
    render(<PackSummary runs={runs({ failed: 1 })} onRetryFailed={vi.fn()} />);
    expect(document.querySelector("p")?.textContent).toBe("1 document · read failed");
    expect(screen.getByRole("button", { name: /Retry 1 failed read · charges again/ })).toBeInTheDocument();
  });
});

describe("VARIANCE: every document failed", () => {
  it("is the whole line in red, with retry-all beside it", () => {
    const onRetryFailed = vi.fn();
    render(<PackSummary runs={runs({ failed: 11 })} onRetryFailed={onRetryFailed} />);
    const line = document.querySelector("p");
    expect(line?.textContent).toBe("11 documents · 11 read failed");
    expect(line).toHaveClass("text-red-800");
    expect(screen.getByRole("button", { name: /Retry 11 failed reads/ })).toBeInTheDocument();
  });
});

describe("VARIANCE: still uploading and reading", () => {
  it("moves with the polled state, because it re-tallies what it is given", () => {
    const { rerender } = render(<PackSummary runs={runs({ queued: 3, parsing: 2 })} />);
    expect(document.querySelector("p")?.textContent).toBe("5 documents · 5 still being read");
    // Three seconds later, as the poll would deliver it.
    rerender(<PackSummary runs={runs({ parsing: 1, parsed: 4 })} />);
    expect(document.querySelector("p")?.textContent).toBe("5 documents · 4 waiting for you · 1 still being read");
  });

  it("counts a document nobody has read, rather than letting the line not add up", () => {
    // `pending` is registered-and-never-read. Four labelled tiles never claimed
    // to be exhaustive; one sentence does.
    render(<PackSummary runs={runs({ confirmed: 2, pending: 1 })} />);
    expect(document.querySelector("p")?.textContent).toBe("3 documents · 2 reviewed · 1 not read yet");
  });

  it("says so where a status it does not know turns up", () => {
    render(<PackSummary runs={runs({ confirmed: 2, something_new: 1 })} />);
    expect(document.querySelector("p")?.textContent).toBe("3 documents · 2 reviewed · 1 in another state");
  });

  it("renders nothing at all for an empty pack", () => {
    const { container } = render(<PackSummary runs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("packTally is the one reading behind the line and the tiles", () => {
  it("counts confirmed as REVIEWED, never complete, and totals the set", () => {
    const tally = packTally(ELEVEN);
    expect(tally).toEqual({ total: 11, reviewed: 8, toReview: 1, reading: 1, failed: 1, notRead: 0 });
  });

  it("counts queued and parsing as one state, because neither wants anybody", () => {
    expect(packTally(runs({ queued: 2, parsing: 3 })).reading).toBe(5);
  });
});
