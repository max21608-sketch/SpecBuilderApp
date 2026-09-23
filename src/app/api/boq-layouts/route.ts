// Saved bill layouts: a person's column mapping, remembered under a name.
//
// ============================================================================
// "NAIL THE MAJOR SPECIFIERS" IS DATA, NOT CODE.
//
// A reviewer who has set a bill's columns once can save them ("Aman Interiors —
// AMB pricing document"), and the next bill in that layout reads on its own,
// with "Read with the <name> layout" on its review and its Columns panel open
// until somebody has looked (src/lib/boq-import.ts, `layoutAt`).
//
// A layout is saved FROM A STAGED SHEET'S CURRENT MAPPING, never from a mapping
// the client sends: the sheet's `columns` are what the reader actually read the
// bill with, so the layout cannot claim a mapping that never produced a line.
// Each role is stored as the FOLDED heading of its column, and the match is
// exact on every one of them. A column whose heading is blank cannot be found
// on the next bill, so a layout that needs one is refused in words rather than
// saved as a layout that will silently never apply.
//
// It opens no change set — it is not specification content, and nothing about
// any record changes when one is saved — and `write_audit` records the row
// with its `created_by`. Writer roles only, which the middleware enforces for
// every mutating request.
// ============================================================================
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { assertBoqDocument } from "@/lib/boq-import";
import { BOQ_ROLE_LABELS, columnLetter, foldHeading, isBoqReadRole, type BoqReadRole } from "@/lib/boq-roles";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const rows = await sql`
    select id, name, headings, mapping, header_rows, created_by, created_at
    from boq_layouts
    where retired_at is null
    order by name
  `;
  return json({
    ok: true,
    layouts: rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      headings: (row.headings as string[] | null) ?? [],
      mapping: row.mapping,
      headerRows: Number(row.header_rows),
      createdBy: String(row.created_by),
      createdAt: row.created_at,
    })),
  });
}

const SaveLayout = z
  .object({
    importId: z.string().uuid(),
    sheetIndex: z.number().int().nonnegative(),
    name: z.string().trim().min(1, "Give the layout a name.").max(200, "That name is too long."),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = SaveLayout.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? "That request is not valid." }, 400);
  }
  const { importId, sheetIndex, name } = parsed.data;

  const runs = await sql`select source_kind, parsed from intake_runs where id = ${importId}`;
  const run = runs[0];
  if (!run) return json({ ok: false, error: "No such import." }, 404);
  if (run.source_kind !== "boq_xlsx" || !run.parsed) {
    return json({ ok: false, error: "Only a staged bill of quantities has columns to remember." }, 400);
  }
  const sheet = assertBoqDocument(run.parsed).sheets[sheetIndex];
  if (!sheet) return json({ ok: false, error: "That sheet is not in this bill." }, 400);
  if (sheet.needsColumns || !sheet.columns) {
    return json({ ok: false, error: "Set this sheet's columns and read it first — there is no mapping to remember yet." }, 400);
  }

  const mapping: Partial<Record<BoqReadRole, string>> = {};
  const byHeading = new Map<string, BoqReadRole>();
  for (const [role, ref] of Object.entries(sheet.columns)) {
    if (!isBoqReadRole(role) || !ref) continue;
    const heading = foldHeading(ref.heading ?? "");
    if (heading === "") {
      return json(
        {
          ok: false,
          error:
            `Column ${columnLetter(ref.index)} (${BOQ_ROLE_LABELS[role].toLowerCase()}) has no heading, so a saved ` +
            "layout could not find it on the next bill. Remember the columns from a header row that names it.",
        },
        400,
      );
    }
    const clash = byHeading.get(heading);
    if (clash) {
      return json(
        {
          ok: false,
          error:
            `Two roles are read from columns headed “${ref.heading}” (${BOQ_ROLE_LABELS[clash].toLowerCase()} and ` +
            `${BOQ_ROLE_LABELS[role].toLowerCase()}), so a layout could not tell them apart on the next bill.`,
        },
        400,
      );
    }
    byHeading.set(heading, role);
    mapping[role] = heading;
  }
  if (Object.keys(mapping).length === 0) {
    return json({ ok: false, error: "This sheet's mapping reads no column, so there is nothing to remember." }, 400);
  }

  const headings = (sheet.headings ?? []).map((heading) => foldHeading(heading ?? ""));
  const headerRows = sheet.headerRows === 2 ? 2 : 1;

  try {
    const inserted = await sql`
      insert into boq_layouts (name, headings, mapping, header_rows, created_by)
      values (${name}, ${headings}::text[], ${JSON.stringify(mapping)}::jsonb, ${headerRows}, ${user.email})
      returning id, name
    `;
    return json({ ok: true, layout: { id: String(inserted[0]?.id), name: String(inserted[0]?.name) } }, 201);
  } catch (cause) {
    // The one refusal a person can act on: the name is taken. Anything else is
    // a real failure and goes up as one.
    const code = (cause as { code?: string } | null)?.code;
    if (code === "23505") {
      return json({ ok: false, code: "name_taken", error: `A layout called “${name}” already exists. Choose another name.` }, 409);
    }
    throw cause;
  }
}
