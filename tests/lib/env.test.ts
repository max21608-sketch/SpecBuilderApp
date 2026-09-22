// The guard that refuses to start, and the label both the chip and the tab
// title read.
//
// `src/lib/env.ts` CACHES its answer, deliberately — it is called on every
// request. So each case here re-imports the module through `vi.resetModules()`
// rather than calling the function twice: without that, the first case's
// answer is the answer every later case gets, and a test asserting a REFUSAL
// would pass because the module had already been frozen by a case that
// succeeded. There is no test-only reset export and this file is the reason
// one is not needed.
//
// What is being protected is one accident per pairing. `production` has been
// guarded since the scaffold. `pilot` arrived on 2026-09-19 (plan 1.16) and is
// Matthew's own data on his own Neon project: a pilot deployment reading the
// sandbox would show him whatever a test run last left there, and a staging
// deployment reading pilot would let an hourly push rewrite his work.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["APP_ENV", "DATABASE_ENVIRONMENT"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

// A fresh module instance per call, so the cache inside it is empty.
async function load(appEnv: string | undefined, databaseEnvironment: string | undefined) {
  vi.resetModules();
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  if (databaseEnvironment === undefined) delete process.env.DATABASE_ENVIRONMENT;
  else process.env.DATABASE_ENVIRONMENT = databaseEnvironment;
  return import("@/lib/env");
}

describe("getEnvironment", () => {
  it("starts on the pairings that are allowed", async () => {
    for (const [appEnv, dbEnv] of [
      ["development", "sandbox"],
      ["staging", "sandbox"],
      ["pilot", "pilot"],
      ["production", "production"],
    ] as const) {
      const env = await load(appEnv, dbEnv);
      expect(env.getEnvironment(), `${appEnv}/${dbEnv}`).toEqual({
        appEnv,
        databaseEnvironment: dbEnv,
      });
    }
  });

  it("refuses a pilot deployment pointed at any other database", async () => {
    for (const dbEnv of ["sandbox", "production"] as const) {
      const env = await load("pilot", dbEnv);
      expect(() => env.getEnvironment(), `pilot/${dbEnv}`).toThrow(/Refusing to start/);
    }
  });

  it("refuses any other deployment pointed at the pilot database", async () => {
    for (const appEnv of ["development", "staging", "production"] as const) {
      const env = await load(appEnv, "pilot");
      expect(() => env.getEnvironment(), `${appEnv}/pilot`).toThrow(/Refusing to start/);
    }
  });

  it("names both variables in the refusal, and no secret", async () => {
    const env = await load("pilot", "sandbox");
    expect(() => env.getEnvironment()).toThrow(/APP_ENV=pilot/);
    expect(() => env.getEnvironment()).toThrow(/DATABASE_ENVIRONMENT=sandbox/);
  });

  // The production rules are unchanged by pilot's arrival, and this is where
  // that is held true rather than assumed.
  it("keeps the production rules exactly as they were", async () => {
    for (const dbEnv of ["sandbox", "pilot"] as const) {
      const prod = await load("production", dbEnv);
      expect(() => prod.getEnvironment(), `production/${dbEnv}`).toThrow(/Refusing to start/);
    }
    for (const appEnv of ["development", "staging", "pilot"] as const) {
      const other = await load(appEnv, "production");
      expect(() => other.getEnvironment(), `${appEnv}/production`).toThrow(/Refusing to start/);
    }
  });

  it("refuses an unset or unrecognised value before it compares anything", async () => {
    const unset = await load(undefined, "sandbox");
    expect(() => unset.getEnvironment()).toThrow(/APP_ENV is not set to a recognized value/);

    const unknownDb = await load("pilot", "pilot-2");
    expect(() => unknownDb.getEnvironment()).toThrow(/DATABASE_ENVIRONMENT is not set to a recognized value/);
  });

  it("lists pilot among the recognised values it names in the message", async () => {
    const unset = await load(undefined, undefined);
    expect(() => unset.getEnvironment()).toThrow(/development, staging, pilot, production/);
  });
});

describe("isProduction", () => {
  // Pilot carries real work and is NOT production: no production
  // authorization applies to it, and every non-production behaviour — the
  // chip, the title marker, the chase email's redirect to the signed-in user
  // — has to stay on.
  it("is false on pilot", async () => {
    const env = await load("pilot", "pilot");
    expect(env.isProduction()).toBe(false);
    expect(env.currentAppEnvIsProduction()).toBe(false);
  });

  it("is true only on production", async () => {
    const env = await load("production", "production");
    expect(env.isProduction()).toBe(true);
  });
});

describe("isSandboxDatabase", () => {
  it("is false on pilot — pilot is not a sandbox", async () => {
    const env = await load("pilot", "pilot");
    expect(env.isSandboxDatabase()).toBe(false);
  });
});

describe("currentEnvLabel", () => {
  it("names the build the chip and the title both print", async () => {
    for (const [appEnv, label] of [
      ["development", "DEV"],
      ["staging", "STAGING"],
      ["pilot", "PILOT"],
    ] as const) {
      const env = await load(appEnv, undefined);
      expect(env.currentEnvLabel(), appEnv).toBe(label);
    }
  });

  it("returns null in production, so the marker is absent there", async () => {
    const env = await load("production", undefined);
    expect(env.currentEnvLabel()).toBeNull();
  });

  // The marker's whole job is to be present on the deployment somebody has
  // misconfigured, so an unset or unrecognised value must not hide it.
  it("fails toward showing", async () => {
    for (const appEnv of [undefined, "", "Production", "pilot-2"]) {
      const env = await load(appEnv, undefined);
      expect(env.currentEnvLabel(), String(appEnv)).toBe("STAGING");
    }
  });

  // It reads APP_ENV directly and never calls getEnvironment(), because a
  // throw here would take down the render it is decorating.
  it("never throws on a mismatched pair", async () => {
    const env = await load("pilot", "sandbox");
    expect(env.currentEnvLabel()).toBe("PILOT");
  });
});

// ============================================================================
// SAYING SO RATHER THAN DYING OF IT
//
// The pilot deployment of 2026-09-19 served its sign-in page with the right
// chip and answered the sign-in POST with a bodyless 500, because the pair was
// checked only when `db.ts` was first called. These two are what the middleware
// and the sign-in page ask instead, so a mismatch is visible before anybody
// types a password.
// ============================================================================
describe("environmentProblem", () => {
  it("is null when the pair is allowed, and never throws when it is not", async () => {
    const fine = await load("staging", "sandbox");
    expect(fine.environmentProblem()).toBeNull();
    expect(fine.environmentProblemMessage()).toBeNull();

    const broken = await load("pilot", "sandbox");
    expect(() => broken.environmentProblem()).not.toThrow();
    expect(broken.environmentProblem()).toMatch(/Refusing to start/);
  });

  it("names both variables on a non-production build, so the reason is on the screen", async () => {
    const env = await load("pilot", "sandbox");
    const message = env.environmentProblemMessage() ?? "";
    // The generic half tells an administrator what to do; the detail tells them
    // which of the two to change, which is the half that was missing.
    expect(message).toContain("APP_ENV and DATABASE_ENVIRONMENT");
    expect(message).toContain("APP_ENV=pilot");
    expect(message).toContain("DATABASE_ENVIRONMENT=sandbox");
  });

  it("withholds the detail on production, and still says what is wrong", async () => {
    const env = await load("production", "sandbox");
    const message = env.environmentProblemMessage() ?? "";
    expect(message).toBe(env.ENVIRONMENT_MISCONFIGURED);
    expect(message).not.toContain("DATABASE_ENVIRONMENT=sandbox");
  });

  it("reports an UNSET pair too, which is the same accident one step earlier", async () => {
    const env = await load(undefined, undefined);
    expect(env.environmentProblemMessage()).toMatch(/APP_ENV is not set to a recognized value/);
  });
});
