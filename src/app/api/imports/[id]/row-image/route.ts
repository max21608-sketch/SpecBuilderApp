// The picture a bill prints on one of its rows, for the review's thumbnail.
//
//   GET /api/imports/<run>/row-image?sheet=<sheet index>&row=<1-based row>
//
// THE PATHNAME IS NEVER ACCEPTED FROM THE CLIENT. The caller names a run, a
// sheet and a row; the pathname is read from that run's OWN staged document
// (`rowImages`, written at registration by `bill-images.ts`) and re-checked
// against the run's project prefix on the way out — the item image route's
// rule, for the same reason: the blob token is the store's, not the user's.
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { streamTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { assertBoqDocument } from "@/lib/boq-import";
import { rowImageFor } from "@/lib/bill-row-image";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  const url = new URL(request.url);
  const sheetIndex = Number(url.searchParams.get("sheet"));
  const row = Number(url.searchParams.get("row"));
  if (!Number.isInteger(sheetIndex) || sheetIndex < 0 || !Number.isInteger(row) || row < 1) {
    return json({ ok: false, error: "Name a sheet and a row." }, 400);
  }

  const runs = await sql`select project_id, source_kind, parsed from intake_runs where id = ${id}`;
  const run = runs[0];
  if (!run || run.source_kind !== "boq_xlsx" || !run.parsed) {
    return json({ ok: false, error: "No such bill." }, 404);
  }
  let image;
  try {
    const doc = assertBoqDocument(run.parsed);
    const sheet = doc.sheets[sheetIndex];
    image = sheet ? rowImageFor(doc.rowImages, sheet.sheetName, row) : null;
  } catch {
    image = null;
  }
  // 404 rather than a placeholder: "this row has no picture" is a fact the
  // screen says in words, not a broken image somebody has to interpret.
  if (!image?.pathname) return json({ ok: false, error: "That row has no picture." }, 404);

  try {
    const source = await streamTrustedBlob(image.pathname, String(run.project_id));
    const headers = new Headers({
      "content-type": image.contentType || source.contentType || "image/png",
      "content-disposition": "inline",
      // Private and per-user: a picture out of an NDA-covered client document.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    });
    const contentLength = source.headers.get("content-length");
    if (contentLength) headers.set("content-length", contentLength);
    return new Response(source.stream as unknown as BodyInit, { status: 200, headers });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 404);
    console.error("bill row image read failed", cause);
    return json({ ok: false, error: "That picture could not be read." }, 502);
  }
}
