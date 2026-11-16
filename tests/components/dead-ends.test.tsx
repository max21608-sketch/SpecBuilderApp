// Dead ends say what happened and offer the way on (review 3.4, 2026-11-16).
//
// An unknown /dashboard address rendered Next's bare 404 with no nav bar, a
// throw in the shell itself was a white page, and a record id that does not
// exist was a red "No such record." box with no heading and nothing to press.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RecordPage from "@/app/dashboard/records/[id]/page";
import RootNotFound from "@/app/not-found";
import DashboardNotFound from "@/app/dashboard/not-found";
import GlobalError from "@/app/global-error";
import MissingDashboardPage from "@/app/dashboard/[...missing]/page";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const notFound = vi.hoisted(() => vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "rec-gone" }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/records/rec-gone",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  notFound,
}));

const answer = vi.hoisted(() => ({ value: { ok: false, status: 404, error: "No such record.", data: null } as unknown }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => answer.value }));

beforeEach(() => {
  answer.value = { ok: false, status: 404, error: "No such record.", data: null };
});

function backLink() {
  const link = screen.getByRole("link", { name: "Back to projects" });
  expect(link.getAttribute("href")).toBe("/dashboard/projects");
  return link;
}

describe("a record that does not exist", () => {
  it("has a heading and a link back to the projects", async () => {
    render(<RecordPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "No such record" })).toBeTruthy();
    backLink();
  });

  it("any other failure to load still has a heading, the server's words and the way back", async () => {
    answer.value = { ok: false, status: 500, error: "The database did not answer.", data: null };
    render(<RecordPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "This record could not be loaded" })).toBeTruthy();
    expect(screen.getByText("The database did not answer.")).toBeTruthy();
    backLink();
  });
});

describe("the app-level dead ends", () => {
  it("both not-found files say so and link back to the projects", () => {
    for (const NotFound of [RootNotFound, DashboardNotFound]) {
      const view = render(<NotFound />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/no page at this address/);
      backLink();
      view.unmount();
    }
  });

  it("every unclaimed dashboard address throws Next's notFound", () => {
    expect(() => MissingDashboardPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("global-error exports a component that renders its own document", () => {
    expect(typeof GlobalError).toBe("function");
    const element = GlobalError({ error: new Error("boom"), reset: () => {} });
    expect(element.type).toBe("html");
  });
});
