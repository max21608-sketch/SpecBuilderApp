// The picture of one item, for anybody looking at its record.
//
// A spec record was a description, a quantity and a list of things documents
// said. Nobody could look at one and recognise the item. This is the crop a
// reviewer confirmed off the drawings, and it is the fastest way a human
// checks they are on the right record.
//
// THE PATHNAME IS NEVER ACCEPTED FROM THE CLIENT. It is resolved from the
// RECORD'S OWN attachment row and re-checked against that record's project
// prefix on the way out — the caller names a record id and nothing else. Same
// rule as the import source route, and for the same reason: the blob token is
// the store's, not the user's, so a client-supplied address would point a
// store-wide credential wherever it liked.
//
// Modelled on that route rather than on the fabric app's photo route, which
// still does a bare fetch against a stored URL with a bearer token. This one
// goes through `streamTrustedBlob`, which is the stricter of the two.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { blobPathname, streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  const rows = await sql`
    select r.project_id, a.storage_path, a.content_type
    from spec_records r
    join attachments a
      on a.entity_type = 'spec_records' and a.entity_id = r.id and a.kind = 'item_image'
    where r.id = ${id}
    order by a.created_at desc
    limit 1
  `;
  const row = rows[0];
  // 404 rather than a placeholder: "this record has no picture" is a fact the
  // screen should render in words, not a broken image to interpret.
  if (!row) return json({ ok: false, error: "That record has no image." }, 404);

  try {
    const source = await streamTrustedBlob(blobPathname(String(row.storage_path)), String(row.project_id), {
      range: request.headers.get("range"),
    });

    const headers = new Headers({
      "content-type": String(row.content_type || source.contentType || "image/png"),
      "content-disposition": "inline",
      "accept-ranges": "bytes",
      // Private and per-user. This is a crop of NDA-covered client drawings; a
      // shared cache holding it is a disclosure waiting to happen. Unlike the
      // source document it IS re-fetched constantly (once per record row on a
      // list), so it gets a short private max-age rather than no-store.
      "cache-control": "private, max-age=3600",
      // The bytes came from a browser, so they are not a file this app produced.
      // Nothing should be talked into sniffing them as anything but an image.
      "x-content-type-options": "nosniff",
    });
    const contentRange = source.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    const contentLength = source.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);

    return new Response(source.stream as unknown as BodyInit, {
      status: contentRange ? 206 : 200,
      headers,
    });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 404);
    console.error("item image read failed", cause);
    return json({ ok: false, error: "That image could not be read." }, 502);
  }
}
