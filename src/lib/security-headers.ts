// ============================================================================
// THE HEADERS EVERY RESPONSE CARRIES (audit A9, 2026-11-06). A leaf, read by
// `next.config.ts` at build time and by its test.
//
// THE DEFECT. The app served NDA-covered documents and every review screen
// with no `frame-ancestors`, no referrer policy and no content type policy, so
// another site could frame the drawings review and steer a signed-in reviewer
// onto Confirm (clickjacking), and a document URL travelled to any site a
// reviewer clicked through to in the Referer header.
//
// WHAT IS ENFORCED, because nothing this app does can break it:
//   - `frame-ancestors 'none'` (and `X-Frame-Options: DENY` for anything that
//     predates it): no page here is ever meant to sit inside another one.
//   - `base-uri 'self'` and `object-src 'none'`: no page writes a <base> or
//     embeds a plugin.
//   - `nosniff` everywhere, not only on the byte-serving routes.
//   - `strict-origin-when-cross-origin`: a link out carries the origin, never
//     a path naming a project, a record or an import.
//   - a `Permissions-Policy` that turns off what nothing here uses.
//
// WHAT IS REPORT-ONLY, deliberately: the full policy (`default-src 'self'`
// and the rest). Next's App Router writes its own inline scripts, the
// browser-direct upload talks to the Blob API on another origin, pdfjs runs a
// worker and the crops are `blob:` images. A wrong guess ENFORCED would blank
// a screen on pilot; reported, it shows each violation in the browser console
// while every screen keeps working. It is enforced once a walk of every screen
// reports nothing (the release note says which directives that needs).
// ============================================================================

/** The origin of the Blob API a browser upload talks to: the real one, or the local stack's fake. */
function blobApiOrigins(env: Record<string, string | undefined>): string[] {
  const origins = ["https://vercel.com", "https://*.blob.vercel-storage.com"];
  const configured = env.NEXT_PUBLIC_VERCEL_BLOB_API_URL;
  if (configured) {
    try {
      origins.push(new URL(configured).origin);
    } catch {
      // A malformed value is the upload's problem to report, not this header's.
    }
  }
  return origins;
}

/** The policy to enforce once a walk of every screen reports nothing against it. */
export function fullContentSecurityPolicy(env: Record<string, string | undefined>): string {
  const development = env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // Next's App Router inlines its own bootstrap scripts; a nonce would need
    // middleware to mint one per request. React's dev runtime evaluates code.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    // Tailwind ships a stylesheet, but React writes `style=` attributes.
    "style-src 'self' 'unsafe-inline'",
    // Crops are `blob:` object URLs; a placeholder may be a data URI.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The browser-direct upload goes to the Blob API, not through this app.
    `connect-src 'self' ${blobApiOrigins(env).join(" ")}${development ? " ws:" : ""}`,
    // pdfjs's worker is an emitted same-origin asset; `blob:` covers a bundler
    // that inlines it.
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(env: Record<string, string | undefined>): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    { key: "Content-Security-Policy-Report-Only", value: fullContentSecurityPolicy(env) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];
}
