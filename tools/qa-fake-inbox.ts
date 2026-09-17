#!/usr/bin/env tsx
// Fake correspondence, so the inbox screen can be looked at before a mailbox
// is connected.
//
//   npm run qa:fake-inbox                        dry run — says what it would record
//   npm run qa:fake-inbox -- --apply             records them
//   npm run qa:fake-inbox -- --clear --apply     removes the ones it recorded
//
// Like every db/ script it loads `.env.local` when present, prints the
// resolved host before acting, and refuses production outright — this writes
// invented correspondence, which has no business existing in a real database
// under any flag.
//
// ============================================================================
// WHY THIS GOES THROUGH `recordMessage` AND NOT THROUGH INSERTS
//
// The point of the exercise is to see what the screen looks like when real
// mail arrives, and what arrives is decided by `parseEnvelope` and
// `routeMessage`: which signal fired, what the held reason reads like, which
// candidates are listed underneath. A script that inserted its own
// `email_messages` rows would be a second implementation of the one thing
// being demonstrated, and it would agree with the app right up until the
// routing rules changed.
//
// So each message below is a real RFC 5322 `.eml`, stored in the blob store at
// the same `mailbox/<slug>/<yyyy>/<mm>/<id>.eml` path Graph ingestion uses, and
// handed to the app's own ingestion function. The routing outcomes at the
// bottom of this file are therefore PREDICTIONS, not settings: the script
// prints what actually happened and they can differ.
//
// ---- NOTHING IS ASSIGNED, AND THAT IS THE DESIGN -------------------------
//
// `recordMessage` records every message HELD. Assignment is the spend point —
// it opens a charged model read — and it stays a person's click, exactly as it
// would for a real message. So this script cannot cost anything, and the "On a
// project" half of the screen fills only when somebody assigns one.
//
// ---- HOW IT LEAVES NO TRACE ----------------------------------------------
//
// house/conventions.md §12 asks for a `__QA ` prefix so cleanup is one `like`
// sweep. Prefixing the SUBJECTS would defeat the whole purpose — the screen is
// being judged on how it reads — so the marker sits on the two fields nothing
// renders: the mailbox (`__qa_inbox`) and the Graph message id. The sweep is
// still one `like`, and `--clear` is that sweep plus the stored files.
//
// A message somebody has since ASSIGNED is not swept: it owns an intake run,
// possibly a paid read and possibly applied proposals. Those are named and
// left alone.
// ============================================================================
import pg from "pg";
import { del, put } from "@vercel/blob";
import { recordMessage } from "@/lib/email-ingest";

// The two fields nothing renders, carrying the cleanup marker.
const QA_MAILBOX = "__qa_inbox";
const QA_ID_PREFIX = "__qa_";

const apply = process.argv.includes("--apply");
const clear = process.argv.includes("--clear");

// ---- the guards, before anything is touched --------------------------------
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Run with:");
  console.error("  npm run qa:fake-inbox            (reads .env.local)");
  process.exit(1);
}
const environment = process.env.DATABASE_ENVIRONMENT ?? "";
if (environment !== "sandbox") {
  // No --yes-production escape hatch on purpose. A backfill has a reason to
  // run against production; inventing correspondence does not.
  console.error(`DATABASE_ENVIRONMENT is "${environment}". This script only ever runs against sandbox.`);
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. The .eml has to be stored, or 'Open in Outlook' has nothing to open.");
  process.exit(1);
}
console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${new URL(databaseUrl).host})`);

// ---------------------------------------------------------------------------
// The messages.
//
// Written against the sandbox's own AP364c data — the codes (S-100, S-201,
// S-301, UP-101), the finishes (WD-05, CLO003 A, UPH-07) and the runs (MUR,
// MAIN RUN, MAIN RUN - VE) are the ones that project actually holds, so a
// message that is later assigned and read resolves against real records
// instead of matching nothing.
//
// Every address is at example.com, which IANA reserves and nobody can
// register: an invented address that could belong to a real person is one
// somebody eventually emails.
// ---------------------------------------------------------------------------
type Fake = {
  key: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  /** Days before today. Spreads the list out so "received" reads naturally. */
  daysAgo: number;
  hour: number;
  body: string;
  html?: boolean;
  attachment?: { filename: string; contentType: string; content: string };
  /** What routing is EXPECTED to do. Printed beside what it actually did. */
  expect: string;
};

const DESIGNER = "Claire Beaumont <claire.beaumont@example.com>";
const PM = "Tom Findlay <tom.findlay@example.com>";
const SUPPLIER = "Ines Duarte <ines.duarte@example.com>";
const ISG = "Rachel Okonjo <rachel.okonjo@example.com>";
const ACCOUNTS = "Accounts Receivable <accounts@example.com>";
const US = "Max de Groot <max.degroot@example.com>";
const SPECS = "Specs <specs@example.com>";

const MESSAGES: Fake[] = [
  {
    key: "s201-seat-height",
    from: DESIGNER,
    to: [US, SPECS],
    subject: "AP364 Panther - S-201 armchair, seat height confirmed",
    daysAgo: 1,
    hour: 9,
    expect: "held; the sender is a contact on AP364c",
    body: `Hi Max,

Following the workshop review this morning, we can confirm the S-201 armchair:

  Seat height  445mm (measured to top of cushion, compressed)
  Overall      W660 x D685 x H680mm
  Arm height   520mm from FFL

Timber is WD-05 ceruse finish oak on the legs and the front rail. The
outside back stays in UPH-07.

Fabric for the A configuration is CLO003 A (Tibor Blob Amber Fern) as
before. B is still with the client and I will come back on it separately.

Best,
Claire

Claire Beaumont
Panther Design Studio`,
  },
  {
    key: "s301-castors",
    from: DESIGNER,
    to: [US],
    cc: [SPECS],
    subject: "RE: Panther - S-301 desk chair, castors and timber",
    daysAgo: 2,
    hour: 16,
    expect: "held; the sender is a contact on AP364c",
    body: `Answers below, in line.

Castors: yes, hard castors throughout, the guest rooms are all carpeted
so the soft wheel is wrong. Braked on the two accessible rooms only.

Timber: WD-05, same as the armchair. Please ignore WD-02 on the older
sheet, that was superseded in July.

Gas lift: 100mm travel, and the maximum seat height must not exceed
520mm.

Claire

> -----Original Message-----
> From: Max de Groot <max.degroot@example.com>
> Sent: 14 September 2026 11:20
> To: Claire Beaumont <claire.beaumont@example.com>
> Subject: Panther - S-301 desk chair, castors and timber
>
> Claire,
>
> Three things outstanding on the S-301 before we can price it:
>
>   1. Castor type - hard or soft?
>   2. Timber finish - the drawing says WD-02, the finishes schedule
>      says WD-05.
>   3. Gas lift travel, and the seat height range it gives us.
>
> Max`,
  },
  {
    key: "up101-fabric-tbc",
    from: DESIGNER,
    to: [US, SPECS],
    subject: "Panther - UP-101 headboard, fabric back on hold",
    daysAgo: 2,
    hour: 18,
    expect: "held; the sender is a contact on AP364c",
    body: `Max,

Sorry - the client has reopened the headboard fabric. Please put UP-101
back to TBC; the Aissa Dione reference we confirmed in March (CH-01.1)
is no longer the intent and they are looking at two alternatives.

Everything else on UP-101 stands: 1400 x 1200mm, wall fixed, 60mm
returns, buttoning as drawn.

I should have a direction by the end of next week.

Claire`,
  },
  {
    key: "finishes-schedule",
    from: DESIGNER,
    to: [US],
    subject: "AP364 Panther - revised finishes schedule (Rev C)",
    daysAgo: 3,
    hour: 12,
    expect: "held; the sender is a contact on AP364c",
    attachment: {
      filename: "AP364 Finishes Schedule Rev C.pdf",
      contentType: "application/pdf",
      // Deliberately a stub. The point of this message is a row that carries
      // an attachment, not a document anybody reads: a real PDF here would be
      // invented specification content sitting in the store looking genuine.
      content: "%PDF-1.4\n% placeholder - invented QA correspondence, not a specification document\n",
    },
    body: `Attached is Rev C of the finishes schedule.

Changes from Rev B:
  CLO003 A   unchanged, Tibor Blob Amber Fern
  CLO003 B   now confirmed as Tibor Blob Slate
  WD-05      unchanged, ceruse finish oak
  MT-01      antique brass, satin lacquered (was polished)

Claire`,
  },
  {
    key: "s100-dimensions",
    from: DESIGNER,
    to: [SPECS],
    cc: [US],
    subject: "Panther - S-100 sofa, overall sizes for the MAIN RUN",
    daysAgo: 4,
    hour: 10,
    expect: "held; the sender is a contact on AP364c",
    body: `The S-100 sofa, for the main run only - the mock-up stays as drawn:

  Overall  1900 x 790 x 720
  Seat height  440
  Seat depth   580

All millimetres. Feet in dark tinted wood, no visible fixings.

The 2-seater (S-101) is the same section at 1520 wide. Its seat height
is still with the upholsterer, so leave that one TBC for now.

Claire`,
  },
  {
    key: "s203-combined",
    from: DESIGNER,
    to: [US],
    subject: "Panther - S-203 armchair sizes",
    daysAgo: 5,
    hour: 15,
    expect: "held; the sender is a contact on AP364c",
    body: `S-203 overall is 80 x 70 x 90 cm.

Note the centimetres - that sheet is drawn in cm, unlike the shop
drawings. Seat height 43cm.

Claire`,
  },
  {
    key: "out-of-office",
    from: DESIGNER,
    to: [US],
    subject: "Automatic reply: Panther - S-402 bench",
    daysAgo: 6,
    hour: 8,
    expect: "held; the sender is a contact on AP364c (routing is not usefulness)",
    body: `I am out of the studio until Monday 21 September with limited access
to email. For anything urgent on Panther please contact the studio on
the main line.

Claire Beaumont
Panther Design Studio`,
  },
  {
    key: "client-comments",
    from: PM,
    to: [US, SPECS],
    subject: "FW: client comments - armchairs",
    daysAgo: 3,
    hour: 17,
    expect: "unassigned; nothing in it names a project",
    body: `Forwarding the client's comments from this afternoon's call. The
armchair quantities are moving again - they want 45 in the A fabric and
the balance in B, but nobody has confirmed what the balance is.

Tom

> From: Claire Beaumont
> Sent: 17 September 2026 14:02
>
> Client comments, in order of how much they will cost us:
>
> - The arm on the armchair is too upright. They want the S-202 arm
>   instead, on the same frame.
> - Seat foam one grade softer throughout.
> - The desk chair castors are fine as they are.`,
  },
  {
    key: "delivery-programme",
    from: PM,
    to: [US],
    cc: [SPECS],
    subject: "Delivery programme - week commencing 12 October",
    daysAgo: 7,
    hour: 11,
    expect: "unassigned; nothing in it names a project",
    body: `Max,

The site is now asking for the first delivery w/c 12 October rather than
26 October. That is two weeks earlier than the order date we were
working to.

Can you tell me which items are at risk if we hold that date? I assume
anything still sitting at TBC on fabric is the problem.

Tom Findlay`,
  },
  {
    key: "yarn-lead-times",
    from: SUPPLIER,
    to: [SPECS],
    subject: "Tessarae - lead times and minimum order",
    daysAgo: 8,
    hour: 9,
    expect: "unassigned; nothing in it names a project",
    body: `Good morning,

Further to your enquiry: Tessarae is currently running at 14 weeks from
order, with a 40m minimum per colourway. Strike-off is 3 weeks on top of
that and we would need the cutting approved before the main run is
scheduled.

Kind regards,
Ines Duarte
Yarn Collective`,
  },
  {
    key: "invoice",
    from: ACCOUNTS,
    to: [US],
    subject: "Invoice INV-20871 is now available",
    daysAgo: 9,
    hour: 7,
    expect: "unassigned; nothing in it names a project (and it is not specification)",
    html: true,
    body: `<p>Dear Customer,</p>
<p>Invoice <strong>INV-20871</strong> for the sum of &pound;2,480.00 is now
available. Payment terms are 30 days from the invoice date.</p>
<p>Please do not reply to this message.</p>`,
  },
  {
    key: "maybourne-com",
    from: ISG,
    to: [US],
    subject: "AP346 - COM fabric approvals outstanding",
    daysAgo: 5,
    hour: 13,
    expect: "held; the subject names the AP346 project code — a DIFFERENT project",
    body: `Max,

We are still missing COM approvals on six lines. Can you confirm which
of these you hold cuttings for?

Rachel Okonjo`,
  },
  {
    key: "maybourne-number",
    from: ISG,
    to: [SPECS],
    subject: "P17231 - revised BOQ, tab 2 only",
    daysAgo: 6,
    hour: 14,
    expect: "held; the subject names BWS project number P17231 — a DIFFERENT project",
    body: `Revised bill attached in the usual place on SharePoint. Only the
second tab has changed; the quantities on tab 1 and tab 3 are as issued.

Rachel`,
  },
  {
    key: "no-subject",
    from: PM,
    to: [US],
    subject: "",
    daysAgo: 10,
    hour: 19,
    expect: "unassigned; no subject, no signal",
    body: `Can you call me about the benches when you get a minute.`,
  },
];

// ---------------------------------------------------------------------------
// Building the .eml.
//
// Plain RFC 5322 text, assembled by hand rather than by a library: what is
// being tested downstream is the PARSER, and generating the file with the same
// family of code that reads it would hide exactly the malformed-header case
// worth seeing.
// ---------------------------------------------------------------------------
const BOUNDARY = "----qa-fake-boundary-0e6c1f";

function rfc2822Date(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[date.getUTCDay()]}, ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00 +0000`
  );
}

function receivedAt(message: Fake): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - message.daysAgo);
  date.setUTCHours(message.hour, (message.key.length * 7) % 60, 0, 0);
  return date;
}

function buildEml(message: Fake): { bytes: Buffer; messageId: string } {
  const date = receivedAt(message);
  const messageId = `<${message.key}.${date.getTime()}@example.com>`;
  const headers = [
    `Message-ID: ${messageId}`,
    `Date: ${rfc2822Date(date)}`,
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    // Kept because the screen shows the header trail as routing evidence, and
    // a message with no X-headers at all does not look like anything Exchange
    // ever delivered.
    "X-Mailer: Microsoft Outlook 16.0",
    "X-QA-Fixture: invented correspondence, spec builder QA",
  ];

  if (message.attachment) {
    const body = [
      `Content-Type: multipart/mixed; boundary="${BOUNDARY}"`,
      "",
      `--${BOUNDARY}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      message.body,
      "",
      `--${BOUNDARY}`,
      `Content-Type: ${message.attachment.contentType}; name="${message.attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${message.attachment.filename}"`,
      "",
      Buffer.from(message.attachment.content, "utf8").toString("base64"),
      "",
      `--${BOUNDARY}--`,
      "",
    ].join("\r\n");
    return { bytes: Buffer.from(`${headers.join("\r\n")}\r\n${body}`, "utf8"), messageId };
  }

  const contentType = message.html
    ? 'Content-Type: text/html; charset="utf-8"'
    : 'Content-Type: text/plain; charset="utf-8"';
  const body = [contentType, "Content-Transfer-Encoding: 8bit", "", message.body, ""].join("\r\n");
  return { bytes: Buffer.from(`${headers.join("\r\n")}\r\n${body}`, "utf8"), messageId };
}

/** The Graph path shape, so these sit where real ingested mail would sit. */
function storagePathFor(graphId: string, received: Date): string {
  const yyyy = String(received.getUTCFullYear());
  const mm = String(received.getUTCMonth() + 1).padStart(2, "0");
  return `mailbox/${QA_MAILBOX.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}/${yyyy}/${mm}/${graphId.replace(/[^A-Za-z0-9_-]/g, "")}.eml`;
}

// ---------------------------------------------------------------------------
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  if (clear) {
    const rows = await client.query(
      `select id, subject, mailbox_storage_path, intake_run_id from email_messages where mailbox = $1`,
      [QA_MAILBOX],
    );
    const assigned = rows.rows.filter((row) => row.intake_run_id);
    const sweepable = rows.rows.filter((row) => !row.intake_run_id);
    // A message with no subject is a real message; `null` in the output reads
    // as a bug in the sweep rather than as the message it removed.
    const named = (row: { subject: string | null }) => row.subject || "(no subject)";

    for (const row of assigned) {
      console.log(`  keeping "${named(row)}" — it owns an intake run; remove that first if you mean to.`);
    }
    if (!apply) {
      console.log(`\nDry run. Would remove ${sweepable.length} fake message(s) and their stored files.`);
      console.log("Add --apply to do it.");
      process.exit(0);
    }
    for (const row of sweepable) {
      if (row.mailbox_storage_path) {
        await del(String(row.mailbox_storage_path), { token: process.env.BLOB_READ_WRITE_TOKEN }).catch((cause) => {
          console.log(`  (the stored file for "${named(row)}" was not removed: ${cause instanceof Error ? cause.message : cause})`);
        });
      }
      await client.query(`delete from email_messages where id = $1`, [row.id]);
      console.log(`  removed "${named(row)}"`);
    }
    console.log(`\nRemoved ${sweepable.length} message(s). ${assigned.length} left in place.`);
    process.exit(0);
  }

  const existing = await client.query(
    `select graph_message_id from email_messages where mailbox = $1 and graph_message_id is not null`,
    [QA_MAILBOX],
  );
  const already = new Set(existing.rows.map((row) => String(row.graph_message_id)));

  const planned = MESSAGES.filter((message) => !already.has(`${QA_ID_PREFIX}${message.key}`));
  console.log(
    `\n${MESSAGES.length} fake message(s) defined; ${already.size} already recorded; ${planned.length} to record.\n`,
  );
  for (const message of planned) {
    console.log(`  ${message.subject || "(no subject)"}`);
    console.log(`    from ${message.from} — expected: ${message.expect}`);
  }

  if (!apply) {
    console.log("\nDry run. Nothing was written and nothing was stored. Add --apply to record them.");
    process.exit(0);
  }

  console.log("");
  for (const message of planned) {
    const graphId = `${QA_ID_PREFIX}${message.key}`;
    const received = receivedAt(message);
    const { bytes } = buildEml(message);
    const storagePath = storagePathFor(graphId, received);

    // `addRandomSuffix: false` so the path is the identity: re-running
    // overwrites rather than accumulating copies of the same message.
    await put(storagePath, bytes, {
      access: "private",
      addRandomSuffix: false,
      contentType: "message/rfc822",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    const recorded = await recordMessage({
      mailbox: QA_MAILBOX,
      origin: "graph",
      graphMessageId: graphId,
      bytes,
      storagePath,
      mimeSize: bytes.byteLength,
      actor: "qa-seed",
    });

    // What routing ACTUALLY decided, which is the only reason the expectation
    // above is worth printing.
    const outcome =
      recorded.routing.status === "assigned"
        ? `would place on a project — ${recorded.routing.evidence}`
        : recorded.routing.status;
    console.log(`  recorded "${message.subject || "(no subject)"}" — ${outcome}`);
  }

  console.log(`\nRecorded ${planned.length} message(s), all HELD.`);
  console.log("Assigning one is what starts a charged read, and that stays a click on the inbox screen.");
} finally {
  await client.end();
}
