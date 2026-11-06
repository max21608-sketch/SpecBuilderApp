// Types for db/script-env.mjs, which the node scripts in db/ import as plain
// `.mjs` and the tsx backfills import too.
export function requireScriptEnvironment(
  scriptName: string,
  usage?: string[],
): { databaseUrl: string; environment: "sandbox" | "pilot" | "production"; host: string };

export function pgToolConnection(
  databaseUrl: string,
  baseEnv?: Record<string, string | undefined>,
): { url: string; env: Record<string, string | undefined> };
