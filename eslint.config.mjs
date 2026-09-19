import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Agent worktrees under .claude/ carry their own copy of the source, so
    // linting them reports every rule twice and a coder's half-finished file as
    // this repo's error -- 149 of them on 2026-09-19. vitest.config.ts already
    // excludes the same path for the same reason.
    ignores: ["Reference/**", ".next/**", "node_modules/**", "next-env.d.ts", ".claude/worktrees/**"],
  },
];

export default eslintConfig;
