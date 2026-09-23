// THE COMPONENT TIER'S WALL-CLOCK BOUND MEASURES THE MACHINE, NOT THE CODE.
//
// A test in this tier mounts React into jsdom and awaits `findBy*`. Nothing it
// does is a performance assertion, and nothing it does is bounded by anything
// except how quickly this laptop gets round to the next microtask — so the
// number that fires under contention is a statement about how busy the machine
// was, and a suite that goes red for that teaches people to re-run it rather
// than to read it.
//
// MEASURED (2026-09-23, 8 CPUs, this worktree, the five files below run
// together while a second suite runs alongside):
//
//   quiet                  every test under 650ms, worst file 3.8s
//   one concurrent suite   worst test 2.1s, all 57 pass
//   two concurrent suites  worst test 7.3s, and `failure-surfaces` >
//   plus a typecheck       "says why in words the server never sent" times
//                          out at 5276ms against the 5s default
//
// That last run is the ordinary state of this repo's shared checkout, where
// another agent's `checks` may be going. The failing test renders one page and
// makes two clicks; there is nothing in it to make faster, and SPLITTING THE
// FILE WOULD NOT HELP — the bound that fires is per TEST, and more files under
// saturation is more forks, not fewer.
//
// So the bound is raised, and 20s is the number this repo has already settled
// on twice for exactly this argument: `boq-review-variance.test.tsx`'s own
// 300-line assertion ("catches a hang or an accidental O(n squared) blow-up
// into minutes and nothing else") and `tests/db/db-tier.ts` ("exists to
// distinguish a hung connection from a slow one, not to police performance").
//
// TWO THINGS THIS IS DELIBERATELY NOT.
//
// It is NOT the global default. `vitest.config.ts` stays at 5s for the pure,
// db-gated and route tiers: a pure function that takes five seconds IS the
// finding, and a default of 20s everywhere would hide the next genuinely slow
// test — which is the whole reason this constant is imported file by file and
// is greppable, rather than set once somewhere nobody reads.
//
// And it is NOT the bound for a test that genuinely paints at scale. The three
// 300-line tests in `boq-review-variance.test.tsx` and the one in
// `spec-table-area.test.tsx` keep their own explicit 30s, which wins over this
// one, and they PRINT their elapsed time so the number stays visible.
//
// `npm run checks:shared` (VITEST_MAX_FORKS=4) is the other half and is not a
// substitute: it caps the fork pool for a machine already running a suite, and
// a test that is genuinely close to its bound is still close to it with four
// forks. Both, not either.
export const COMPONENT_TIMEOUT_MS = 20_000;
