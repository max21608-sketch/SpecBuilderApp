// ============================================================================
// WHAT MAY BE SERVED AS A PICTURE, AND HOW (audit A2, 2026-11-06).
//
// A leaf, so the swatch route, the item picture, the bill row picture and the
// bill line crop (`patchLinePicture`) all read one list.
//
// THE TRAP. A picture route serves its bytes `inline`, and `nosniff` only stops
// a browser GUESSING a type; it does nothing when the type it is TOLD is
// `text/html`. The swatch POST used to store the type the browser declared, so
// an editor could attach a script as a "swatch" and run it, on this app's
// origin, as whoever opened it. Two halves close it, and both are needed:
//
//   - On WRITE, the type comes from the store (`headTrustedBlob`) and must be
//     on this list.
//   - On READ, a stored type that is not on this list is served as plain
//     bytes to download, never inline. Rows written before the write half
//     existed still hold whatever the browser said.
// ============================================================================

export const PICTURE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** The type with its parameters and case dropped: `IMAGE/PNG; q=1` is `image/png`. */
function bareType(type: string | null | undefined): string {
  return String(type ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

export function isPictureContentType(type: string | null | undefined): boolean {
  return PICTURE_CONTENT_TYPES.has(bareType(type));
}

/**
 * The type and disposition a stored picture is served with. Inline only when
 * the stored type is a picture; anything else is `application/octet-stream`
 * as an attachment, so a browser can neither render it nor run it.
 */
export function pictureServing(storedType: string | null | undefined): {
  contentType: string;
  inline: boolean;
} {
  return isPictureContentType(storedType)
    ? { contentType: bareType(storedType), inline: true }
    : { contentType: "application/octet-stream", inline: false };
}
