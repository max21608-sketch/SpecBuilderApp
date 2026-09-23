// Thirty boxes, set in one go.
//
// ============================================================================
// Plan any-bill, step 3. Assigning thirty dropdowns by hand on the Miami Beach
// pack was a chore, and most of a pack is drawings. What is proved here:
//
//   TICK ALL ticks every file that can still be set, and "Set the ticked ones
//   to … Apply" writes that kind as a PERSON'S CHOICE — so the press does not
//   pay to look at those files, and registers them under that kind.
//
//   "ALL UNSET → SHOP DRAWINGS" says how many it will set and sets exactly
//   those: PDFs whose box is empty. A box showing a suggestion, and a
//   spreadsheet, are left alone.
//
//   A BULK CHOICE OVER A SUGGESTION THE SELECT IS ALREADY SHOWING STILL
//   COUNTS. The select trap: choosing the option a select already shows fires
//   no change event, so a bulk control that drove the select would do nothing.
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

function mount() {
  const view = render(<IntakeBatchUpload projectId="p1" />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const drop = (...names: string[]) =>
    fireEvent.change(input, { target: { files: names.map((name) => new File(["x"], name, { type: "" })) } });
  return { ...view, drop };
}

const row = (name: string) => screen.getByTitle(name).closest("li") as HTMLElement;
const kindBox = (name: string) => screen.getByRole("combobox", { name: `Kind of ${name}` }) as HTMLSelectElement;
const registered = () =>
  apiFetch.mock.calls
    .filter((call) => String(call[0]) === "/api/imports")
    .map((call) => JSON.parse(String((call[1] as { body: string }).body)) as { filename: string; documentKind: string | null; importType: string });
const classifiedNames = () =>
  apiFetch.mock.calls
    .filter((call) => String(call[0]).includes("/classify"))
    .map((call) => (JSON.parse(String((call[1] as { body: string }).body)) as { filename: string }).filename);

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/batches")) return { ok: true, status: 201, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) {
      return { ok: true, status: 200, data: { decision: { importType: "spec_document", documentKind: "preamble" }, evidence: "general conditions", charged: true } };
    }
    if (url === "/api/imports") return { ok: true, status: 201, data: { importId: "i1", autoRead: { dispatched: true } } };
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
});

describe("tick and apply", () => {
  it("ticks every settable file, sets them all, and the press does not look at them", async () => {
    const { drop } = mount();
    drop("AM-1.pdf", "AM-2.pdf", "AM-3.pdf");
    await userEvent.click(screen.getByRole("checkbox", { name: "Tick every file" }));
    expect(screen.getByText("3 ticked")).toBeTruthy();
    for (const name of ["AM-1.pdf", "AM-2.pdf", "AM-3.pdf"]) {
      expect((within(row(name)).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    }

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind for the ticked files" }), "shop_drawings");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    for (const name of ["AM-1.pdf", "AM-2.pdf", "AM-3.pdf"]) expect(kindBox(name).value).toBe("shop_drawings");
    // Ticks clear once applied, so a second Apply cannot land somewhere unseen.
    expect(screen.getByText("Tick all")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(registered()).toHaveLength(3));
    expect(classifiedNames()).toEqual([]);
    expect(registered().every((body) => body.documentKind === "shop_drawings")).toBe(true);
  });

  it("sets only the ticked rows, and the others are still looked at", async () => {
    const { drop } = mount();
    drop("AM-1.pdf", "AM-2.pdf", "Preamble v2.pdf");
    await userEvent.click(within(row("AM-1.pdf")).getByRole("checkbox"));
    await userEvent.click(within(row("AM-2.pdf")).getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind for the ticked files" }), "shop_drawings");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(kindBox("AM-1.pdf").value).toBe("shop_drawings");
    expect(kindBox("AM-2.pdf").value).toBe("shop_drawings");

    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(registered()).toHaveLength(3));
    expect(classifiedNames()).toEqual(["Preamble v2.pdf"]);
  });

  it("files a suggestion the select is already showing as a person's choice", async () => {
    // "Preamble v2.pdf" is guessed Preamble from its name — its box already
    // SHOWS Preamble. A bulk Preamble must still settle it, so the press
    // skips the look it would otherwise spend on a name guess.
    const { drop } = mount();
    drop("Preamble v2.pdf", "Preamble v3.pdf");
    expect(kindBox("Preamble v2.pdf").value).toBe("preamble");
    await userEvent.click(screen.getByRole("checkbox", { name: "Tick every file" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind for the ticked files" }), "preamble");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(classifiedNames()).toEqual([]);
  });

  it("offers no bulk control over a single file", () => {
    const { drop } = mount();
    drop("AM-1.pdf");
    expect(screen.queryByRole("checkbox", { name: "Tick every file" })).toBeNull();
  });
});

describe("all unset → shop drawings", () => {
  it("counts and sets only the PDFs whose box is empty", async () => {
    const { drop } = mount();
    drop("AM-1.pdf", "AM-2.pdf", "Preamble v2.pdf", "Tracker.xlsx");
    // Two empty PDFs. The preamble is guessed from its name; the spreadsheet
    // is not a drawing set.
    const button = screen.getByRole("button", { name: "All unset → Shop drawings (2)" });
    await userEvent.click(button);
    expect(kindBox("AM-1.pdf").value).toBe("shop_drawings");
    expect(kindBox("AM-2.pdf").value).toBe("shop_drawings");
    expect(kindBox("Preamble v2.pdf").value).toBe("preamble");
    expect(kindBox("Tracker.xlsx").value).toBe("");
    // Nothing left unset, so the button goes.
    expect(screen.queryByRole("button", { name: /All unset/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Start intake/ }));
    await waitFor(() => expect(registered().length).toBeGreaterThanOrEqual(3));
    // The two set in bulk are never sent to be identified.
    expect(classifiedNames()).not.toContain("AM-1.pdf");
    expect(classifiedNames()).not.toContain("AM-2.pdf");
  });
});
