// The bill review against the shapes a real bill arrives in — §6.10.a.
//
// ============================================================================
// WHY THIS IS A COMPONENT TEST AND NOT A PURE ONE.
//
// Every row of the variance matrix is one of three words — proceeds, flags,
// refuses — and two of those three are only true if a SCREEN says something. A
// pure test can prove `parseBoqSheets` refused; only this tier can prove the
// refusal is readable on the page a reviewer lands on, which is where row 1's
// defect actually was: the sentence existed, was returned as a 422 to the
// upload screen, and was never rendered again.
//
// The page is rendered whole, with `next/navigation` and `apiFetch` stubbed,
// the way `next-step-action.test.tsx` does it. No database, no model, no money.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseBoqSheets, type BoqLine } from "@/lib/boq-import";
import { guessNonFurniture } from "@/lib/non-furniture-guess";
import ReviewImportPage from "@/app/dashboard/imports/[id]/page";

const PROJECT = "project-variance";
const IMPORT = "import-variance";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/dashboard/imports/${IMPORT}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/**
 * What each endpoint answers, and every call made.
 *
 * Matched on the PATH, never on a prefix, for the reason the next-step tests
 * are: this screen mounts the project's batches alongside the import itself.
 */
const routes = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  calls: [] as { url: string; method: string; body: unknown }[],
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    routes.calls.push({
      url: path,
      method: (init?.method ?? "GET").toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const body = routes.current[path];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

/** A staged line, as `/api/imports` builds one: the parsed row plus the questions. */
function stagedLine(line: BoqLine, index: number) {
  return {
    index,
    ...line,
    // Uncategorised on purpose: a category match needs the seeded vocabulary,
    // which needs a database, and none of these assertions is about it.
    categoryId: null,
    categoryStatus: "none",
    level: null,
    levelStatus: "suggested" as const,
    levelReason: null,
    nonFurnitureSuggested: guessNonFurniture({ ...line, categoryStatus: "none" }),
    ignored: false,
  };
}

/** One sheet of parsed rows, staged the way the registration route stages them. */
function stagedSheet(rows: Parameters<typeof parseBoqSheets>[0]) {
  const parsed = parseBoqSheets(rows);
  if (!parsed.ok) throw new Error(parsed.error);
  const sheet = parsed.sheets[0]!;
  return { ...sheet, replacesRunId: null, lines: sheet.lines.map(stagedLine) };
}

function mount(over: Record<string, unknown>, sheets: unknown[]) {
  routes.current = {
    [`/api/imports/${IMPORT}`]: {
      ok: true,
      import: {
        id: IMPORT,
        status: "parsed",
        version: 1,
        error: null,
        source_kind: "boq_xlsx",
        document_kind: null,
        project_id: PROJECT,
        bws_project_number: "ZZ001",
        project_name: "Example",
        filename: "bill.xlsx",
        parsed: { schemaVersion: 3, filename: "bill.xlsx", sourcePreserved: true, sheets },
        ...over,
      },
      categories: [],
      runs: [],
      reconciliation: {},
    },
  };
  return render(<ReviewImportPage />);
}

beforeEach(() => {
  routes.current = {};
  routes.calls.length = 0;
});

// ---------------------------------------------------------------------------
// ROW 1 — HEADER SYNONYMS NOT MATCHED. Expected: REFUSES, on this screen.
// ---------------------------------------------------------------------------
describe("VARIANCE row 1: a bill this reader could not read", () => {
  const refusal = (() => {
    const result = parseBoqSheets([
      { sheet: "Bill", data: [["Item No.", "Product", "Qty"], ["1", "ZZ-101 Side table", 4]] },
    ]);
    if (result.ok) throw new Error("expected a refusal");
    return result.error;
  })();

  /** A bill that parses, for the contrast. Invented codes, invented rooms. */
  const READABLE: Parameters<typeof parseBoqSheets>[0] = [
    {
      sheet: "Bill",
      data: [
        ["Area", "FF&E code", "Item description", "TOTAL Q-ty"],
        ["Example room", "ZZ-101", "Side table", 4],
      ],
    },
  ];

  it("prints the parser's own refusal, with the bill's own headings in it", async () => {
    mount({ status: "failed", error: refusal, parsed: null }, []);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This bill could not be read, and nothing was staged from it.");
    expect(alert.textContent).toContain("“Item No.”");
    expect(alert.textContent).toContain("“Product”");
    expect(alert.textContent).toContain("code column");
  });

  it("says something even if the run failed with no reason recorded", async () => {
    // A blank where the reason goes is the one state a reviewer cannot act on
    // at all, so it names itself as worth reporting.
    mount({ status: "failed", error: null, parsed: null }, []);
    expect((await screen.findByRole("alert")).textContent).toContain("gave no reason");
  });

  it("drops the standing explanation about tabs, which there are none of", async () => {
    mount({ status: "failed", error: refusal, parsed: null }, []);
    await screen.findByRole("alert");
    expect(screen.queryByText(/A tab is a phase, not a revision/)).toBeNull();
  });

  it("keeps that note on a bill that parsed, and shows no alert", async () => {
    mount({}, [stagedSheet(READABLE)]);
    expect(await screen.findByText(/A tab is a phase, not a revision/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
