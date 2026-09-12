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
const DATABASE_ENVIRONMENTS = ["sandbox", "production"];

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

  if (environment === "production" && !process.argv.includes("--yes-production")) {
    console.error("Refusing to run against the production database without --yes-production.");
    process.exit(1);
  }

  return { databaseUrl, environment, host };
}
