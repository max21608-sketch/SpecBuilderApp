// The projects list says where a TGQ figure comes from the AI-drafted gate
// model (review 1, finding 2, 2026-11-21).
//
// `ProjectSummary.provisionalNotes` was loaded for this page and unused, so a
// cabinetry-heavy project's TGQ — and the total over every project — read as
// the confirmed model. The sentence is the seed's, carried by the data; this
// screen holds no copy of it. And the column's tooltip used "provisional" for
// the PLACEHOLDER checklist, which is a different thing.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectsPage from "@/app/dashboard/projects/page";
import { EMPTY_COMPLETION, EMPTY_SUMMARY } from "@/lib/project-summary-shape";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/projects",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

const SENTENCE = "Invented provisional model, drafted on 1 Jan, not yet confirmed";

function project(id: string, number: string, summary: Partial<typeof EMPTY_SUMMARY>) {
  return {
    id,
    bws_project_number: number,
    name: `Invented ${number}`,
    client: null,
    record_count: "5",
    status: "active",
    archived_at: null,
    archived_by: null,
    specs_agreed_by: null,
    run_count: "1",
    waiting: 0,
    completion: { ...EMPTY_COMPLETION, records: 5, outstanding: 4 },
    summary: { ...EMPTY_SUMMARY, records: 5, ...summary },
    state: "active",
  };
}

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

function serve(projects: unknown[]) {
  apiFetch.mockImplementation(async (url: string) =>
    url.startsWith("/api/projects")
      ? { ok: true, status: 200, data: { projects, archivedCount: 0, unplacedMail: 0 } }
      : { ok: true, status: 200, data: {} },
  );
}

describe("the projects list and a provisional gate model", () => {
  it("prints the model's own sentence, and marks the row whose TGQ counts items on it", async () => {
    serve([
      project("p1", "P90401", { toQuote: 7, tgqFromMatrix: 5, tgqFromProvisional: 3, provisionalNotes: [SENTENCE] }),
      project("p2", "P90402", { toQuote: 4, tgqFromMatrix: 5 }),
    ]);
    render(<ProjectsPage />);
    expect(await screen.findByText(new RegExp(SENTENCE))).toBeInTheDocument();
    // It names the project it covers, because it sits above every row.
    expect(screen.getByText(new RegExp(SENTENCE)).textContent).toContain("the TGQ of P90401 counts 3 items on it");
    const marker = screen.getByText("3 on a provisional model");
    expect(marker).toHaveAttribute("title", SENTENCE);
    expect(screen.getAllByText(/on a provisional model/)).toHaveLength(1);
  });

  it("says nothing provisional where no figure comes from such a model", async () => {
    serve([project("p2", "P90402", { toQuote: 4, tgqFromMatrix: 5 })]);
    render(<ProjectsPage />);
    expect(await screen.findByText("Invented P90402")).toBeInTheDocument();
    expect(screen.queryByText(/on a provisional model/)).not.toBeInTheDocument();
  });

  it("calls the per-level checklist the placeholder in the column's tooltip, not 'provisional'", async () => {
    serve([project("p2", "P90402", { toQuote: 4, tgqFromMatrix: 5 })]);
    render(<ProjectsPage />);
    await screen.findByText("Invented P90402");
    const tip = screen.getAllByRole("note").find((node) => /blocking a quotation/.test(node.getAttribute("title") ?? ""));
    expect(tip?.getAttribute("title")).toMatch(/placeholder/);
    expect(tip?.getAttribute("title")).not.toMatch(/provisional per-level/);
  });
});
