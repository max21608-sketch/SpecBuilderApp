// Which stored files nothing in the database names (audit 5.4 A10, 2026-11-06).
//
// Files are left behind by design in three places, each the lesser failure:
// a duplicate upload refused after its bytes were stored, a Graph copy raced
// by a second delivery, and an assignment the cap refused after the copy.
// `deleteProjectRows` also deletes a project's files AFTER its commit, so a
// failed blob delete leaves the whole folder. None is ever read; nothing listed
// them. This decides, purely, which stored paths no row names. Deleting them is
// a later decision and this module offers no way to.
//
// `attachments.storage_path` and `email_messages.mailbox_storage_path` are the
// only COLUMNS that name a stored file (read off information_schema on the
// local stack, 2026-11-06), and a staged document's JSON names more: a bill's
// row pictures live in `intake_runs.parsed` until its confirm files them. The
// tool gathers all three. A stored row may be a full store URL; it is read as
// its pathname, the `project-delete.mjs` rule.

/** The prefixes this app writes under. Anything else in the store is not ours to judge. */
export const APP_PREFIXES = ["projects/", "mailbox/"] as const;

const PROJECT_OF = /^projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

export function storedPathname(stored: string): string {
  return String(stored).replace(/^https?:\/\/[^/]+\//i, "").replace(/^\/+/, "");
}

export type Orphan = { path: string; why: "no row names it" | "its project no longer exists" };

export function findOrphans(input: {
  stored: readonly string[];
  named: readonly string[];
  projectIds: readonly string[];
}): { orphans: Orphan[]; checked: number } {
  const named = new Set(input.named.map(storedPathname));
  const projects = new Set(input.projectIds.map((id) => id.toLowerCase()));
  const ours = input.stored.map(storedPathname).filter((path) => APP_PREFIXES.some((prefix) => path.startsWith(prefix)));
  const orphans: Orphan[] = [];
  for (const path of [...ours].sort()) {
    if (named.has(path)) continue;
    const project = PROJECT_OF.exec(path)?.[1]?.toLowerCase() ?? null;
    orphans.push({ path, why: project !== null && !projects.has(project) ? "its project no longer exists" : "no row names it" });
  }
  return { orphans, checked: ours.length };
}
