// The marker that says which build a screenshot came from.
//
// EnvironmentChip is a server component only in the sense that a server layout
// renders it and passes it in as an element — it is a plain function reading
// `process.env`, with no async and no server-only import, so it renders here
// unchanged. That is itself the property worth having: a client fetch would
// fail toward HIDING the chip on exactly the deployment that matters.
//
// The colour assertions are not decoration. Matthew reports by screenshot,
// staging is pushed to hourly and pilot is not, so two chips reading the same
// word send somebody hunting a defect in code that is not running.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TONE } from "@/components/ui/tone";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.APP_ENV;
});

afterEach(() => {
  if (saved === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = saved;
  vi.resetModules();
});

// `src/lib/env.ts` caches, and the chip's own module holds its colour map, so
// each case takes a fresh instance of both.
async function renderChip(appEnv: string | undefined) {
  vi.resetModules();
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  const { default: EnvironmentChip } = await import("@/components/layout/EnvironmentChip");
  return render(<EnvironmentChip />);
}

describe("the environment chip", () => {
  it("names the build", async () => {
    for (const [appEnv, label] of [
      ["development", "DEV"],
      ["staging", "STAGING"],
      ["pilot", "PILOT"],
    ] as const) {
      const view = await renderChip(appEnv);
      expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("renders nothing at all in production", async () => {
    const view = await renderChip("production");
    expect(view.container).toBeEmptyDOMElement();
  });

  it("fails toward showing when APP_ENV is unset or unrecognised", async () => {
    for (const appEnv of [undefined, "", "Production"]) {
      const view = await renderChip(appEnv);
      expect(screen.getByText("STAGING"), String(appEnv)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("paints PILOT a different colour from STAGING, from tone.ts", async () => {
    const pilot = await renderChip("pilot");
    const pilotClass = screen.getByText("PILOT").className;
    // The tone, not a literal written here: Tailwind's JIT purges a class
    // string it cannot read in source, and an unstyled chip says nothing.
    for (const token of TONE.live.bubble.split(" ")) expect(pilotClass).toContain(token);
    pilot.unmount();

    await renderChip("staging");
    const stagingClass = screen.getByText("STAGING").className;
    expect(stagingClass).toContain("bg-yellow-400");
    expect(stagingClass).not.toContain(TONE.live.bubble.split(" ")[0]);
  });
});
