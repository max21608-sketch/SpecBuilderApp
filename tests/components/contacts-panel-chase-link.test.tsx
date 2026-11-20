// "Draft a chase" goes to THAT contact (2026-11-20, U1).
//
// The link carried only the project, although the chase screen reads
// `contactId` and its comment said the link carried it: from the project page
// it opened on whoever the strip defaulted to, and from the chase screen
// itself it went to the page already open. Now the project page links with
// the contact, and the chase screen — where a link to itself changes nothing,
// because it reads `contactId` once — selects the contact's tab in place.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactsPanel, { type Contact, type ContactsOutstanding } from "@/components/projects/ContactsPanel";

vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));

const contacts: Contact[] = [
  { id: "c-hayley", name: "Hayley", email: "hayley@example.test", organisation: "LCS", role: "designer", designerCode: "LCS", version: 1 },
  { id: "c-claire", name: "Claire", email: null, organisation: null, role: "designer", designerCode: "TH", version: 1 },
];

const outstanding: ContactsOutstanding = {
  byContact: [
    { contactId: "c-hayley", contactName: "Hayley", toQuote: 4, alsoOutstanding: 2, noTier: 0 },
    { contactId: "c-claire", contactName: "Claire", toQuote: 0, alsoOutstanding: 1, noTier: 0 },
  ],
  unassigned: { toQuote: 0, alsoOutstanding: 0, noTier: 0, records: 0 },
  noLevel: { toQuote: 0, alsoOutstanding: 0, noTier: 0, records: 0 },
};

describe("ContactsPanel's Draft a chase", () => {
  it("links to the chase screen opened on that contact, from the project page", () => {
    render(
      <ContactsPanel projectId="p-1" contacts={contacts} outstanding={outstanding} suggestedCodes={[]} onChanged={() => {}} />,
    );
    const links = screen.getAllByRole("link", { name: "Draft a chase" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard/drafts?projectId=p-1&contactId=c-hayley",
      "/dashboard/drafts?projectId=p-1&contactId=c-claire",
    ]);
    // The red count beside it goes to the same place.
    expect(screen.getByRole("link", { name: "4" }).getAttribute("href")).toBe(
      "/dashboard/drafts?projectId=p-1&contactId=c-hayley",
    );
  });

  it("on the chase screen, selects that contact's tab in place rather than linking to itself", async () => {
    const onDraftChase = vi.fn();
    render(
      <ContactsPanel
        projectId="p-1"
        contacts={contacts}
        suggestedCodes={[]}
        onChanged={() => {}}
        onDraftChase={onDraftChase}
      />,
    );
    expect(screen.queryByRole("link", { name: "Draft a chase" })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "Draft a chase" })[1]!);
    expect(onDraftChase).toHaveBeenCalledWith("c-claire");
  });
});
