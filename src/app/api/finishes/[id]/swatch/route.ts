// A finish's swatch: read and replace.
//
// THE PATHNAME IS NEVER ACCEPTED FROM THE CLIENT ON READ. It is resolved from
// the finish's own attachment row and re-checked against that project's
// prefix — the caller names a finish and nothing else. On write the browser
// hands over a pathname it has just uploaded under this project's prefix, and
// the server re-checks that before it will attach it to anything.
//
// REPLACING SUPERSEDES, never deletes. A record version may point at the old
// row, and a version whose picture had been deleted would be a version of a
// state nobody can see any more.
import { sql, json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse, DomainConflictError } from "@/lib/db-transaction";
import { assertProjectScopedPathname, blobPathname, streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { openChangeSet } from "@/lib/change-sets";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select f.project_id, a.storage_path, a.content_type
    from project_finishes f
    join attachments a
      on a.entity_type = 'project_finishes' and a.entity_id = f.id and a.kind = 'finish_swatch'
         and a.superseded_at is null
    where f.id = ${id}
    order by a.created_at desc
    limit 1
  `;
  const row = rows[0];
  // 404 rather than a placeholder: "this finish has no swatch" is a fact the
  // screen renders in words, not a broken image to interpret.
  if (!row) return json({ ok: false, error: "That finish has no swatch." }, 404);

  try {
    const source = await streamTrustedBlob(blobPathname(String(row.storage_path)), String(row.project_id), {
      range: request.headers.get("range"),
    });
    const headers = new Headers({
      "content-type": String(row.content_type || source.contentType || "image/png"),
      "content-disposition": "inline",
      "accept-ranges": "bytes",
      // NDA-covered client material, and re-fetched once per library row.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    });
    const contentRange = source.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    return new Response(source.stream as unknown as BodyInit, { status: contentRange ? 206 : 200, headers });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 404);
    console.error("swatch read failed", cause);
    return json({ ok: false, error: "That image could not be read." }, 502);
  }
}

const Body = z
  .object({
    pathname: z.string().min(1).max(1024),
    filename: z.string().max(300).nullable().optional(),
    contentType: z.string().max(200).nullable().optional(),
    size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
    // WHERE IT CAME FROM, required. intake-source-types.ts says nobody picks a
    // PNG off their disk as an intake document; relaxing that for a swatch is
    // only safe if the picture can still be traced to a page somebody can open.
    source: z.string().min(1).max(300),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "Say where this picture came from — the document and page." }, 400);
  }

  try {
    const result = await withTransaction(async (txn) => {
      const rows = await txn`
        select id, project_id, code from project_finishes where id = ${id} and status = 'active'
      `;
      const finish = rows[0];
      if (!finish) throw new DomainConflictError("not_found", "No such finish.", { status: 404 });
      const projectId = String(finish.project_id);

      let pathname: string;
      try {
        pathname = assertProjectScopedPathname(parsed.data.pathname, projectId);
      } catch {
        throw new DomainConflictError("not_this_project", "That image is not one of this project's files.", { status: 400 });
      }

      await openChangeSet(txn, {
        projectId,
        kind: "finish_edit",
        actor: user.email,
        reason: `Swatch added for ${String(finish.code)}, from ${parsed.data.source}.`,
      });

      // Supersede, never delete: a record version may point at the old row.
      await txn`
        update attachments set superseded_at = now()
        where entity_type = 'project_finishes' and entity_id = ${id} and kind = 'finish_swatch'
          and superseded_at is null
      `;
      await txn`
        insert into attachments
          (entity_type, entity_id, kind, storage_path, filename, content_type, size, uploaded_by)
        values
          ('project_finishes', ${id}, 'finish_swatch', ${pathname},
           ${parsed.data.filename ?? "swatch.png"}, ${parsed.data.contentType ?? "image/png"},
           ${parsed.data.size ?? null}, ${user.email})
      `;
      return { finishId: id, source: parsed.data.source };
    });
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
