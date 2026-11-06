// Types for tools/localstack/ci-env.mjs, so the pure tier can hold what it
// builds (`tests/lib/localstack-ci-env.test.ts`). Plain `.mjs` because CI runs
// it under bare `node`.
export const CI_STRIPPED: readonly string[];

export function ciStackEnv(
  base: Record<string, string | undefined>,
  options: { makeBlobDir: () => string },
): Record<string, string | undefined>;
