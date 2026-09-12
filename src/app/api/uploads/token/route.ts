// POST /api/uploads/token — issues a scoped client-upload token for
// @vercel/blob's client-direct upload flow. Bytes go straight from the
// browser to Blob storage, never through our own route handler — necessary
// since a real source document (12.4MB was the largest seen on the
// fabric-ordering app) is well over Vercel's
// function request-body ceiling.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { UPLOAD_CONTENT_TYPES } from "@/lib/intake-source-types";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30MB — comfortably above the largest known sample (12.4MB)

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: UPLOAD_CONTENT_TYPES,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });
    return json(result);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
