import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
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
