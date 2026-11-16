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
import { json, sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { UPLOAD_CONTENT_TYPES } from "@/lib/intake-source-types";
import { assertProjectScopedPathname, UntrustedBlobError } from "@/lib/blob-source";
import { isUuid, requireWriter } from "@/lib/route-guards";
import { explainFailure } from "@/lib/error-detail";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30MB — comfortably above the largest known sample (12.4MB)

export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;

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
        if (!isUuid(projectId)) {
          throw new UntrustedBlobError("An upload must say which project it belongs to.");
        }
        // Throws unless the pathname is inside this project's prefix. The
        // browser builds it with projectUploadPrefix(); anything else is either
        // a bug or someone reaching for another project's namespace.
        assertProjectScopedPathname(pathname, projectId);
        // AND THE PROJECT EXISTS (review 2.6). A uuid-shaped id was enough, so
        // a file could be stored under a project this database has never
        // held: a blob no registration can ever accept and nothing lists.
        // Registration asks the same question; this asks it before the bytes
        // are sent. An archived project is a project, as it is there.
        const project = await sql`select id from projects where id = ${projectId}`;
        if (!project[0]) {
          throw new UntrustedBlobError(
            "That project is not in this app any more, so nothing can be uploaded to it. Open the project again from the projects list.",
          );
        }

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
    // Our own refusals (a pathname outside the project, no project named) are
    // sentences and pass through; the SDK's and anything else's become one
    // sentence and a reference the log holds the cause under (audit A12).
    return json({ ok: false, error: explainFailure("The upload could not be started.", e, "upload-token") }, 400);
  }
}
