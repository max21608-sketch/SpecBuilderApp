// The chase email itself. Pure — no I/O, no database, no clock of its own.
// This is the "easy to change later" surface where the wording lives, and
// keeping it pure is what lets the whole format be unit-tested.
//
// ============================================================================
// TWO THINGS HERE ARE LOAD-BEARING
//
// 1. ONLY the intro and closing are author-written, and they arrive as PLAIN
//    TEXT which this module escapes. The question table is generated from the
//    coverage rows. That is what makes "the email says exactly what the
//    coverage table says" a structural property rather than a convention —
//    and it is what the send gate's staleness check depends on. Do not add a
//    path that accepts arbitrary HTML for the body.
//
// 2. EVERY STYLE IS INLINE, ON EVERY CELL. Outlook on Windows renders mail
//    with the Word engine: no <style> block, no classes, and no border
//    declared on <table> — a border has to be on each <td> or it does not
//    appear at all. Mail clients are not browsers and this file is not
//    Tailwind.
// ============================================================================
import { ANSWER_STATE_LABELS, type AnswerState } from "@/lib/spec-vocab";
import { TIER_EMAIL_HEADINGS, type QuestionTier } from "@/lib/tgq";

const FONT = "font-family:Arial,Helvetica,sans-serif";
const CELL = `style="border:1px solid #999999;padding:4px 8px;${FONT};font-size:13px;vertical-align:top"`;
const HEAD_CELL = `align="left" style="border:1px solid #999999;padding:4px 8px;background:#f2f2f2;${FONT};font-size:13px"`;
// A question the client already answered "TBC" is a different problem from one
// nobody has looked at, and it has to stay visually loud all the way into the
// message the reader opens — not just in the app.
const TBC_CELL = `style="border:1px solid #999999;padding:4px 8px;${FONT};font-size:13px;color:#b91c1c;font-weight:bold;vertical-align:top"`;
const MISSING_CELL = `style="border:1px solid #999999;padding:4px 8px;${FONT};font-size:13px;color:#6b7280;vertical-align:top"`;
const P = `<p style="margin:0 0 1em;${FONT};font-size:13px">`;
const H = `<p style="margin:1.5em 0 0.5em;${FONT};font-size:13px;font-weight:bold">`;

// The banner that separates what blocks a quote from what does not.
//
// A ONE-CELL TABLE, not a <p> with a border. Word's renderer drops borders and
// backgrounds declared on a paragraph and keeps them on a table cell, and this
// banner carries the whole point of the message — "we cannot price this until
// you answer these" — so it is the last thing that may render as plain text.
function banner(text: string, urgent: boolean): string {
  const cell = urgent
    ? `style="border:2px solid #b91c1c;background:#fef2f2;padding:6px 10px;${FONT};font-size:13px;font-weight:bold;color:#7f1d1d"`
    : `style="border:1px solid #999999;background:#f2f2f2;padding:6px 10px;${FONT};font-size:13px;font-weight:bold;color:#374151"`;
  return (
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:1.5em 0 0.5em;width:100%">\n` +
    `<tr><td ${cell}>${escapeHtml(text)}</td></tr>\n</table>`
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Author prose is plain text. Blank lines become paragraphs, single newlines
// become <br>, and everything is escaped first.
function paragraphs(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((block) => `${P}${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export type ChaseQuestion = {
  recordId: string;
  requirementId: string;
  /** `P17231-007` — the stable, human-quotable record label. */
  recordLabel: string;
  /** The client's own reference(s), e.g. `SX11A`. Empty when the record has none. */
  refs: string;
  itemDescription: string;
  area: string | null;
  categoryName: string | null;
  prompt: string;
  /** The BWS field this answer would land in, when there is one. */
  fieldLabel: string | null;
  state: AnswerState;
  /** What the record currently holds, if anything — usually null for a chase. */
  currentValue: string | null;
  /** Which half of the email this question belongs in. */
  tier: QuestionTier;
};

export type ChaseGroup = {
  recordId: string;
  recordLabel: string;
  refs: string;
  itemDescription: string;
  area: string | null;
  categoryName: string | null;
  /** Every question in a group shares one tier: the email prints by tier first. */
  tier: QuestionTier;
  questions: ChaseQuestion[];
};

export type BuildChaseEmailInput = {
  projectLabel: string;
  contactName: string;
  intro: string;
  closing: string;
  groups: ChaseGroup[];
  /** Passed in, never read from the clock here, so the output is testable. */
  now: Date;
  /** Non-production deployments mark the subject so a stray send is obvious. */
  environmentPrefix?: string;
};

/**
 * 1 — one table per record.
 * 2 — two sections, "needed to quote" first, each with its own banner (0020).
 */
export const TEMPLATE_VERSION = 2;

// Vercel runs UTC; the reader is in London. A "Good morning" that arrives at
// 23:00 reads as carelessness, so resolve the hour in the reader's zone.
export function londonGreeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function questionCount(groups: ChaseGroup[]): number {
  return groups.reduce((total, group) => total + group.questions.length, 0);
}

/** Questions and distinct records per tier — what the subject line reports. */
export function tierCounts(groups: ChaseGroup[]): {
  toQuote: number;
  later: number;
  records: number;
} {
  const byTier = (tier: QuestionTier) => questionCount(groups.filter((g) => g.tier === tier));
  return {
    toQuote: byTier("to_quote"),
    later: byTier("later"),
    // A record with questions in both halves is ONE item to the reader, even
    // though it is two groups here.
    records: new Set(groups.map((group) => group.recordId)).size,
  };
}

/**
 * The subject says what is blocking, because that is what decides whether the
 * message is opened today or on Friday.
 */
export function buildChaseSubject(input: {
  projectLabel: string;
  groups: ChaseGroup[];
  environmentPrefix?: string;
}): string {
  const { toQuote, later, records } = tierCounts(input.groups);
  const prefix = input.environmentPrefix ? `${input.environmentPrefix} ` : "";
  const items = `across ${records} item${records === 1 ? "" : "s"}`;
  const stem = `${prefix}${input.projectLabel} — outstanding specification information`;

  if (toQuote > 0 && later > 0) {
    return `${stem} (${toQuote} needed to quote, ${later} further question${later === 1 ? "" : "s"}, ${items})`;
  }
  if (toQuote > 0) {
    return `${stem} (${toQuote} needed to quote ${items})`;
  }
  return (
    `${stem} (${later} question${later === 1 ? "" : "s"} ${items} — none holding up the quote)`
  );
}

function currentValueCell(question: ChaseQuestion): string {
  if (question.state === "tbc") {
    return `<td ${TBC_CELL}>${escapeHtml(ANSWER_STATE_LABELS.tbc)}</td>`;
  }
  if (question.currentValue && question.currentValue.trim()) {
    return `<td ${CELL}>${escapeHtml(question.currentValue.trim())}</td>`;
  }
  // An empty cell reads as an oversight in the email rather than as the thing
  // being asked. Name it.
  return `<td ${MISSING_CELL}>${escapeHtml(ANSWER_STATE_LABELS.missing)}</td>`;
}

function groupHeading(group: ChaseGroup): string {
  const parts = [group.recordLabel];
  if (group.refs) parts.push(group.refs);
  parts.push(group.itemDescription);
  const suffix = [group.categoryName, group.area].filter(Boolean).join(" · ");
  const heading = escapeHtml(parts.join(" · "));
  return suffix ? `${heading} <span style="font-weight:normal">(${escapeHtml(suffix)})</span>` : heading;
}

function groupTable(group: ChaseGroup): string {
  const rows = group.questions
    .map(
      (question) =>
        `<tr>` +
        `<td ${CELL}>${escapeHtml(question.prompt)}</td>` +
        `<td ${CELL}>${question.fieldLabel ? escapeHtml(question.fieldLabel) : "—"}</td>` +
        currentValueCell(question) +
        `</tr>`,
    )
    .join("\n");

  return (
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 0.5em">\n` +
    `<tr>` +
    `<th ${HEAD_CELL}>Question</th>` +
    `<th ${HEAD_CELL}>BWS field</th>` +
    `<th ${HEAD_CELL}>Currently</th>` +
    `</tr>\n${rows}\n</table>`
  );
}

export function buildChaseEmail(input: BuildChaseEmailInput): { subject: string; body: string } {
  const subject = buildChaseSubject(input);

  // Tier first, then record. All the blocking questions together under one
  // heading is what makes "we cannot quote without these" legible at a glance;
  // interleaving them per record buries them among everything else.
  const section = (tier: QuestionTier) => {
    const groups = input.groups.filter((group) => group.tier === tier);
    if (groups.length === 0) return "";
    const count = questionCount(groups);
    const heading =
      tier === "to_quote"
        ? `${TIER_EMAIL_HEADINGS.to_quote} — ${count} question${count === 1 ? "" : "s"}`
        : `${TIER_EMAIL_HEADINGS.later} — ${count} question${count === 1 ? "" : "s"}`;
    const bodies = groups
      .map((group) => `${H}${groupHeading(group)}</p>\n${groupTable(group)}`)
      .join("\n");
    return `${banner(heading, tier === "to_quote")}\n${bodies}`;
  };

  const sections = [section("to_quote"), section("later")].filter(Boolean).join("\n");

  const body = [
    `${P}${escapeHtml(londonGreeting(input.now))} ${escapeHtml(input.contactName)},</p>`,
    paragraphs(input.intro),
    sections,
    paragraphs(input.closing),
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, body };
}

// Offered as the starting prose on a freshly generated draft. The author edits
// it; nothing here is enforced later.
export function defaultIntro(projectLabel: string, counts: { toQuote: number; later: number }): string {
  const opening = `I hope you are well.\n\nWe are working through the specification for ${projectLabel}. `;

  if (counts.toQuote > 0 && counts.later > 0) {
    return (
      opening +
      `The first section below lists the ${counts.toQuote} detail${counts.toQuote === 1 ? "" : "s"} we need ` +
      `before we can put a price on these items; the second lists ${counts.later} further ` +
      `point${counts.later === 1 ? "" : "s"} that are outstanding but not holding up the quote. ` +
      `Could you confirm the first section as a priority, and the rest when you are able?`
    );
  }
  if (counts.toQuote > 0) {
    return (
      opening +
      `We need the ${counts.toQuote} detail${counts.toQuote === 1 ? "" : "s"} below before we can put a price ` +
      `on these items. Could you confirm them so we can issue the quotation?`
    );
  }
  return (
    opening +
    `Nothing below is holding up the quote, but we need the following ` +
    `${counts.later} point${counts.later === 1 ? "" : "s"} to complete the specification and issue drawings ` +
    `for sign-off.`
  );
}

export function defaultClosing(): string {
  return `Many thanks,`;
}
