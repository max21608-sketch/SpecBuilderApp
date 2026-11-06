// ============================================================================
// WHERE AN UPLOAD LIVES, AND NOTHING ELSE (audit G5, 2026-11-06).
//
// The browser builds every upload pathname with `projectUploadPrefix`, and the
// server checks it against the same prefix in `blob-source.ts`. It lived in
// `blob-source.ts`, so seven upload components imported the module that holds
// the store's server SDK (`@vercel/blob`) and its read-with-credential helpers
// into the browser, kept from crashing only by lazy initialisation. A leaf
// with no imports is the one definition both sides read; `blob-source.ts`
// imports it from here, and is now `server-only`.
// ============================================================================

/** Everything this app uploads lives under its project. Nothing else is readable. */
export function projectUploadPrefix(projectId: string): string {
  return `projects/${projectId}/`;
}

/**
 * A client's own filename, made safe to be the LAST SEGMENT of a pathname.
 *
 * The intake upload keeps the name the client gave the document, so a reviewer
 * recognises it in the store, and that is why `assertPathnameShape` cannot be
 * an ASCII allowlist. But a name carrying `#`, `?`, `\`, `/`, a control
 * character or a percent-encoded octet would be cut short or resolved by the
 * URL the store's SDK builds from it (audit A7), so those, and only those,
 * become `_` here, before the browser asks for an upload token. The attachment
 * row still records the name exactly as the client wrote it.
 */
export function pathnameSafeName(name: string): string {
  const safe = name
    // eslint-disable-next-line no-control-regex
    .replace(/[#?\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/%(?=[0-9A-Fa-f]{2})/g, "_")
    .trim();
  return safe === "" || safe === "." || safe === ".." ? "document" : safe;
}
