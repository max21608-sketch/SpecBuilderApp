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
};

export type ChaseGroup = {
  recordId: string;
  recordLabel: string;
  refs: string;
  itemDescription: string;
  area: string | null;
  categoryName: string | null;
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

export const TEMPLATE_VERSION = 1;

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

export function buildChaseSubject(input: {
  projectLabel: string;
  groups: ChaseGroup[];
  environmentPrefix?: string;
}): string {
  const questions = questionCount(input.groups);
  const records = input.groups.length;
  const prefix = input.environmentPrefix ? `${input.environmentPrefix} ` : "";
  return (
    `${prefix}${input.projectLabel} — outstanding specification information ` +
    `(${questions} question${questions === 1 ? "" : "s"} across ` +
    `${records} item${records === 1 ? "" : "s"})`
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

  const sections = input.groups
    .map((group) => `${H}${groupHeading(group)}</p>\n${groupTable(group)}`)
    .join("\n");

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
export function defaultIntro(projectLabel: string, questions: number): string {
  return (
    `I hope you are well.\n\n` +
    `We are working through the specification for ${projectLabel} and have ` +
    `${questions} outstanding question${questions === 1 ? "" : "s"} listed below. ` +
    `Could you confirm the following so we can complete the specification and ` +
    `issue drawings for sign-off?`
  );
}

export function defaultClosing(): string {
  return `Many thanks,`;
}
