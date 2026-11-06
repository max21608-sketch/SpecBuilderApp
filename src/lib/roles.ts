// ============================================================================
// WHO MAY WRITE. A leaf with no imports, because the middleware runs on the
// edge runtime and the route guards run on Node, and both read this ONE set.
//
// AN ALLOWLIST, not a `role === "viewer"` denylist. The denylist version
// failed open on the fabric-ordering app: any role string the deny check did
// not recognise (a mis-cased "Viewer", a role added later) got full write
// rights. An allowlist fails closed instead.
//
// Kept in sync with the users_role_check constraint in
// db/migrations/0001_foundation.sql, minus the read-only role. Changing the
// role set means a new migration, not just an edit here.
// ============================================================================
export const WRITER_ROLES: ReadonlySet<string> = new Set(["admin", "editor"]);

export function isWriterRole(role: string | null | undefined): boolean {
  return WRITER_ROLES.has(String(role ?? ""));
}
