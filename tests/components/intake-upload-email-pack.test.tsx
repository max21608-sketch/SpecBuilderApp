// An email joins no pack, so uploading one makes no pack and sends nobody to one.
//
// ============================================================================
// Found by the pre-push review of prod-ready, 2026-11-20 (F1). `ensureBatch`
// made a pack before EVERY registration, emails included; `assignMessage`
// files an email's read with no pack (`batch_id` null, by design — its read
// counts against the project's batch-less slots); and the batches GET hides a
// pack with no reads. So one new .eml uploaded on its own was stored, read and
// then redirected to the empty pack, which said "That pack is not on this
// project" — and every email upload left an empty pack row behind. a867ca7
// fixed only the DUPLICATE email half. Proved here:
//
//   AN UPLOAD OF EMAILS ONLY creates no pack, sends no batch id, and lands on
//   the email's own review page (where the Documents tab's "Emails" row links)
//   — or, for several, closes the panel over the Documents card, whose
//   "Emails" group lists them.
//
//   A MIXED UPLOAD still groups the other files in one pack and goes to it, as
//   it always has; the email is registered without the pack's id.
// ============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";

const upload = vi.fn();
vi.mock("@/lib/pdf-crop", () => ({ countPdfPagesInBrowser: async () => null }));
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const assign = vi.fn();
const original = window.location;

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
  assign.mockReset();
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  let runs = 0;
  apiFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url.includes("/batches")) return { ok: true, status: 201, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) {
      const { filename } = JSON.parse(String(init?.body)) as { filename: string };
      return filename.endsWith(".eml")
        ? {
            ok: true,
            status: 200,
            data: { decision: { importType: "spec_document", documentKind: "email" }, evidence: "a saved email file", charged: false },
          }
        : {
            ok: true,
            status: 200,
            data: { decision: { importType: "boq", documentKind: null }, evidence: "a bill's columns", charged: true },
          };
    }
    if (url === "/api/imports") {
      runs += 1;
      return { ok: true, status: 201, data: { importId: `run-${runs}`, autoRead: { dispatched: true } } };
    }
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
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
});

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: original });
});

function mount() {
  const onUploaded = vi.fn();
  const onRegistered = vi.fn();
  const view = render(<IntakeBatchUpload projectId="p1" onUploaded={onUploaded} onRegistered={onRegistered} />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const drop = (...names: string[]) =>
    fireEvent.change(input, { target: { files: names.map((name) => new File(["x"], name, { type: "" })) } });
  return { onUploaded, onRegistered, drop };
}

const calls = (part: string) =>
  apiFetch.mock.calls.filter((call) =>
    part === "/api/imports" ? String(call[0]) === part : String(call[0]).includes(part),
  );
const registered = () =>
  calls("/api/imports").map((call) => JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>);

describe("an upload of emails only", () => {
  it("creates no pack and lands on the email's own review", async () => {
    const { drop, onUploaded } = mount();
    drop("RE tender queries.eml");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(calls("/batches")).toHaveLength(0);
    expect(registered()).toHaveLength(1);
    expect(registered()[0]).not.toHaveProperty("batchId");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/dashboard/imports/run-1");
  });

  it("closes the panel over the documents for several, and sends nobody to a pack", async () => {
    const { drop, onUploaded } = mount();
    drop("RE fabrics.eml", "RE finishes.eml");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(calls("/batches")).toHaveLength(0);
    expect(registered()).toHaveLength(2);
    for (const body of registered()) expect(body).not.toHaveProperty("batchId");
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("a mixed upload", () => {
  it("still groups the other files in one pack and goes to it; the email carries no pack", async () => {
    const { drop, onUploaded } = mount();
    drop("Seating bill.xlsx", "RE tender queries.eml");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(calls("/batches")).toHaveLength(1);
    // The pack is named for what it holds: the bill, not the email.
    expect(JSON.parse(String((calls("/batches")[0]![1] as { body: string }).body))).toEqual({ label: "1 document" });
    const [bill, email] = registered();
    expect(bill).toMatchObject({ importType: "boq", batchId: "b1" });
    expect(email).toMatchObject({ documentKind: "email" });
    expect(email).not.toHaveProperty("batchId");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/dashboard/projects/p1/intake/b1");
  });
});
