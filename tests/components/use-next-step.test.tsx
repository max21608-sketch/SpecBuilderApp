// `useNextStep` re-reads the project when the screen's own document moves
// (audit 2026-11-06, G7).
//
// It depended on the project id alone. A review screen that CONFIRMS and stays
// on the page -- the bill's "Review complete", the drawings' -- kept the step
// it computed while the document was still waiting for review, so the primary
// button read "Review the bill" and linked to the screen it was on. The fix is
// a refresh token the screen already holds (the document's status and
// version): a new token is a new read, the same token is not.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useNextStep } from "@/lib/use-next-step";

const calls = vi.hoisted(() => ({ count: 0, documents: [] as { id: string; status: string; source_kind: string; document_kind: string | null }[] }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async () => {
    calls.count += 1;
    return {
      ok: true,
      status: 200,
      data: {
        summary: { records: 3, uncategorised: 0, toQuote: 2, projectWide: 0, documentsReading: 0, documentsFailed: 0 },
        documents: calls.documents,
        runs: [{ id: "phase-1" }],
      },
    };
  },
}));

function Probe({ token }: { token: string | null }) {
  const step = useNextStep("project-1", token);
  return <p>{step ? step.label : "no step"}</p>;
}

describe("useNextStep", () => {
  beforeEach(() => {
    calls.count = 0;
    calls.documents = [{ id: "bill-1", status: "parsed", source_kind: "boq_xlsx", document_kind: null }];
  });

  it("reads again when the screen's document moves on, and says the step after it", async () => {
    const view = render(<Probe token="parsed:4" />);
    await waitFor(() => expect(calls.count).toBe(1));
    expect(await screen.findByText("Review the bill")).toBeTruthy();

    // The reviewer confirms; the screen stays; its document is now confirmed.
    calls.documents = [{ id: "bill-1", status: "confirmed", source_kind: "boq_xlsx", document_kind: null }];
    view.rerender(<Probe token="confirmed:5" />);
    await waitFor(() => expect(calls.count).toBe(2));
    // The step after the bill, never the bill again.
    await waitFor(() => expect(screen.queryByText("Review the bill")).toBeNull());
    expect(screen.getByText(/to-quote/)).toBeTruthy();
  });

  it("does not read again on a render that changes nothing", async () => {
    const view = render(<Probe token="parsed:4" />);
    await waitFor(() => expect(calls.count).toBe(1));
    view.rerender(<Probe token="parsed:4" />);
    view.rerender(<Probe token="parsed:4" />);
    // Give an extra effect the chance to fire before counting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.count).toBe(1);
  });
});
