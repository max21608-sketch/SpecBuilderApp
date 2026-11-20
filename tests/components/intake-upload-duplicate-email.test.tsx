// An email the inbox already holds is said on its row, and the press does not
// navigate away from the sentence.
//
// ============================================================================
// Found by the production-readiness rehearsal, 2026-11-20: a reply already
// held on another project was uploaded again. The server answered
// `duplicateOf` with "This email is already in T20111 …"; the row took the
// sentence, then the press redirected to the new pack's page — empty, because
// the email was all it held — which said "That pack is not on this project",
// and the sentence was gone. The tally also counted the duplicate as "waiting
// for a slot". Proved here:
//
//   THE PANEL STAYS, with the server's sentence on the row.
//   THE DUPLICATE IS NOT "being read" OR "waiting for a slot".
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";

const upload = vi.fn();
vi.mock("@/lib/pdf-crop", () => ({ countPdfPagesInBrowser: async () => null }));
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const NOTE = "This email is already in T20111 (RE: tender queries), so nothing was recorded or read again.";

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/batches")) return { ok: true, status: 201, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) {
      return {
        ok: true,
        status: 200,
        data: { decision: { importType: "spec_document", documentKind: "email" }, evidence: "a saved email file", charged: false },
      };
    }
    if (url === "/api/imports") {
      return { ok: true, status: 200, data: { ok: true, duplicateOf: { messageId: "m1" }, note: NOTE } };
    }
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
});

describe("an email the inbox already holds", () => {
  it("keeps the panel open with the server's sentence, and does not count it as being read", async () => {
    const assign = vi.fn();
    const original = window.location;
    // jsdom's location cannot be assigned; watch the href setter instead.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        set href(value: string) {
          assign(value);
        },
        get href() {
          return original.href;
        },
      },
    });
    const onUploaded = vi.fn();
    const onRegistered = vi.fn();
    const view = render(<IntakeBatchUpload projectId="p1" onUploaded={onUploaded} onRegistered={onRegistered} />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "RE tender queries.eml", { type: "" })] } });
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));

    const line = await screen.findByText(NOTE);
    expect(line).toBeTruthy();
    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    expect(onUploaded).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    const rowEl = screen.getByTitle("RE tender queries.eml").closest("li") as HTMLElement;
    expect(within(rowEl).queryByText(/waiting for a slot/i)).toBeNull();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});
