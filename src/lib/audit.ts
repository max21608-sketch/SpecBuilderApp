// Every mutating query should set updated_by (and created_by on insert) to
// the acting user's email as a plain column value, rather than relying on a
// session-scoped `SET LOCAL app.user` GUC — Neon's HTTP driver issues one
// query per call, so a prior SET LOCAL wouldn't survive to reach the actual
// mutation. write_audit()'s trigger (see db/migrations/0002) falls back to
// reading updated_by/created_by when the GUC isn't set, so this is all that's
// needed for audit_log.changed_by to be populated correctly.
export function actorEmail(user: { email: string } | null): string | null {
  return user?.email ?? null;
}
