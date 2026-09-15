// One project, and the parts of it a human is allowed to change.
//
// shared_inbox exists in the schema since 0002 and had no way to set it. A
// chase email copies the project inbox, so leaving it unreachable would mean
// either no Cc at all or an address invented in code — and an invented address
// on a message a human sends to a client is not a small mistake.
//
// An unset inbox is a visible state, not an error: "no Cc" is a legitimate
// choice and the draft screen says which one is in force.
//
// bws_project_number is READ-ONLY after creation and this route refuses it by
// name rather than ignoring it. It is the BWS key, it is what every record_no
// label is built from, and it is snapshotted into stored chase coverage.
// Changing it silently re-labels history. Renaming a project number is a data
// migration, not a form field.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { validateProgramme, type ProgrammeDates } from "@/lib/project-programme";
import { ATTRIBUTE_UNITS, normaliseUnit } from "@/lib/spec-vocab";

const EMAIL = /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalDate = z
  .string()
  .trim()
  .regex(ISO_DATE, "Dates are days, in the form 2026-06-17.")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const ProjectPatch = z
  .object({
    version: z.number().int(),
    name: z.string().trim().min(1, "A project name is required.").max(200).optional(),
    client: z.string().trim().max(200).nullable().optional(),
    sharedInbox: z
      .string()
      .trim()
      .max(320)
      .regex(EMAIL, "That does not look like a single email address.")
      .nullable()
      .optional(),
    orderDate: optionalDate,
    specsAgreedBy: optionalDate,
    deliveryDate: optionalDate,
    // What this project's drawings are drawn in, answered once. Used only when
    // a drawing page prints no unit AND its own figures do not agree -- see
    // resolveDimensionUnit() in drawing-document.ts for the full order.
    //
    // A plain string rather than z.enum, so the alias table in `normaliseUnit`
    // is what decides: "CM" and "mm." are the same answer as "cm" and "mm", and
    // anything unrecognised is refused below with a sentence naming the four
    // that work. z.enum here would reject "CM" as "invalid enum value".
    defaultDimensionUnit: z.string().trim().max(20).nullable().optional(),
  })
  .strict();

/** The fields this route will write. `version` is the lock, not a change. */
const EDITABLE = [
  "name",
  "client",
  "sharedInbox",
  "orderDate",
  "specsAgreedBy",
  "deliveryDate",
  "defaultDimensionUnit",
] as const;

export const dynamic = "force-dynamic";

// A `date` column is a calendar day and must never become a JS Date on the way
// out. `pg` parses `2026-04-01` into LOCAL midnight, and `toISOString()` then
// renders that as `2026-03-31` in British Summer Time -- so a read-modify-write
// of the project (changing only the client name, say) silently moved every date
// a day earlier, every time it was saved. Selecting `::text` means the day never
// has a timezone to lose. Keep the cast on every query that reads these columns.
function asDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 10);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const rows = await sql`
    select id, bws_project_number, name, client, shared_inbox, default_dimension_unit,
           order_date::text, specs_agreed_by::text, delivery_date::text, version
    from projects where id = ${id}
  `;
  if (!rows[0]) return json({ ok: false, error: "No such project." }, 404);

  // The project's documents, for the overview screen's Documents section. A
  // failed list is an error there, never an empty queue, so this is part of the
  // same read rather than a second fetch that can fail silently.
  const documents = await sql`
    select r.id, r.source_kind, r.document_kind, r.status, r.error, r.created_at, r.created_by,
           -- The attachment is the filename's real home, but the direct-upload
           -- path keeps no attachment at all (see /api/imports) and would leave
           -- every one of those runs reading "Unnamed file". The staged JSON
           -- recorded the name it was given; fall back to it.
           coalesce(a.filename, r.parsed->>'filename') as filename,
           (r.attachment_id is not null) as source_preserved
    from intake_runs r
    left join attachments a on a.id = r.attachment_id
    where r.project_id = ${id}
    order by r.created_at desc
    limit 50
  `;

  // The runs (BOQ tabs) this project quotes. One tab each on the overview, so
  // the same item code at three different quantities reads as three sub-quotes
  // rather than as three confusing duplicates in one list.
  const runs = await sql`
    select run.id, run.name, run.source_sheet, run.boq_revision, run.boq_date, run.header_notes,
           run.sort_order, run.status, run.version, run.created_at,
           (select count(*) from spec_records r where r.run_id = run.id and r.status = 'active') as record_count,
           (select count(*) from record_attributes a
              join spec_records r on r.id = a.record_id
             where r.run_id = run.id and a.status = 'active') as attribute_count
    from spec_runs run
    where run.project_id = ${id} and run.status = 'active'
    order by run.sort_order, run.created_at
  `;

  // What the preamble said the whole package is built under.
  const notes = await sql`
    select n.id, n.topic, n.title, n.body, n.flagged, n.source_page, n.sort_order, n.version, n.created_at, n.created_by,
           at.filename as source_filename
    from project_notes n
    left join intake_runs r on r.id = n.source_run_id
    left join attachments at on at.id = r.attachment_id
    where n.project_id = ${id} and n.status = 'active'
    -- Flagged first: the three that change what gets quoted must not be read
    -- at the same weight as the thirty that do not.
    order by n.flagged desc, n.sort_order, n.created_at
  `;

  const record = rows[0] as Record<string, unknown>;
  return json({
    ok: true,
    project: {
      ...record,
      order_date: asDate(record.order_date),
      specs_agreed_by: asDate(record.specs_agreed_by),
      delivery_date: asDate(record.delivery_date),
    },
    documents,
    runs,
    notes,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  if (raw && typeof raw === "object" && "bwsProjectNumber" in raw) {
    return json(
      {
        ok: false,
        error:
          "The BWS project number cannot be changed here. It is the key every record number and stored chase is labelled with; renaming it is a data migration.",
      },
      400,
    );
  }

  const parsed = ProjectPatch.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That change is not valid." }, 400);
  }

  const changed = EDITABLE.filter((field) => field in parsed.data);
  if (changed.length === 0) return json({ ok: false, error: "Nothing to change." }, 400);

  const current = await sql`
    select id, bws_project_number, name, client, shared_inbox, default_dimension_unit,
           order_date::text, specs_agreed_by::text, delivery_date::text, version
    from projects where id = ${id}
  `;
  if (!current[0]) return json({ ok: false, error: "No such project." }, 404);
  const row = current[0] as Record<string, unknown>;

  const blankToNull = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };
  const pick = <T>(field: (typeof EDITABLE)[number], stored: T, incoming: T): T =>
    field in parsed.data ? incoming : stored;

  const name = pick("name", String(row.name), (parsed.data.name ?? "").trim());
  const client = pick("client", (row.client as string | null) ?? null, blankToNull(parsed.data.client));
  const sharedInbox = pick(
    "sharedInbox",
    (row.shared_inbox as string | null) ?? null,
    blankToNull(parsed.data.sharedInbox),
  );

  // The dates are validated as a SET, merged over what is stored: changing one
  // date alone can still produce an out-of-order programme, and validating only
  // the submitted field would let it through.
  const dates: ProgrammeDates = {
    orderDate: pick("orderDate", asDate(row.order_date), blankToNull(parsed.data.orderDate)),
    specsAgreedBy: pick("specsAgreedBy", asDate(row.specs_agreed_by), blankToNull(parsed.data.specsAgreedBy)),
    deliveryDate: pick("deliveryDate", asDate(row.delivery_date), blankToNull(parsed.data.deliveryDate)),
  };
  const dateError = validateProgramme(dates);
  if (dateError) return json({ ok: false, error: dateError }, 400);

  if (!name) return json({ ok: false, error: "A project name is required." }, 400);

  // Resolved through the same function the extraction worker uses, so the
  // column, ATTRIBUTE_UNITS and this route cannot drift into three opinions.
  // Blank clears it, which is how a project says "ask me per page again".
  const submittedUnit = blankToNull(parsed.data.defaultDimensionUnit);
  const defaultDimensionUnit = pick(
    "defaultDimensionUnit",
    (row.default_dimension_unit as string | null) ?? null,
    submittedUnit === null ? null : normaliseUnit(submittedUnit),
  );
  if (submittedUnit !== null && defaultDimensionUnit === null && "defaultDimensionUnit" in parsed.data) {
    return json(
      { ok: false, error: `\"${submittedUnit}\" is not a unit this app knows. Use ${ATTRIBUTE_UNITS.join(", ")}.` },
      400,
    );
  }

  const rows = await sql`
    update projects
    set name = ${name},
        client = ${client},
        shared_inbox = ${sharedInbox},
        order_date = ${dates.orderDate},
        specs_agreed_by = ${dates.specsAgreedBy},
        delivery_date = ${dates.deliveryDate},
        default_dimension_unit = ${defaultDimensionUnit},
        updated_by = ${user.email}
    where id = ${id} and version = ${parsed.data.version}
    returning id, bws_project_number, name, client, shared_inbox, default_dimension_unit,
              order_date::text, specs_agreed_by::text, delivery_date::text, version
  `;

  if (!rows[0]) {
    const now = await sql`select id, shared_inbox, version, updated_by from projects where id = ${id}`;
    if (!now[0]) return json({ ok: false, error: "No such project." }, 404);
    return json(
      {
        ok: false,
        conflict: true,
        code: "project_version_stale",
        error: `This project was changed by ${String(now[0].updated_by ?? "someone else")} while you were editing. Reload and try again.`,
        current: now[0],
      },
      409,
    );
  }

  const updated = rows[0] as Record<string, unknown>;
  return json({
    ok: true,
    project: {
      ...updated,
      order_date: asDate(updated.order_date),
      specs_agreed_by: asDate(updated.specs_agreed_by),
      delivery_date: asDate(updated.delivery_date),
    },
  });
}
