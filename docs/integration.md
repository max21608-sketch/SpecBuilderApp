# Microsoft Graph — shared project inbox (read-only)

## The safety boundary — read first

This integration **reads** messages from one shared project mailbox
(`p17231@benwhistler.com`) so that specification information arriving by email
can be staged against spec records. It does not send, reply, forward, flag,
move, delete, or mark anything as read. Reading a mailbox is not writing to it,
and inbound access does not enable outbound: this app has no send path at all,
and chase emails are drafts a human sends from their own Outlook.

**Built 2026-09-16, and DISABLED.** The subscription lifecycle, the webhook,
the delta poll and the ingestion worker all exist. `MAIL_INGESTION_MODE` is
`disabled` and no mailbox, tenant or secret is set on any deployment, so none
of it runs.

**It has never talked to Microsoft Graph.** Everything past the token exchange
is written against Microsoft's documentation. What IS verified is its own
guards — the webhook's authentication, the message-id validation, the paging
link's origin check and every disabled path have tests. What is NOT verified is
the subscription lifecycle, the delta semantics and the message shape Graph
actually sends. The first real message is the test that matters, and the
checklist at the end of this document is what to walk when the mailbox exists.

It is **disabled by default** and stays disabled until the credentials, scope,
behaviour and rollback have been explicitly approved. Enablement is deployment
configuration, not an in-app toggle — turning it on has security and business
impact, so it should not be a button someone can find.

## One-time setup

1. Register an application in Entra ID for this app alone. Do not reuse the
   fabric-ordering app's registration — one app, one identity, so revoking one
   does not break the other.
2. Grant **`Mail.Read`** application permission, then immediately scope it (see
   below). Do not grant `Mail.ReadWrite`, `Mail.Send`, or delegated equivalents.
3. Create an Exchange application access policy restricting that application to
   the single target mailbox.
4. Record the tenant, client id and secret in the environment variables below.
   The secret expires — note the expiry date in `docs/plans/README.md`, because
   nothing here will warn you.

### The secret expires, and the expiry is the silent failure

Requested at **two years**, which is the practical maximum in Entra and what
was asked of IT on 2026-09-17. A tenant app management policy may cap it
shorter; whatever it ends up as, **the date is the thing to record**, in the
credential table in `docs/plans/README.md`.

The reason this gets its own heading rather than a line in the list: an expired
secret is indistinguishable, from the outside, from a quiet week. The
integration fails closed, no alert fires, nothing appears in the app saying the
credential is dead, and the symptom is specification email that never becomes a
staged record. Whoever is waiting for the information notices, days later, and
they will not think of the client secret.

So renewal is a DIARY entry, held in two places because neither is reliable
alone: IT's own reminder about a month before the date, and the credential
table in the decision log. Rotating it is `Add-MgApplicationPassword` again
plus `GRAPH_CLIENT_SECRET` in every hosted environment and a fresh build — a
variable change does not alter a running deployment.

### Scope it as narrowly as the provider allows

Request the least permission that works, and scope it to the single mailbox /
folder / project it needs.

**Grants combine; they do not narrow one another.** On the fabric app's
Microsoft Graph integration, an application-wide `Mail.Read` granted in Entra
alongside a mailbox-scoped Exchange role produced *unscoped* access — the
narrow grant did not constrain the broad one. Do not grant both.

Verify the scope positively AND negatively: prove access to the intended target
**and** prove the absence of access to an unrelated one. A test that only
checks the happy path cannot tell a scoped grant from an unscoped one.

## Configuration

| Variable | Purpose |
|---|---|
| `MAIL_INGESTION_MODE` | `disabled` until explicitly approved. This is the switch. |
| `GRAPH_TENANT_ID` | Entra tenant |
| `GRAPH_CLIENT_ID` | The app registration for **this** app |
| `GRAPH_CLIENT_SECRET` | Rotates on expiry; nothing warns you |
| `GRAPH_MAILBOX` | The single mailbox, e.g. `p17231@benwhistler.com` |
| `GRAPH_CLIENT_STATE` | **Required.** The secret Graph echoes on every notification (32+ random characters, one per environment). Without it creating or renewing the subscription refuses as "not configured" and the webhook accepts nothing. Only its hash is stored; rotating it means recreating the subscription |
| `AUTO_READ_DAILY_CAP` | Optional. Charged reads one project may start by itself per UTC day before routed mail is held for a person (default **20**, Max 2026-11-06). A person's Assign is never capped |

Set these in every hosted environment that will run the code, **before**
deploying the code that needs them. Changing a variable does not alter an
existing deployment; trigger a fresh build and verify it picked them up.

## Activation

Set `MAIL_INGESTION_MODE=enabled` in the target environment's variables and
trigger a fresh build. A variable change does not alter a running deployment.

Turning it off is the reverse, and takes effect on the next build — so for an
emergency stop, remove `GRAPH_CLIENT_SECRET` as well: the integration fails
closed without it.

## First real use — verification checklist

Do not consider this live until every line is ticked, with real data, by a
person:

- [ ] A message sent to the project inbox appears as a staged record.
- [ ] The original `.eml` is preserved as an attachment row, not just parsed
      text — the source artifact is the evidence.
- [ ] No `spec_answers` row changed as a result of ingestion. Staging only.
- [ ] `Get-ApplicationAccessPolicy` reports **`InScope=True`** for
      `p17231@benwhistler.com` **and `InScope=False` for an unrelated
      mailbox.** Both directions, or the test proves nothing.
- [ ] Reading the mailbox left every message **unread** in Outlook.
- [ ] The audit trail names the ingestion as a system actor, distinguishable
      from a person.

### The spend guards (audit 2026-11-06, A1, A5, A8, B8)

Routed mail starts a charged read with nobody watching, so these are checked
with real messages before ingestion is left on. Each says what to send and what
must happen. The Inbox screen shows every outcome; a held message is on the
"Could not be placed" list with its sentence.

1. **A forged forwarding header is held.** From an address OUTSIDE the
   organisation, send a message to the app mailbox carrying
   `X-Forwarded-To: <a project inbox>` (and, separately, `Resent-To:` and
   `X-MS-Exchange-Inbox-Rules-Loop:` naming it). Each must be HELD, naming the
   project, with "any sender can write" in its reason, and start no read.
2. **A real forward is assigned, and says why.** Let the project inbox's own
   rule forward (or redirect) a message to the app mailbox. It must be
   assigned automatically. Then download its `.eml` from the Inbox row, read the
   headers, and confirm
   `X-MS-Exchange-Organization-AutoForwarded: true` is present: that stamp is
   the ONLY thing the router now trusts for a forward. If this organisation's
   rule shape does not carry it, every forward will be held (safe, but a click
   each); record what the headers DO carry in `docs/plans/README.md` before
   widening the rule, never instead of it.
3. **A To line naming a project inbox, delivered elsewhere, is held.** From
   outside, deliver to the app mailbox ONLY while the `To:` header names a
   project inbox (an ordinary mail client cannot do this, because it delivers
   to whatever To says; a test tool can, e.g. `swaks --to <app mailbox>
   --header "To: <project inbox>"`, or a plain Bcc to the app mailbox). It
   must be HELD. Confirm Exchange stamped
   `X-MS-Exchange-Organization-Recipient-P2-Type: Bcc` on the Bcc case; that
   header is what holds it. Record what the swaks case carries: Graph's
   reported recipients are Exchange's reading of the same To line, so if
   nothing stamped marks that shape, the cap in step 4 is its only bound.
4. **The daily cap holds rather than drops.** On a TEST project, set
   `AUTO_READ_DAILY_CAP=1` (fresh build), send two messages to its inbox. The
   first is assigned and read; the second is HELD with "The automatic-read cap
   for this project (1 a day) is reached; a person starts this read", and
   pressing Assign on it starts the read. Put the variable back.
5. **The same email twice is one message.** Send one message so it reaches the
   app mailbox by two routes (to the project inbox AND cc'd to the app
   mailbox), and upload its saved `.eml` on the project too. There must be ONE
   inbox row and ONE read; the upload says "This email is already in the inbox
   as …".
6. **A message taken off a project can be put on another.** Unassign an
   automatically placed message and assign it to a different project: the
   button reads "Reading it again on P… is a charged read", a new read starts
   on that project, and its `.eml` opens. Assign it back to the first: "Put it
   back", and nothing is read.

## Failure handling and rollback

When it fails, it fails quietly: nobody is paged, and the symptom is email
that never turns up as a staged record. Whoever is waiting for the information
notices, which may be days later. Check the scheduled job first, then the
client secret's expiry.

To turn it off: `MAIL_INGESTION_MODE=disabled`, redeploy. To turn it off
*now*: delete `GRAPH_CLIENT_SECRET`. To turn it off permanently: remove the
Entra application's permission grant, which cannot be undone by a deploy.

---

# Capsule CRM — contacts (read-only)

This integration **searches and reads** parties in Capsule so a project contact
can be a modelled person rather than a name somebody typed. It never creates,
updates or deletes anything in Capsule, and it never will: company systems are
read-only for this app.

**Built 2026-09-16, disabled by default.** With no `CAPSULE_API_TOKEN` the
search says so and the manual contact form keeps working.

## The boundary, and how it is held

`src/lib/capsule.ts` has exactly ONE HTTP helper and it hard-codes
`method: "GET"`. There is no post, patch or delete helper and none may be
added. `tests/lib/capsule.test.ts` asserts the module's export surface, so a
write verb fails a test rather than a code review — "we only ever call GET" is
a habit that erodes, and an absent function is a fact that does not.

Nothing about Capsule is a runtime dependency of chasing anybody. A contact's
name, email and organisation are cached on `project_contacts`; a Capsule outage
stops somebody LINKING a contact and never stops them sending an email.

## The link is optional, and flagged

A contact with no Capsule party is recorded and badged **Not linked**. A
designer whose practice Capsule has never heard of still has to be chaseable
today, and a tool that refuses to record them only moves the record into
somebody's head. The badge is what keeps the gap visible.

## Setup

1. Create a Capsule API token for a user with **read access only**, if the plan
   allows a restricted user. Otherwise note in `docs/plans/README.md` that the
   token is broader than the code, and that the code is the narrower boundary.
2. Set `CAPSULE_API_TOKEN` in the deployment's environment.
3. Trigger a fresh build. A variable change does not alter a running deployment.

| Variable | Purpose |
|---|---|
| `CAPSULE_API_TOKEN` | Bearer token for `https://api.capsulecrm.com/api/v2`. Absent means the search is unavailable and says so |

## Verification

- [ ] With no token: the contacts panel's search answers 503 with the reason,
      and a contact added by hand still saves.
- [ ] With a token: a search returns parties; choosing one fills the form; the
      saved contact is badged **Capsule**.
- [ ] The server re-reads the party on save — a request naming a party id it
      has not read is not trusted.
- [ ] An email not listed in Capsule for that party is REPORTED on refresh and
      left alone, never cleared.
- [ ] `grep -n "method:" src/lib/capsule.ts` shows one line, and it is `"GET"`.

## Data residency

Capsule is the company's own CRM, not a service this app introduces, so the
region-pinning rule (`docs/stack.md`) does not decide anything here. Where
Capsule stores its data is Max's to confirm with Capsule.

## Rollback

Delete `CAPSULE_API_TOKEN` and redeploy. The search goes unavailable with its
message; every existing contact keeps its cached name, email and organisation,
and every chase still works.

## How it actually runs

| Piece | Where | What it does |
|---|---|---|
| Subscription | `src/lib/graph-subscriptions.ts` | Created on `users/<mailbox>/mailFolders/inbox/messages`, `changeType: created`, lifetime 4000 minutes |
| Renewal | `/api/cron/graph-renew`, every 12 h | Renews with a day in hand. Recreates when Graph has forgotten it |
| Webhook | `/api/graph/notifications` | Validates and enqueues. Never fetches inside the request: Graph's handshake budget is 10 s and it drops a slow subscriber |
| Delta poll | `/api/cron/graph-delta`, every 15 min | Walks what actually changed. This is the GUARANTEE; the webhook is only the speed |
| Ingestion | `src/lib/mail-ingest.ts` | Fetches the message and its MIME, routes it, and assigns it only when routing is confident |

**Why both a webhook and a poll.** Graph drops notifications, a deploy can be
mid-flight, and a subscription can lapse — and every one of those fails
silently: mail stops arriving and the person waiting for a specification finds
out days later. The delta query asks what changed since the last token, so a
message that never produced a notification is still ingested within the
quarter-hour.

**If a cron stops.** Renewal stopping means the subscription expires within
about 66 hours and notifications stop; the delta poll keeps ingesting until it
too stops. Both stopping means mail accumulates unread in the mailbox and
arrives whenever the poll resumes, from the stored delta token — nothing is
lost, it is only late. Neither failure pages anybody, which is why the Inbox
screen shows the subscription's state.

**The first run starts from NOW**, not from the mailbox's history: turning
ingestion on must not read and bill for every message the inbox has ever held.

## Blob retention — undecided

Ingested MIME is written to `mailbox/<slug>/<yyyy>/<mm>/<id>.eml` and copied
under a project's prefix on assignment. **Nothing deletes either**, and NDA-
covered client correspondence accumulating indefinitely is a decision nobody
has taken. Recorded here as open; `docs/stack.md` already says the same about
uploads.
