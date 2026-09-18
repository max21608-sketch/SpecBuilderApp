// Component tier — the run's outputs, rendered.
//
// ============================================================================
// THE RULE WORTH A TEST: THERE ARE THREE OUTPUTS.
//
// Asked for directly on 2026-09-18, on sight of the row: "surely we only
// should have three". There are — the spec upload, the quote lines and the
// costing block — and the row was showing five buttons, because a FORMAT
// (.csv) and a VERIFICATION TOOL (Check sheet) sat as their peers.
//
// A format belongs inside the output it is a format of, and the check sheet
// produces no deliverable. Nothing but a test stops a fourth button appearing
// here the next time an output grows a format or somebody adds a tool: the
// count is the thing a person reads off this row, and it has to stay honest.
// ============================================================================
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ExportMenu from "@/components/records/ExportMenu";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const RUN = "22222222-2222-2222-2222-222222222222";

/** The block holding the download controls, found by its own standing label. */
async function outputs(): Promise<HTMLElement> {
  const label = await screen.findByText(/Checking the spec upload against the pack/i);
  return label.closest("div")?.parentElement as HTMLElement;
}

describe("the run's outputs", () => {
  beforeEach(() => {
    render(<ExportMenu projectId={PROJECT} runId={RUN} />);
  });

  it("offers exactly three, named for what they are", async () => {
    const block = await outputs();
    for (const name of ["Spec upload", "Quote lines", "Costing block"]) {
      expect(within(block).getByText(name)).toBeTruthy();
    }
  });

  it("puts a format INSIDE its output, never beside it as a fourth", async () => {
    const block = await outputs();
    // Three outputs carry five format links between them: the spec upload and
    // the costing block come both ways, the quote is csv only. A bare ".csv"
    // sitting on its own was the button that made the row read as five
    // deliverables.
    const downloads = within(block)
      .getAllByRole("link")
      .map((node) => node.textContent?.trim());
    expect(downloads.filter((text) => text === ".xlsx")).toHaveLength(2);
    expect(downloads.filter((text) => text === ".csv")).toHaveLength(3);
  });

  it("sends each format to its own route", async () => {
    const block = await outputs();
    const hrefs = within(block)
      .getAllByRole("link")
      .map((node) => node.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export?runId=${RUN}`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export?runId=${RUN}&format=csv`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export/quote?runId=${RUN}`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export/costing?runId=${RUN}`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export/costing?runId=${RUN}&format=csv`)).toBe(true);
  });

  it("keeps the check sheet out of the three and says what it is for", async () => {
    const block = await outputs();
    expect(within(block).getByText(/Checking the spec upload against the pack/i)).toBeTruthy();
    const checkSheet = within(block).getByText("Check sheet");
    expect(checkSheet.getAttribute("href")).toBe(
      `/api/projects/${PROJECT}/export/check-sheet?runId=${RUN}`,
    );
  });
});

// THE SAME THREE, PROJECT-WIDE. The Overview has no run selected, and the
// export is never filtered — so the scope parameter simply goes, rather than
// the cluster shrinking to the one file somebody might think is safe.
describe("the project's outputs", () => {
  beforeEach(() => {
    render(<ExportMenu projectId={PROJECT} />);
  });

  it("drops the run scope and keeps all three", async () => {
    const block = await outputs();
    for (const name of ["Spec upload", "Quote lines", "Costing block"]) {
      expect(within(block).getByText(name)).toBeTruthy();
    }
    const hrefs = within(block)
      .getAllByRole("link")
      .map((node) => node.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export`)).toBe(true);
    expect(hrefs.some((href) => href === `/api/projects/${PROJECT}/export?format=csv`)).toBe(true);
    expect(hrefs.every((href) => !href.includes("runId"))).toBe(true);
  });
});
