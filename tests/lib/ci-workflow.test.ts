// CI runs the database tier (audit H1, 2026-11-06).
//
// The workflow ran `npm test` with no DATABASE_URL, so every db-tier file
// skipped behind a green tick, on `staging` and on a `main` that does not
// exist, and never on `pilot`. Nothing here can run GitHub Actions; what it
// CAN hold is the shape that makes the tier run, so that a later edit which
// drops the database job, the seed, or the pilot trigger fails here rather
// than going green again in silence. And `ciStackEnv` is the half of the CI
// run that is code, held directly.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CI_STRIPPED, ciStackEnv } from "../../tools/localstack/ci-env.mjs";

// js-yaml is already installed (eslint's), and parsing is also the check that
// the file IS valid YAML, which nothing else here can run.
const requireHere = createRequire(import.meta.url);
const yaml = requireHere("js-yaml") as { load(text: string): unknown };

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = {
  "runs-on": string;
  env?: Record<string, string | undefined>;
  services?: Record<string, { image: string; env?: Record<string, string> }>;
  steps: Step[];
};
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job>; permissions?: unknown };

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const ciText = read(".github/workflows/ci.yml");
const ci = yaml.load(ciText) as Workflow;

function runLines(job: Job): string[] {
  return job.steps.flatMap((s) => (s.run ? s.run.split("\n").map((l) => l.trim()).filter(Boolean) : []));
}

function jobRunning(command: string): Job {
  const found = Object.values(ci.jobs).filter((job) => runLines(job).some((line) => line.includes(command)));
  expect(found, `exactly one job runs ${command}`).toHaveLength(1);
  return found[0]!;
}

describe("ci.yml triggers", () => {
  it("runs on a push to staging and to pilot, and on pull requests, and names no main", () => {
    const push = ci.on.push as { branches: string[] };
    expect([...push.branches].sort()).toEqual(["pilot", "staging"]);
    expect(ci.on).toHaveProperty("pull_request");
    expect(ciText).not.toMatch(/\bmain\b/);
  });
});

describe("ci.yml database job", () => {
  // Found inside each test, so a missing job fails every test by name rather
  // than the whole file at collection.
  const job = () => jobRunning("tools/localstack/ci.mjs");

  it("migrates, then seeds, then runs the whole suite through the local stack, in that order", () => {
    const lines = runLines(job());
    const at = (command: string) => lines.findIndex((line) => line.startsWith(command));
    const migrate = at("node db/run-migrations.mjs");
    const seed = at("node db/run-seed.mjs");
    const suite = at("node tools/localstack/ci.mjs");
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(seed).toBeGreaterThan(migrate);
    expect(suite).toBeGreaterThan(seed);
  });

  it("passes no flag that unlocks pilot or production, anywhere in the workflow", () => {
    expect(ciText).not.toMatch(/--yes-(pilot|production)/);
  });

  it("declares the local stack's three on the job, with a localhost database", () => {
    const env = job().env ?? {};
    expect(env.LOCAL_STACK).toBe("1");
    expect(env.APP_ENV).toBe("development");
    expect(env.DATABASE_ENVIRONMENT).toBe("sandbox");
    expect(new URL(env.DATABASE_URL ?? "").hostname).toBe("localhost");
  });

  it("has a Postgres service on the same major as Neon's (17)", () => {
    const images = Object.values(job().services ?? {}).map((s) => s.image);
    expect(images).toContain("postgres:17");
  });

  it("gives the suite no Anthropic key", () => {
    expect(ciText).not.toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe("ci.yml fast job", () => {
  it("still lints, typechecks, tests and builds, with no database", () => {
    const job = jobRunning("npm run build");
    expect(runLines(job)).toEqual(
      expect.arrayContaining(["npm ci", "npm run lint", "npm run typecheck", "npm test", "npm run build"]),
    );
    expect(job.services).toBeUndefined();
    expect(job.env?.DATABASE_URL).toBeUndefined();
  });
});

describe("ciStackEnv", () => {
  const base = {
    PATH: "/bin",
    LOCAL_STACK: "1",
    APP_ENV: "development",
    DATABASE_ENVIRONMENT: "sandbox",
    DATABASE_URL: "postgres://invented@localhost:5432/invented_ci",
  };
  const fixedDir = () => "/tmp/invented-blob-dir";

  it("refuses anything but a local-stack environment", () => {
    expect(() => ciStackEnv({ ...base, DATABASE_URL: "postgres://u@ep-invented.eu-west-2.aws.neon.tech/db" }, { makeBlobDir: fixedDir })).toThrow(/not localhost/);
    expect(() => ciStackEnv({ ...base, LOCAL_STACK: undefined }, { makeBlobDir: fixedDir })).toThrow(/LOCAL_STACK/);
    expect(() => ciStackEnv({ ...base, APP_ENV: "staging" }, { makeBlobDir: fixedDir })).toThrow(/development/);
  });

  it("takes out every key that spends money or reaches a company system", () => {
    const loaded = Object.fromEntries(CI_STRIPPED.map((key) => [key, "__qa-not-a-secret"]));
    const env = ciStackEnv({ ...base, ...loaded }, { makeBlobDir: fixedDir });
    for (const key of CI_STRIPPED) expect(env, key).not.toHaveProperty(key);
    expect(CI_STRIPPED).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "VERIFY_MODEL"]));
  });

  it("points the Blob SDK at the port the server will listen on, overriding a stale URL", () => {
    const env = ciStackEnv(
      { ...base, LOCAL_STACK_PORT: "3111", VERCEL_BLOB_API_URL: "http://127.0.0.1:3101/api" },
      { makeBlobDir: fixedDir },
    );
    expect(env.VERCEL_BLOB_API_URL).toBe("http://127.0.0.1:3111/api");
    expect(env.NEXT_PUBLIC_VERCEL_BLOB_API_URL).toBe("http://localhost:3111/api");
    expect(ciStackEnv(base, { makeBlobDir: fixedDir }).VERCEL_BLOB_API_URL).toBe("http://127.0.0.1:3101/api");
  });

  it("makes a store directory only when none is named", () => {
    let made = 0;
    const makeBlobDir = () => {
      made += 1;
      return "/tmp/invented-made";
    };
    expect(ciStackEnv(base, { makeBlobDir }).LOCAL_BLOB_DIR).toBe("/tmp/invented-made");
    expect(ciStackEnv({ ...base, LOCAL_BLOB_DIR: "/tmp/invented-named" }, { makeBlobDir }).LOCAL_BLOB_DIR).toBe(
      "/tmp/invented-named",
    );
    expect(made).toBe(1);
  });

  it("never carries a blob token that is not the local stack's", () => {
    const real = ciStackEnv({ ...base, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_invented_secret" }, { makeBlobDir: fixedDir });
    expect(real.BLOB_READ_WRITE_TOKEN).toMatch(/^vercel_blob_rw_localstack_[0-9a-f]{32}$/);
    const local = ciStackEnv({ ...base, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_localstack_kept" }, { makeBlobDir: fixedDir });
    expect(local.BLOB_READ_WRITE_TOKEN).toBe("vercel_blob_rw_localstack_kept");
  });

  it("demands the database tier and disables mail, whatever the base said", () => {
    const env = ciStackEnv({ ...base, EMAIL_MODE: "live", MAIL_INGESTION_MODE: "graph" }, { makeBlobDir: fixedDir });
    expect(env.REQUIRE_DB_TESTS).toBe("1");
    expect(env.EMAIL_MODE).toBe("disabled");
    expect(env.MAIL_INGESTION_MODE).toBe("disabled");
    expect(env.AUTH_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Pilot only ever fast-forwards to a commit already on staging (audit H10).
// The job checks it; branch protection (docs/environments.md) enforces it.
describe("pilot-is-ancestor.yml", () => {
  const text = read(".github/workflows/pilot-is-ancestor.yml");
  const workflow = yaml.load(text) as Workflow;

  it("runs on a push to pilot and on a daily schedule", () => {
    expect((workflow.on.push as { branches: string[] }).branches).toEqual(["pilot"]);
    const schedule = workflow.on.schedule as { cron: string }[];
    expect(schedule).toHaveLength(1);
    // minute hour * * *: once a day.
    expect(schedule[0]!.cron).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("asks git whether pilot is an ancestor of staging, after fetching full history", () => {
    const job = Object.values(workflow.jobs)[0]!;
    const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    const script = runLines(job).join("\n");
    expect(script).toContain('git merge-base --is-ancestor "$pilot" "$staging"');
    expect(script).toContain("exit 1");
  });

  it("can only read the repository", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });
});

// The step's own shell, run against a scratch repository with an `origin`,
// so the sentence and the exit code are what a real breach would produce.
describe("pilot-is-ancestor.yml, its script run against a scratch repository", () => {
  const workflow = yaml.load(read(".github/workflows/pilot-is-ancestor.yml")) as Workflow;
  const job = Object.values(workflow.jobs)[0]!;
  const script = job.steps.find((s) => s.run?.includes("merge-base"))!.run!;

  function scratch() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pilot-ancestor-"));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GIT_AUTHOR_NAME: "qa", GIT_AUTHOR_EMAIL: "qa@invalid", GIT_COMMITTER_NAME: "qa", GIT_COMMITTER_EMAIL: "qa@invalid" },
      }).trim();
    const origin = path.join(dir, "origin.git");
    const work = path.join(dir, "work");
    execFileSync("git", ["init", "--bare", "-q", origin]);
    execFileSync("git", ["clone", "-q", origin, work]);
    const commit = (message: string) => {
      git(work, "commit", "-q", "--allow-empty", "-m", message);
      return git(work, "rev-parse", "HEAD");
    };
    const run = () =>
      spawnSync("bash", ["-e", "-c", script], { cwd: work, encoding: "utf8" });
    return { dir, git, work, commit, run };
  }

  it("passes when pilot is behind staging, and fails naming both SHAs when it is not on it", () => {
    const repo = scratch();
    try {
      repo.git(repo.work, "checkout", "-q", "-b", "staging");
      const first = repo.commit("one");
      repo.git(repo.work, "push", "-q", "origin", `${first}:refs/heads/pilot`);
      const second = repo.commit("two");
      repo.git(repo.work, "push", "-q", "origin", "staging");

      const ok = repo.run();
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.stdout).toContain(`pilot (${first}) is on staging (${second}).`);

      // A commit made on pilot alone.
      repo.git(repo.work, "checkout", "-q", "-b", "pilot-only", first);
      const stray = repo.commit("only on pilot");
      repo.git(repo.work, "push", "-q", "-f", "origin", `${stray}:refs/heads/pilot`);

      const bad = repo.run();
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain(`pilot is at ${stray}, which is not on staging (${second})`);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});
