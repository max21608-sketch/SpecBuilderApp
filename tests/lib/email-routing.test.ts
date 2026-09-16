// Which project an email belongs to. Pure, and the most consequential guess in
// the feature: a wrong project writes one client's fabric onto another's sofa.
import { describe, expect, it } from "vitest";
import { routeMessage, type RoutingRegisters } from "@/lib/email-routing";
import type { EmailEnvelope } from "@/lib/email-envelope";

const panther = {
  id: "proj-panther",
  bwsProjectNumber: "P17726",
  name: "AP364 Project Panther",
  sharedInbox: "p17726@benwhistler.test",
  status: "active",
};
const maybourne = {
  id: "proj-maybourne",
  bwsProjectNumber: "P17231",
  name: "AP346 Maybourne Paris",
  sharedInbox: "p17231@benwhistler.test",
  status: "active",
};

const registers: RoutingRegisters = {
  projects: [panther, maybourne],
  contacts: [{ projectId: panther.id, email: "jane@designers.test" }],
};

function envelope(overrides: Partial<EmailEnvelope> = {}): EmailEnvelope {
  return {
    messageId: "<m1@x.test>",
    inReplyTo: null,
    references: [],
    from: { name: "Jane Doe", address: "someone@elsewhere.test" },
    replyTo: [],
    to: [{ name: null, address: "kam@benwhistler.test" }],
    cc: [],
    subject: "Specification",
    date: "2026-09-16T09:00:00.000Z",
    headers: [],
    textBody: "body",
    htmlBody: null,
    attachments: [],
    ...overrides,
  };
}

describe("routeMessage — a redirected message", () => {
  // Exchange "redirect to" keeps the original From and stamps a loop header.
  it("assigns on the inbox-rules-loop header, keeping the original sender", () => {
    const outcome = routeMessage(
      envelope({
        headers: [
          { name: "X-MS-Exchange-Inbox-Rules-Loop", value: "p17726@benwhistler.test" },
          { name: "X-MS-Exchange-Organization-AutoForwarded", value: "true" },
        ],
      }),
      registers,
    );
    expect(outcome.status).toBe("assigned");
    if (outcome.status !== "assigned") return;
    expect(outcome.projectId).toBe(panther.id);
    expect(outcome.signal).toBe("forwarded_from_inbox");
    // The evidence names the header, so the decision can be checked against
    // what actually arrived.
    expect(outcome.evidence).toContain("p17726@benwhistler.test");
  });
});

describe("routeMessage — a rule-forwarded message", () => {
  // "forward to" REPLACES the sender with the project mailbox.
  it("assigns when the project inbox is the sender and Exchange says auto-forwarded", () => {
    const outcome = routeMessage(
      envelope({
        from: { name: "Project Panther", address: "p17726@benwhistler.test" },
        headers: [{ name: "X-MS-Exchange-Organization-AutoForwarded", value: "true" }],
      }),
      registers,
    );
    expect(outcome.status).toBe("assigned");
  });

  // Otherwise a person emailing from the project mailbox by hand would be read
  // as a forwarding rule, and their message would route on the wrong evidence.
  it("does not treat a hand-sent message from the inbox as a forward", () => {
    const outcome = routeMessage(
      envelope({ from: { name: null, address: "p17726@benwhistler.test" }, subject: "no clues here" }),
      registers,
    );
    expect(outcome.status).toBe("unassigned");
  });
});

describe("routeMessage — the other signals", () => {
  it("assigns on the project inbox appearing in To or Cc", () => {
    const outcome = routeMessage(
      envelope({ cc: [{ name: null, address: "p17231@benwhistler.test" }] }),
      registers,
    );
    expect(outcome.status).toBe("assigned");
    if (outcome.status !== "assigned") return;
    expect(outcome.projectId).toBe(maybourne.id);
    expect(outcome.signal).toBe("recipient_is_inbox");
  });

  it("assigns on the BWS project number in the subject", () => {
    const outcome = routeMessage(envelope({ subject: "P17726 — seat heights" }), registers);
    expect(outcome.status).toBe("assigned");
    if (outcome.status !== "assigned") return;
    expect(outcome.signal).toBe("subject_project_number");
  });

  it("assigns on the client's own project code, which lives in the project name", () => {
    const outcome = routeMessage(envelope({ subject: "AP364 revised fabric schedule" }), registers);
    expect(outcome.status).toBe("assigned");
    if (outcome.status !== "assigned") return;
    expect(outcome.projectId).toBe(panther.id);
    expect(outcome.signal).toBe("subject_project_code");
  });

  it("does not match a code that is merely a prefix of the project's", () => {
    const outcome = routeMessage(envelope({ subject: "AP36 something else" }), registers);
    expect(outcome.status).toBe("unassigned");
  });

  it("assigns on a sender who is a contact on exactly one project", () => {
    const outcome = routeMessage(
      envelope({ from: { name: "Jane", address: "jane@designers.test" } }),
      registers,
    );
    expect(outcome.status).toBe("assigned");
    if (outcome.status !== "assigned") return;
    expect(outcome.signal).toBe("sender_is_contact");
  });

  it("holds a sender who is a contact on two projects", () => {
    const outcome = routeMessage(envelope({ from: { name: "Jane", address: "jane@designers.test" } }), {
      ...registers,
      contacts: [
        { projectId: panther.id, email: "jane@designers.test" },
        { projectId: maybourne.id, email: "jane@designers.test" },
      ],
    });
    expect(outcome.status).toBe("ambiguous");
    expect(outcome.candidates).toHaveLength(2);
  });
});

describe("routeMessage — precedence and ambiguity", () => {
  it("lets the inbox decide even when the subject names another project", () => {
    // A designer replying about Panther while quoting a Maybourne reference is
    // normal. The mailbox the message was routed through is the stronger fact.
    const outcome = routeMessage(
      envelope({
        headers: [{ name: "X-MS-Exchange-Inbox-Rules-Loop", value: "p17726@benwhistler.test" }],
        subject: "P17231 for comparison",
      }),
      registers,
    );
    expect(outcome.status).toBe("assigned");
    if (outcome.status !== "assigned") return;
    expect(outcome.projectId).toBe(panther.id);
    // The weaker match is still offered, so the screen can show its working.
    expect(outcome.candidates.some((c) => c.projectId === maybourne.id)).toBe(true);
  });

  it("holds a message addressed to two project inboxes rather than picking the first", () => {
    const outcome = routeMessage(
      envelope({
        to: [
          { name: null, address: "p17726@benwhistler.test" },
          { name: null, address: "p17231@benwhistler.test" },
        ],
      }),
      registers,
    );
    expect(outcome.status).toBe("ambiguous");
    expect(outcome.candidates).toHaveLength(2);
  });

  it("does not let a weaker signal break a tie between two strong ones", () => {
    // The sender is a contact on Panther, and both inboxes are addressed. If
    // the contact broke the tie, one confident-looking wrong answer in ten
    // would be invisible.
    const outcome = routeMessage(
      envelope({
        from: { name: "Jane", address: "jane@designers.test" },
        to: [
          { name: null, address: "p17726@benwhistler.test" },
          { name: null, address: "p17231@benwhistler.test" },
        ],
      }),
      registers,
    );
    expect(outcome.status).toBe("ambiguous");
  });

  it("holds a message that names nothing", () => {
    const outcome = routeMessage(envelope(), registers);
    expect(outcome.status).toBe("unassigned");
    expect(outcome.candidates).toEqual([]);
  });

  it("will not assign to an archived project", () => {
    const outcome = routeMessage(envelope({ subject: "P17231 question" }), {
      ...registers,
      projects: [panther, { ...maybourne, status: "archived" }],
    });
    expect(outcome.status).toBe("unassigned");
  });
});
