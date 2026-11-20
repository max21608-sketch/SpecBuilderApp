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

// ============================================================================
// SAYING SO, RATHER THAN DYING OF IT
//
// The guard above is a throw, and a throw inside a route handler is a BODYLESS
// 500. On the first pilot deployment (2026-09-19) that is exactly what it was:
// `/login` rendered with its PILOT chip, `/api/auth/me` answered a clean 401,
// `/` redirected to login — and signing in returned a 500 with no body, because
// the login POST is the first thing on a fresh deployment that touches `db.ts`.
// A person went to look at the database string; the database was fine. The
// deployment looked healthy on every page a signed-out person could reach.
//
// So the two things that meet somebody BEFORE they are signed in — the
// middleware and the sign-in page — ask this instead of finding out by failing.
// It is non-throwing, like the label readers below, and it names variables and
// nothing else: the messages `getEnvironment` throws contain no secret by
// construction, which is what makes them safe to print.
//
// AND IT ASKS ABOUT AUTH_SECRET ON EVERY DEPLOYED BUILD (2026-11-20, production
// hardening H1). `auth.ts` throws when the secret is missing, and the sign-in
// route reached that throw only AFTER the password had been checked: a
// deployment with no AUTH_SECRET took the password, verified it, and answered
// with the bodyless 500 this section exists to prevent. Staging, pilot and
// production need one of at least 32 characters (`npm run hash-password`
// prints 64); development and the local stack set their own and are not asked,
// so a developer is never locked out by a check written for deployments. The
// secret itself is never printed, nor its length.
//
// ON PRODUCTION THE DETAIL IS WITHHELD, for the reason every other environment
// detail is: the generic half already tells an administrator what to do, and
// nobody debugging production is reading the sign-in page for it.
// ============================================================================

/** What a misconfigured deployment says instead of nothing at all. */
export const ENVIRONMENT_MISCONFIGURED =
  "This deployment is not configured correctly, so it cannot reach its database. " +
  "An administrator has to set APP_ENV and DATABASE_ENVIRONMENT to a matching pair and redeploy.";

/** The shortest AUTH_SECRET a deployed build (staging, pilot, production) accepts. */
export const AUTH_SECRET_MIN_LENGTH = 32;

/** What a deployed build with no usable AUTH_SECRET says. */
export const SESSION_SECRET_MISCONFIGURED =
  "This deployment is not configured correctly, so it cannot sign anybody in. " +
  `An administrator has to set AUTH_SECRET to a new random value of at least ${AUTH_SECRET_MIN_LENGTH} characters and redeploy.`;

/** The builds that are deployed somewhere, as opposed to a developer's own machine. */
const DEPLOYED: ReadonlySet<AppEnv> = new Set(["staging", "pilot", "production"]);

type Problem = { sentence: string; detail: string };

function sessionSecretProblem(appEnv: AppEnv): string | null {
  if (!DEPLOYED.has(appEnv)) return null;
  const value = process.env.AUTH_SECRET;
  if (!value) return `AUTH_SECRET is not set on this ${appEnv} deployment.`;
  if (value.length < AUTH_SECRET_MIN_LENGTH) {
    return `AUTH_SECRET on this ${appEnv} deployment is shorter than ${AUTH_SECRET_MIN_LENGTH} characters.`;
  }
  return null;
}

function diagnose(): Problem | null {
  let environment: Environment;
  try {
    environment = getEnvironment();
  } catch (cause) {
    return { sentence: ENVIRONMENT_MISCONFIGURED, detail: cause instanceof Error ? cause.message : String(cause) };
  }
  const secret = sessionSecretProblem(environment.appEnv);
  return secret ? { sentence: SESSION_SECRET_MISCONFIGURED, detail: secret } : null;
}

/**
 * The deployment's own complaint — the environment pair, or a missing or short
 * AUTH_SECRET on a deployed build — or null when there is none.
 *
 * Never throws — that is the whole point of it.
 */
export function environmentProblem(): string | null {
  return diagnose()?.detail ?? null;
}

/**
 * What to show a person, or null when there is nothing wrong. The detail is
 * appended on every build except production.
 */
export function environmentProblemMessage(): string | null {
  const problem = diagnose();
  if (!problem) return null;
  return currentAppEnvIsProduction() ? problem.sentence : `${problem.sentence} ${problem.detail}`;
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
