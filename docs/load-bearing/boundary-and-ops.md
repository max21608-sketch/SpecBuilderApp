# The trust boundary

Load-bearing workflows of the Project Spec Builder: invariants that are not
obvious from reading the code, and that a reasonable-looking change breaks
silently. **Read the named files before changing the behaviour they govern.**
Moved here from `CLAUDE.md` on 2026-11-07 (audit Stage 5.5) unchanged, each
section dated as it was written; `CLAUDE.md` keeps the index. Add to a section
here, and a new one gets an index line there. Add to this file whenever you
discover a constraint the hard way — the entry is worth more than the fix.

### Never fetch a client-supplied URL with a store credential

`src/lib/blob-source.ts`, `src/app/api/uploads/token/route.ts`,
`src/app/api/imports/route.ts`

M1 took a `url` from the request body and fetched it with
`Bearer BLOB_READ_WRITE_TOKEN`. Being signed in did not make that safe — the
token is the store's, not the user's.

The fix is not a better URL check: it is never accepting a URL. A blob is
addressed by **pathname**, which the store resolves against its own host from
the token, so there is no host to influence and no redirect to follow.
Pathnames are scoped to `projects/<projectId>/`, and that scope is checked three
times — at token issue, at registration, and on every read — because a check in
only one of them is a check the other two skipped.

The import type is likewise **declared, never inferred**. A BOQ and an FF&E
schedule are both `.xlsx`; a file extension identifies bytes, not a workflow.

### The write boundary is in every handler, and every byte goes out under one header

`src/lib/route-guards.ts` (`requireWriter`, `requireUuid`), `src/lib/roles.ts`,
`src/middleware.ts`, `src/lib/content-disposition.ts`, `src/lib/picture-types.ts`,
`src/lib/security-headers.ts`, `next.config.ts`, `src/lib/blob-source.ts`
(`assertPathnameShape`), `src/lib/upload-paths.ts` (`pathnameSafeName`),
`src/lib/change-sets.ts` (`verifyEvidence`, `VerifiedEvidence`),
`src/lib/cron-auth.ts`, `src/lib/login-throttle.ts`, `src/lib/error-detail.ts`
(`explainFailure`), `src/lib/return-path.ts`; tests `route-guards`,
`middleware-matcher`, `content-disposition`

Audit Stage 4.1, 2026-11-06. Role was enforced only by a matcher whose
exceptions were prefixes; a swatch was served inline as whatever content type
the uploader declared (a stored script on the app origin for any editor); a
curly apostrophe in a filename threw inside `Headers` and killed every "page
N" link on that document; `%2e%2e` in a pathname beat the project prefix
check because the SDK concatenates and undici resolves it; the login's timing
said whether an account existed; driver error text reached pilot's browsers.

- **Every write handler calls `requireWriter(user)`** after its session check
  (54 files) and **every destructured path id goes through `requireUuid`**
  before SQL (64 files; `abc` was a non-JSON 500). `tests/lib/route-guards.test.ts`
  reads every route file and fails on a handler that forgets either; its four
  exemptions (login, logout, the queue consumer, the Graph webhook) are named
  there with their reasons.
- **`Headers` THROWS on a character above U+00FF**, so a `Content-Disposition`
  is always `contentDisposition(kind, name)` — `filename="<ascii>";
  filename*=UTF-8''<encoded>` — and never hand-written; a grep test holds it,
  and the five sanitisers that existed are one. The email `.eml` from
  `/api/imports/[id]/source` is a DOWNLOAD with `nosniff`, not a 404, because
  every provenance link to an email-sourced spec goes through that route.
- **A picture is served inline only when its stored type is on
  `picture-types.ts`**, and on write the type and size come from the store
  (`headTrustedBlob`), never the request; anything else stored under an old
  row is served as a download. **Evidence is HEADed before the transaction**
  and `attachEvidence` accepts only the `VerifiedEvidence` brand, so a route
  that skips the HEAD does not compile; a missing blob is refused after the
  project check, so the refusal cannot probe another project's files.
- **A pathname is refused for what a URL parser would do with it**: a
  percent-encoded octet, `?`, `#`, `\`, a control character, an empty, `.` or
  `..` segment. It is NOT an ASCII allowlist: a client's document keeps its
  own name in the store (`Ronnie Scott’s – Drawings.pdf`), and an allowlist
  would make it unreadable by its own project. New uploads replace those
  characters before asking for a token; a row uploaded before with `#` or `?`
  in its name is now refused "not valid" rather than read as a wrong path.
- **A failure's raw text reaches a browser only when `APP_ENV=development`.**
  Elsewhere it is the app's own sentence, or a sentence plus a reference the
  log holds (`explainFailure`). Pilot holds real data and was treated as
  non-production here.
- **Login always costs one scrypt** (an unknown or inactive account is
  checked against a hash no password matches). Ten failures per email or per
  IP within 15 minutes lock that key for 60 seconds (429, the wait in words
  and in `Retry-After`), in memory per instance — the header says what that
  does not stop. `?from=` is honoured after sign-in only for a path under
  `/dashboard`.
- **A phase retire or restore and a level set carry the version the screen
  showed** (`phase_version_stale`, `level_stale`; the drawings card's
  `ResolvedRecord` carries each record's version). `POST /api/projects` is
  one insert with `on conflict do nothing`, a 409 in words, its fields
  length-capped. Cron secrets compare in constant time and fail closed when
  unset; the Graph validation echo carries `nosniff` and a length cap.
- **Security headers.** Enforced: `Content-Security-Policy: frame-ancestors
  'none'; base-uri 'self'; object-src 'none'`, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal
  `Permissions-Policy`. The FULL policy ships Report-Only until a browser
  walk shows no violations (the bill upload's direct PUT to the blob origin,
  the pdfjs worker and crops, record pictures are the places to look); the
  recommended enforced form is in `security-headers.ts`'s header. Dropping
  `'unsafe-inline'` from `script-src` needs a per-request nonce minted in the
  middleware.
