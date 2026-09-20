// The quote CSV — the second of Matthew's three outputs.
//
// ============================================================================
// THIS IS NOT THE BWS FILE, AND IT MUST NOT BE MISTAKEN FOR IT.
//
// The 109-column export REPLACES a job's fields on import, which is why it
// refuses to be filtered and carries no Id. This is a different document: a
// list of quotable lines with the specification written out for a person to
// price. It shares the export's SCOPE LOADER on purpose — a quote covering a
// different set of records from the file would be its own kind of wrong — and
// nothing else.
//
// Eight of its twelve columns are filled. The other four, and the nineteen
// companion billing lines in Matthew's real file, are reported on the response
// so the screen can say why they are blank rather than letting somebody price
// off a gap. See src/lib/quote-lines.ts.
// ============================================================================
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { loadExportScope, isScopeFailure } from "@/lib/export-scope";
import { composeQuoteSheet, type QuoteBoilerplate } from "@/lib/quote-lines";
import { toCsv } from "@/lib/bws-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_PARAMS = new Set(["runId", "format"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return json({ ok: false, error: `"${key}" is not accepted. Quote a whole phase, or the whole project.` }, 400);
    }
  }
  const runId = url.searchParams.get("runId");
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") {
    return json({ ok: false, error: 'format must be "csv" or "json".' }, 400);
  }

  // The SAME loader the export and the check sheet use, so all three describe
  // one set of records.
  const loaded = await loadExportScope(id, runId);
  if (isScopeFailure(loaded)) return json({ ok: false, error: loaded.error }, loaded.status);
  const { scope } = loaded;

  // The quote's own extra columns, which the 109-column file has no home for:
  // the prose description, the internal note, and which of Matthew's nine
  // categories the record is — the last being what derives its product code.
  const ids = scope.records.map((record) => record.id);
  const extras = ids.length
    ? await sql`
        select r.id, r.spec_description, r.internal_notes,
               -- EVERY code the category maps to, not one of them. Our
               -- armchairs-benches-stools-sofas sheet receives three, and
               -- taking the first handed a sofa the armchair boilerplate.
               coalesce((select array_agg(m.matrix_code order by m.matrix_code)
                           from spec_matrix_category_map m
                          where m.item_category_id = r.category_id), '{}') as matrix_codes
          from spec_records r where r.id = any(${ids}::uuid[])
      `
    : [];
  const extraById = new Map(extras.map((row) => [String(row.id), row]));

  const register: QuoteBoilerplate[] = (
    await sql`
      select matrix_code, variant, code, bws_id from bws_boilerplates
       where active and matrix_code is not null
    `
  ).map((row) => ({
    matrixCode: String(row.matrix_code),
    variant: String(row.variant),
    code: String(row.code),
    bwsId: Number(row.bws_id),
  }));

  const sheet = composeQuoteSheet(
    {
      ...scope,
      records: scope.records.map((record) => {
        const extra = extraById.get(record.id);
        return {
          ...record,
          specDescription: (extra?.spec_description ?? null) as string | null,
          internalNotes: (extra?.internal_notes ?? null) as string | null,
          matrixCodes: (extra?.matrix_codes ?? []) as string[],
        };
      }),
    },
    register,
  );

  if (format === "json") {
    return json({ ok: true, ...sheet, records: sheet.rows.length });
  }

  const filename = `${loaded.projectNumber || "project"}${scope.runName ? ` - ${scope.runName}` : ""} - quote lines.csv`
    .replace(/[^A-Za-z0-9 .&-]/g, "")
    .trim();
  return new Response(toCsv([sheet.header, ...sheet.rows]), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-quote-records": String(sheet.rows.length),
      // The screen reads these so it can say what is blank and why without a
      // second request.
      "x-quote-unfillable": String(sheet.unfillable.length),
    },
  });
}
