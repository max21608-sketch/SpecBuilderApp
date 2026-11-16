// The "This item" card on the record screen.
//
// Two things about it are traps rather than preferences, and both are asserted
// here: it reads as a summary until Edit, and it saves as ONE act. Typing the
// quote description, tabbing to Internal notes and typing there used to lose
// the second box, because the first blur saved and the reload re-keyed every
// input to what the server held.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordDetails from "@/components/records/RecordDetails";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

const record: React.ComponentProps<typeof RecordDetails>["record"] = {
  item_description: "Sofa",
  area: "Rooms",
  qty: 14,
  designer: "PDS",
  spec_description: "Curved sofa with fixed back and seat.",
  internal_notes: null,
  dimension_note: null,
  version: 3,
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, data: { changed: ["item_description", "internal_notes"] } });
});

describe("the item details card", () => {
  it("reads as a summary, and says in words what nobody has recorded", () => {
    render(<RecordDetails recordId="r1" record={record} onSaved={() => {}} />);
    expect(screen.getByText("Sofa")).toBeInTheDocument();
    // Never an empty cell: an internal note nobody has written and a screen
    // that failed to load look identical otherwise.
    expect(screen.getByText("nothing recorded — never leaves this app")).toBeInTheDocument();
    // The form is MOUNTED but hidden, so text somebody is typing survives a
    // reload of the record. What is conditional is the summary.
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("writes every changed field in ONE request, not one per blur", async () => {
    render(<RecordDetails recordId="r1" record={record} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const description = screen.getByDisplayValue("Sofa");
    await userEvent.clear(description);
    await userEvent.type(description, "Sofa, curved");
    // Tabbing away used to save and re-key every input, discarding whatever
    // was typed next.
    await userEvent.tab();
    expect(apiFetch).not.toHaveBeenCalled();

    const notes = screen.getByPlaceholderText(/Curved sofa/);
    await userEvent.type(notes, " Plinth.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((apiFetch.mock.calls[0]![1] as { body: string }).body);
    expect(body.details.itemDescription).toBe("Sofa, curved");
    expect(body.details.specDescription).toContain("Plinth.");
    // The version it was looking at, so a change underneath is refused rather
    // than overwritten.
    expect(body.version).toBe(3);
  });

  it("sends the dimension note with the rest of the panel, in ONE request", async () => {
    // 0034. It is one box on this form rather than a control beside the
    // dimension cell, because it is a fact about the item typed at the same
    // moment as the others — and save-on-blur is the trap this whole panel
    // exists to avoid.
    render(<RecordDetails recordId="r1" record={record} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const box = screen.getByPlaceholderText("1250 L-shaped return");
    await userEvent.type(box, "1250 L-shaped return");
    await userEvent.tab();
    expect(apiFetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((apiFetch.mock.calls[0]![1] as { body: string }).body);
    expect(body.details.dimensionNote).toBe("1250 L-shaped return");
  });

  it("caps the note at the 200 characters the cell can carry", () => {
    render(<RecordDetails recordId="r1" record={record} onSaved={() => {}} />);
    expect(screen.getByPlaceholderText("1250 L-shaped return")).toHaveAttribute("maxLength", "200");
  });

  it("cannot write a no-op", async () => {
    render(<RecordDetails recordId="r1" record={record} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the category and level selects out of the summary and inside Edit", async () => {
    // They are their own decisions, under their own change-set kinds — the
    // PATCH route takes one per request — so they are not part of Save. They
    // live here because the place you go to change a fact about the item is
    // Edit.
    render(
      <RecordDetails
        recordId="r1"
        record={record}
        onSaved={() => {}}
        classification={<button type="button">Category picker</button>}
      />,
    );
    const picker = () => screen.getByRole("button", { name: "Category picker" });
    expect(picker().closest("div.hidden")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(picker().closest("div.hidden")).toBeNull();
  });

  it("keeps what is being typed when the page hands in a new record object of the same version", async () => {
    // Every reload of the record page builds a new `record` object. The form
    // was re-seeded on the OBJECT, so anything else on the screen saving
    // wiped the panel mid-sentence.
    const { rerender } = render(<RecordDetails recordId="r1" record={record} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const area = screen.getByDisplayValue("Rooms");
    await userEvent.clear(area);
    await userEvent.type(area, "Lobby");

    rerender(<RecordDetails recordId="r1" record={{ ...record }} onSaved={() => {}} />);
    expect(screen.getByDisplayValue("Lobby")).toBeInTheDocument();
  });

  it("keeps the panel open with the typed text after a 409, says so, and only then sends the new version", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "Someone else changed this item. Reload and try again.",
      data: null,
    });
    let current = record;
    let rerenderIt: (ui: React.ReactElement) => void = () => {};
    // The reload after the refusal brings the other person's edit: version 4.
    const onSaved = () => {
      current = { ...record, internal_notes: "Theirs", version: 4 };
      rerenderIt(<RecordDetails recordId="r1" record={current} onSaved={onSaved} />);
    };
    const { rerender } = render(<RecordDetails recordId="r1" record={current} onSaved={onSaved} />);
    rerenderIt = rerender;

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const area = screen.getByDisplayValue("Rooms");
    await userEvent.clear(area);
    await userEvent.type(area, "Lobby");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Someone else changed this item. Reload and try again.")).toBeInTheDocument();
    expect(screen.getByText(/This item was changed while you were editing/)).toBeInTheDocument();
    // Still open, still holding the text.
    expect(screen.getByDisplayValue("Lobby")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(JSON.parse((apiFetch.mock.calls[0]![1] as { body: string }).body).version).toBe(3);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(JSON.parse((apiFetch.mock.calls[1]![1] as { body: string }).body).version).toBe(4);
  });
});
