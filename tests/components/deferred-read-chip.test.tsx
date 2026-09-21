// The three single-document review screens, for a read the per-pack cap deferred.
//
// ============================================================================
// `pending` MEANT TWO THINGS AND THE SCREENS SAID THE FIRST — found-in-use
// 2026-09-21, from Coder B's round 3.
//
// A document over the in-flight cap is marked (`attempt_deadline_at` set,
// `attempt_id` null) and read later by the worker that frees a slot. These
// three screens read the STATUS alone, so each said "has not been read" beside
// a Read button — the sentence for a document waiting for a PERSON — over one
// the app is about to read on its own. And pressing Read then returned a 202
// `waiting`, which `apiFetch` reports as a success with nothing in it, so the
// button appeared to do nothing at all.
//
// The stub is a real `fetch`, driving the real `apiFetch`, for the reason
// `failure-surfaces.test.tsx` gives: the 202 IS the defect, and mocking the
// wrapper would prove only that the screens render a string somebody handed
// them.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WAITING_FOR_SLOT_MESSAGE } from "@/lib/intake-status";

const jsonOk = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, ...(body as object) }), {
    status,
    headers: { "content-type": "application/json" },
  });

/** What the extract route answers for a document the cap deferred. */
const deferredPress = () =>
  jsonOk({ importId: "run-1", attemptId: null, status: "waiting", waiting: true, note: WAITING_FOR_SLOT_MESSAGE }, 202);

function stubFetch(route: (url: string, method: string) => Response) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === "object" && "url" in input ? input.url : input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      return route(url, method);
    }),
  );
  return calls;
}

/** A run the cap deferred: pending, no attempt, a live deadline. */
const deferredRun = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  project_id: "project-9",
  status: "pending",
  waitingForSlot: true,
  version: 2,
  error: null,
  filename: "__QA S-100.pdf",
  attempt_id: null,
  claim_live: null,
  within_deadline: true,
  claim_count: 0,
  parsed: null,
  ...over,
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("the drawings review, for a deferred read", () => {
  it("says it is waiting for a slot rather than that nobody has read it", async () => {
    stubFetch((url, method) => {
      if (method === "POST") return deferredPress();
      if (url.startsWith("/api/projects/")) return jsonOk({ project: { id: "project-9" } });
      return jsonOk({ import: deferredRun({ document_kind: "shop_drawings" }), resolution: [], specFields: [], records: [] });
    });
    const { default: DrawingsReview } = await import("@/components/imports/DrawingsReview");
    render(<DrawingsReview importId="run-1" />);

    expect(await screen.findByText("Waiting for a slot")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(WAITING_FOR_SLOT_MESSAGE.slice(0, 40)))).toBeInTheDocument();
    expect(screen.queryByText("These drawings have not been read")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read it now" })).toBeEnabled();
  });

  it("says why a press changed nothing, and frees the button", async () => {
    stubFetch((url, method) => {
      if (method === "POST") return deferredPress();
      if (url.startsWith("/api/projects/")) return jsonOk({ project: { id: "project-9" } });
      return jsonOk({ import: deferredRun({ document_kind: "shop_drawings" }), resolution: [], specFields: [], records: [] });
    });
    const { default: DrawingsReview } = await import("@/components/imports/DrawingsReview");
    render(<DrawingsReview importId="run-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Read it now" }));
    // The sentence is on screen AFTER the reload the press triggers — the
    // reload-first rule, which is what makes the press visible at all.
    await waitFor(() => expect(screen.getAllByText(new RegExp(WAITING_FOR_SLOT_MESSAGE.slice(0, 40))).length).toBeGreaterThan(1));
    expect(screen.getByRole("button", { name: "Read it now" })).toBeEnabled();
  });

  it("still says nobody has read an ordinary pending document", async () => {
    stubFetch((url) => {
      if (url.startsWith("/api/projects/")) return jsonOk({ project: { id: "project-9" } });
      return jsonOk({
        import: deferredRun({ document_kind: "shop_drawings", waitingForSlot: false }),
        resolution: [],
        specFields: [],
        records: [],
      });
    });
    const { default: DrawingsReview } = await import("@/components/imports/DrawingsReview");
    render(<DrawingsReview importId="run-1" />);

    expect(await screen.findByText("These drawings have not been read")).toBeInTheDocument();
    expect(screen.getByText("Not read yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read the drawings" })).toBeEnabled();
  });
});

describe("the preamble review, for a deferred read", () => {
  it("says it is waiting for a slot, and says so again when Read is pressed", async () => {
    stubFetch((url, method) => {
      if (method === "POST") return deferredPress();
      if (url.startsWith("/api/projects/")) return jsonOk({ project: { id: "project-9" } });
      return jsonOk({ import: deferredRun(), blockers: [] });
    });
    const { default: PreambleReview } = await import("@/components/imports/PreambleReview");
    render(
      <PreambleReview
        importId="run-1"
        crumb={{ label: "Pack", href: "/dashboard/projects/project-9" }}
        project={{ id: "project-9", number: "__QA P90010", name: "__QA Panther" }}
      />,
    );

    expect(await screen.findByText("Waiting for a slot")).toBeInTheDocument();
    expect(screen.queryByText("This preamble has not been read")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Read it now" }));
    await waitFor(() => expect(screen.getAllByText(new RegExp(WAITING_FOR_SLOT_MESSAGE.slice(0, 40))).length).toBeGreaterThan(1));
    expect(screen.getByRole("button", { name: "Read it now" })).toBeEnabled();
  });
});

describe("the spec document review, for a deferred read", () => {
  it("says it is waiting for a slot, and says so again when Read is pressed", async () => {
    stubFetch((_url, method) => (method === "POST" ? deferredPress() : jsonOk({})));
    const { default: SpecDocumentReview } = await import("@/components/imports/SpecDocumentReview");
    render(
      <SpecDocumentReview
        data={{
          import: {
            ...deferredRun({ document_kind: "ffe_schedule" }),
            model: null,
            model_metadata: null,
            bws_project_number: "__QA P90010",
            project_name: "__QA Panther",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          registers: { records: [], requirements: [] },
        }}
        reload={async () => {}}
        quietReload={async () => {}}
        crumb={{ label: "Pack", href: "/dashboard/projects/project-9" }}
      />,
    );

    expect(await screen.findByText("Waiting for a slot")).toBeInTheDocument();
    expect(screen.queryByText("This document has not been read")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Read it now" }));
    // This screen is handed its run as a prop, so the panel's own copy cannot
    // change here — what has to appear is the press's own sentence.
    await waitFor(() => expect(screen.getAllByText(new RegExp(WAITING_FOR_SLOT_MESSAGE.slice(0, 40))).length).toBeGreaterThan(1));
    expect(screen.getByRole("button", { name: "Read it now" })).toBeEnabled();
  });
});
