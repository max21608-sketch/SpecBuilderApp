// Central environment identity + safety check. Every deployment (local,
// staging, pilot, production) must explicitly declare APP_ENV and
// DATABASE_ENVIRONMENT; this module refuses to let a disallowed combination
// run (e.g. production code pointed at the sandbox database). Lazily
// evaluated and cached, like db.ts/auth.ts/anthropic.ts, so `next build`
// doesn't require these vars at build time. Edge-safe (no node built-ins) so
// middleware.ts can import it too.
//
// `pilot` arrived on 2026-09-19 (plan item 1.16): a third PHYSICALLY separate
// deployment -- its own Vercel project, its own Neon project, its own blob
// store -- so Matthew has a stable build with his own data while staging is
// pushed to hourly. It is NOT production: isProduction() stays false for it
// and house/deployment.md still governs what production requires.
//
// The reason it needed a new APP_ENV value at all, rather than a second
// deployment reading `staging`, is one concrete failure: two separate
// deployments whose chips read the same word, so a screenshot from Matthew
// cannot say which build it came from.

export type AppEnv = "development" | "staging" | "pilot" | "production";
export type DatabaseEnvironment = "sandbox" | "pilot" | "production";

const APP_ENVS: AppEnv[] = ["development", "staging", "pilot", "production"];
const DATABASE_ENVIRONMENTS: DatabaseEnvironment[] = ["sandbox", "pilot", "production"];

export type Environment = { appEnv: AppEnv; databaseEnvironment: DatabaseEnvironment };

let cached: Environment | undefined;

function readAppEnv(): AppEnv {
  const value = process.env.APP_ENV;
  if (!APP_ENVS.includes(value as AppEnv)) {
    throw new Error(
      `APP_ENV is not set to a recognized value (must be one of: ${APP_ENVS.join(", ")}).`
    );
  }
  return value as AppEnv;
}

function readDatabaseEnvironment(): DatabaseEnvironment {
  const value = process.env.DATABASE_ENVIRONMENT;
  if (!DATABASE_ENVIRONMENTS.includes(value as DatabaseEnvironment)) {
    throw new Error(
      `DATABASE_ENVIRONMENT is not set to a recognized value (must be one of: ${DATABASE_ENVIRONMENTS.join(", ")}).`
    );
  }
  return value as DatabaseEnvironment;
}

// Validates APP_ENV against DATABASE_ENVIRONMENT and returns both. Throws a
// plain Error (never containing DATABASE_URL or any other secret — only the
// two explicit identifier vars) on an unset or disallowed combination.
//
// Both pairings are checked in BOTH directions, because each direction is a
// different accident: the first is a deployment pointed at the wrong database,
// the second is the wrong deployment pointed at a real one.
export function getEnvironment(): Environment {
  if (cached) return cached;

  const appEnv = readAppEnv();
  const databaseEnvironment = readDatabaseEnvironment();

  if (appEnv === "production" && databaseEnvironment !== "production") {
    throw new Error(
      `Refusing to start: APP_ENV=production but DATABASE_ENVIRONMENT=${databaseEnvironment}. ` +
        `Production must be configured with DATABASE_ENVIRONMENT=production.`
    );
  }
  if (appEnv !== "production" && databaseEnvironment === "production") {
    throw new Error(
      `Refusing to start: APP_ENV=${appEnv} but DATABASE_ENVIRONMENT=production. ` +
        `Only the production deployment may use DATABASE_ENVIRONMENT=production.`
    );
  }
  if (appEnv === "pilot" && databaseEnvironment !== "pilot") {
    throw new Error(
      `Refusing to start: APP_ENV=pilot but DATABASE_ENVIRONMENT=${databaseEnvironment}. ` +
        `The pilot build must be configured with DATABASE_ENVIRONMENT=pilot — it is Matthew's own data, ` +
        `and a pilot deployment reading the sandbox would show him whatever a test run last left there.`
    );
  }
  if (appEnv !== "pilot" && databaseEnvironment === "pilot") {
    throw new Error(
      `Refusing to start: APP_ENV=${appEnv} but DATABASE_ENVIRONMENT=pilot. ` +
        `Only the pilot deployment may use DATABASE_ENVIRONMENT=pilot.`
    );
  }

  cached = { appEnv, databaseEnvironment };
  return cached;
}

// Pilot is NOT production. It carries real work and it is still a test
// deployment: no production authorization applies to it, and every
// non-production behaviour (the chip, the title marker, the chase email's
// redirect to the signed-in user) stays on.
export function isProduction(): boolean {
  return getEnvironment().appEnv === "production";
}

export function isSandboxDatabase(): boolean {
  return getEnvironment().databaseEnvironment === "sandbox";
}

// Non-throwing read of APP_ENV, for cosmetic UI (banner/title) that must
// never crash rendering or `next build` if the var isn't set yet — the real
// enforcement (refusing to run) lives in getEnvironment() above, called from
// middleware.ts and db.ts at request time. Defaults to treating anything
// other than an exact "production" match as non-production, so a missing or
// misconfigured value fails toward showing the sandbox banner, never hiding it.
export function currentAppEnvIsProduction(): boolean {
  return process.env.APP_ENV === "production";
}

// The word the chip and the page title both print, or null in production.
//
// ONE implementation, two callers, for the reason `composeDimensionCell` is
// one: the chip saying PILOT over a tab title reading [STAGING] is a
// screenshot that names two builds. It is non-throwing and FAILS TOWARD
// SHOWING — an unset or unrecognised APP_ENV returns "STAGING" rather than
// null, because the marker's whole job is to be present on the deployment
// somebody has misconfigured.
export function currentEnvLabel(): "DEV" | "STAGING" | "PILOT" | null {
  const value = process.env.APP_ENV;
  if (value === "production") return null;
  if (value === "development") return "DEV";
  if (value === "pilot") return "PILOT";
  return "STAGING";
}
