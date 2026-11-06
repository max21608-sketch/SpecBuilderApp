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

export type RoutingCandidate = {
  projectId: string;
  signal: RoutingSignal;
  evidence: string;
  /**
   * True when the evidence is something the sender could not have written:
   * a header Exchange stamps inside the organisation, or a recipient Graph
   * reported. Only the two strong signals ever carry it. See "WHICH EVIDENCE
   * MAY SPEND MONEY" below.
   */
  stamped?: boolean;
};

export type RoutingOutcome =
  | {
      status: "assigned";
      projectId: string;
      signal: RoutingSignal;
      evidence: string;
      candidates: RoutingCandidate[];
      /** Some stamped evidence names this project. What an automatic read requires. */
      stamped: boolean;
    }
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

/**
 * Exchange says this mailbox received the message as a BLIND copy, so the To
 * and Cc lines are the sender's words about somebody else and say nothing
 * about how it reached us. An `X-MS-Exchange-Organization-*` header, so the
 * sender cannot write it and cannot remove it.
 */
function deliveredAsBcc(envelope: EmailEnvelope): boolean {
  return headerValues(envelope, "x-ms-exchange-organization-recipient-p2-type").some(
    (value) => fold(value) === "bcc",
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
  const push = (candidate: RoutingCandidate) => {
    const same = candidates.find((c) => c.projectId === candidate.projectId && c.signal === candidate.signal);
    if (same) {
      // One stamped piece of evidence is enough; a second, unstamped header
      // naming the same inbox must not take that back.
      if (candidate.stamped) same.stamped = true;
      return;
    }
    candidates.push({ ...candidate });
  };

  // ---- 1. forwarded from a project inbox ----------------------------------
  // Every forwarding header still NAMES the project, so a held row can say
  // which one it pointed at. Only Exchange's own stamp VOUCHES for any of
  // them (audit A8): without it the header is a line the sender typed.
  const stampedForward = autoForwarded(envelope);
  const forwardMatches: RoutingCandidate[] = [];
  for (const name of FORWARD_HEADERS) {
    for (const value of headerValues(envelope, name)) {
      for (const address of addressesIn(value)) {
        const project = byInbox.get(address);
        if (project) {
          forwardMatches.push({
            projectId: project.id,
            signal: "forwarded_from_inbox",
            evidence: `${name}: ${address}`,
            stamped: stampedForward,
          });
        }
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
        stamped: true,
      });
    }
  }

  // ---- 2. addressed to a project inbox ------------------------------------
  // Vouched for only where Graph REPORTED the recipient and Exchange did not
  // stamp this delivery as a blind copy (audit A8).
  const reported = new Set((envelope.reportedRecipients ?? []).map(fold));
  const blind = deliveredAsBcc(envelope);
  const recipientMatches: RoutingCandidate[] = [];
  for (const person of [...envelope.to, ...envelope.cc]) {
    const project = byInbox.get(person.address);
    if (project) {
      recipientMatches.push({
        projectId: project.id,
        signal: "recipient_is_inbox",
        evidence: `addressed to ${person.address}`,
        stamped: !blind && reported.has(fold(person.address)),
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
    for (const candidate of tier) push(candidate);
  }

  for (const tier of tiers) {
    if (tier.length === 0) continue;
    const projectIds = [...new Set(tier.map((c) => c.projectId))];
    if (projectIds.length === 1) {
      // The deciding tier names the project. The evidence REPORTED is the
      // most trustworthy that names it, from this tier or the other strong
      // one, so a row placed on a Graph-reported recipient never says it was
      // placed on a forwarding header anybody could have typed.
      const projectId = projectIds[0]!;
      const vouched =
        tier.find((c) => c.stamped) ?? candidates.find((c) => c.projectId === projectId && c.stamped) ?? tier[0]!;
      return {
        status: "assigned",
        projectId,
        signal: vouched.signal,
        evidence: vouched.evidence,
        candidates,
        stamped: vouched.stamped === true,
      };
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

// ============================================================================
// WHICH OUTCOMES MAY SPEND MONEY WITH NOBODY WATCHING
//
// Assignment is the spend point: it opens the charged read, copies the message
// under the project and stages a run there. Until 2026-09-21 every assignment
// was a person's click, and Max asked for the one case that is pure ceremony
// to stop asking — mail that arrived at a project's own inbox, which is the
// design of the feature, has already named its project as plainly as anything
// can.
//
// THE SIMPLEST VERSION IS TO ACT ON EVERY `assigned` OUTCOME, AND IT IS WRONG.
// `sender_is_contact` is the weakest signal in the list above: a designer who
// works on two of our projects writes about both, and routing can only see
// that they are a contact on one of them. A wrong auto-assignment costs a
// charged read AND leaves a staged run of one client's specification on
// another client's project — where the review screen that would have caught it
// is the review screen nobody is looking at. A subject reference is the same
// shape one step up: a reply chain carries a project number in its subject
// long after the conversation has moved on.
//
// So only the two strongest signals assign themselves. The other three keep
// exactly the behaviour they have today — HELD, with routing's own sentence and
// the offer to place it — which costs a click and never costs the wrong
// project.
//
// ---- WHICH EVIDENCE MAY SPEND MONEY (audit A8, 2026-11-06) ----------------
//
// The two strongest SIGNALS were read off ordinary headers, and any sender can
// write an ordinary header. `Resent-To`, `X-Original-To`, `Delivered-To`,
// `X-Forwarded-To` and `X-MS-Exchange-Inbox-Rules-Loop` are lines in the
// message: Exchange's header firewall strips only the
// `X-MS-Exchange-Organization-*` family from mail entering the organisation.
// And a blind copy to the app mailbox carries whatever To and Cc the sender
// chose to write. Either way, one outside sender who knew a project inbox's
// address could start a charged read on that project with nobody watching.
//
// So a strong signal assigns only on evidence the sender cannot have written:
//
//   forwarded   the message carries `X-MS-Exchange-Organization-AutoForwarded:
//               true`. The rule-forward shape has always been trusted only
//               alongside it; it is now the rule for EVERY forwarding header.
//   addressed   the inbox is among the recipients GRAPH reported for the
//               delivered item, and Exchange did not stamp the delivery
//               `X-MS-Exchange-Organization-Recipient-P2-Type: Bcc`. An
//               uploaded `.eml` has no reported recipients, which is right:
//               an upload is a person's assignment anyway.
//
// Everything else that names a project inbox still NAMES it (the held row
// says which project, like a subject reference) and is held for a person.
// WHAT THIS DOES NOT PROVE, and the activation checklist in
// `docs/integration.md` measures on the first real messages: that Exchange
// stamps those two headers on the shapes this organisation's rules produce.
// If it does not, the failure is in the safe direction (the mail is held and
// costs a click), and the per-project daily cap on automatic reads
// (`auto-read-cap.ts`) bounds the other direction.
// ============================================================================

/** The signals strong enough to start a charged read with nobody watching. */
export const AUTO_ASSIGN_SIGNALS: readonly RoutingSignal[] = ["forwarded_from_inbox", "recipient_is_inbox"];

export type AutoAssignDecision =
  | { assign: true; projectId: string; signal: RoutingSignal }
  /** Held, and which of the four reasons: a screen says a different sentence for each. */
  | { assign: false; reason: "signal_too_weak" | "unstamped_evidence" | "ambiguous" | "nothing_named_a_project" };

/** The actor an automatic assignment is recorded under, in the trail and on the row. */
export const ROUTER_ACTOR = "system:router";

/**
 * May this routing outcome place the message on a project by itself?
 *
 * Pure, and separate from `routeMessage` on purpose: routing answers "which
 * project", and this answers "is that answer strong enough to spend money on".
 * Folding the second into the first would mean the held view could no longer
 * say which project a weak signal pointed at — which is the whole of what a
 * person is being asked to confirm.
 */
export function autoAssignDecision(outcome: RoutingOutcome): AutoAssignDecision {
  if (outcome.status === "ambiguous") return { assign: false, reason: "ambiguous" };
  if (outcome.status === "unassigned") return { assign: false, reason: "nothing_named_a_project" };
  if (!AUTO_ASSIGN_SIGNALS.includes(outcome.signal)) return { assign: false, reason: "signal_too_weak" };
  if (!outcome.stamped) return { assign: false, reason: "unstamped_evidence" };
  return { assign: true, projectId: outcome.projectId, signal: outcome.signal };
}

/**
 * The sentence a held row adds to routing's own, for the two reasons routing's
 * sentence does not already explain. Null where it does.
 */
export function describeHeld(decision: AutoAssignDecision): string | null {
  if (decision.assign) return null;
  if (decision.reason === "unstamped_evidence") {
    return "Held: what names the project inbox here is a line any sender can write, and nothing Exchange or Graph stamped confirms it.";
  }
  if (decision.reason === "signal_too_weak") {
    return "Held: that signal is not strong enough to spend a charged read on its own.";
  }
  return null;
}

/** One line for a row the app placed on its own. */
export function describeAutoAssignment(signal: RoutingSignal): string {
  return `assigned automatically — ${ROUTING_SIGNAL_LABELS[signal]}`;
}
