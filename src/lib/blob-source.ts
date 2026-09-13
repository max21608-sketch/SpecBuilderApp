// The trust boundary around the private blob store.
//
// ============================================================================
// THE DEFECT THIS EXISTS TO CLOSE
//
// M1's /api/imports took a `url` from the REQUEST BODY and fetched it with
//
//     headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
//
// A signed-in user could point that anywhere. The server would then attach a
// store-wide read/write credential to a request at an attacker-chosen host and
// hand it over. Nothing about being signed in makes that safe: the token is not
// the user's, it is the store's.
//
// THE FIX IS NOT A BETTER URL CHECK. It is never accepting a URL at all.
//
// A blob is addressed by its PATHNAME, which the store resolves against its own
// host from the token. There is no host for a client to influence, so there is
// no redirect to follow and nothing to allowlist. The client tells us WHICH
// file it uploaded; it never tells us WHERE to go and get it.
//
// A pathname is still client-supplied, so it is scoped: every upload lands
// under `projects/<projectId>/`, the upload token refuses to sign anything
// else, and registration re-checks the same prefix against the project it was
// given. One project's user cannot register another project's document, and a
// pathname outside the prefix is not a blob this app ever wrote.
// ============================================================================
import { get, head } from "@vercel/blob";

/** Everything this app uploads lives under its project. Nothing else is readable. */
export function projectUploadPrefix(projectId: string): string {
  return `projects/${projectId}/`;
}

export class UntrustedBlobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UntrustedBlobError";
  }
}

/**
 * `storage_path` on an attachment. Written as a pathname from 0006 onward.
 *
 * Tolerant of a stored full URL, because the M1 code wrote one — but ONLY for
 * a Vercel Blob host, and only to recover the pathname from it. A stored value
 * pointing anywhere else is refused rather than fetched: whatever wrote it was
 * not this code path.
 */
export function blobPathname(storagePath: string): string {
  if (!/^https?:\/\//i.test(storagePath)) return storagePath.replace(/^\/+/, "");
  let parsed: URL;
  try {
    parsed = new URL(storagePath);
  } catch {
    throw new UntrustedBlobError("That stored file reference is not readable.");
  }
  if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) {
    throw new UntrustedBlobError("That stored file reference does not point at the document store.");
  }
  return decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
}

/**
 * The scope check. Called at token issue, at registration, and again on every
 * read — three times deliberately, because each is reached by a different route
 * and a check that lives in only one of them is a check the other two skipped.
 */
export function assertProjectScopedPathname(pathname: string, projectId: string): string {
  const clean = pathname.replace(/^\/+/, "");
  if (clean.includes("..") || clean.includes("\\")) {
    throw new UntrustedBlobError("That file reference is not valid.");
  }
  if (!clean.startsWith(projectUploadPrefix(projectId))) {
    throw new UntrustedBlobError("That file does not belong to this project.");
  }
  return clean;
}

export type TrustedBlobMetadata = {
  pathname: string;
  size: number;
  contentType: string;
};

/**
 * Metadata only — no body, no bytes, no model. Registration uses this to check
 * that the file the client claims to have uploaded actually exists, and that
 * its real size and type match what was declared.
 */
export async function headTrustedBlob(pathname: string, projectId: string): Promise<TrustedBlobMetadata> {
  const scoped = assertProjectScopedPathname(pathname, projectId);
  // `head` takes no access option -- metadata is the same call for a public or
  // a private blob; the token is what authorises it.
  const meta = await head(scoped).catch(() => null);
  if (!meta) throw new UntrustedBlobError("That upload could not be found in the document store.");
  return { pathname: scoped, size: meta.size, contentType: meta.contentType };
}

/**
 * The bytes. `maxBytes` is enforced against the STORE's own reported size before
 * anything is downloaded, and again while reading — a store that under-reports
 * must not be able to talk this process into buffering an unbounded file.
 */
export async function readTrustedBlob(
  pathname: string,
  projectId: string,
  options: { maxBytes: number },
): Promise<{ bytes: Buffer; contentType: string; size: number; pathname: string }> {
  const meta = await headTrustedBlob(pathname, projectId);
  if (meta.size > options.maxBytes) {
    throw new UntrustedBlobError(
      `That file is ${(meta.size / 1024 / 1024).toFixed(1)}MB, over the ${(options.maxBytes / 1024 / 1024).toFixed(0)}MB limit for this kind of import.`,
    );
  }

  const result = await get(meta.pathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new UntrustedBlobError("That upload could not be read from the document store.");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > options.maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UntrustedBlobError("That file is larger than the limit for this kind of import.");
    }
    chunks.push(value);
  }

  return {
    bytes: Buffer.concat(chunks),
    contentType: result.blob.contentType || meta.contentType,
    size: total,
    pathname: meta.pathname,
  };
}

/**
 * The reviewer's view of the source document: streamed, never buffered, with
 * range support so a PDF viewer can jump to the page a proposal cites.
 *
 * Returns the store's own response pieces so the route can pass them through.
 * The route authenticates the session and resolves the pathname from the RUN's
 * OWN attachment row; this function never sees a client value.
 */
export async function streamTrustedBlob(
  pathname: string,
  projectId: string,
  options: { range?: string | null } = {},
): Promise<{
  stream: ReadableStream<Uint8Array>;
  // The store's own response headers, so the route can pass through
  // content-range and accept-ranges rather than reconstructing them. Typed
  // loosely because the SDK's Headers come from undici, not the DOM lib.
  headers: { get(name: string): string | null };
  contentType: string;
  size: number;
}> {
  const scoped = assertProjectScopedPathname(pathname, projectId);
  const result = await get(scoped, {
    access: "private",
    ...(options.range ? { headers: { range: options.range } } : {}),
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new UntrustedBlobError("That document could not be read from the store.");
  }
  return {
    stream: result.stream,
    headers: result.headers,
    contentType: result.blob.contentType,
    size: result.blob.size,
  };
}
