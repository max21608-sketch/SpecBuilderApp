// The chase screen opened with no project (review 3.4c, 2026-11-16).
//
// It rendered one red box, "No project selected.", with no heading and no way
// on. A chase is always about one project, so the screen now carries its page
// header (the one h1) and a real link to the projects list, where every row has
// a Chase button.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DraftsPage from "@/app/dashboard/drafts/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/drafts",
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

describe("the chase screen with no project", () => {
  it("has its heading and a link back to the projects list, and asks the server nothing", async () => {
    render(<DraftsPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Chase what is missing" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open the projects list" });
    expect(link.getAttribute("href")).toBe("/dashboard/projects");
    expect(screen.getByText(/press Chase on a project/)).toBeTruthy();
    expect(screen.queryByText("No project selected.")).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
