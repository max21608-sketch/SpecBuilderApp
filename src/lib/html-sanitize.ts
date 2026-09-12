// Allowlist-ish sanitizer for draft email bodies saved from the in-app
// contentEditable editor. This is defense-in-depth for a single-tenant tool
// whose only author is the logged-in user -- it strips the obvious active
// content (scripts, event handlers, javascript:/data: URLs) so a pasted
// snippet can't execute when the body is re-rendered, but it is NOT a
// general-purpose sanitizer for untrusted multi-user input. Must tolerate
// contentEditable's rewritten markup and preserve data-address-block (the
// marker the template's address-replacement anchors on).

const DANGEROUS_ELEMENTS = "script|style|iframe|object|embed|form|link|meta|title";

export function sanitizeEmailHtml(html: string): string {
  let out = html;
  // Comments can hide payloads from the tag passes below.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // Dangerous elements go entirely, content included...
  out = out.replace(new RegExp(`<(${DANGEROUS_ELEMENTS})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, "gi"), "");
  // ...and any stray unpaired open/close tags of the same elements.
  out = out.replace(new RegExp(`</?(?:${DANGEROUS_ELEMENTS})\\b[^>]*>`, "gi"), "");
  // Scrub attributes on the remaining tags: event handlers and script URLs.
  out = out.replace(/<([a-z][a-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (_m, tag: string, attrs: string) => {
    const cleaned = attrs
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(href|src|srcset|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (attr, _name, value: string) => {
        const url = value.replace(/^["']|["']$/g, "").replace(/\s+/g, "").toLowerCase();
        return url.startsWith("javascript:") || url.startsWith("data:") || url.startsWith("vbscript:") ? "" : attr;
      });
    return `<${tag}${cleaned}>`;
  });
  return out;
}
