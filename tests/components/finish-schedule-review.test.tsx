// The finishes schedule's review list (brief C, 2026-10-04).
//
// Rendered from a staged document and the server's verdicts, as the GET route
// returns them, with no network. Every code and name is invented.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinishScheduleTable } from "@/components/imports/FinishScheduleReview";
import { RawFinishEntry } from "@/lib/extraction-schema";
import { normaliseFinishCode } from "@/lib/finishes";
import {
  reviewFinishSchedule,
  stageFinishSchedule,
  type LibraryFinish,
  type StagedFinishSchedule,
} from "@/lib/finish-schedule";
import IntakeBatchPage from "@/app/dashboard/projects/[id]/intake/[batchId]/page";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const entry = (over: Partial<RawFinishEntry>) => RawFinishEntry.parse({ otherRaw: [], ...over });

function held(code: string, over: Partial<LibraryFinish> = {}): LibraryFinish {
  return {
    id: `finish-${code}`,
    code,
    codeNorm: normaliseFinishCode(code),
    codeOrigin: "client",
    kind: null,
    description: null,
    supplierRaw: null,
    reference: null,
    colour: null,
    notes: null,
    state: "tbc",
    version: 1,
    ...over,
  };
}

function setup(staged: StagedFinishSchedule, library: LibraryFinish[]) {
  const onKind = vi.fn();
  const onAct = vi.fn();
  const review = reviewFinishSchedule(staged, library);
  const byEntry = new Map(review.map((row) => [row.entryId, row]));
  // Everything tickable, as the screen ticks it on arrival.
  const selected = new Set(
    review
      .filter((row) => row.verdict && ["new", "fills", "agrees"].includes(row.verdict.status))
      .map((row) => row.entryId),
  );
  render(
    <FinishScheduleTable
      importId="run-1"
      staged={staged}
      byEntry={byEntry}
      selected={selected}
      setSelected={() => {}}
      busy={null}
      error={null}
      notice={null}
      onKind={onKind}
      onAct={onAct}
      showIgnored={false}
      setShowIgnored={() => {}}
      showApplied={false}
      setShowApplied={() => {}}
    />,
  );
  return { onKind, onAct };
}

let n = 0;
const ids = () => `e${(n += 1)}`;

describe("the finishes schedule review", () => {
  const staged = (() => {
    n = 0;
    return stageFinishSchedule(
      [
        entry({ codeRaw: "AB TIM 01", kindRaw: "TIMBER", nameRaw: "NATURAL OAK", finishRaw: "Stained", page: 2 }),
        entry({ codeRaw: "AB MTL 01", kindRaw: "METAL", nameRaw: "BRUSHED BRASS" }),
        entry({ codeRaw: "AB STN 01", kindRaw: "STONE", nameRaw: "WHITE MARBLE" }),
        entry({ codeRaw: "AB TIM 01", nameRaw: "NATURAL OAK" }),
      ],
      "__QA schedule.pdf",
      "Seven furniture entries left out.",
      ids,
    );
  })();
  const library = [held("AB-MTL-01"), held("AB-STN-01", { description: "Grey limestone", kind: "stone" })];

  it("lists FINISHES, each under the code the library files it by and the code as printed", () => {
    setup(staged, library);
    expect(screen.getAllByText("AB-TIM-01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("printed AB TIM 01").length).toBeGreaterThan(0);
    expect(screen.getByText("NATURAL OAK; Finish: Stained")).toBeInTheDocument();
    expect(screen.getByText(/Seven furniture entries left out/)).toBeInTheDocument();
  });

  it("names each verdict in the pasted list's vocabulary, plus fill and conflict", () => {
    setup(staged, library);
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText("already held, no description yet")).toBeInTheDocument();
    expect(screen.getByText("already held and DIFFERENT")).toBeInTheDocument();
    expect(screen.getByText("repeated in this document")).toBeInTheDocument();
    expect(screen.getByText(/The library says “Grey limestone”/)).toBeInTheDocument();
  });

  it("will not tick a conflict or a repeat, and the button counts only what it writes", () => {
    const { onAct } = setup(staged, library);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((box) => (box as HTMLInputElement).disabled)).toEqual([false, false, true, true]);
    const add = screen.getByRole("button", { name: "Add 2 to the library" });
    return userEvent.click(add).then(() => {
      expect(onAct).toHaveBeenCalledWith([staged.entries[0], staged.entries[1]], "confirm");
    });
  });

  it("SUGGESTS a kind with its evidence and files it only on a click", async () => {
    const { onKind } = setup(staged, library);
    expect(screen.getAllByText("the schedule files it under “TIMBER”").length).toBeGreaterThan(0);
    expect(onKind).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole("button", { name: /Timber/ })[0]!);
    expect(onKind).toHaveBeenCalledWith(staged.entries[0], "timber");
  });

  it("offers no kind control where the library already has its answer", () => {
    setup(staged, library);
    // The conflict row's held kind is shown, not offered.
    const conflict = screen.getByText("already held and DIFFERENT").closest("tr")!;
    expect(within(conflict).queryByRole("combobox")).toBeNull();
    expect(within(conflict).getByText("Stone")).toBeInTheDocument();
  });
});

describe("the pack screen's order", () => {
  function mount(runs: object[]) {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/batches")) {
        return {
          ok: true,
          status: 200,
          data: {
            batches: [{ id: "b1", label: null, created_at: "2026-10-04T09:00:00.000Z", created_by: null, runs }],
          },
        };
      }
      return { ok: true, status: 200, data: { project: { id: "p1", bws_project_number: "ZZ001", name: "Example" } } };
    });
    return render(<IntakeBatchPage params={Promise.resolve({ id: "p1", batchId: "b1" })} />);
  }
  const run = (over: object) => ({
    id: Math.random().toString(36).slice(2),
    sourceKind: "spec_document",
    documentKind: null,
    status: "parsed",
    error: null,
    filename: "x.pdf",
    createdAt: "2026-10-04T09:00:00.000Z",
    ...over,
  });

  it("puts the finishes schedule between the bill and the drawings", async () => {
    mount([
      run({ sourceKind: "boq_xlsx", status: "confirmed", filename: "Example bill.xlsx" }),
      run({ documentKind: "finishes_schedule", filename: "Example tracker.pdf", pendingReview: 4 }),
      run({ documentKind: "shop_drawings", filename: "Example drawings.pdf" }),
    ]);
    await waitFor(() => expect(screen.getByText("The finishes schedule")).toBeInTheDocument());
    const titles = ["The preamble", "The bill of quantities", "The finishes schedule", "The drawings"].map(
      (title) => screen.getByText(title),
    );
    for (let index = 1; index < titles.length; index += 1) {
      expect(titles[index - 1]!.compareDocumentPosition(titles[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // The schedule is the stage the pack is on: bill confirmed, schedule not reviewed.
    const step = screen.getByText("The finishes schedule").closest("div")!.parentElement!;
    expect(within(step).getByText("3")).toHaveClass("bg-neutral-900");
    expect(screen.queryByText(/No finishes schedule in this pack/)).toBeNull();
  });

  it("says in words when a pack has no schedule, and still points at the drawings", async () => {
    mount([
      run({ sourceKind: "boq_xlsx", status: "confirmed", filename: "Example bill.xlsx" }),
      run({ documentKind: "shop_drawings", filename: "Example drawings.pdf" }),
    ]);
    await waitFor(() => expect(screen.getByText(/No finishes schedule in this pack/)).toBeInTheDocument());
    const drawings = screen.getByText("The drawings").closest("div")!.parentElement!;
    expect(within(drawings).getByText("4")).toHaveClass("bg-neutral-900");
  });
});
