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

export function requireScriptEnvironment(scriptName) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(`DATABASE_URL is not set. Run with: node --env-file=.env.local db/${scriptName}`);
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

  console.log(`Target: DATABASE_ENVIRONMENT=${environment} (${host})`);

  const flag = GUARDED[environment];
  if (flag && !process.argv.includes(flag)) {
    console.error(`Refusing to run against the ${environment} database without ${flag}.`);
    process.exit(1);
  }

  return { databaseUrl, environment, host };
}
