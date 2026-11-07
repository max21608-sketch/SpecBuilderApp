// Shared preflight for the db/*.mjs scripts. src/lib/env.ts guards the
// application against a mismatched environment, but these scripts read only
// DATABASE_URL -- so a mistyped --env-file pointed the migration runner at
// production with no warning, at exactly the moment that matters (promoting a
// migration by hand). This makes the target environment explicit and loud, and
// makes touching production a deliberate act.
//
// DATABASE_ENVIRONMENT is a declaration, not a probe: it says which database
// the operator BELIEVES DATABASE_URL points at. It cannot verify that. Printing
// the resolved host alongside it is what lets a human catch a mismatch.
//
// PILOT IS GUARDED THE SAME WAY, AND FOR THE SAME REASON (2026-09-19, plan
// 1.16). It holds Matthew's own work, not test data somebody can re-seed, and
// the accident is exactly the one --yes-production was written for: a local
// `npm run db:migrate` with a mistyped --env-file, run while switching between
// sandbox and pilot in one sitting, lands on his data. So pilot names its own
// env file and its own flag:
//
//   node --env-file=.env.pilot.local db/run-migrations.mjs --yes-pilot
//
// Production's flag does NOT cover pilot and pilot's does not cover
// production: a flag that stood for "any protected environment" would let
// somebody who meant one reach the other.
const DATABASE_ENVIRONMENTS = ["sandbox", "pilot", "production"];

// environment -> the flag that has to be typed before anything is written.
// Sandbox has none: it is the one that exists to be thrown away.
const GUARDED = {
  production: "--yes-production",
  pilot: "--yes-pilot",
};

// ============================================================================
// THE HOST IS CHECKED AGAINST THE DECLARATION (audit 5.4 A7, 2026-11-06).
//
// The declaration cannot verify itself, and the printed host is how a person
// catches a wrong one. The accident this table exists for is the one
// `.env.example` and docs/environments.md warn about: `neon link` or `neon
// deploy` without --no-env-pull REWRITES DATABASE_URL in an env file whose
// DATABASE_ENVIRONMENT still says sandbox, and the next `db:*` run writes to
// whatever Neon project the CLI picked. A host this table knows refuses a
// declaration that does not own it.
//
// THE NEON HOSTS ARE NOT IN THIS REPO YET. docs/environments.md names the
// projects (`SpecBuilder`, `SpecBuilder Pilot`) and never their endpoint
// hosts, so the two lists below are empty until Max copies each project's
// endpoint host (`ep-…`, the direct one; the pooler is folded onto it) out of
// the Neon console. An empty list is UNCHECKED, said on the Target line,
// never a refusal of everything. What holds today: this machine is the local
// stack, which declares sandbox, and is never pilot or production.
// ============================================================================
export const KNOWN_HOSTS = {
  sandbox: [],
  pilot: [],
  production: [],
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The host without its port and case, a Neon pooler folded onto its endpoint. */
function hostKey(host) {
  const name = String(host)
    .toLowerCase()
    .replace(/^\[(.*)\](?::\d+)?$/, "[$1]")
    .replace(/:\d+$/, "");
  return name.replace(/^([^.]+)-pooler\./, "$1.");
}

/** Null when the host may be the declared environment; otherwise the sentence why not. Pure. */
export function hostRefusal(environment, host, known = KNOWN_HOSTS) {
  const key = hostKey(host);
  if (LOCAL_HOSTS.has(key)) {
    return environment === "sandbox"
      ? null
      : `DATABASE_ENVIRONMENT declares ${environment}, but the host is this machine (${host}). Only the local stack runs here, and it declares sandbox.`;
  }
  for (const [owner, hosts] of Object.entries(known)) {
    if (owner !== environment && hosts.some((entry) => hostKey(entry) === key)) {
      return `DATABASE_ENVIRONMENT declares ${environment}, but ${host} is the ${owner} database. Check which env file this ran with, and whether a Neon CLI command rewrote it.`;
    }
  }
  const mine = known[environment] ?? [];
  if (mine.length > 0 && !mine.some((entry) => hostKey(entry) === key)) {
    return `DATABASE_ENVIRONMENT declares ${environment}, but ${host} is not one of ${environment}'s known hosts (db/script-env.mjs). Check the env file before anything is written.`;
  }
  return null;
}

// ONE GUARD FOR EVERY SCRIPT (audit B9). The tsx backfills each carried an
// inline copy of this function -- six of them, already worded six ways -- so a
// change to the rule (pilot's own flag arrived after most were written) had to
// be remembered six times. They import it now. `usage` is the lines a script
// prints when DATABASE_URL is missing, because "run node db/<file>" is the
// wrong advice for a script whose real entry point is an npm script.
export function requireScriptEnvironment(scriptName, usage = []) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (usage.length === 0) {
      console.error(`DATABASE_URL is not set. Run with: node --env-file=.env.local db/${scriptName}`);
    } else {
      console.error("DATABASE_URL is not set. Run with:");
      for (const line of usage) console.error(`  ${line}`);
    }
    process.exit(1);
  }

  const environment = process.env.DATABASE_ENVIRONMENT;
  if (!DATABASE_ENVIRONMENTS.includes(environment)) {
    console.error(
      `DATABASE_ENVIRONMENT is not set to a recognized value (must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}).`,
    );
    console.error("It must be set in the same env file as DATABASE_URL, so this script knows which database it is about to touch.");
    process.exit(1);
  }

  let host = "unknown host";
  try {
    host = new URL(databaseUrl).host;
  } catch {
    // A malformed URL will fail at connect time with a better message.
  }

  const checked = (KNOWN_HOSTS[environment] ?? []).length > 0 || LOCAL_HOSTS.has(hostKey(host));
  console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})${checked ? "" : "  [host unchecked: none recorded for " + environment + "]"}`);
  const refused = hostRefusal(environment, host);
  if (refused) {
    console.error(refused);
    process.exit(1);
  }

  const flag = GUARDED[environment];
  if (flag && !process.argv.includes(flag)) {
    console.error(`Refusing to run against the ${environment} database without ${flag}.`);
    process.exit(1);
  }

  return { databaseUrl, environment, host };
}

// ============================================================================
// A PASSWORD ON A COMMAND LINE IS READABLE BY EVERY USER ON THE MACHINE.
//
// backup.mjs and restore.mjs ran `pg_dump <url>` and `psql -d <url>` with the
// whole DATABASE_URL as an argument (audit B9), and a process's arguments are
// what `ps` shows anybody, for as long as a dump of a production database
// takes. libpq reads the password from PGPASSWORD when the URL carries none,
// so the URL goes on the command line WITHOUT it and the password goes in the
// child's environment, which only the same user can read.
// ============================================================================

/**
 * The connection URL with its password taken out, and the environment that
 * carries it, for a libpq tool (`pg_dump`, `psql`) run as a child process.
 */
export function pgToolConnection(databaseUrl, baseEnv = process.env) {
  const url = new URL(databaseUrl);
  const password = url.password ? decodeURIComponent(url.password) : "";
  url.password = "";
  const env = { ...baseEnv };
  if (password) env.PGPASSWORD = password;
  return { url: url.toString(), env };
}
