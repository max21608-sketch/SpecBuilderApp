// A read of PART of a file is named by its part on every screen (open intake,
// 2026-11-20). Two reads of one PDF used to print the same filename twice —
// on the pack's rows, in its step summary, in a review's header — so a person
// could not tell the bill's read from the drawings' without opening both.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";
import PreambleReview from "@/components/imports/PreambleReview";
import { RecordDocumentsTable } from "@/components/records/RecordDocuments";
import type { RecordDocument } from "@/lib/record-documents";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/projects/p1/intake/batch-1",
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify({ ok: true, ...(body as object) }), { status: 200, headers: { "content-type": "application/json" } });

function stubFetch(route: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => route(String(typeof input === "object" && "url" in input ? input.url : input))),
  );
}

beforeEach(() => vi.unstubAllGlobals());

const BILL_PART = { kind: "pages", ranges: [{ from: 1, to: 12 }] };
const DRAWINGS_PART = { kind: "pages", ranges: [{ from: 13, to: 30 }, { from: 41, to: 44 }] };

const run = (id: string, over: Record<string, unknown>) => ({
  id,
  sourceKind: "spec_document",
  documentKind: "shop_drawings",
  status: "parsed",
  waitingForSlot: false,
  error: null,
  filename: "QA Pack.pdf",
  sourcePart: null,
  createdAt: "2026-11-20T09:00:00.000Z",
  version: 1,
  lines: null,
  proposals: null,
  pendingReview: 1,
  ...over,
});

describe("the pack screen", () => {
  it("names each read of one file by its part, in the rows and in the bill's step", async () => {
    stubFetch((url) => {
      if (url.includes("/api/projects/p1/batches")) {
        return jsonOk({
          batches: [
            {
              id: "batch-1",
              label: null,
              created_at: "2026-11-20T09:00:00.000Z",
              created_by: "qa",
              runs: [
                run("run-bill", { sourceKind: "boq_xlsx", documentKind: null, sourcePart: BILL_PART }),
                run("run-drawings", { sourcePart: DRAWINGS_PART }),
              ],
            },
          ],
        });
      }
      return jsonOk({ project: { id: "p1", bws_project_number: "QA001", name: "Invented" }, documents: [], libraryCodes: [] });
    });
    const { default: IntakeBatchPage } = await import("@/app/dashboard/projects/[id]/intake/[batchId]/page");
    render(<IntakeBatchPage params={Promise.resolve({ id: "p1", batchId: "batch-1" })} />);

    expect(await screen.findByRole("link", { name: "QA Pack.pdf — pages 1–12" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "QA Pack.pdf — pages 13–30 and 41–44" })).toBeTruthy();
    // The bill's step names its read once, by its part.
    expect(screen.getByText(/QA Pack\.pdf — pages 1–12 · not confirmed yet/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "QA Pack.pdf" })).toBeNull();
  });
});

describe("a review's header", () => {
  it("names the part the preamble read was of", async () => {
    stubFetch(() =>
      jsonOk({
        import: {
          id: "run-1",
          status: "parsed",
          version: 3,
          error: null,
          filename: "QA Pack.pdf",
          sourcePart: { kind: "pages", ranges: [{ from: 31, to: 40 }] },
          claim_live: null,
          within_deadline: null,
          claim_count: 1,
          parsed: { schemaVersion: 1, kind: "preamble", filename: "x", documentNotes: null, notes: [] },
        },
        blockers: [],
      }),
    );
    render(
      <PreambleReview
        importId="run-1"
        crumb={{ label: "Pack", href: "/dashboard/projects/p1/intake/b1" }}
        project={{ id: "p1", number: "QA001", name: "Invented" }}
      />,
    );
    expect(await screen.findByRole("heading", { level: 1, name: /QA Pack\.pdf — pages 31–40/ })).toBeTruthy();
  });
});

describe("the record's Documents list", () => {
  it("names the part a row's read was of, and the whole file by its name alone", () => {
    const row = (over: Partial<RecordDocument>): RecordDocument => ({
      key: "att-1",
      filename: "QA Pack.pdf",
      subject: null,
      kind: "shop_drawings",
      kindLabel: "Shop drawings",
      arrivedAt: "2026-11-20T09:00:00.000Z",
      relations: ["2 specs, pages 14–15"],
      pages: [14, 15],
      reviews: [{ runId: "run-1", label: "Shop drawings" }],
      open: { href: "/api/imports/run-1/source#page=14", inline: true },
      ...over,
    });
    render(
      <RecordDocumentsTable
        result={{
          documents: [
            row({ sourcePart: { kind: "pages", ranges: [{ from: 13, to: 30 }] } }),
            row({ key: "att-2", filename: "QA Spec.pdf", sourcePart: null }),
          ],
          origin: { mockup: false, noBill: false },
        }}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("QA Pack.pdf — pages 13–30")).toBeTruthy();
    expect(within(rows[1]!).getByText("QA Spec.pdf")).toBeTruthy();
  });
});
