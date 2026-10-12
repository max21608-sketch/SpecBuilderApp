// The chase screen's contact strip, with a colleague in it.
//
// ===========================================================================
// WHY THE STRIP NEEDS A TEST OF ITS OWN
//
// Matthew, 2026-09-18: "You can send it to the CAM or to the sales system or
// to production… It doesn't have to be an external e-mail." A colleague is not
// routed by designer code, so `groupByContact` hands them EVERY outstanding
// question on the project — which is right for their own tab and wrong for
// everyone else's, because it is a COPY: flattened beside the designers it
// would list every question twice, double each furniture line's two counts,
// and offer the same question to two recipients in one press.
//
// So two things are asserted here and nowhere else: the strip marks a
// colleague rather than passing them off as another designer, and Everyone
// still counts the designer chases once.
// ===========================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DraftsPage from "@/app/dashboard/drafts/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("projectId=p1"),
  usePathname: () => "/dashboard/drafts",
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

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

const contact = (over: Record<string, unknown>) => ({
  id: "c-1",
  name: "Claire Beaumont",
  email: "claire@example.test",
  organisation: "CB Studio",
  role: "designer",
  designerCode: "CB",
  version: 1,
  ...over,
});

function payload() {
  const designerQuestions = [question(), question()];
  const designer = contact({ id: "c-des", name: "Claire Beaumont" });
  const colleague = contact({ id: "c-cam", name: "Ana Whitcombe", role: "internal", designerCode: null });
  return {
    project: { id: "p1", bws_project_number: "P17231", name: "Maybourne", shared_inbox: null, version: 1 },
    contacts: [designer, colleague],
    drafts: [],
    inventory: {
      // The shape `groupByContact` produces: the colleague carries a COPY of
      // the designer's questions, and sorts after them.
      groups: [
        { contact: designer, questions: designerQuestions },
        { contact: colleague, questions: designerQuestions },
      ],
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
        noLevel: 0,
        waiting: 0,
        blockedRecords: 0,
      },
    },
  };
}

beforeEach(() => {
  // The item numbers are built by a counter, and a test that asserted
  // "Item 1" would otherwise be looking for a row the third render never made.
  n = 0;
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, status: 200, data: payload() });
});

describe("the contact strip", () => {
  it("marks a colleague, and puts them after the designers", async () => {
    render(<DraftsPage />);
    const colleague = await screen.findByRole("tab", { name: /Ana Whitcombe/ });
    expect(colleague.textContent).toContain("Colleague");

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
    expect(tabs.findIndex((t) => t.includes("Claire Beaumont"))).toBeLessThan(
      tabs.findIndex((t) => t.includes("Ana Whitcombe")),
    );
  });

  it("counts Everyone over the designer chases only, never twice", async () => {
    render(<DraftsPage />);
    const everyone = await screen.findByRole("tab", { name: /Everyone/ });
    // Two outstanding questions. The colleague's copy of them is not a third
    // and a fourth thing to ask.
    expect(everyone.textContent).toBe("Everyone2");
  });

  // FOUND IN THE BROWSER, on the 300-line project: a colleague's tab read
  // "5702 questions ticked" for 2851 questions and offered "Draft it · 3
  // drafts" for one recipient, because the designers' copies were still being
  // flattened beside the colleague's. `groupIntoLines` buckets by record, so
  // each question landed in its furniture line twice.
  it("counts a colleague's questions once, and drafts one email", async () => {
    render(<DraftsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: /Ana Whitcombe/ }));
    await waitFor(() => expect(screen.getByText("Item 1")).toBeTruthy());
    expect(screen.getAllByText("Item 1")).toHaveLength(1);
    expect(screen.getByText(/2 lines shown of 2/)).toBeTruthy();
    // Two questions across two lines — not four.
    expect(screen.getByText(/2 questions ticked/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Draft it · 1 draft" })).toBeTruthy();
  });

  it("goes back to the designers' own totals when their tab is chosen", async () => {
    render(<DraftsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: /Ana Whitcombe/ }));
    await waitFor(() => expect(screen.getByText(/2 questions ticked/)).toBeTruthy());
    await userEvent.click(screen.getByRole("tab", { name: /Claire Beaumont/ }));
    await waitFor(() => expect(screen.getByText(/2 questions ticked/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Draft it · 1 draft" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Found on pilot, 2026-10-12, on a project with NO contacts: "Everyone 0"
// beside "Nobody assigned 3128", and "Furniture lines 67 · 67 with nothing
// outstanding". Both numbers now say what is true, and Everyone opens onto
// the items nobody can be asked about.
// ---------------------------------------------------------------------------
describe("a project nobody has been assigned to yet", () => {
  function unrouted() {
    const base = payload();
    return {
      ...base,
      contacts: [],
      inventory: {
        ...base.inventory,
        groups: [],
        lineCount: 3,
        settledLines: 0,
        uncategorisedLines: 1,
        blocked: [
          { recordId: "r-1", recordLabel: "P17231-001", itemDescription: "Stool", designer: null, questionCount: 40, reason: "no designer on the record" },
          { recordId: "r-2", recordLabel: "P17231-002", itemDescription: "Drawers", designer: null, questionCount: 44, reason: "no designer on the record" },
        ],
      },
    };
  }

  it("counts everything outstanding under Everyone, and lists who cannot be asked", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: unrouted() });
    render(<DraftsPage />);
    const everyone = await screen.findByRole("tab", { name: /Everyone/ });
    expect(everyone.textContent).toBe("Everyone84");
    expect(screen.getByText("Nobody can be asked yet.")).toBeTruthy();
    // The list the count opens onto, under the same tab.
    expect(screen.getByText("Drawers")).toBeTruthy();
    expect(screen.getByText("Stool")).toBeTruthy();
  });

  it("never says the lines have nothing outstanding when nobody can be asked", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: unrouted() });
    render(<DraftsPage />);
    await screen.findByRole("tab", { name: /Everyone/ });
    expect(screen.queryByText(/3 with nothing outstanding/)).toBeNull();
    expect(screen.getByText(/none with nothing outstanding · 1 with no category/)).toBeTruthy();
  });
});
