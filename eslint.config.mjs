import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Agent worktrees under .claude/ carry their own copy of the source, so
    // linting them reports every rule twice and a coder's half-finished file as
    // this repo's error -- 149 of them on 2026-09-19. vitest.config.ts already
    // excludes the same path for the same reason.
    //
    // The skills under .claude/skills and .agents/ are procedures with their
    // own helper scripts, some installed by a tool and none of them app code:
    // four warnings in them were the whole of what `--max-warnings=0` found on
    // 2026-11-16, and `neon.ts` is a tool's scratch file at the root.
    ignores: [
      "Reference/**",
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      ".claude/worktrees/**",
      ".claude/skills/**",
      ".agents/**",
      "neon.ts",
    ],
  },
];

export default eslintConfig;
