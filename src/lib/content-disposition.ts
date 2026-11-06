// ============================================================================
// THE ONE Content-Disposition (audit A6, 2026-11-06). A leaf.
//
// THE TRAP. `Headers` takes a ByteString: a header value holding any character
// above U+00FF does not get escaped, it THROWS. Five routes wrote a stored
// filename into `filename="…"` with only quotes, backslashes and CR/LF taken
// out, so the real pack's `Ronnie Scott’s – Drawings.pdf` (a curly apostrophe,
// an en dash) could never be opened from the review: 502 on the source route,
// a bare non-JSON 500 on the email attachment route, and every "page N" link
// into that document dead. A Chinese specification sheet or an emoji in a
// cloth's name does the same.
//
// THE FIX is RFC 6266 with RFC 5987's extended parameter, which every browser
// this app supports reads:
//
//   attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded>
//
// The real name travels in `filename*`; `filename` is for anything that cannot
// read the extended form, and is built by the SAME allowlist the BWS export,
// the check sheet, the costing sheet, the quote and the chase .eml already
// used, which had been written out five times. `asciiFilenamePart` is that
// allowlist, once.
// ============================================================================

/**
 * A name reduced to letters, digits, spaces, `&` and `-`, at most 60
 * characters. Typographic dashes become a hyphen and accents are dropped FIRST,
 * so `Café – Lounge` is `Cafe - Lounge` rather than `Caf  Lounge`. Quotes,
 * backslashes, slashes and control characters never survive it, which is what
 * keeps a client's project name from breaking out of a header.
 */
export function asciiFilenamePart(raw: string, max = 60): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/[^A-Za-z0-9 &-]/g, "")
    .slice(0, max)
    .trim();
}

/** RFC 5987 `value-chars`: `encodeURIComponent` leaves five characters the grammar does not allow. */
function encodeExtended(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const EXTENSION = /\.([A-Za-z0-9]{1,10})$/;

/**
 * The header for serving a stored file. With no name (or a blank one) it is the
 * bare disposition. The full name goes in `filename*` with control characters
 * and path separators removed and cut to 200 characters; the fallback keeps
 * the extension, so a download still opens in the right program.
 */
export function contentDisposition(kind: "inline" | "attachment", name?: string | null): string {
  const real = Array.from(
    String(name ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/]/g, "_")
      .trim(),
  )
    .slice(0, 200)
    .join("");
  if (!real) return kind;

  const extension = EXTENSION.exec(real)?.[1] ?? null;
  const base = extension ? real.slice(0, -(extension.length + 1)) : real;
  const fallback = `${asciiFilenamePart(base) || "download"}${extension ? `.${extension}` : ""}`;
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeExtended(real)}`;
}
