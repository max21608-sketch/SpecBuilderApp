// The preamble and finishes-schedule reviews: the primary action is in the
// header's top-right slot as well as under the list, the finished state says
// so and offers the way back, and a schedule's suggested kinds are accepted
// in one press (prod-ready F1/F2/F3, 2026-11-20).
//
// THE DEFECTS. "Add 7 notes to the project" and "Add 11 to the library" sat
// only at the bottom; the schedule's top-right slot held the SECONDARY "Also
// read its furniture … one charged read"; after everything was added the
// button stayed as "Add 0 notes to the project"; and every schedule row
// offered "Fabric ?" while "Add 11 to the library" filed no kind, so the
// library asked about all of them again. Every code and name is invented.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PreambleReview from "@/components/imports/PreambleReview";
import FinishScheduleReview, { FinishScheduleTable } from "@/components/imports/FinishScheduleReview";
import { RawFinishEntry } from "@/lib/extraction-schema";
import { normaliseFinishCode } from "@/lib/finishes";
import { reviewFinishSchedule, stageFinishSchedule, type LibraryFinish, type StagedFinishSchedule } from "@/lib/finish-schedule";
import type { PreambleNote } from "@/lib/preamble-document";

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify({ ok: true, ...(body as object) }), { status: 200, headers: { "content-type": "application/json" } });

function stubFetch(route: (url: string, method: string, body: unknown) => Response) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === "object" && "url" in input ? input.url : input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      return route(url, method, body);
    }),
  );
  return calls;
}

const PACK = { label: "Pack delivered 20 Nov", href: "/dashboard/projects/p1/intake/b1" };
const PROJECT = { id: "p1", number: "ZZ001", name: "Example" };
const parsedRun = (parsed: unknown) => ({
  id: "run-1",
  status: "parsed",
  version: 3,
  error: null,
  filename: "Example preamble.pdf",
  claim_live: null,
  within_deadline: null,
  claim_count: 1,
  parsed,
});

const note = (id: string, reviewStatus: PreambleNote["reviewStatus"]): PreambleNote => ({
  id,
  version: 1,
  page: 2,
  topicRaw: "General",
  titleRaw: `Requirement ${id}`,
  bodyRaw: "An invented requirement.",
  topic: "General",
  title: `Requirement ${id}`,
  body: "An invented requirement.",
  reviewStatus,
  reviewedAt: null,
  reviewedBy: null,
  applied: reviewStatus === "applied" ? { noteId: `n-${id}` } : null,
});

const header = () => document.querySelector(".ml-auto.flex") as HTMLElement;

beforeEach(() => vi.unstubAllGlobals());

describe("the preamble review", () => {
  const mount = (notes: PreambleNote[]) => {
    stubFetch(() => jsonOk({ import: parsedRun({ schemaVersion: 1, kind: "preamble", filename: "x", documentNotes: null, notes }), blockers: [] }));
    render(<PreambleReview importId="run-1" crumb={PACK} project={PROJECT} />);
  };

  it("puts its primary action top right as well as under the list", async () => {
    mount([note("a", "pending"), note("b", "pending")]);
    const buttons = await screen.findAllByRole("button", { name: "Add 2 notes to the project" });
    expect(buttons).toHaveLength(2);
    expect(within(header()).getByRole("button", { name: "Add 2 notes to the project" })).toBeTruthy();
  });

  it("once everything is reviewed, says so and offers the way back — never “Add 0”", async () => {
    mount([note("a", "applied"), note("b", "applied"), note("c", "ignored")]);
    expect(await screen.findByText(/Every requirement in this preamble has been reviewed/)).toBeTruthy();
    expect(screen.getByText(/2 added to the project, 1 ignored/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add 0/ })).toBeNull();
    const back = within(header()).getByRole("link", { name: "Back to the pack" });
    expect(back.getAttribute("href")).toBe(PACK.href);
  });
});

const entry = (over: Partial<RawFinishEntry>) => RawFinishEntry.parse({ otherRaw: [], ...over });
const held = (code: string, over: Partial<LibraryFinish> = {}): LibraryFinish => ({
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
});
let n = 0;
const ids = () => `e${(n += 1)}`;
const schedule = (): StagedFinishSchedule => {
  n = 0;
  return stageFinishSchedule(
    [
      entry({ codeRaw: "AB TIM 01", kindRaw: "TIMBER", nameRaw: "NATURAL OAK" }),
      entry({ codeRaw: "AB MTL 01", kindRaw: "METAL", nameRaw: "BRUSHED BRASS" }),
      entry({ codeRaw: "AB STN 01", kindRaw: "STONE", nameRaw: "WHITE MARBLE" }),
    ],
    "__QA schedule.pdf",
    null,
    ids,
  );
};
const library = [held("AB-MTL-01"), held("AB-STN-01", { description: "Grey limestone", kind: "stone" })];

describe("the finishes schedule review", () => {
  it("offers every suggested kind in one press, and only where the confirm would write it", async () => {
    const staged = schedule();
    const review = reviewFinishSchedule(staged, library);
    const onAcceptKinds = vi.fn();
    render(
      <FinishScheduleTable
        importId="run-1"
        staged={staged}
        byEntry={new Map(review.map((row) => [row.entryId, row]))}
        selected={new Set(["e1", "e2"])}
        setSelected={() => {}}
        busy={null}
        error={null}
        notice={null}
        onKind={() => {}}
        onAcceptKinds={onAcceptKinds}
        onAct={() => {}}
        showIgnored={false}
        setShowIgnored={() => {}}
        showApplied={false}
        setShowApplied={() => {}}
      />,
    );
    // The new timber and the held, kindless metal; never the conflicting stone.
    await userEvent.click(screen.getByRole("button", { name: "Accept all 2 suggested kinds" }));
    expect(onAcceptKinds).toHaveBeenCalledWith([
      { entry: staged.entries[0], kind: "timber" },
      { entry: staged.entries[1], kind: "metal" },
    ]);
  });

  it("puts “Add N to the library” top right, the furniture read under the list, and sends the accepted kinds in one request", async () => {
    const staged = schedule();
    const review = reviewFinishSchedule(staged, library);
    const calls = stubFetch((_url, method) =>
      method === "PATCH" ? jsonOk({ filed: 2 }) : jsonOk({ import: parsedRun(staged), review, furnitureRunId: null }),
    );
    render(<FinishScheduleReview importId="run-1" crumb={PACK} project={PROJECT} />);
    // Two buttons, one reading: top right and under the table.
    expect(await screen.findAllByRole("button", { name: "Add 2 to the library" })).toHaveLength(2);
    expect(within(header()).getByRole("button", { name: "Add 2 to the library" })).toBeTruthy();
    expect(within(header()).queryByRole("button", { name: /furniture/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Also read its furniture as an FF&E schedule/ })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Accept all 2 suggested kinds" }));
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.body).toEqual({
      kinds: [
        { entryId: "e1", expectedVersion: staged.entries[0]!.version, kind: "timber" },
        { entryId: "e2", expectedVersion: staged.entries[1]!.version, kind: "metal" },
      ],
    });
  });
});
