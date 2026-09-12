# Microsoft Graph — shared project inbox (read-only)

## The safety boundary — read first

This integration **reads** messages from one shared project mailbox
(`p17231@benwhistler.com`) so that specification information arriving by email
can be staged against spec records. It does not send, reply, forward, flag,
move, delete, or mark anything as read. Reading a mailbox is not writing to it,
and inbound access does not enable outbound: this app has no send path at all,
and chase emails are drafts a human sends from their own Outlook.

**Planned for M5. Nothing is built yet** — this document is the boundary
agreed in advance, not a description of running code.

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
- [ ] No `spec_values` row changed as a result of ingestion. Staging only.
- [ ] `Get-ApplicationAccessPolicy` reports **`InScope=True`** for
      `p17231@benwhistler.com` **and `InScope=False` for an unrelated
      mailbox.** Both directions, or the test proves nothing.
- [ ] Reading the mailbox left every message **unread** in Outlook.
- [ ] The audit trail names the ingestion as a system actor, distinguishable
      from a person.

## Failure handling and rollback

When it fails, it fails quietly: nobody is paged, and the symptom is email
that never turns up as a staged record. Whoever is waiting for the information
notices, which may be days later. Check the scheduled job first, then the
client secret's expiry.

To turn it off: `MAIL_INGESTION_MODE=disabled`, redeploy. To turn it off
*now*: delete `GRAPH_CLIENT_SECRET`. To turn it off permanently: remove the
Entra application's permission grant, which cannot be undone by a deploy.
