// Creating a BOQ import: record the uploaded file, then parse it into staged
// rows. Nothing operational is written here — staged rows only, until a human
// confirms at /api/imports/[id]/confirm.
//
// TWO UPLOAD PATHS, and the difference matters.
//
//   multipart/form-data  the file is posted straight to this route. Works with
//                        no blob store, which is what makes the import usable
//                        today. But the SOURCE ARTIFACT IS NOT KEPT: there is
//                        nowhere to put it, so no attachments row is written
//                        and the import is flagged `source_preserved: false`
//                        for the reviewer to see. house/data-safety.md says
//                        preserve the original; this path cannot, so it says so
//                        rather than pretending.
//   application/json     the browser has already uploaded to Vercel Blob and
//                        sends the URL. We re-read the blob server-side with
//                        the bearer token, so the client cannot fake the
//                        contents. This is the real path; it needs
//                        BLOB_READ_WRITE_TOKEN.
//
// Why not @vercel/blob's onUploadCompleted callback: it is an inbound webhook
// from Vercel, so it never fires against localhost. Building the only write
// path on something that cannot run in development would mean the import could
// not be tested end to end without a tunnel.
import readExcelFile from "read-excel-file/node";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind } from "@/lib/intake-source-types";
import { parseBoqSheets } from "@/lib/boq-import";
import { matchName, type MatchCandidate } from "@/lib/matching";

export const maxDuration = 60;

const MAX_DIRECT_BYTES = 4 * 1024 * 1024; // below the serverless request-body ceiling

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const contentType = request.headers.get("content-type") ?? "";
  const direct = contentType.includes("multipart/form-data");

  let projectId = "";
  let filename = "";
  let fileType = "";
  let bytes: Buffer | null = null;
  let blobUrl: string | null = null;
  let size: number | null = null;

  if (direct) {
    const form = await request.formData();
    const file = form.get("file");
    projectId = String(form.get("projectId") ?? "");
    if (!(file instanceof File)) return json({ ok: false, error: "No file was attached." }, 400);
    if (file.size > MAX_DIRECT_BYTES) {
      return json(
        { ok: false, error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. Direct upload is capped at 4MB; a blob store is needed for anything larger.` },
        413,
      );
    }
    filename = file.name;
    fileType = file.type;
    size = file.size;
    bytes = Buffer.from(await file.arrayBuffer());
  } else {
    let body: { projectId?: unknown; url?: unknown; filename?: unknown; contentType?: unknown; size?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: "invalid JSON" }, 400);
    }
    projectId = typeof body.projectId === "string" ? body.projectId : "";
    blobUrl = typeof body.url === "string" ? body.url : null;
    filename = typeof body.filename === "string" ? body.filename : "";
    fileType = typeof body.contentType === "string" ? body.contentType : "";
    size = typeof body.size === "number" ? body.size : null;
    if (!blobUrl) return json({ ok: false, error: "url is required." }, 400);
  }

  if (!projectId || !filename) return json({ ok: false, error: "projectId and a file are required." }, 400);

  // Re-checked server-side. The upload route's allowedContentTypes is a MIME
  // list, and intakeSourceKind deliberately distrusts MIME in favour of the
  // extension. A BOQ is a spreadsheet; a PDF would need a model, and M1 has none.
  const kind = intakeSourceKind(filename, fileType);
  if (kind !== "xlsx") {
    return json(
      { ok: false, error: `M1 imports .xlsx bills of quantities. "${filename}" is ${kind === "unsupported" ? "not a supported file" : `a .${kind} file`}.` },
      400,
    );
  }

  const project = await sql`select id from projects where id = ${projectId}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  let attachmentId: string | null = null;
  if (blobUrl) {
    const attachment = await sql`
      insert into attachments (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
      values ('project', ${projectId}, 'boq', ${blobUrl}, ${filename}, ${fileType || null}, ${size}, ${user.email})
      returning id
    `;
    attachmentId = String(attachment[0]?.id);
  }

  const run = await sql`
    insert into intake_runs (project_id, attachment_id, source_kind, status, created_by, updated_by)
    values (${projectId}, ${attachmentId}, 'boq_xlsx', 'parsing', ${user.email}, ${user.email})
    returning id
  `;
  const runId = String(run[0]?.id);

  // Terminal vs retryable is decided per step, not by one outer try/catch. A
  // blob that will not download may be transient; a spreadsheet that will not
  // parse never becomes parseable, so it is terminal and says why.
  try {
    if (!bytes && blobUrl) {
      const response = await fetch(blobUrl, {
        headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN ?? ""}` },
      });
      if (!response.ok) {
        const message = `Could not read the uploaded file (${response.status}).`;
        await fail(runId, user.email, message);
        return json({ ok: false, error: message, importId: runId }, 502);
      }
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (!bytes) {
      await fail(runId, user.email, "No file content.");
      return json({ ok: false, error: "No file content.", importId: runId }, 400);
    }

    const sheets = await readExcelFile(bytes);
    const parsed = parseBoqSheets(sheets);
    if (!parsed.ok) {
      await fail(runId, user.email, parsed.error);
      return json({ ok: false, error: parsed.error, importId: runId }, 422);
    }

    // Suggest a category now, at parse time, and STORE the suggestion. It has
    // to be stored rather than recomputed on each read, because confirm writes
    // what is stored — and the rule is that what gets written is what the
    // reviewer approved, not what a fresh match would produce later.
    //
    // Candidates are the category names plus the BOQ vocabulary in
    // item_category_aliases: a BOQ says "Sofa" and the sheet is called
    // "Armchairs, Benches, Stools, Sofas", which share no word.
    const categories = await sql`select id, name from item_categories`;
    const aliases = await sql`select category_id, term from item_category_aliases`;
    const candidates: MatchCandidate[] = [
      ...categories.map((c) => ({ id: String(c.id), name: String(c.name) })),
      ...aliases.map((a) => ({ id: String(a.category_id), name: String(a.term) })),
    ];

    const staged = parsed.lines.map((line, index) => {
      const match = matchName(line.itemDescription, candidates);
      if (match.status === "confident") {
        return { index, ...line, categoryId: match.id, categoryStatus: "suggested", ignored: false };
      }
      if (match.status === "ambiguous") {
        // Several terms pointing at ONE category is agreement, not ambiguity.
        const ids = [...new Set(match.candidates.map((candidate) => candidate.id))];
        if (ids.length === 1) {
          return { index, ...line, categoryId: ids[0] ?? null, categoryStatus: "suggested", ignored: false };
        }
        return {
          index, ...line, categoryId: null, categoryStatus: "ambiguous", ignored: false,
          categoryCandidates: ids.map((id) => ({
            id, name: String(categories.find((c) => String(c.id) === id)?.name ?? id),
          })),
        };
      }
      return { index, ...line, categoryId: null, categoryStatus: "none", ignored: false };
    });

    await sql`
      update intake_runs
      set status = 'parsed',
          parsed = ${JSON.stringify({
            sheet: parsed.sheet,
            headerRow: parsed.headerRow,
            skippedRows: parsed.skippedRows,
            filename,
            sourcePreserved: Boolean(blobUrl),
            lines: staged,
          })}::jsonb,
          updated_by = ${user.email}
      where id = ${runId}
    `;
    return json(
      { ok: true, importId: runId, lines: staged.length, skippedRows: parsed.skippedRows, sourcePreserved: Boolean(blobUrl) },
      201,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await fail(runId, user.email, message);
    return json({ ok: false, error: message, importId: runId }, 500);
  }
}

async function fail(runId: string, actor: string, error: string): Promise<void> {
  await sql`update intake_runs set status = 'failed', error = ${error}, updated_by = ${actor} where id = ${runId}`;
}
