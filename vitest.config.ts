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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
