// POST /api/uploads/token — issues a scoped client-upload token for
// @vercel/blob's client-direct upload flow. Bytes go straight from the
// browser to Blob storage, never through our own route handler — necessary
// since a real source document (12.4MB was the largest seen on the
// fabric-ordering app) is well over Vercel's function request-body ceiling.
//
// THE TOKEN IS SCOPED TO ONE PROJECT, and that is the first of the three
// places the same check runs (see src/lib/blob-source.ts): the browser names
// the project in `clientPayload`, this route refuses to sign a pathname outside
// that project's prefix, and registration re-checks the prefix against the
// project it is actually given. The upload is therefore bound to a project
// without a second signing purpose or a separate upload-intent endpoint.
//
// The prefix is not a security boundary on its own — the signed-in user picks
// the project. It is what makes "this pathname is not one of this project's
// documents" a decidable question at registration and at every later read, so a
// pathname can never send a store credential somewhere this app did not write.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { UPLOAD_CONTENT_TYPES } from "@/lib/intake-source-types";
import { assertProjectScopedPathname, UntrustedBlobError } from "@/lib/blob-source";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30MB — comfortably above the largest known sample (12.4MB)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const projectId = typeof clientPayload === "string" ? clientPayload.trim() : "";
        if (!UUID.test(projectId)) {
          throw new UntrustedBlobError("An upload must say which project it belongs to.");
        }
        // Throws unless the pathname is inside this project's prefix. The
        // browser builds it with projectUploadPrefix(); anything else is either
        // a bug or someone reaching for another project's namespace.
        assertProjectScopedPathname(pathname, projectId);

        return {
          // Private, always: the store holds NDA-covered client documents and a
          // public URL is access for anyone who has it.
          access: "private" as const,
          allowedContentTypes: UPLOAD_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          // Recorded on the blob itself, so a later read can tell who uploaded
          // it without trusting anything the client says at registration.
          tokenPayload: JSON.stringify({ projectId, uploadedBy: user.email }),
        };
      },
    });
    return json(result);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
