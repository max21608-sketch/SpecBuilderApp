// Central environment identity + safety check. Every deployment (local,
// staging, production) must explicitly declare APP_ENV and
// DATABASE_ENVIRONMENT; this module refuses to let a disallowed combination
// run (e.g. production code pointed at the sandbox database). Lazily
// evaluated and cached, like db.ts/auth.ts/anthropic.ts, so `next build`
// doesn't require these vars at build time. Edge-safe (no node built-ins) so
// middleware.ts can import it too.

export type AppEnv = "development" | "staging" | "production";
export type DatabaseEnvironment = "sandbox" | "production";

const APP_ENVS: AppEnv[] = ["development", "staging", "production"];
const DATABASE_ENVIRONMENTS: DatabaseEnvironment[] = ["sandbox", "production"];

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

  cached = { appEnv, databaseEnvironment };
  return cached;
}

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
