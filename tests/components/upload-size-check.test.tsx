// A document too large for one read is refused on its own row BEFORE a byte
// is stored; a long one is warned about and still goes. The page count is
// STUBBED — the component tier never loads pdfjs or a real PDF.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";
import DocumentUpload from "@/components/projects/DocumentUpload";

const pages = vi.hoisted(() => new Map<string, number | null>());
const countPdfPagesInBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pdf-crop", () => ({ countPdfPagesInBrowser }));

const upload = vi.fn();
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));
const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const pdf = (name: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

beforeEach(() => {
  pages.clear();
  countPdfPagesInBrowser.mockReset();
  countPdfPagesInBrowser.mockImplementation(async (file: File) => pages.get(file.name) ?? null);
  upload.mockReset();
  upload.mockImplementation(async (pathname: string) => ({ pathname }));
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) =>
    url.includes("/batches")
      ? { ok: true, status: 200, data: { batch: { id: "b1" } } }
      : url.includes("/classify")
        ? { ok: true, status: 200, data: { decision: { importType: "spec_document", documentKind: "shop_drawings" }, evidence: "cover" } }
        : { ok: true, status: 200, data: { importId: "i1" } },
  );
});

describe("the pack upload", () => {
  it("refuses a PDF over 600 pages on its own row, in words, and uploads the rest", async () => {
    pages.set("Huge set.pdf", 734);
    pages.set("Drawings.pdf", 12);
    const view = render(<IntakeBatchUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("Huge set.pdf"), pdf("Drawings.pdf")] } });

    expect(
      await screen.findByText("This PDF has 734 pages; one read takes at most 600 — split it into smaller documents."),
    ).toBeInTheDocument();
    expect(screen.getByText("Too large")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]?.[0]).toContain("Drawings.pdf");
    const registered = apiFetch.mock.calls.filter(([url]) => url === "/api/imports");
    expect(registered).toHaveLength(1);
    expect(String(registered[0]?.[1]?.body)).not.toContain("Huge set.pdf");
  });

  it("refuses a PDF over 20 MB without counting its pages", async () => {
    const view = render(<IntakeBatchUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("Big.pdf", 20 * 1024 * 1024 + 1)] } });
    expect(screen.getByText(/one read takes at most 20 MB/)).toBeInTheDocument();
    expect(countPdfPagesInBrowser).not.toHaveBeenCalled();
  });

  it("warns on a long PDF and still uploads it", async () => {
    pages.set("Long set.pdf", 72);
    const view = render(<IntakeBatchUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("Long set.pdf")] } });
    expect(
      await screen.findByText("72 pages — this may be too large to read in one go; if the read fails, split it."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });

  it("never counts a file that is not a PDF", async () => {
    const view = render(<IntakeBatchUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "Bill.xlsx", { type: "" })] } });
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(countPdfPagesInBrowser).not.toHaveBeenCalled();
  });
});

describe("the single-document upload", () => {
  it("refuses a PDF over 600 pages before a byte is stored", async () => {
    pages.set("Huge set.pdf", 734);
    const view = render(<DocumentUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("Huge set.pdf")] } });
    expect(await screen.findByText(/This PDF has 734 pages/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("warns on a long PDF and still uploads it", async () => {
    pages.set("Long set.pdf", 72);
    upload.mockImplementation(() => new Promise(() => {})); // hold it mid-upload
    const view = render(<DocumentUpload projectId="p1" />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf("Long set.pdf")] } });
    expect(await screen.findByText(/72 pages — this may be too large/)).toBeInTheDocument();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });
});
