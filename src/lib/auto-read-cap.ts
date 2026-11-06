// How many charged reads a project may start in a day with NOBODY pressing
// anything (audit A5, 2026-11-06).
//
// ============================================================================
// THE ONLY CAP USED TO BE A SPEED LIMIT, NOT A SPEND LIMIT.
//
// `extraction-slots.ts` holds three reads in flight per pack, and the
// project's batch-less reads (an email's) to three more. That bounds how many
// run AT ONCE and says nothing about how many run: every read that settles
// hands its slot to the next, so a mailbox receiving two hundred messages
// addressed to a project inbox reads all two hundred, at the extraction
// model's price, before anybody opens the inbox. CLAUDE.md said every
// automatic read "counts against the per-project cap", and there was no such
// count.
//
// So this is a COUNT, per project and per UTC day, of the reads the app
// started by itself, and over it an automatic read is HELD for a person
// rather than started. Never refused, never dropped: the message is recorded,
// stays on the inbox's held list with this file's sentence and the project it
// would have gone to, and one click on that row is a person's assignment,
// which is never capped. A cap that dropped mail would turn a spending limit
// into lost correspondence.
//
// ---- WHAT COUNTS AS AUTOMATIC ----------------------------------------------
//
// A run CREATED by a system actor (`system:...`): today exactly the router's
// assignments (`system:router`, `ROUTER_ACTOR`). The actor is already on the
// row, so the count is one indexed query and no column; `created_by` is
// written once, at insert, and nothing rewrites it. A run counts from the day
// it was made, whether its read started at once, waited for a slot, or
// failed: the cap bounds what the app PROMISED to read by itself.
//
// A person's upload is NOT automatic, although registration dispatches its
// read without a second press: the upload screen states the count and the
// charge before anything uploads, and that statement is the person's decision
// (CLAUDE.md, "Registering a specification document SPENDS MONEY"). Capping
// it would stop a thirty-document pack two thirds of the way through for a
// spend somebody agreed to. The day something registers documents with
// nobody watching (a watched SharePoint folder, P5), its actor is a system
// actor, and it calls `takeAutomaticRead` like the router does.
//
// The UTC day is deliberate and is not the inbox's London day: this is a
// budget, and a budget whose boundary moves with the clocks would allow two
// days' reads in one wall-clock day twice a year. Nobody reads the boundary
// off a screen; the sentence says "a day".
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";

/** Max's number, 2026-11-06 ("go with the proposed"). Overridable per deployment. */
export const AUTO_READ_DAILY_CAP_DEFAULT = 20;

/** Every actor that is the app acting by itself starts with this. */
export const AUTOMATIC_ACTOR_PREFIX = "system:";

export function isAutomaticActor(actor: string): boolean {
  return actor.startsWith(AUTOMATIC_ACTOR_PREFIX);
}

/**
 * The cap in force. `AUTO_READ_DAILY_CAP` overrides the default when it is a
 * whole number of at least zero; anything else is ignored rather than read as
 * zero, because a typo in an environment variable must not quietly stop every
 * automatic read, nor (read as infinity) remove the limit.
 */
export function autoReadDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AUTO_READ_DAILY_CAP?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return AUTO_READ_DAILY_CAP_DEFAULT;
}

/** What a held message says, on its row and in the inbox. */
export function autoReadCapSentence(cap: number): string {
  return `The automatic-read cap for this project (${cap} a day) is reached; a person starts this read.`;
}

/**
 * Automatic reads this project has been given since midnight UTC. Inside the
 * caller's transaction, after `takeAutomaticRead`'s lock.
 */
export async function automaticReadsToday(txn: TxnSql, projectId: string): Promise<number> {
  const rows = await txn`
    select count(*)::int as n
    from intake_runs
    where project_id = ${projectId}
      and source_kind = 'spec_document'
      and created_by like ${`${AUTOMATIC_ACTOR_PREFIX}%`}
      and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * May the app start one more read on this project by itself today? Call it
 * inside the transaction that would insert the run, BEFORE inserting it.
 *
 * Serialised per project by an advisory lock, so two messages arriving at the
 * same moment cannot both read 19 and both become the twentieth. Taken before
 * `takeReadSlot`'s lock and never after it, which is the only order either
 * file takes them in.
 */
export async function takeAutomaticRead(
  txn: TxnSql,
  projectId: string,
  cap: number = autoReadDailyCap(),
): Promise<boolean> {
  await txn`select pg_advisory_xact_lock(hashtext(${`auto-read:project:${projectId}`}))`;
  return (await automaticReadsToday(txn, projectId)) < cap;
}
