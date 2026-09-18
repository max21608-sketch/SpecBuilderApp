// What kind of document is this? — asked of the model, answered to a screen.
//
// ============================================================================
// NOTHING IS WRITTEN AND NOTHING IS STAGED HERE.
//
// This route creates no `intake_runs` row, opens no attempt and stages no
// proposals. It answers one question for the upload screen, which fills the
// dropdown in and flags it. The kind still arrives at `/api/imports` DECLARED,
// by a person's press — the `level_suggested` rule again: the app guesses and
// shows its evidence, a human's action is what files it.
//
// IT DOES SPEND MONEY, one small call per document, on the fast model rather
// than the extraction one. The upload screen says so before anything uploads.
//
// THE BLOB IS ADDRESSED BY PATHNAME, NEVER BY URL, and the pathname is checked
// against the project's own prefix before a byte is read — `blob-source.ts`,
// unchanged. A classification is a hint on a screen, but the READ that produces
// it is a store credential fetching a file, and that is the thing M1 got wrong.
// ============================================================================
import { z } from "zod";
import { json } from "@/lib/db";
import { sql } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { intakeSourceKind } from "@/lib/intake-source-types";
import { readTrustedBlob, UntrustedBlobError } from "@/lib/blob-source";
import { prepareDocumentSource } from "@/lib/intake-source";
import { classifyDocument, KIND_FROM_GENRE } from "@/lib/document-classify";

export const maxDuration = 60;

// Well under the extraction ceiling: this reads a cover page, and a document
// too large to classify is one somebody can declare in a dropdown.
const MAX_BYTES = 20 * 1024 * 1024;

const Body = z
  .object({
    projectId: z.string().uuid(),
    pathname: z.string().trim().min(1).max(1024),
    filename: z.string().trim().min(1).max(400),
    contentType: z.string().trim().max(200).optional().default(""),
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
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: issue?.message ?? "That request is not valid." }, 400);
  }
  const input = parsed.data;

  const project = await sql`select id from projects where id = ${input.projectId}`;
  if (!project[0]) return json({ ok: false, error: "No such project." }, 404);

  const kind = intakeSourceKind(input.filename, input.contentType);
  if (kind === "unsupported") {
    return json({ ok: false, error: `"${input.filename}" is not a supported document.` }, 400);
  }
  // AN .eml NEEDS NO MODEL CALL. A saved email is unambiguously an email, and
  // paying to be told so would be the filename hint with a bill attached.
  if (kind === "eml") {
    return json(
      {
        ok: true,
        genre: "email",
        decision: KIND_FROM_GENRE.email,
        titleText: null,
        evidence: "a saved email file",
        certain: true,
        charged: false,
      },
      200,
    );
  }

  let blob;
  try {
    blob = await readTrustedBlob(input.pathname, input.projectId, { maxBytes: MAX_BYTES });
  } catch (cause) {
    if (cause instanceof UntrustedBlobError) return json({ ok: false, error: cause.message }, 400);
    throw cause;
  }

  let source;
  try {
    source = await prepareDocumentSource(blob.bytes, input.filename, blob.contentType || input.contentType);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, 400);
  }

  const result = await classifyDocument(source);
  // 200 EITHER WAY, like a failed dispatch on a registration. Not knowing what
  // a document is leaves the dropdown empty and a person sets it, which is
  // exactly where this app was before; failing the request would make the whole
  // upload look broken over a hint.
  if (!result.ok) return json({ ok: true, genre: "unclear", decision: null, error: result.error, charged: true }, 200);

  return json(
    {
      ok: true,
      genre: result.genre,
      decision: result.decision,
      titleText: result.titleText,
      evidence: result.evidence,
      certain: result.certain,
      charged: true,
    },
    200,
  );
}
