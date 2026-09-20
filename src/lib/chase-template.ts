// The chase email itself. Pure — no I/O, no database, no clock of its own.
// This is the "easy to change later" surface where the wording lives, and
// keeping it pure is what lets the whole format be unit-tested.
//
// ============================================================================
// THE UNIT OF THE BODY IS THE QUESTION, THEN THE AREA, THEN THE ITEMS
//
// This email used to print one table per RECORD, which is how the SCREEN is
// built and is right there — a person works item by item. A client does not.
// Matthew, for Jay, on 2026-09-18: "we end up repeating the question on ten
// lines", and what he wanted instead was "oh, for the dressing area, we don't
// have a metalwork finish". A designer answering "polished steel" once for six
// items was being asked six times.
//
// So the body regroups what it is given: each tier section holds one table per
// QUESTION, each table groups its items by AREA, and a question outstanding on
// a single item prints as one line with no area row at all.
//
// THE REGROUPING LIVES HERE AND NOWHERE ELSE. `buildChaseEmail` still takes
// `ChaseGroup[]` — one per tier × record — because those ARE the coverage rows
// (`email_draft_items`, one per record × question), and the send gate's whole
// guarantee is that the body and the coverage describe the same set. Moving
// the regrouping into `chase-drafts.ts` or into the coverage would break that
// equality, which is why a test extracts every (record, requirement) pair back
// out of the rendered HTML and compares it with the input.
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
import { NO_AREA_LABEL, foldArea } from "@/lib/area-filter";
import { TIER_EMAIL_HEADINGS, type QuestionTier } from "@/lib/tgq";

const FONT = "font-family:Arial,Helvetica,sans-serif";
const CELL = `style="border:1px solid #999999;padding:4px 8px;${FONT};font-size:13px;vertical-align:top"`;
const HEAD_CELL = `align="left" style="border:1px solid #999999;padding:4px 8px;background:#f2f2f2;${FONT};font-size:13px"`;
// A question the client already answered "TBC" is a different problem from one
// nobody has looked at, and it has to stay visually loud all the way into the
// message the reader opens — not just in the app.
const TBC_CELL = `style="border:1px solid #999999;padding:4px 8px;${FONT};font-size:13px;color:#b91c1c;font-weight:bold;vertical-align:top"`;
const MISSING_CELL = `style="border:1px solid #999999;padding:4px 8px;${FONT};font-size:13px;color:#6b7280;vertical-align:top"`;
// The area row inside a question's table. A spanning row rather than a fourth
// column, because an area repeated down a column is the repetition this
// rewrite removes — the reader answers "for the dressing area, …" once.
const GROUP_CELL = `align="left" style="border:1px solid #999999;padding:4px 8px;background:#f2f2f2;${FONT};font-size:13px;font-weight:bold"`;
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
 * 3 — one table per QUESTION, its items grouped by area (2026-09-20).
 */
export const TEMPLATE_VERSION = 3;

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

/**
 * What the record already holds, which is how "we think so-and-so said
 * polished steel" reaches the reader.
 *
 * TBC keeps its loud red: a client who said "not yet decided" is a different
 * problem from one nobody has asked, and flattening the two means the reader
 * cannot tell what they already told us. Where a TBC also carries words — the
 * drawings routinely say `TBC - Yarn Collective Tessarae` — they are printed
 * after it, because that IS the understanding being checked.
 */
function currentValueCell(question: ChaseQuestion): string {
  const value = (question.currentValue ?? "").trim();
  if (question.state === "tbc") {
    const tail = value ? ` — our understanding: ${value}` : "";
    return `<td ${TBC_CELL}>${escapeHtml(ANSWER_STATE_LABELS.tbc + tail)}</td>`;
  }
  if (value) {
    return `<td ${CELL}>${escapeHtml(`our understanding: ${value}`)}</td>`;
  }
  // An empty cell reads as an oversight in the email rather than as the thing
  // being asked. Name it.
  return `<td ${MISSING_CELL}>${escapeHtml(ANSWER_STATE_LABELS.missing)}</td>`;
}

/** `P17231-007 · SX11A · Armchair`. The quantity is deliberately absent: see below. */
function itemLabel(question: ChaseQuestion): string {
  const parts = [question.recordLabel];
  if (question.refs) parts.push(question.refs);
  if (question.itemDescription) parts.push(question.itemDescription);
  return parts.join(" · ");
}

/** A question, identified the way two coverage rows are the same question. */
function questionKey(question: ChaseQuestion): string {
  return `${question.prompt.trim()} ${(question.fieldLabel ?? "").trim()}`;
}

type AreaBlock = { label: string; noArea: boolean; questions: ChaseQuestion[] };
type QuestionBlock = { prompt: string; fieldLabel: string | null; areas: AreaBlock[]; count: number };

/**
 * The flat coverage rows of ONE tier, regrouped into question → area → items.
 *
 * Order is first appearance throughout, and that is not laziness: the caller
 * hands these over sorted by record number and then by the cheat sheet's own
 * question order (`groupsFromCovered`), so first appearance IS bill order. A
 * second sort here — alphabetical by prompt, say — would re-order the email
 * after every edit, which reads to the recipient as the message having been
 * rewritten. The one exception is the no-area block, which goes last: it is
 * not an area, and among them it would read as a room.
 *
 * Areas are folded by case and whitespace only (`foldArea`), and printed as
 * the document first spelled them. `Dressing area` and `DRESSING AREA` are one
 * heading; nothing cleverer, or two rooms a bill kept apart become one.
 */
export function groupByQuestionAndArea(questions: readonly ChaseQuestion[]): QuestionBlock[] {
  const blocks = new Map<string, QuestionBlock>();
  const areasByBlock = new Map<string, Map<string, AreaBlock>>();

  for (const question of questions) {
    const key = questionKey(question);
    let block = blocks.get(key);
    if (!block) {
      block = { prompt: question.prompt, fieldLabel: question.fieldLabel, areas: [], count: 0 };
      blocks.set(key, block);
      areasByBlock.set(key, new Map());
    }
    block.count += 1;

    const folded = foldArea(question.area);
    const areaKey = folded ?? " none";
    const areas = areasByBlock.get(key)!;
    let area = areas.get(areaKey);
    if (!area) {
      area = {
        label: folded === null ? NO_AREA_LABEL : (question.area ?? "").replace(/\s+/g, " ").trim(),
        noArea: folded === null,
        questions: [],
      };
      areas.set(areaKey, area);
    }
    area.questions.push(question);
  }

  for (const [key, areas] of areasByBlock) {
    const block = blocks.get(key)!;
    const listed = [...areas.values()];
    block.areas = [...listed.filter((area) => !area.noArea), ...listed.filter((area) => area.noArea)];
  }

  return [...blocks.values()];
}

/**
 * One table per question.
 *
 * `data-record` and `data-requirement` are on each item row so that a test can
 * extract the exact set of coverage rows back out of the rendered body and
 * compare it with what was passed in — the send gate rests on the body and the
 * coverage being the same set, and that is now a structural property somebody
 * can check rather than a claim. Word and Outlook ignore attributes they do
 * not know, so neither renders them.
 *
 * THE QUANTITY IS NOT HERE, although the item line is the obvious place for
 * it. A coverage row is a frozen `context_snapshot` and it has never carried
 * one; adding a field to that snapshot makes every unsent draft in the
 * database read as stale the moment it ships, for a reason unrelated to any
 * answer. The `chased_at` trap, in a new place.
 */
function questionTable(block: QuestionBlock): string {
  const single = block.count === 1;
  const rows: string[] = [];
  for (const area of block.areas) {
    // A QUESTION ABOUT ONE ITEM GETS NO AREA ROW. "Dressing area" above a
    // single line says nothing the line does not, and a heading per line is
    // the repetition this rewrite exists to remove.
    if (!single) {
      rows.push(
        `<tr><td colspan="2" ${GROUP_CELL}>${escapeHtml(area.label)}</td></tr>`,
      );
    }
    for (const question of area.questions) {
      rows.push(
        `<tr data-record="${escapeHtml(question.recordId)}" data-requirement="${escapeHtml(question.requirementId)}">` +
          `<td ${CELL}>${escapeHtml(itemLabel(question))}</td>` +
          currentValueCell(question) +
          `</tr>`,
      );
    }
  }

  return (
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 0.5em">\n` +
    `<tr>` +
    `<th ${HEAD_CELL}>Item</th>` +
    `<th ${HEAD_CELL}>Currently</th>` +
    `</tr>\n${rows.join("\n")}\n</table>`
  );
}

/** `Metalwork finish (BWS: Metal finish 1) — 6 items`. */
function questionHeading(block: QuestionBlock): string {
  const field = block.fieldLabel?.trim()
    ? ` <span style="font-weight:normal">(BWS: ${escapeHtml(block.fieldLabel.trim())})</span>`
    : "";
  const items = ` <span style="font-weight:normal">— ${block.count} item${block.count === 1 ? "" : "s"}</span>`;
  return `${escapeHtml(block.prompt)}${field}${items}`;
}

export function buildChaseEmail(input: BuildChaseEmailInput): { subject: string; body: string } {
  const subject = buildChaseSubject(input);

  // TIER FIRST, then question, then area. All the blocking questions together
  // under one heading is what makes "we cannot quote without these" legible at
  // a glance; interleaving them per record buries them among everything else.
  //
  // The banner still counts COVERAGE ROWS, not question tables: "6 questions"
  // where one question is outstanding on six items would tell the reader they
  // have six things to answer when they have one, but it is also the number
  // the subject line and the screen report, and three counts of one thing is
  // worse than one that is conservative. It is the count of what is
  // outstanding, which is what it has always been.
  const section = (tier: QuestionTier) => {
    const groups = input.groups.filter((group) => group.tier === tier);
    if (groups.length === 0) return "";
    const count = questionCount(groups);
    const heading =
      tier === "to_quote"
        ? `${TIER_EMAIL_HEADINGS.to_quote} — ${count} question${count === 1 ? "" : "s"}`
        : `${TIER_EMAIL_HEADINGS.later} — ${count} question${count === 1 ? "" : "s"}`;
    const bodies = groupByQuestionAndArea(groups.flatMap((group) => group.questions))
      .map((block) => `${H}${questionHeading(block)}</p>\n${questionTable(block)}`)
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

/**
 * Offered as the starting prose on a freshly generated draft. The author edits
 * it; nothing here is enforced later.
 *
 * `internal` is what a colleague gets. Matthew, 2026-09-18: "You can send it
 * to the CAM or to the sales system or to production… It doesn't have to be an
 * external e-mail" — and a message to the CAM asking them to confirm details
 * "from you" reads as though the app thinks a colleague is the client. It
 * comes from the LIVE contact row's role in the generate route, never from the
 * client: the `questionTier` rule, because the wording is a claim about who is
 * being asked.
 */
export function defaultIntro(
  projectLabel: string,
  counts: { toQuote: number; later: number },
  options: { internal?: boolean } = {},
): string {
  const internal = options.internal === true;
  const opening = internal
    ? `We are working through the specification for ${projectLabel}. `
    : `I hope you are well.\n\nWe are working through the specification for ${projectLabel}. `;
  // "we need from you" is right for a designer and wrong for a colleague, who
  // is helping us answer rather than being asked to supply.
  const need = internal ? "we still need" : "we need from you";
  const ask = internal
    ? "Could you fill in anything already settled, or say who to ask?"
    : "Could you confirm them so we can issue the quotation?";

  if (counts.toQuote > 0 && counts.later > 0) {
    return (
      opening +
      `The first section below lists the ${counts.toQuote} detail${counts.toQuote === 1 ? "" : "s"} ${need} ` +
      `before we can put a price on these items; the second lists ${counts.later} further ` +
      `point${counts.later === 1 ? " that is" : "s that are"} outstanding but not holding up the quote. ` +
      (internal
        ? `Could you confirm the first section as a priority, and the rest when you can?`
        : `Could you confirm the first section as a priority, and the rest when you are able?`)
    );
  }
  if (counts.toQuote > 0) {
    return (
      opening +
      `${need === "we still need" ? "We still need" : "We need from you"} the ${counts.toQuote} ` +
      `detail${counts.toQuote === 1 ? "" : "s"} below before we can put a price ` +
      `on these items. ${ask}`
    );
  }
  return (
    opening +
    `Nothing below is holding up the quote, but ${need} the following ` +
    `${counts.later} point${counts.later === 1 ? "" : "s"} to complete the specification and issue drawings ` +
    `for sign-off.`
  );
}

export function defaultClosing(): string {
  return `Many thanks,`;
}
