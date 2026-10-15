// The panel a PDF bill waits behind while the model transcribes it (C2).
// A real `fetch` stub driving the real `apiFetch`: what is held here is WHEN
// the charged read starts — once on the first visit, never again by itself
// after a failure, never over another tab's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PdfTranscriptionPanel from "@/components/imports/PdfTranscriptionPanel";
import type { PdfTranscription, TranscriptionRecord } from "@/lib/pdf-bill-checks";

const waiting: PdfTranscription = { state: "waiting", reason: "This PDF has no text a program can read.", pageCount: 2 };

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function panel(props: { transcription?: PdfTranscription; record?: TranscriptionRecord | null; reload?: () => Promise<void> }) {
  return render(
    <PdfTranscriptionPanel
      importId="run-1"
      version={3}
      transcription={props.transcription ?? waiting}
      record={props.record ?? null}
      pdfHref="/api/imports/run-1/source?document=pdf"
      reload={props.reload ?? (async () => {})}
    />,
  );
}

describe("PdfTranscriptionPanel", () => {
  it("starts the transcription once on a first visit, with the version the screen saw", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify({ ok: true, lines: 18 }), { status: 200 }));
    const reload = vi.fn(async () => {});
    panel({ reload });
    expect(await screen.findByText(/The model is transcribing this PDF \(2 pages\)/)).toBeTruthy();
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/imports/run-1/transcribe");
    expect(JSON.parse(String(init.body))).toMatchObject({ version: 3 });
  });

  it("never starts again by itself after a failure, and says the retry is charged", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    panel({ record: { outcome: { at: "2026-10-15T20:00:00Z", ok: false, text: "The transcription of page 3 was cut off.", charged: true } } });
    expect(screen.getByText("The PDF could not be transcribed")).toBeTruthy();
    expect(screen.getByText(/page 3 was cut off\. That attempt was charged\./)).toBeTruthy();
    expect(screen.getByText(/One charged read by the model/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("waits on another tab's transcription rather than starting a second", () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    panel({ record: { pending: { requestId: "r", at: new Date().toISOString() } } });
    expect(screen.getByText(/started in another tab or a moment ago/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a refusal that is not JSON as a sentence, and stops spinning", async () => {
    stubFetch(() => new Response("<html>504 Gateway Timeout</html>", { status: 504, headers: { "content-type": "text/html" } }));
    panel({});
    expect(await screen.findByText("The PDF could not be transcribed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Transcribe again" })).toBeTruthy();
  });

  it("renders nothing once the bill is transcribed", () => {
    stubFetch(() => new Response("{}", { status: 200 }));
    const { container } = panel({ transcription: { ...waiting, state: "done" } });
    expect(container.textContent).toBe("");
  });
});
