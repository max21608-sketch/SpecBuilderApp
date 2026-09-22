// The upload screen guesses from the filename, and a person can agree with it.
//
// ============================================================================
// FIU 2026-09-22, item 4a.3. Eleven files landed as eleven unset boxes and a
// Start intake button, and the sentence saying the press fills them in was at
// the bottom in grey. Three things are proved here:
//
//   THE BOXES FILL ON DROP, from the name alone, with nothing stored and
//   nothing asked — `upload` and `apiFetch` are both asserted silent.
//
//   AGREEING WITH THE SUGGESTION WORKS. The defect recorded inside that entry:
//   the select's value IS the suggestion and its `onChange` is the only thing
//   that records a choice, so picking the option already showing fired nothing
//   and the amber flag could never be cleared by agreeing with it.
//
//   A NAME DOES NOT SPEND AND DOES NOT DECIDE. A guess off the name is still
//   looked at by the model at the press; a person's choice is not, and it
//   survives into what is registered.
//
// The "Not implemented: navigation" lines jsdom prints on the presses that
// succeed are the screen's own redirect to the pack, which is the real
// behaviour and is not a failure.
// ============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";

const upload = vi.fn();
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

function mount() {
  const view = render(<IntakeBatchUpload projectId="p1" />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const drop = (...names: string[]) =>
    fireEvent.change(input, {
      target: { files: names.map((name) => new File(["x"], name, { type: "" })) },
    });
  return { ...view, drop };
}

const startButton = () => screen.getByRole("button", { name: /Start intake|Read the/ });

/** The press succeeds, and the model answers whatever this is told to answer. */
function pressSucceeds(classify: Record<string, unknown>) {
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  apiFetch.mockImplementation(async (url: string) => {
    if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) return { ok: true, status: 200, data: classify };
    if (url === "/api/imports") {
      return { ok: true, status: 200, data: { importId: "i1", autoRead: { dispatched: true } } };
    }
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
}

const registered = () =>
  apiFetch.mock.calls
    .filter((call) => String(call[0]) === "/api/imports")
    .map((call) => JSON.parse(String((call[1] as { body: string }).body)));

const classified = () => apiFetch.mock.calls.filter((call) => String(call[0]).includes("/classify"));

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
});

describe("the boxes fill the moment the files land", () => {
  it("names the pack from its filenames, storing and asking nothing", () => {
    const { drop } = mount();
    drop(
      "AP364 - Apx 2 - Panther - BOQ - Seating.xlsx",
      "SPEC-346-Seating - S-100 - Sofa.pdf",
      "AP364 - Apx 1b - Argenta FF&E Preamble.pdf",
    );

    // Each one as a suggestion, with what it was read from beside it.
    expect(screen.getByRole("button", { name: "Bill of quantities" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shop drawings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preamble" })).toBeTruthy();
    expect(screen.getByText("The name says “BOQ”.")).toBeTruthy();
    expect(screen.getByText("The name says “SPEC-346”.")).toBeTruthy();
    expect(screen.getByText("The name says “Preamble”.")).toBeTruthy();

    // THE POINT: a name costs nothing. No bytes, no call, no charge.
    expect(upload).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("says so where it is read, above the rows rather than under the button", () => {
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");
    const said = screen.getByText(/filled in from/);
    expect(said.textContent).toContain("reads nothing, stores nothing and costs nothing");
    // The explanation comes BEFORE the row it is about.
    const row = screen.getByTitle("SPEC-346-Seating - S-100 - Sofa.pdf");
    expect(said.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("holds a name it cannot settle, exactly as before", () => {
    const { drop } = mount();
    // A bare "schedule": FF&E, finishes or fabric, and a name has no tie-break.
    drop("AP364 - Apx 3 - Schedule.xlsx");
    expect(screen.queryByRole("button", { name: /schedule/i })).toBeNull();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    // Held is not an error.
    expect(screen.queryByText("Cannot be read")).toBeNull();
    expect(startButton()).not.toBeDisabled();
  });
});

describe("agreeing with the suggestion", () => {
  it("records the choice and clears the flag", async () => {
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // The box already SHOWS the suggestion, which is the whole defect: picking
    // that same option fires no change event.
    expect(select.value).toBe("shop_drawings");
    expect(select.className).toContain("amber");

    await userEvent.click(screen.getByRole("button", { name: "Shop drawings" }));

    expect(select.value).toBe("shop_drawings");
    expect(select.className).not.toContain("amber");
    expect(screen.queryByRole("button", { name: "Shop drawings" })).toBeNull();
  });

  it("means the press has nothing left to pay to identify", async () => {
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");
    expect(screen.getByText(/one small call/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Shop drawings" }));

    expect(screen.queryByText(/small call/)).toBeNull();
    expect(screen.getByText(/nothing to spend on working that out/)).toBeTruthy();
  });

  it("registers what was accepted, without looking at the document", async () => {
    pressSucceeds({ decision: null, evidence: "should not be reached" });
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Shop drawings" }));
    await userEvent.click(startButton());

    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(classified()).toHaveLength(0);
    expect(registered()[0]).toMatchObject({ importType: "spec_document", documentKind: "shop_drawings" });
  });
});

describe("a person's choice beats both readings", () => {
  it("survives the press, and the document is never looked at", async () => {
    pressSucceeds({ decision: null, evidence: "should not be reached" });
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");

    await userEvent.selectOptions(screen.getByRole("combobox"), "preamble");
    await userEvent.click(startButton());

    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(classified()).toHaveLength(0);
    expect(registered()[0]).toMatchObject({ documentKind: "preamble" });
  });
});

describe("a name suggests and never settles", () => {
  it("is still looked at by the model, whose answer replaces it", async () => {
    pressSucceeds({
      genre: "preamble",
      decision: { importType: "spec_document", documentKind: "preamble" },
      evidence: "it specifies flameproofing for the whole package and names no item",
    });
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");
    await userEvent.click(startButton());

    await waitFor(() => expect(registered()).toHaveLength(1));
    // THE CHARGE STATEMENT STAYS TRUE: the name filled the box for free, and
    // the charged look still happened at the press.
    expect(classified()).toHaveLength(1);
    expect(registered()[0]).toMatchObject({ documentKind: "preamble" });
    expect(screen.getByText(/flameproofing/)).toBeTruthy();
  });

  it("keeps the name's answer when the document settles nothing, and says so", async () => {
    pressSucceeds({ genre: "unclear", decision: null, evidence: "the first page is a title block only" });
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf");
    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText("Say which")).toBeTruthy());
    expect(registered()).toHaveLength(0);
    // The name's suggestion is still there, one click from being accepted.
    expect(screen.getByRole("button", { name: "Shop drawings" })).toBeTruthy();
    expect(screen.getByText("The name says “SPEC-346”.")).toBeTruthy();
    expect(screen.getByText(/Looked at the document and could not tell/)).toBeTruthy();
  });
});

describe("the progress line", () => {
  it("counts what the press has done, and appears only once something is stored", async () => {
    expect(screen.queryByText(/stored ·/)).toBeNull();
    pressSucceeds({ genre: "unclear", decision: null, evidence: "a title block only" });
    const { drop } = mount();
    drop("SPEC-346-Seating - S-100 - Sofa.pdf", "AP364 - Apx 3 - Schedule.xlsx");
    expect(screen.queryByText(/stored ·/)).toBeNull();

    await userEvent.click(startButton());

    await waitFor(() => expect(screen.getByText(/stored ·/)).toBeTruthy());
    const line = screen.getByText(/stored ·/);
    expect(line.textContent).toContain("2 stored");
    expect(line.textContent).toContain("2 waiting for you");
    expect(line.textContent).toContain("0 being read");
  });
});
