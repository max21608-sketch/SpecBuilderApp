// A file with PARTS on the upload screen (open intake, 2026-11-20).
//
// The look answers a mixed file per part; the screen shows a box per part and
// the press registers one READ per reader, each with its own place and its own
// request id. Proved here, with the routes stubbed:
//   - a three-part PDF registers three reads, each with its own `part` and id;
//   - two parts of one kind are ONE read naming both places;
//   - a held part blocks its own file and nobody else's;
//   - "Don't read this part" registers nothing for that part;
//   - a retry never registers a read twice, and a request id is replaced
//     exactly when the server ANSWERED with an error — for a whole file too;
//   - a bill-or-schedule file held with the bill suggested files nothing
//     until the suggestion is accepted.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntakeBatchUpload from "@/components/projects/IntakeBatchUpload";

const upload = vi.fn();
vi.mock("@/lib/pdf-crop", () => ({ countPdfPagesInBrowser: async () => null }));
vi.mock("@vercel/blob/client", () => ({ upload: (...args: unknown[]) => upload(...args) }));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const DRAWINGS = { importType: "spec_document", documentKind: "shop_drawings" };
const PREAMBLE = { importType: "spec_document", documentKind: "preamble" };
const BILL = { importType: "boq", documentKind: null };

type Part = Record<string, unknown>;
const part = (from: number, to: number, decision: unknown, over: Part = {}): Part => ({
  place: { kind: "pages", from, to },
  genre: "shop_drawings",
  decision,
  certain: decision !== null,
  evidence: `pages ${from}-${to} evidence`,
  held: null,
  suggestion: null,
  unsupported: null,
  unsupportedDetail: null,
  itemCodes: [],
  finishCodes: [],
  pdfBill: null,
  nothingToRead: false,
  ...over,
});

/** What the look answers per filename; a filename not listed is a plain drawing set. */
let looks: Record<string, unknown> = {};
/** What `/api/imports` answers, in turn; past the end, success. */
let registrations: { ok: boolean; status: number; error?: string; data: unknown }[] = [];

beforeEach(() => {
  upload.mockReset();
  apiFetch.mockReset();
  looks = {};
  registrations = [];
  upload.mockImplementation(async (path: string) => ({ pathname: `projects/p1/uploads/${path}` }));
  apiFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
    if (url.includes("/classify")) {
      const filename = JSON.parse(String(init?.body)).filename as string;
      const data = looks[filename] ?? { decision: DRAWINGS, evidence: "elevations", charged: true };
      return { ok: true, status: 200, data };
    }
    if (url === "/api/imports") {
      const next = registrations.shift();
      if (next) return next;
      return { ok: true, status: 200, data: { importId: crypto.randomUUID(), autoRead: { dispatched: true } } };
    }
    return { ok: false, status: 500, error: `unexpected ${url}`, data: null };
  });
});

function mount(...names: string[]) {
  const view = render(<IntakeBatchUpload projectId="p1" />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: names.map((name) => new File(["x"], name, { type: "application/pdf" })) } });
  return view;
}

const registered = () =>
  apiFetch.mock.calls
    .filter((call) => String(call[0]) === "/api/imports")
    .map((call) => JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>);

const press = async (name: RegExp = /Start intake|Read the/) => userEvent.click(screen.getByRole("button", { name }));

describe("a file with parts", () => {
  it("registers a three-part PDF as three reads, each with its own part and request id", async () => {
    looks["QA Pack.pdf"] = {
      parts: [part(1, 12, BILL, { genre: "bill_of_quantities" }), part(13, 30, DRAWINGS), part(31, 40, PREAMBLE, { genre: "preamble" })],
      charged: true,
    };
    mount("QA Pack.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(3));
    const reads = registered();
    expect(reads.map((read) => [read.importType, read.documentKind, read.part])).toEqual([
      ["boq", null, { kind: "pages", ranges: [{ from: 1, to: 12 }] }],
      ["spec_document", "shop_drawings", { kind: "pages", ranges: [{ from: 13, to: 30 }] }],
      ["spec_document", "preamble", { kind: "pages", ranges: [{ from: 31, to: 40 }] }],
    ]);
    expect(new Set(reads.map((read) => read.registrationRequestId)).size).toBe(3);
    expect(reads.every((read) => read.filename === "QA Pack.pdf" && read.batchId === "b1")).toBe(true);
    // One look for the file, whatever it holds.
    expect(apiFetch.mock.calls.filter((call) => String(call[0]).includes("/classify"))).toHaveLength(1);
  });

  it("registers two parts of one kind as ONE read naming both places", async () => {
    looks["QA Merged.pdf"] = {
      parts: [part(1, 11, DRAWINGS), part(12, 30, PREAMBLE, { genre: "preamble" }), part(31, 44, DRAWINGS, { genre: "specification_sheets" })],
      charged: true,
    };
    mount("QA Merged.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(registered()[0]).toMatchObject({
      documentKind: "shop_drawings",
      part: { kind: "pages", ranges: [{ from: 1, to: 11 }, { from: 31, to: 44 }] },
    });
    expect(registered()[1]).toMatchObject({ documentKind: "preamble", part: { kind: "pages", ranges: [{ from: 12, to: 30 }] } });
  });

  it("holds a file with an unanswered part, registers the other files, and registers it once answered", async () => {
    looks["QA Mixed.pdf"] = {
      parts: [part(1, 3, DRAWINGS), part(4, 9, null, { genre: "unclear" })],
      charged: true,
    };
    mount("QA Mixed.pdf", "QA Plain.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(registered()[0]).toMatchObject({ filename: "QA Plain.pdf" });
    expect(registered()[0]).not.toHaveProperty("part");

    const box = screen.getByRole("combobox", { name: "Kind of QA Mixed.pdf, pages 4–9" });
    expect((box as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: /Read the 0 you have named/ })).toBeDisabled();
    await userEvent.selectOptions(box, "preamble");
    await press(/Read the 1 you have named/);
    await waitFor(() => expect(registered()).toHaveLength(3));
    expect(registered().slice(1).map((read) => [read.documentKind, read.part])).toEqual([
      ["shop_drawings", { kind: "pages", ranges: [{ from: 1, to: 3 }] }],
      ["preamble", { kind: "pages", ranges: [{ from: 4, to: 9 }] }],
    ]);
  });

  it("starts a cover at Don't read this part, and registers nothing for a part left out", async () => {
    looks["QA Pack.pdf"] = {
      parts: [part(1, 1, null, { genre: "unclear", nothingToRead: true, evidence: "a cover" }), part(2, 9, DRAWINGS), part(10, 12, PREAMBLE, { genre: "preamble" })],
      charged: true,
    };
    mount("QA Pack.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(registered().map((read) => read.part)).toEqual([
      { kind: "pages", ranges: [{ from: 2, to: 9 }] },
      { kind: "pages", ranges: [{ from: 10, to: 12 }] },
    ]);
    const cover = screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, page 1" }) as HTMLSelectElement;
    expect((cover.selectedOptions[0]?.textContent ?? "").trim()).toBe("Don't read this part");
  });

  it("registers nothing for a part a person sets to Don't read this part", async () => {
    looks["QA Mixed.pdf"] = { parts: [part(1, 3, DRAWINGS), part(4, 9, null, { genre: "unclear" })], charged: true };
    mount("QA Mixed.pdf");
    await press();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Kind of QA Mixed.pdf, pages 4–9" }), "skip");
    await press(/Read the 1 you have named/);
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(registered()[0]).toMatchObject({ documentKind: "shop_drawings", part: { kind: "pages", ranges: [{ from: 1, to: 3 }] } });
  });
});

describe("a retry never registers a read twice", () => {
  it("re-sends only the read that failed: under the same id where no answer came, a new one where the server answered", async () => {
    looks["QA Pack.pdf"] = { parts: [part(1, 3, DRAWINGS), part(4, 9, PREAMBLE, { genre: "preamble" })], charged: true };
    // Drawings land; the preamble's answer never arrives.
    registrations = [
      { ok: true, status: 200, data: { importId: "r1", autoRead: { dispatched: true } } },
      { ok: false, status: 0, error: "Could not reach the server.", data: null },
    ];
    mount("QA Pack.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(await screen.findByText("Could not reach the server.")).toBeTruthy();
    const first = registered();

    // Pressed again: the drawings are not sent again; the preamble is, with the SAME id.
    registrations = [{ ok: false, status: 500, error: "The server returned an error (500).", data: { ok: false, error: "boom" } }];
    await press(/Start intake/);
    await waitFor(() => expect(registered()).toHaveLength(3));
    expect(registered()[2]).toMatchObject({ documentKind: "preamble", registrationRequestId: first[1]!.registrationRequestId });

    // The server ANSWERED that one with an error: the next send is a new request.
    await press(/Start intake/);
    await waitFor(() => expect(registered()).toHaveLength(4));
    expect(registered()[3]).toMatchObject({ documentKind: "preamble" });
    expect(registered()[3]!.registrationRequestId).not.toBe(first[1]!.registrationRequestId);
    expect(registered().filter((read) => read.documentKind === "shop_drawings")).toHaveLength(1);
  });

  it("follows the same rule for a whole file", async () => {
    registrations = [
      { ok: false, status: 0, error: "Could not reach the server.", data: null },
      { ok: false, status: 500, error: "boom", data: { ok: false, error: "boom" } },
    ];
    mount("QA Plain.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(1));
    await screen.findByText("Could not reach the server.");
    await press(/Start intake/);
    await waitFor(() => expect(registered()).toHaveLength(2));
    await press(/Start intake/);
    await waitFor(() => expect(registered()).toHaveLength(3));
    const [a, b, c] = registered().map((read) => read.registrationRequestId);
    expect(b).toBe(a);
    expect(c).not.toBe(b);
  });
});

describe("a bill or a schedule, held with the bill suggested", () => {
  it("shows the bill in the box, files nothing, and files the bill once accepted", async () => {
    looks["QA Procurement.pdf"] = {
      decision: null,
      held: "Could be the bill or an FF&E schedule. If it is the bill, accept Bill of quantities; if not, choose what it is.",
      suggestion: BILL,
      evidence: "Reads as a bill: 26 lines; code and quantity columns found.",
      charged: true,
    };
    mount("QA Procurement.pdf");
    await press();
    await screen.findByText(/Could be the bill or an FF&E schedule/);
    expect(registered()).toEqual([]);
    const row = screen.getByRole("combobox", { name: "Kind of QA Procurement.pdf" }).closest("li") as HTMLElement;
    expect(within(row).getByText(/Reads as a bill: 26 lines; code and quantity columns found\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Read the 0 you have named/ })).toBeDisabled();

    await userEvent.click(within(row).getByRole("button", { name: /Bill of quantities/ }));
    await press(/Read the 1 you have named/);
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(registered()[0]).toMatchObject({ importType: "boq", documentKind: null });
    expect(registered()[0]).not.toHaveProperty("part");
  });
});

describe("a part in a read stays in that read (fix 1, 2026-11-21)", () => {
  const refusedBill = {
    ok: false,
    status: 400,
    error: "This PDF's text is not a bill's table.",
    data: { ok: false, error: "This PDF's text is not a bill's table.", detail: "Page 12: no quantity column." },
  };

  it("re-answering a refused bill part as drawings registers ONLY that part, never the whole file again", async () => {
    looks["QA Pack.pdf"] = { parts: [part(1, 11, DRAWINGS), part(12, 30, BILL, { genre: "bill_of_quantities" })], charged: true };
    registrations = [{ ok: true, status: 200, data: { importId: "r1", autoRead: { dispatched: true } } }, refusedBill];
    mount("QA Pack.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(2));
    const drawings = screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, pages 1–11" });
    expect(drawings).toBeDisabled();
    const bill = screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, pages 12–30" });
    expect((bill as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/One file is partly read/)).toBeTruthy();
    expect(screen.queryByText(/could not be identified/)).toBeNull();

    await userEvent.selectOptions(bill, "shop_drawings");
    await press(/Read the 1 you have named/);
    await waitFor(() => expect(registered()).toHaveLength(3));
    expect(registered()[2]).toMatchObject({ documentKind: "shop_drawings", part: { kind: "pages", ranges: [{ from: 12, to: 30 }] } });
    expect(registered()[2]!.registrationRequestId).not.toBe(registered()[0]!.registrationRequestId);
  });

  it("locks a part whose read is waiting for a slot while the file is still held", async () => {
    looks["QA Pack.pdf"] = { parts: [part(1, 3, DRAWINGS), part(4, 9, BILL, { genre: "bill_of_quantities" })], charged: true };
    registrations = [
      { ok: true, status: 200, data: { importId: "r1", autoRead: { dispatched: false, waiting: true, note: "Waiting for a slot." } } },
      refusedBill,
    ];
    mount("QA Pack.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, pages 1–3" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, pages 4–9" })).not.toBeDisabled();
  });

  it("re-sends a read whose answer was lost exactly as it was, and locks its parts meanwhile", async () => {
    looks["QA Pack.pdf"] = { parts: [part(1, 3, DRAWINGS), part(4, 9, PREAMBLE, { genre: "preamble" })], charged: true };
    registrations = [
      { ok: false, status: 0, error: "Could not reach the server.", data: null },
      { ok: true, status: 200, data: { importId: "r2", autoRead: { dispatched: true } } },
    ];
    mount("QA Pack.pdf");
    await press();
    await waitFor(() => expect(registered()).toHaveLength(2));
    expect(screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, pages 1–3" })).toBeDisabled();
    await press(/Start intake/);
    await waitFor(() => expect(registered()).toHaveLength(3));
    expect(registered()[2]).toEqual(registered()[0]);
  });
});

describe("what a parts file says when nothing of it is read", () => {
  it("says Nothing read from this file. and does not count it as being read when every part is left out", async () => {
    looks["QA Pack.pdf"] = { parts: [part(1, 3, DRAWINGS), part(4, 9, null, { genre: "unclear" })], charged: true };
    mount("QA Pack.pdf");
    await press();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Kind of QA Pack.pdf, pages 1–3" }), "skip");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind of QA Pack.pdf, pages 4–9" }), "skip");
    await press(/Read the 1 you have named/);
    expect(await screen.findByText("Nothing read from this file.")).toBeTruthy();
    expect(registered()).toEqual([]);
    expect(screen.getByText(/0 being read/)).toBeTruthy();
  });

  it("shows the survey's note on the row, for parts and for a single file", async () => {
    looks["QA Pack.pdf"] = { parts: [part(1, 3, DRAWINGS), part(4, 9, PREAMBLE, { genre: "preamble" })], note: "Part 3 (preamble) was dropped: it named no pages.", charged: true };
    looks["QA Plain.pdf"] = { decision: DRAWINGS, evidence: "elevations", note: "Pages 1–2: one shop drawings part.", charged: true };
    mount("QA Pack.pdf", "QA Plain.pdf");
    await press();
    expect(await screen.findByText("Part 3 (preamble) was dropped: it named no pages.")).toBeTruthy();
    expect(screen.getByText("Pages 1–2: one shop drawings part.")).toBeTruthy();
  });
});

describe("a held file's suggestion sits beside an empty box (fix 4, 2026-11-21)", () => {
  const held = {
    decision: null,
    held: "Could be the bill or an FF&E schedule. If it is the bill, accept Bill of quantities; if not, choose what it is.",
    suggestion: BILL,
    evidence: "Reads as a bill: 26 lines; code and quantity columns found.",
    charged: true,
  };

  it("keeps the box empty, so choosing Bill in the box itself records it", async () => {
    looks["QA Procurement.pdf"] = held;
    mount("QA Procurement.pdf");
    await press();
    await screen.findByText(/Could be the bill or an FF&E schedule/);
    const box = screen.getByRole("combobox", { name: "Kind of QA Procurement.pdf" }) as HTMLSelectElement;
    expect(box.value).toBe("");
    expect((box.selectedOptions[0]?.textContent ?? "").trim()).toBe("— say which —");
    await userEvent.selectOptions(box, "boq");
    await press(/Read the 1 you have named/);
    await waitFor(() => expect(registered()).toHaveLength(1));
    expect(registered()[0]).toMatchObject({ importType: "boq", documentKind: null });
  });

  it("never files the suggestion on a retry of the file", async () => {
    // The look fails first, so the row offers "Try identifying again"; the
    // second look holds it with the bill suggested; nothing may register.
    let first = true;
    apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/classify")) {
        if (first) {
          first = false;
          return { ok: false, status: 504, error: "timeout", data: { ok: false, code: "timeout", error: "The look took too long.", charged: false } };
        }
        return { ok: true, status: 200, data: held };
      }
      if (url.includes("/batches")) return { ok: true, status: 200, data: { batch: { id: "b1" } } };
      return { ok: true, status: 200, data: { importId: "r1", autoRead: { dispatched: true } } };
    });
    mount("QA Procurement.pdf");
    await press();
    await userEvent.click(await screen.findByRole("button", { name: "Try identifying again" }));
    await screen.findByText(/Could be the bill or an FF&E schedule/);
    expect(registered()).toEqual([]);
    expect(screen.getByRole("button", { name: /Read the 0 you have named/ })).toBeDisabled();
  });
});
