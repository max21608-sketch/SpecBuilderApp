// Which project an email belongs to. Pure, and the most consequential guess in
// the feature: a wrong project writes one client's fabric onto another's sofa.
import { describe, expect, it } from "vitest";
import {
  AUTO_ASSIGN_SIGNALS,
  autoAssignDecision,
  describeAutoAssignment,
  routeMessage,
  type RoutingOutcome,
  type RoutingRegisters,
  type RoutingSignal,
} from "@/lib/email-routing";
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

// ============================================================================
// WHICH OUTCOMES MAY SPEND MONEY WITH NOBODY WATCHING (2.11)
//
// `autoAssignDecision` is a second reading of the outcome above, and the whole
// of it is which signals are trusted to start a charged read by themselves.
// All five signals and all three statuses are asserted here rather than the
// two that pass, because the failure this guards is a signal quietly joining
// the trusted list: a widened `AUTO_ASSIGN_SIGNALS` would otherwise show up as
// a bill and a staged run on the wrong client's project.
// ============================================================================
describe("autoAssignDecision", () => {
  const assigned = (signal: RoutingSignal): RoutingOutcome => ({
    status: "assigned",
    projectId: panther.id,
    signal,
    evidence: "__qa evidence",
    candidates: [],
  });

  it("assigns a message addressed to a project inbox", () => {
    const decision = autoAssignDecision(assigned("recipient_is_inbox"));
    expect(decision).toEqual({ assign: true, projectId: panther.id, signal: "recipient_is_inbox" });
  });

  it("assigns a message forwarded from a project inbox", () => {
    const decision = autoAssignDecision(assigned("forwarded_from_inbox"));
    expect(decision).toEqual({ assign: true, projectId: panther.id, signal: "forwarded_from_inbox" });
  });

  // The trap, named three times because it is the whole point of the function.
  // A contact who works on two projects writes about both, and a subject
  // carries a project number long after the conversation has moved on.
  it("holds a message placed by the subject alone", () => {
    expect(autoAssignDecision(assigned("subject_project_number"))).toEqual({
      assign: false,
      reason: "signal_too_weak",
    });
    expect(autoAssignDecision(assigned("subject_project_code"))).toEqual({
      assign: false,
      reason: "signal_too_weak",
    });
  });

  it("holds a message placed by a known sender alone", () => {
    expect(autoAssignDecision(assigned("sender_is_contact"))).toEqual({
      assign: false,
      reason: "signal_too_weak",
    });
  });

  it("never assigns an ambiguous outcome", () => {
    expect(
      autoAssignDecision({
        status: "ambiguous",
        candidates: [
          { projectId: panther.id, signal: "recipient_is_inbox", evidence: "one" },
          { projectId: maybourne.id, signal: "recipient_is_inbox", evidence: "two" },
        ],
      }),
    ).toEqual({ assign: false, reason: "ambiguous" });
  });

  it("never assigns an outcome that named no project", () => {
    expect(autoAssignDecision({ status: "unassigned", candidates: [] })).toEqual({
      assign: false,
      reason: "nothing_named_a_project",
    });
  });

  // The two trusted signals are exactly the two, and the list is the rule.
  it("trusts two signals and no others", () => {
    expect([...AUTO_ASSIGN_SIGNALS]).toEqual(["forwarded_from_inbox", "recipient_is_inbox"]);
  });

  it("says in words what placed it, for the row that accounts for the charge", () => {
    expect(describeAutoAssignment("recipient_is_inbox")).toBe(
      "assigned automatically — addressed to the project inbox",
    );
  });
});

// A whole-path assertion rather than a unit one: these two are what the
// ingestion path actually composes, so the pair is worth one test each way.
describe("routeMessage into autoAssignDecision", () => {
  it("reads a message to the project inbox as one to assign", () => {
    const outcome = routeMessage(
      envelope({ to: [{ name: null, address: "p17726@benwhistler.test" }] }),
      registers,
    );
    expect(autoAssignDecision(outcome)).toEqual({
      assign: true,
      projectId: panther.id,
      signal: "recipient_is_inbox",
    });
  });

  it("reads a message from a known contact as one to hold", () => {
    const outcome = routeMessage(
      envelope({ from: { name: "Jane", address: "jane@designers.test" } }),
      registers,
    );
    expect(outcome.status).toBe("assigned");
    expect(autoAssignDecision(outcome)).toEqual({ assign: false, reason: "signal_too_weak" });
  });
});
