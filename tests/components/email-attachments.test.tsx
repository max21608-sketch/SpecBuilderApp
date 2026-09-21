// The attachment list on an email review — Stage 2 variance row 4.
//
// ============================================================================
// WHAT THIS PROVES
//
// Specification arrives as an attachment constantly: the email says "sizes
// attached" and the sizes are in a PDF. The body is read; the attachment is
// LISTED as not read, because a document's kind is declared by a person and
// reading one is a charged call.
//
// Three things are worth holding here rather than in a rule about how to build
// the panel. That the list SAYS the files are not read, and what the next step
// costs — a panel that just named them reads as though the app had them. That
// the download is a plain link to the run's own read-only route, so nothing on
// this screen can register a document or spend money. And that the link's index
// is the POSITION in the list: a download pointing one row off would hand
// somebody the wrong client document believing it was the one they clicked.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import EmailEnvelope, { type EmailMessage } from "@/components/imports/EmailHeader";

const message = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "msg-1",
  from_addr: "jane@designers.test",
  from_name: "Jane Doe",
  subject: "RE: X-100 - sizes attached",
  received_at: "2026-09-16T09:30:00.000Z",
  to_addrs: [{ name: "Project Panther", address: "p17726@benwhistler.test" }],
  cc_addrs: null,
  attachments_meta: [
    { filename: "X-100 sizes.pdf", contentType: "application/pdf", size: 2048, isRfc822: false },
    { filename: "forwarded.eml", contentType: "message/rfc822", size: 900, isRfc822: true },
  ],
  has_attachments: true,
  routing_reason: null,
  chase_match: null,
  chase_subject: null,
  chase_sent_at: null,
  chase_recipient_name: null,
  chase_question_count: null,
  triage: "assigned",
  version: 1,
  ...overrides,
});

describe("the attachment list", () => {
  it("says the attachments are not read, and what having one read costs", () => {
    render(<EmailEnvelope message={message()} runId="run-1" />);
    expect(screen.getByText(/2 attachments, not read/)).toBeInTheDocument();
    expect(screen.getByText(/charged call/)).toBeInTheDocument();
    expect(screen.getByText(/upload it as its own intake document/)).toBeInTheDocument();
  });

  it("names each file with its size, and marks a forwarded message as one", () => {
    render(<EmailEnvelope message={message()} runId="run-1" />);
    expect(screen.getByText(/X-100 sizes\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
    // A forwarded message is not an intake document, and registering one as a
    // specification sheet is the mistake this label exists to head off.
    expect(screen.getByText(/a forwarded message/)).toBeInTheDocument();
  });

  it("links each download to ITS OWN index on the run's read-only route", () => {
    render(<EmailEnvelope message={message()} runId="run-1" />);
    const links = screen.getAllByRole("link", { name: "Download" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/api/imports/run-1/attachments/0");
    expect(links[1]).toHaveAttribute("href", "/api/imports/run-1/attachments/1");
    // A link, not a form and not a POST: this screen cannot register anything.
    expect(screen.queryByRole("button", { name: /register/i })).not.toBeInTheDocument();
  });

  it("offers no download where there is no run to read it from", () => {
    // The panel also renders on a document that is not an email, where there
    // is no attachment route to point at. A link that goes nowhere is worse
    // than no link.
    render(<EmailEnvelope message={message()} />);
    expect(screen.queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
    expect(screen.getByText(/X-100 sizes\.pdf/)).toBeInTheDocument();
  });

  it("says nothing at all about attachments on a message with none", () => {
    render(<EmailEnvelope message={message({ attachments_meta: [], has_attachments: false })} runId="run-1" />);
    expect(screen.queryByText(/not read/)).not.toBeInTheDocument();
  });
});
