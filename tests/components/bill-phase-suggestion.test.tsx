// The bill review: a tab that looks like a phase the project already has is
// OFFERED as its revision, never shown as one, and the Confirm waits until a
// person says which it is (prod-ready RV0, 2026-11-20).
//
// THE DEFECT. A revised "Guest Rooms" tab defaulted to "This sheet is: a new
// phase", and one press of the primary Confirm put every item on the project
// a second time.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewImportPage from "@/app/dashboard/imports/[id]/page";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const PROJECT = "project-phase";
const IMPORT = "import-phase";
const RUN = "run-guest-rooms";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: IMPORT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/dashboard/imports/${IMPORT}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

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
    if ((init?.method ?? "GET").toUpperCase() === "PATCH") return { ok: true, status: 200, data: { version: 2 } };
    const body = routes.current[path];
    if (body === undefined) return { ok: false, status: 404, error: "no such route", data: null };
    return { ok: true, status: 200, data: body };
  },
}));

/** Invented codes, invented rooms. */
const line = (index: number, code: string) => ({
  index,
  lineNo: index + 2,
  designer: null,
  boqCategory: null,
  area: "Example room",
  code,
  itemDescription: `Item ${code}`,
  productReference: null,
  qty: 4,
  qtyUnit: "nr",
  categoryId: null,
  categoryStatus: "none",
  level: null,
  levelStatus: "suggested",
  levelReason: null,
  ignored: false,
  replaces: null,
});

function mount(sheet: Record<string, unknown>, phaseSuggestions: unknown) {
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
        filename: "bill rev B.xlsx",
        parsed: {
          schemaVersion: 3,
          filename: "bill rev B.xlsx",
          sourcePreserved: true,
          sheets: [
            {
              sheetName: "Guest Rooms",
              proposedRunName: "Guest Rooms",
              headerRow: 1,
              skippedRows: 0,
              ignored: false,
              ignoredReason: null,
              replacesRunId: null,
              metadata: { revision: "B", date: null, notes: [] },
              lines: [line(0, "ZZ-01"), line(1, "ZZ-02"), line(2, "ZZ-03")],
              ...sheet,
            },
          ],
        },
      },
      categories: [],
      runs: [{ id: RUN, name: "Guest Rooms", status: "active", boq_revision: "A", boq_date: null, record_count: 3 }],
      phaseSuggestions,
      reconciliation: {},
      fabricFilings: {},
    },
  };
  return render(<ReviewImportPage />);
}

const suggestion = { runId: RUN, runName: "Guest Rooms", sameName: true, codesOnPhase: 3, codesOnSheet: 3 };
const patches = () => routes.calls.filter((call) => call.method === "PATCH").map((call) => call.body);
const phaseSelect = () =>
  screen.getAllByRole("combobox").find((select) => select.closest("label")?.textContent?.includes("This sheet is")) as HTMLSelectElement;

beforeEach(() => {
  routes.current = {};
  routes.calls.length = 0;
});

describe("a tab that looks like a phase the project has", () => {
  it("offers the phase as a suggestion with its evidence, shows no choice, and holds the Confirm", async () => {
    mount({}, { 0: [suggestion] });
    const offer = await screen.findByRole("button", { name: /a revision of “Guest Rooms”/ });
    expect(offer.parentElement?.textContent).toContain("same sheet name · 3 of 3 codes are on it");
    // The select shows what is STORED: nothing, until somebody says.
    expect(phaseSelect().value).toBe("");
    expect(screen.getByText("Say whether this bill is a new phase or a revision of one.", { exact: false })).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Confirm/ }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(offer);
    expect(patches()).toEqual([{ sheetIndex: 0, replacesRunId: RUN, version: 1 }]);
  });

  it("stores “a new phase” as a person's choice", async () => {
    mount({}, { 0: [suggestion] });
    await screen.findByRole("button", { name: /a revision of “Guest Rooms”/ });
    await userEvent.selectOptions(phaseSelect(), "new");
    expect(patches()).toEqual([{ sheetIndex: 0, replacesRunId: null, version: 1 }]);
  });

  it("asks nothing once “a new phase” is stored, and the Confirm goes ahead", async () => {
    mount({ newPhaseChosen: true }, { 0: [suggestion] });
    await screen.findByText("This tab becomes a phase");
    expect(screen.queryByRole("button", { name: /a revision of “Guest Rooms”/ })).toBeNull();
    expect(phaseSelect().value).toBe("new");
    expect((screen.getByRole("button", { name: /^Confirm/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves a tab that looks like no phase a new phase by default, as before", async () => {
    mount({ sheetName: "Public Areas", proposedRunName: "Public Areas" }, {});
    await screen.findByText("This tab becomes a phase");
    expect(phaseSelect().value).toBe("new");
    expect(screen.queryByText(/looks like a phase this project already has/)).toBeNull();
    expect((screen.getByRole("button", { name: /^Confirm/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
