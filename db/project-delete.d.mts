// Types for db/project-delete.mjs, which is plain `.mjs` so a node script
// (tools/qa-clean.mjs) and tsx scripts and tests can share one implementation.
import type pg from "pg";

type Queryable = Pick<pg.Client, "query">;

export type TableCount = {
  table: string;
  rows: number;
  /** The count, as run, so a caller can ask again after the delete. */
  countSql: string;
  values: unknown[];
};

export type ProjectDeletionPlan = {
  project: { id: string; bws_project_number: string; name: string };
  counts: TableCount[];
  /** Store pathnames under `projects/<id>/` the database records. */
  blobPaths: string[];
  /** Messages on the project whose arrival record is elsewhere: they survive, unassigned. */
  messagesKept: number;
  entityIds: string[];
};

export const OWNED_TABLES: string[];
export const POLYMORPHIC_TABLES: string[];
export function projectPrefix(projectId: string): string;
export function planProjectDeletion(client: Queryable, projectId: string): Promise<ProjectDeletionPlan>;
export function deleteProjectRows(
  client: Queryable,
  projectId: string,
  options?: { actor?: string },
): Promise<ProjectDeletionPlan>;
