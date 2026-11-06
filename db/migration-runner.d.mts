// Types for db/migration-runner.mjs (plain `.mjs`, run by node from the CLI).
import type pg from "pg";

export type MigrationRun = {
  applied: string[];
  skipped: string[];
  /** Applied files whose text no longer matches the checksum recorded when they ran. */
  warnings: string[];
};

export function runMigrations(options: {
  client: Pick<pg.Client, "query">;
  dir: string;
  log?: (line: string) => void;
}): Promise<MigrationRun>;
