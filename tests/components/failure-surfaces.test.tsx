// 2.10.g — every failure reaches a screen as a sentence, with the control free.
//
// ============================================================================
// THE THREE QUESTIONS, ASKED OF A SCREEN RATHER THAN OF A `catch`
//
// The audit behind this file asked each failure surface under `src/app` and
// `src/components`: does it set an error the screen RENDERS, does the loading
// state reset, and does the message SURVIVE the reload the action triggers?
// Everything routes through `apiFetch`, which cannot throw and cannot be
// confused by an HTML error page, so the first two were largely already true.
// The third is the one that keeps failing, because it fails silently: a screen
// that refreshes after every action clears its banner on the successful load,
// so a 409 shows for a few milliseconds and then nothing, and the click looks
// as though it never registered.
//
// So these tests drive the REAL `apiFetch` against a stubbed `fetch` — a 500
// carrying `text/html`, which is what Vercel returns, and a JSON 409 — rather
// than mocking `apiFetch` itself. Mocking the wrapper would prove the screens
// render a string somebody handed them; this proves the string arrives.
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

// This tier's 5s default is a bound about the MACHINE, and this file has gone
// red under a second concurrent suite while passing alone. See
// `tests/components/tier-timeout.ts` for the measurements and for why this is
// not the global default.
vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });


vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("projectId=p1"),
  usePathname: () => "/dashboard/drafts",
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

/** What Vercel answers with when a function fails: not JSON at all. */
const htmlError = (status = 500) =>
  new Response("<!DOCTYPE html><html><body><h1>An error occurred</h1></body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify({ ok: true, ...(body as object) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const jsonError = (status: number, error: string) =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Route the stub by method and URL, so a screen can load successfully and
 * then have ONE action fail — which is the only way to test that the message
 * survives the reload that follows it.
 */
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

// ---------------------------------------------------------------------------
// The chase screen. The brief's own definition of done: with a mocked 500 the
// Draft button unfreezes and says why.
// ---------------------------------------------------------------------------

let n = 0;
function question(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    recordId: `rec-${n}`,
    requirementId: `req-${n}`,
    recordLabel: `P17231-${String(n).padStart(3, "0")}`,
    refs: `S-${100 + n}`,
    itemDescription: `Item ${n}`,
    area: "Dressing area",
    prompt: `Question ${n}`,
    requirementKind: "spec_field",
    fieldLabel: "COM 1",
    state: "missing",
    tier: "to_quote",
    waiting: null,
    level: "simple",
    qty: 2,
    runId: "run-1",
    runName: "MAIN RUN",
    parentId: null,
    variantLabel: null,
    parentRefs: "",
    parentQty: null,
    groupNo: n,
    groupLabel: `P17231-${String(n).padStart(3, "0")}`,
    variantCount: 0,
    ...over,
  };
}

function draftsPayload() {
  const contact = {
    id: "c-des",
    name: "Claire Beaumont",
    email: "claire@example.test",
    organisation: "CB Studio",
    role: "designer",
    designerCode: "CB",
    version: 1,
  };
  return {
    project: { id: "p1", bws_project_number: "P17231", name: "Maybourne", shared_inbox: null, version: 1 },
    contacts: [contact],
    drafts: [],
    inventory: {
      groups: [{ contact, questions: [question(), question()] }],
      lineCount: 2,
      blocked: [],
      suggestedCodes: [],
      uncategorised: [],
      unauthored: [],
      levelless: [],
      totals: {
        outstanding: 2,
        specField: 2,
        readiness: 0,
        toQuote: 2,
        later: 0,
        waiting: 0,
        noLevel: 0,
        blockedRecords: 0,
      },
    },
  };
}

describe("the chase screen, when generating a draft fails", () => {
  beforeEach(() => {
    n = 0;
  });

  it("says why in words the server never sent, and frees the button", async () => {
    stubFetch((url, method) => {
      if (method === "POST" && url.includes("/api/drafts/generate")) return htmlError(500);
      return jsonOk(draftsPayload());
    });
    const { default: DraftsPage } = await import("@/app/dashboard/drafts/page");
    render(<DraftsPage />);

    // Choosing the contact is what preselects their to-quote set, and the
    // button is deliberately disabled with nothing ticked — so the failure
    // being tested is only reachable from the state a person would be in.
    await userEvent.click(await screen.findByRole("tab", { name: /Claire Beaumont/ }));
    const draft = await screen.findByRole("button", { name: /Draft the email · 2 questions/ });
    expect(draft).toBeEnabled();
    await userEvent.click(draft);

    // The sentence comes from `apiFetch`'s fallback, because the response was
    // an HTML error page with no `error` field to read. A screen that did
    // `await res.json()` would have thrown here and left the button spinning.
    await waitFor(() =>
      expect(screen.getByText(/The server returned an error \(500\)/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/check the deployment logs/)).toBeInTheDocument();

    // UNFROZEN. The `finally` is the whole point: a person can correct
    // something and press it again.
    await waitFor(() => expect(screen.getByRole("button", { name: /Draft the email/ })).toBeEnabled());
  });

  it("VARIANCE: a screen whose FIRST load fails says so instead of spinning", async () => {
    stubFetch(() => htmlError(502));
    const { default: DraftsPage } = await import("@/app/dashboard/drafts/page");
    render(<DraftsPage />);
    await waitFor(() =>
      expect(screen.getByText(/The server returned an error \(502\)/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Loading chase emails")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The preamble review. THE REGRESSION: its `load()` clears the banner, and
// every action set the error and then reloaded — so a refusal showed nothing.
// ---------------------------------------------------------------------------

const preambleRun = {
  id: "run-p",
  status: "parsed",
  version: 3,
  error: null,
  filename: "__QA preamble.pdf",
  claim_live: null,
  within_deadline: true,
  claim_count: 1,
  parsed: {
    schemaVersion: 1 as const,
    kind: "preamble" as const,
    filename: "__QA preamble.pdf",
    documentNotes: null,
    notes: [
      {
        id: "note-1",
        version: 1,
        page: 4,
        topicRaw: "Tolerances",
        titleRaw: "Tolerances",
        bodyRaw: "All dimensions plus or minus 2mm.",
        topic: "Tolerances",
        title: "Tolerances",
        body: "All dimensions plus or minus 2mm.",
        reviewStatus: "pending" as const,
        reviewedAt: null,
        reviewedBy: null,
        applied: null,
      },
    ],
  },
};

describe("the preamble review, when a confirm is refused", () => {
  it("keeps the refusal on screen AFTER the reload it triggers", async () => {
    const calls = stubFetch((url, method) => {
      if (method === "POST" && url.includes("/confirm")) {
        return jsonError(409, "This note changed while the page was open. Reload before adding it.");
      }
      return jsonOk({ import: preambleRun, blockers: [] });
    });
    const { default: PreambleReview } = await import("@/components/imports/PreambleReview");
    render(
      <PreambleReview
        importId="run-p"
        crumb={{ label: "Pack", href: "/dashboard/projects/p1" }}
        project={{ id: "p1", number: "P17231", name: "Maybourne" }}
      />,
    );

    const add = await screen.findByRole("button", { name: /Add 1 note to the project/ });
    await userEvent.click(add);

    // The reload HAS to happen — a refused request means the screen is out of
    // date — so the assertion is that the message is there once it has.
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(1));
    expect(screen.getByText(/This note changed while the page was open/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add 1 note to the project/ })).toBeEnabled();
  });

  it("VARIANCE: an HTML error page reads as a sentence rather than a parse failure", async () => {
    stubFetch((url, method) => {
      if (method === "POST") return htmlError(504);
      return jsonOk({ import: preambleRun, blockers: [] });
    });
    const { default: PreambleReview } = await import("@/components/imports/PreambleReview");
    render(
      <PreambleReview
        importId="run-p"
        crumb={{ label: "Pack", href: "/dashboard/projects/p1" }}
        project={{ id: "p1", number: "P17231", name: "Maybourne" }}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Add 1 note to the project/ }));
    await waitFor(() =>
      expect(screen.getByText(/The server took too long to respond/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Add 1 note to the project/ })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// The pack screen. Same regression as the preamble review, on the screen the
// in-flight cap's own definition of done walks: pressing Read on a document
// somebody else has already started must SAY so.
// ---------------------------------------------------------------------------

const packPayload = (runStatus = "pending") => ({
  batches: [
    {
      id: "batch-1",
      label: null,
      created_at: "2026-09-21T09:00:00.000Z",
      created_by: "qa",
      runs: [
        {
          id: "run-1",
          sourceKind: "spec_document",
          documentKind: "shop_drawings",
          status: runStatus,
          waitingForSlot: false,
          error: null,
          filename: "__QA S-100.pdf",
          createdAt: "2026-09-21T09:00:00.000Z",
          version: 2,
          lines: null,
          proposals: null,
          pendingReview: null,
        },
      ],
    },
  ],
});

describe("the pack screen, when a read is refused", () => {
  it("keeps the refusal after the reload, and frees the row", async () => {
    const calls = stubFetch((url, method) => {
      if (method === "POST" && url.includes("/extract")) {
        return jsonError(409, "This document is already being read.");
      }
      // The version is read fresh before the attempt, from the import itself.
      if (url.includes("/api/imports/run-1")) return jsonOk({ import: { version: 2 } });
      if (url.includes("/api/projects/p1/batches")) return jsonOk(packPayload());
      return jsonOk({ project: { id: "p1", bws_project_number: "P17231", name: "Maybourne" } });
    });
    const { default: IntakeBatchPage } = await import("@/app/dashboard/projects/[id]/intake/[batchId]/page");
    render(<IntakeBatchPage params={Promise.resolve({ id: "p1", batchId: "batch-1" })} />);

    const read = await screen.findByRole("button", { name: "Read it now" });
    await userEvent.click(read);

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await waitFor(() =>
      expect(screen.getByText("This document is already being read.")).toBeInTheDocument(),
    );
    // The reload happened and did not take the message with it.
    expect(calls.filter((c) => c.url.includes("/batches")).length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Read it now" })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// The page thumbnail. A failure used to render NOTHING, which took the link to
// the drawing with it — the one thing on that card that is provenance rather
// than an aid.
// ---------------------------------------------------------------------------

vi.mock("@/lib/pdf-crop", () => ({
  cropPdfRegion: vi.fn(async () => {
    throw new Error("__QA pdfjs could not rasterise this page");
  }),
}));

describe("the page thumbnail, when the page cannot be rasterised", () => {
  it("still offers the way to the drawing, and says what happened", async () => {
    const { default: PagePreview } = await import("@/components/imports/PagePreview");
    render(<PagePreview importId="run-d" page={7} />);

    await waitFor(() => expect(screen.getByText(/could not be shown here/)).toBeInTheDocument());
    expect(screen.getByText("Open page 7 of the drawing")).toBeInTheDocument();
    // The anchor is what matters: a reviewer can still check the figure
    // against the page it was read from.
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/api/imports/run-d/source#page=7");
  });
});
