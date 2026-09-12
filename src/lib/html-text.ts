// Plain-text rendering of an HTML draft body, for the clipboard's
// text/plain flavour (pasting into anything that can't take HTML) and as a
// legacy fallback. Pure string ops -- safe to import from client components.

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" doesn't double-decode
}

export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Cell separators only *between* cells; a row's last </td> falls through
  // to the </tr> newline below.
  s = s.replace(/<\/(?:td|th)>\s*(?=<t[dh])/gi, " | ");
  s = s.replace(/<li\b[^>]*>/gi, "• ");
  s = s.replace(/<\/(?:p|div|tr|table|ul|ol|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
