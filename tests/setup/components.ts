// Component tier setup: the DOM matchers, and a clean document between tests.
//
// Loaded only by `tests/components/**`, which is why `vitest.config.ts` keeps
// its default `environment: "node"` -- the pure tier is the bulk of this suite
// and it does not need a DOM, and paying for jsdom on 600 pure tests to serve
// a few dozen component ones is the wrong trade.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
