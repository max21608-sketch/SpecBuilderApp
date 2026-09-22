import { defineConfig } from "vitest/config";
import path from "node:path";

// ============================================================================
// HOW TO RUN THIS SUITE ON A SHARED MACHINE, AS A KNOB RATHER THAN AS ADVICE.
//
// Two unbounded runs on this repo are sixteen forks on eight CPUs, and the
// COMPONENT tier then fails 5s bounds that pass alone in about three
// (found-in-use 2026-09-21). The rule written down for that was "a second
// concurrent `checks` should carry `--maxWorkers=4`", and THAT FLAG DOES NOT
// WORK HERE: vitest 2.1 leaves `minWorkers` at the CPU count, tinypool refuses
// `minThreads > maxThreads` with `RangeError: options.minThreads and
// options.maxThreads must not conflict`, and the run executes ZERO tests while
// exiting non-zero. Advice that cannot be followed is worse than none, so the
// cap lives here, where both ends are set together and cannot conflict.
//
//   VITEST_MAX_FORKS=4 npm run checks     (or `npm run checks:shared`)
//
// Unset is the default and is UNCAPPED, because the common case is one agent
// on the machine and a permanent cap would make the primary path slower to
// protect the secondary one.
//
// The equivalent flags, for a one-off run where an env var is awkward:
//   --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=4
//   --minWorkers=1 --maxWorkers=4
// Both work; `--maxWorkers=4` on its own does not.
// ============================================================================
const maxForks = Number(process.env.VITEST_MAX_FORKS);
const forkCap =
  Number.isInteger(maxForks) && maxForks > 0
    ? { poolOptions: { forks: { minForks: 1, maxForks } } }
    : {};

export default defineConfig({
  test: {
    ...forkCap,
    environment: "node",
    // Agent worktrees under .claude/ carry their own copy of tests/, and the
    // "@" alias below resolves to THIS repo's src -- so without this exclude a
    // stale worktree's old expectations run against current source and report
    // failures that do not exist.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "**/.claude/**"],
    // THE FOURTH TIER. pure / db-gated / route were a convention this file said
    // nothing about; the component tier has to be configured, because it needs
    // a DOM and the other three do not.
    //
    // Scoped by PATH rather than by a per-file `@vitest-environment` docblock:
    // a docblock is one line a new test file can forget, and forgetting it
    // produces "document is not defined" rather than a useful failure. The
    // environment and the setup file arrive together with the directory.
    environmentMatchGlobs: [["tests/components/**", "jsdom"]],
    setupFiles: ["tests/setup/components.ts"],
  },
  // `tsconfig.json` sets `jsx: "preserve"` because Next does its own transform.
  // Vitest has no Next pipeline, so it needs to be told to compile JSX, and
  // `automatic` is the runtime React 19 uses -- no `import React` in any file.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
