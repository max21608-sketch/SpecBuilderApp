// The upload row when the NAME and the MODEL disagree about a file (prod-ready
// K1, 2026-11-20).
//
// THE DEFECT. "… Bill of Quantities.xlsx" showed "Bill of quantities" in its
// box, the press asked the model, the model said FF&E schedule, and the file
// was filed and READ as one — charged, no records, nothing asked. Now the
// classify route holds it with both readings, and the row offers both: the
// name's suggestion stays in the box, the model's sits beside it, and nothing
// is registered until a person chooses.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";

const upload = vi.fn();
vi.mock("@/lib/pdf-crop", () => ({ countPdfPagesInBrowser: async () => null }));
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const NAME = "NPI-HHH Phase 2 Bill of Quantities.xlsx";
const HELD = "The name says Bill of quantities; the model reads an FF&E schedule — which is it?";

function mount() {
  const view = render(<IntakeBatchUpload projectId="p1" />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], NAME, { type: "" })] } });
  return view;
}

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) {
      return {
        ok: true,
        status: 200,
        data: {
          decision: null,
          held: HELD,
          modelDecision: { importType: "spec_document", documentKind: "ffe_schedule" },
          evidence: "a table of items with finishes and suppliers",
          charged: true,
        },
      };
    }
    if (url === "/api/imports") return { ok: true, status: 200, data: { importId: "i1", autoRead: { dispatched: true } } };
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
});

const registered = () =>
  apiFetch.mock.calls
    .filter((call) => String(call[0]) === "/api/imports")
    .map((call) => JSON.parse(String((call[1] as { body: string }).body)));

describe("a file whose name and contents disagree", () => {
  it("is held with both readings, registers nothing, and files what the person chooses", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));

    expect(await screen.findByText(HELD)).toBeTruthy();
    // Nothing registered, so nothing read or charged beyond the look.
    expect(registered()).toEqual([]);
    // Both readings, one click each: the name's and the model's.
    expect(screen.getByRole("button", { name: "Bill of quantities" })).toBeTruthy();
    const model = screen.getByRole("button", { name: "FF&E schedule" });
    expect(model.parentElement?.textContent).toContain("The model read: a table of items with finishes and suppliers");

    // The person says it is the bill; the next press files it as one, without looking again.
    await userEvent.click(screen.getByRole("button", { name: "Bill of quantities" }));
    await userEvent.click(screen.getByRole("button", { name: /Read the 1 you have named/ }));
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(registered()[0]).toMatchObject({ importType: "boq", documentKind: null, filename: NAME });
    expect(apiFetch.mock.calls.filter((call) => String(call[0]).includes("/classify"))).toHaveLength(1);
  });

  // The prod-ready review, 2026-11-20 (F4): a held row was still counted as one
  // of "N small calls to identify" on the next press, which skips it.
  it("is not counted as a call the next press will make", async () => {
    mount();
    expect(screen.getByText(/one small call to identify it/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await screen.findByText(HELD);

    expect(screen.queryByText(/small calls? to identify/)).toBeNull();
    expect(screen.getByText(/Nothing is left for the press to identify/)).toBeTruthy();
  });

  it("files the model's reading when that is the one chosen", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await userEvent.click(await screen.findByRole("button", { name: "FF&E schedule" }));
    await userEvent.click(screen.getByRole("button", { name: /Read the 1 you have named/ }));
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(registered()[0]).toMatchObject({ importType: "spec_document", documentKind: "ffe_schedule" });
  });
});

// ============================================================================
// THE MODEL'S READING IS A BILL CODE CANNOT READ (prod-ready review F4,
// 2026-11-20). The route held the file before its PDF-bill checks ran, so the
// row offered "Bill of quantities" one click away and never said that
// choosing it means the model transcribes it — one charged read. The unheld
// path has always said so on the row; the held one now does too, and keeps
// saying it once the bill is chosen, because that is when the press spends.
// ============================================================================
describe("a held PDF the model reads as a bill to be transcribed", () => {
  const PDF = "Guest rooms FF&E schedule.pdf";
  const SAYS = "The name says FF&E schedule; the model reads a bill of quantities — which is it?";
  const COST = /The model will transcribe it when you open the review \(12 pages\) — one charged read — and mark every line/;

  beforeEach(() => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
      if (url.includes("/classify")) {
        return {
          ok: true,
          status: 200,
          data: {
            decision: null,
            held: SAYS,
            modelDecision: { importType: "boq", documentKind: null },
            pdfBill: { lines: 0, pages: 12, transcribe: true, reason: "This PDF's text has no quantity column a program could find." },
            evidence: "headed BILL OF QUANTITIES",
            charged: true,
          },
        };
      }
      if (url === "/api/imports") return { ok: true, status: 201, data: { importId: "i1", autoRead: { dispatched: true } } };
      return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
    });
  });

  it("says on the row that choosing the bill is one charged transcription, before and after it is chosen", async () => {
    const view = render(<IntakeBatchUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], PDF, { type: "application/pdf" })] } });
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    expect(await screen.findByText(SAYS)).toBeTruthy();

    const bill = screen.getByRole("button", { name: "Bill of quantities" });
    expect(bill.parentElement?.textContent).toContain("This PDF's text has no quantity column a program could find.");
    expect(bill.parentElement?.textContent).toMatch(COST);

    await userEvent.click(bill);
    const row = screen.getByTitle(PDF).closest("li") as HTMLElement;
    expect(row.textContent).toMatch(COST);
  });
});
