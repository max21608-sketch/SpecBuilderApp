// Which project an email is about.
//
// ============================================================================
// AMBIGUOUS IS A THIRD OUTCOME, AND IT IS THE POINT
//
// house/data-safety.md: "a fuzzy match has three outcomes, not two: confident,
// AMBIGUOUS, none." An email assigned to the wrong project writes client A's
// fabric onto client B's sofa, and the review screen that would have caught it
// is the review screen for the wrong project. So two candidates is HELD for a
// person, never the first of the two, and a held message is listed rather than
// dropped.
//
// ---- THE SIGNALS, AND WHY THEY ARE ORDERED --------------------------------
//
// The project inbox forwarding to the app mailbox is the design, so its
// evidence is strongest, and Exchange presents it in two shapes:
//
//   REDIRECT ("redirect to") keeps the original From and To, adds the project
//   mailbox to the recipients, and stamps X-MS-Exchange-Inbox-Rules-Loop and
//   Resent-From. The original sender survives, which is what makes the
//   chase-reply hint and contact matching work. PREFER THIS when setting the
//   rule up.
//
//   FORWARD ("forward to") replaces From with the project mailbox and prefixes
//   the subject. The original sender is then only in the body.
//
// Both are covered, because which one is configured is not this app's choice.
//
// The FIRST signal that names any project decides. Later signals are collected
// as candidates for the held view but never break a tie: a subject token is
// weaker evidence than a mailbox, and letting the weak signal arbitrate between
// two strong ones is how a confident wrong answer happens.
// ============================================================================
import type { EmailEnvelope } from "@/lib/email-envelope";

export type RoutingProject = {
  id: string;
  bwsProjectNumber: string;
  name: string;
  sharedInbox: string | null;
  status: string;
};

export type RoutingContact = { projectId: string; email: string };

export type RoutingRegisters = { projects: RoutingProject[]; contacts: RoutingContact[] };

export type RoutingSignal =
  | "forwarded_from_inbox"
  | "recipient_is_inbox"
  | "subject_project_number"
  | "subject_project_code"
  | "sender_is_contact";

export const ROUTING_SIGNAL_LABELS: Record<RoutingSignal, string> = {
  forwarded_from_inbox: "forwarded from the project inbox",
  recipient_is_inbox: "addressed to the project inbox",
  subject_project_number: "the subject names the BWS project number",
  subject_project_code: "the subject names the project code",
  sender_is_contact: "the sender is a contact on one project",
};

export type RoutingCandidate = { projectId: string; signal: RoutingSignal; evidence: string };

export type RoutingOutcome =
  | { status: "assigned"; projectId: string; signal: RoutingSignal; evidence: string; candidates: RoutingCandidate[] }
  | { status: "ambiguous"; candidates: RoutingCandidate[] }
  | { status: "unassigned"; candidates: RoutingCandidate[] };

const fold = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/** Headers that name a mailbox the message was routed THROUGH rather than to. */
const FORWARD_HEADERS = [
  "x-ms-exchange-inbox-rules-loop",
  "resent-from",
  "resent-to",
  "x-original-to",
  "delivered-to",
  "x-forwarded-to",
];

function headerValues(envelope: EmailEnvelope, name: string): string[] {
  return envelope.headers.filter((header) => fold(header.name) === name).map((header) => header.value);
}

function autoForwarded(envelope: EmailEnvelope): boolean {
  return headerValues(envelope, "x-ms-exchange-organization-autoforwarded").some(
    (value) => fold(value) === "true",
  );
}

/** Every address that appears anywhere in a value, lowercased. */
function addressesIn(value: string): string[] {
  return (value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []).map((a) => a.toLowerCase().replace(/[.,;]+$/, ""));
}

export function routeMessage(envelope: EmailEnvelope, registers: RoutingRegisters): RoutingOutcome {
  // Archived projects still MATCH — they are just not assignable. Saying "this
  // looks like P17231, which is archived" is a better answer than silence.
  const live = registers.projects.filter((project) => project.status !== "archived");
  const byInbox = new Map<string, RoutingProject>();
  for (const project of live) {
    const inbox = fold(project.sharedInbox);
    if (inbox) byInbox.set(inbox, project);
  }

  const candidates: RoutingCandidate[] = [];
  const push = (projectId: string, signal: RoutingSignal, evidence: string) => {
    if (candidates.some((c) => c.projectId === projectId && c.signal === signal)) return;
    candidates.push({ projectId, signal, evidence });
  };

  // ---- 1. forwarded from a project inbox ----------------------------------
  const forwardMatches: RoutingCandidate[] = [];
  for (const name of FORWARD_HEADERS) {
    for (const value of headerValues(envelope, name)) {
      for (const address of addressesIn(value)) {
        const project = byInbox.get(address);
        if (project) forwardMatches.push({ projectId: project.id, signal: "forwarded_from_inbox", evidence: `${name}: ${address}` });
      }
    }
  }
  // A rule-forward REPLACES the sender with the project mailbox. Only trusted
  // where Exchange also says the message was auto-forwarded, so a person
  // emailing from the project mailbox by hand is not read as a rule.
  if (envelope.from && autoForwarded(envelope)) {
    const project = byInbox.get(envelope.from.address);
    if (project) {
      forwardMatches.push({
        projectId: project.id,
        signal: "forwarded_from_inbox",
        evidence: `auto-forwarded from ${envelope.from.address}`,
      });
    }
  }

  // ---- 2. addressed to a project inbox ------------------------------------
  const recipientMatches: RoutingCandidate[] = [];
  for (const person of [...envelope.to, ...envelope.cc]) {
    const project = byInbox.get(person.address);
    if (project) {
      recipientMatches.push({
        projectId: project.id,
        signal: "recipient_is_inbox",
        evidence: `addressed to ${person.address}`,
      });
    }
  }

  // ---- 3 and 4. the subject -----------------------------------------------
  const subject = envelope.subject ?? "";
  const numberMatches: RoutingCandidate[] = [];
  for (const token of subject.match(/\bP\d{4,6}\b/gi) ?? []) {
    for (const project of live) {
      if (fold(project.bwsProjectNumber) !== fold(token)) continue;
      numberMatches.push({
        projectId: project.id,
        signal: "subject_project_number",
        evidence: `subject names ${project.bwsProjectNumber}`,
      });
    }
  }

  // A client's own project code (AP364) lives in the project NAME — there is no
  // column for it. Matched as a whole word, so "AP36" does not hit "AP364".
  const codeMatches: RoutingCandidate[] = [];
  for (const token of subject.match(/\b[A-Z]{2,4}[-\s]?\d{2,5}\b/g) ?? []) {
    const folded = fold(token).replace(/[-\s]/g, "");
    for (const project of live) {
      const words = fold(project.name).match(/\b[a-z]{2,4}[-\s]?\d{2,5}\b/g) ?? [];
      if (!words.some((word) => word.replace(/[-\s]/g, "") === folded)) continue;
      codeMatches.push({
        projectId: project.id,
        signal: "subject_project_code",
        evidence: `subject names ${token.trim()}`,
      });
    }
  }

  // ---- 5. the sender is a contact on exactly one project -------------------
  const senderAddresses = new Set(
    [envelope.from, ...envelope.replyTo].filter(Boolean).map((person) => person!.address),
  );
  const contactMatches: RoutingCandidate[] = [];
  for (const contact of registers.contacts) {
    if (!senderAddresses.has(fold(contact.email))) continue;
    if (!live.some((project) => project.id === contact.projectId)) continue;
    contactMatches.push({
      projectId: contact.projectId,
      signal: "sender_is_contact",
      evidence: `${contact.email} is a contact on this project`,
    });
  }

  const tiers = [forwardMatches, recipientMatches, numberMatches, codeMatches, contactMatches];
  for (const tier of tiers) {
    for (const candidate of tier) push(candidate.projectId, candidate.signal, candidate.evidence);
  }

  for (const tier of tiers) {
    if (tier.length === 0) continue;
    const projectIds = [...new Set(tier.map((c) => c.projectId))];
    if (projectIds.length === 1) {
      const chosen = tier[0]!;
      return { status: "assigned", projectId: chosen.projectId, signal: chosen.signal, evidence: chosen.evidence, candidates };
    }
    // Two projects at the same strength. A weaker signal must not arbitrate:
    // the reviewer sees both and picks.
    return { status: "ambiguous", candidates };
  }

  return { status: "unassigned", candidates };
}

/** One line for the screen and the stored `routing_reason`. */
export function describeRouting(outcome: RoutingOutcome): string {
  if (outcome.status === "assigned") {
    return `${ROUTING_SIGNAL_LABELS[outcome.signal]} — ${outcome.evidence}`;
  }
  if (outcome.status === "ambiguous") {
    return `Two or more projects match equally well (${outcome.candidates
      .map((c) => c.evidence)
      .slice(0, 4)
      .join("; ")}). Choose one.`;
  }
  return "Nothing in this message names a project: no project inbox in its headers, no project number or code in the subject, and the sender is not a contact on exactly one project.";
}
