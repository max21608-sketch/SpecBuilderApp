// A failed look reaches the row in words, and no empty pack is left behind.
//
// ============================================================================
// FIU 2026-09-23, the pilot upload: thirty files, every classify call failing
// for want of an API key, and the screen said "Say which" thirty times, left
// two intake batches holding nothing, and told the person nothing had been
// charged. What is proved here:
//
//   THE REASON IS RED, ON THE ROW, with "Try identifying again" — which looks
//   at the stored file again and uploads nothing.
//
//   TWO OR MORE FILES FAILING FOR ONE REASON GET ONE BANNER, and each row keeps
//   its own line.
//
//   THE FOOTER IS TRUTHFUL. "Nothing has been charged" is said only of files
//   never sent to the model; a file that was sent is counted as sent.
//
//   A 504 PAGE IS A RED FAILURE, not grey evidence.
//
//   NO BATCH IS CREATED WHEN NOTHING REGISTERS.
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

const NO_KEY = {
  ok: false,
  status: 503,
  error: "Document reading is not configured on this deployment (no API key), so nothing was read. The file is stored.",
  data: { ok: false, code: "not_configured", charged: false, error: "…" },
};

function mount() {
  const view = render(<IntakeBatchUpload projectId="p1" />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const drop = (...names: string[]) =>
    fireEvent.change(input, { target: { files: names.map((name) => new File(["x"], name, { type: "" })) } });
  return { ...view, drop };
}

const calls = (part: string) =>
  apiFetch.mock.calls.filter((call) =>
    part === "/api/imports" ? String(call[0]) === part : String(call[0]).includes(part),
  );
const row = (name: string) => screen.getByTitle(name).closest("li") as HTMLElement;

/** Classify answers per filename; everything else succeeds. */
function server(classify: (filename: string) => unknown) {
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  apiFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url.includes("/batches")) return { ok: true, status: 201, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) {
      const { filename } = JSON.parse(String(init?.body)) as { filename: string };
      return classify(filename);
    }
    if (url === "/api/imports") return { ok: true, status: 201, data: { importId: "i1", autoRead: { dispatched: true } } };
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
}

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
});

describe("a failed look", () => {
  it("prints the reason red on every row, says it once above them, and creates no pack", async () => {
    server(() => NO_KEY);
    const { drop } = mount();
    drop("A.pdf", "B.pdf", "C.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("3 files were not identified.");
    expect(banner.textContent).toContain(
      "Document reading is not configured on this deployment — nothing was read, and the files are stored.",
    );
    for (const name of ["A.pdf", "B.pdf", "C.pdf"]) {
      const line = within(row(name)).getByText(/not configured on this deployment \(no API key\)/);
      expect(line.className).toContain("text-red-700");
      expect(within(row(name)).getByText("Not identified")).toBeTruthy();
      expect(within(row(name)).getByRole("button", { name: "Try identifying again" })).toBeTruthy();
    }
    // Nothing registered, so nothing to put in a pack.
    expect(calls("/batches")).toHaveLength(0);
    expect(calls("/api/imports")).toHaveLength(0);
    // Never sent, so the footer may say nothing was charged.
    expect(screen.getByText(/3 files could not be identified/).textContent).toContain("so nothing has been charged");
  });

  it("gives one file's failure its own line and no banner", async () => {
    server((filename) =>
      filename === "A.pdf"
        ? NO_KEY
        : { ok: true, status: 200, data: { decision: { importType: "spec_document", documentKind: "shop_drawings" }, evidence: "elevations", charged: true } },
    );
    const { drop } = mount();
    drop("A.pdf", "B.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(calls("/api/imports")).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(row("A.pdf")).getByText(/not configured/).className).toContain("text-red-700");
    // B registered, so the pack exists — created once, at B's registration.
    expect(calls("/batches")).toHaveLength(1);
  });

  it("reads a 504 page as a red timeout, and counts the file as sent", async () => {
    server(() => ({ ok: false, status: 504, error: "The server took too long to respond. Try again.", data: null }));
    const { drop } = mount();
    drop("Big set.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    const line = await within(row("Big set.pdf")).findByText("The server took too long to respond. Try again.");
    expect(line.className).toContain("text-red-700");
    const footer = screen.getByText(/One file could not be identified/).textContent ?? "";
    expect(footer).not.toContain("nothing has been charged");
    expect(footer).toContain("it was sent to the model to be identified");
  });

  it("counts a real 'unclear' as sent, and a failure that was never sent as not", async () => {
    server((filename) =>
      filename === "A.pdf"
        ? { ok: true, status: 200, data: { decision: null, evidence: "a cover page with no title", charged: true } }
        : NO_KEY,
    );
    const { drop } = mount();
    drop("A.pdf", "B.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    const footer = await screen.findByText(/2 files could not be identified/);
    expect(footer.textContent).toContain("1 was sent to the model to be identified");
    expect(footer.textContent).toContain("the other 1 was never sent, so nothing was charged for it");
    // The unclear row is NOT red: the model looked, and that is an answer.
    expect(within(row("A.pdf")).queryByText("Not identified")).toBeNull();
    expect(within(row("A.pdf")).getByText("Say which")).toBeTruthy();
  });
});

describe("trying again", () => {
  it("looks at the stored file again, uploads nothing, and registers it", async () => {
    let attempt = 0;
    server(() => {
      attempt += 1;
      return attempt === 1
        ? { ok: false, status: 429, error: "The model is rate limited right now.", data: { ok: false, code: "rate_limited", charged: false } }
        : { ok: true, status: 200, data: { decision: { importType: "spec_document", documentKind: "shop_drawings" }, evidence: "elevations", charged: true } };
    });
    const { drop } = mount();
    drop("A.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Try identifying again" }));

    await waitFor(() => expect(calls("/api/imports")).toHaveLength(1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(calls("/classify")).toHaveLength(2);
    expect(calls("/batches")).toHaveLength(1);
  });
});

describe("a large document", () => {
  it("says it was identified with the reading model", async () => {
    server(() => ({
      ok: true,
      status: 200,
      data: {
        decision: { importType: "spec_document", documentKind: "shop_drawings" },
        evidence: "elevations",
        charged: true,
        largeDocument: true,
      },
    }));
    const { drop } = mount();
    drop("Whole set.pdf");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    expect(await screen.findByText("Large document — identified with the reading model.")).toBeTruthy();
  });
});

describe("no empty packs", () => {
  it("creates no batch when every upload fails to store", async () => {
    upload.mockRejectedValue(new Error("store unavailable"));
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { batch: { id: "b1" } } });
    const { drop } = mount();
    drop("A.pdf", "B.xlsx");
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(screen.getAllByText(/Could not be stored/)).toHaveLength(2));
    expect(calls("/batches")).toHaveLength(0);
  });
});

// ============================================================================
// THE PANEL STAYS OPEN WHILE ANYTHING IS HELD. `onUploaded` is the parent's
// signal to CLOSE this panel (the project page unmounts it), and it used to
// fire on every press — so thirty failed rows, each with its reason, vanished
// together. It fires only when nothing is waiting on a person; otherwise
// `onRegistered` asks the parent to refresh and the rows stay where they are.
// ============================================================================
describe("closing the panel", () => {
  it("does not close it when every file failed, and keeps the rows", async () => {
    server(() => NO_KEY);
    const onUploaded = vi.fn();
    const onRegistered = vi.fn();
    const view = render(<IntakeBatchUpload projectId="p1" onUploaded={onUploaded} onRegistered={onRegistered} />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: ["A.pdf", "B.pdf"].map((name) => new File(["x"], name, { type: "" })) } });
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.getByTitle("A.pdf")).toBeTruthy();
    expect(screen.getByTitle("B.pdf")).toBeTruthy();
  });
});
