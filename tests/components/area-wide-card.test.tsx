// The fill-in screen's area card (decision C of 2026-11-20): one card row per
// (area, question), answered once for the area through the area-wide route.
// Component tier, `apiFetch` stubbed with what that route returns.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AreaWideCard from "@/components/infill/AreaWideCard";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const row = (n: number) => ({
  recordId: `rec-${n}`,
  recordLabel: `T1-00${n}`,
  itemDescription: `Chair ${n}`,
  requirementId: "req-130",
  answerId: `ans-${n}`,
  answerVersion: 1,
  state: "missing",
  value: null,
  tier: "to_quote",
});

const question = {
  key: "area:restaurant\u0000field:130",
  area: "Restaurant",
  heading: "Indoor/ Outdoor / Humid environment",
  fieldLabel: "Indoor/ Outdoor",
  rows: [row(1), row(2)],
  items: 2,
  settled: 0,
  outstanding: 2,
  toQuoteOutstanding: 2,
  tier: "to_quote",
  values: [],
  palette: null,
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string, init?: { method?: string }) =>
    init?.method === "POST"
      ? { ok: true, data: { written: 2, overridden: 0, records: 2 } }
      : { ok: true, data: { questions: [question] } },
  );
});

describe("AreaWideCard", () => {
  it("reads the area-wide route and names the area beside the question", async () => {
    render(<AreaWideCard projectId="p1" />);
    expect(await screen.findByText(/answered once for each area/i)).toBeInTheDocument();
    expect(screen.getByText("Restaurant")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/projects/p1/area-wide");
  });

  it("answers the area once, through the area-wide route, with the rows it was shown", async () => {
    const user = userEvent.setup();
    render(<AreaWideCard projectId="p1" />);
    await user.click(await screen.findByText("Answer"));
    await user.type(screen.getByPlaceholderText("Value"), "Indoor");
    await user.tab();
    await user.click(screen.getByRole("button", { name: /^Save on 2 items/ }));
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/projects/p1/area-wide");
    const body = JSON.parse(post[1].body);
    expect(body).toMatchObject({ key: question.key, value: "Indoor", state: "confirmed" });
    expect(body.seen).toHaveLength(2);
  });

  // CHASE REVIEW C1: an item whose field a spec holds is listed with what the
  // file ships, unticked, and is not counted in the press.
  it("lists an item whose field a spec holds, with what the file ships, and leaves it out of the press", async () => {
    const held = { ...row(3), state: "tbc", value: "Outdoor TBC", specShips: "Outdoor TBC", projection: true };
    apiFetch.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: true, data: { written: 2, overridden: 0, records: 2 } }
        : { ok: true, data: { questions: [{ ...question, rows: [row(1), row(2), held], items: 3, outstanding: 3 }] } },
    );
    const user = userEvent.setup();
    render(<AreaWideCard projectId="p1" />);
    await user.click(await screen.findByText("Answer"));
    await user.type(screen.getByPlaceholderText("Value"), "Indoor");
    await user.tab();
    expect(screen.getByRole("button", { name: /^Save on 2 items/ })).toBeInTheDocument();
    expect(screen.getByText(/the file ships the spec, “Outdoor TBC”/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Replace the answer on T1-003" })).not.toBeChecked();
  });

  // CHASE REVIEW C3: the card names the phases its items are on, and with the
  // fill-in filtered to one phase it reads and writes that phase alone.
  it("names each phase and how many items in it before the press, unfiltered", async () => {
    apiFetch.mockImplementation(async () => ({
      ok: true,
      data: {
        questions: [
          {
            ...question,
            phases: [
              { runId: "run-a", name: "Guest Rooms", items: 6 },
              { runId: "run-b", name: "Public Areas", items: 4 },
            ],
          },
        ],
      },
    }));
    const user = userEvent.setup();
    render(<AreaWideCard projectId="p1" />);
    expect(await screen.findByText("Guest Rooms 6 · Public Areas 4")).toBeInTheDocument();
    await user.click(screen.getByText("Answer"));
    expect(screen.getByText(/across 2 phases: Guest Rooms 6 · Public Areas 4/)).toBeInTheDocument();
  });

  it("filtered to a phase, reads and writes that phase alone, and says so", async () => {
    const user = userEvent.setup();
    render(<AreaWideCard projectId="p1" runId="run-b" phaseName="Public Areas" />);
    expect(await screen.findByText(/Filtered to the phase Public Areas/)).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/projects/p1/area-wide?runId=run-b");
    await user.click(screen.getByText("Answer"));
    await user.type(screen.getByPlaceholderText("Value"), "Indoor");
    await user.tab();
    await user.click(screen.getByRole("button", { name: /^Save on 2 items/ }));
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/projects/p1/area-wide");
    expect(JSON.parse(post[1].body)).toMatchObject({ runId: "run-b" });
  });
});
