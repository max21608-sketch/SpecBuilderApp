// Signing in brings a person back to the page they were on (audit G-follow-up,
// from the 2.3 report, 2026-11-06).
//
// `LoginForm` always pushed `/dashboard`, so neither the session-expired link
// (`/login?from=…`, `api-fetch.ts`) nor the middleware's redirect returned
// anybody to the record they were halfway through. `from` is honoured now, but
// only as a path inside the dashboard: an absolute URL, a protocol-relative
// `//host`, or anything outside `/dashboard` lands on `/dashboard`, because a
// sign-in page that redirects wherever its query string says is an open
// redirect a phishing email can use.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => ({ ok: true, status: 200, data: {} }) }));

const { default: LoginForm } = await import("@/components/auth/LoginForm");

beforeEach(() => push.mockReset());

async function signInWith(returnTo: string | undefined) {
  render(<LoginForm returnTo={returnTo} />);
  await userEvent.type(screen.getByLabelText(/email/i), "a@example.test");
  await userEvent.type(screen.getByLabelText(/password/i), "pw");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm after signing in", () => {
  it("returns to the dashboard page the person was on, with its query", async () => {
    await signInWith("/dashboard/records/11111111-2222-4333-8444-555555555555?tab=checklist");
    expect(push).toHaveBeenCalledWith("/dashboard/records/11111111-2222-4333-8444-555555555555?tab=checklist");
  });

  it.each([
    undefined,
    "",
    "https://evil.example/dashboard",
    "//evil.example/dashboard",
    "/\\evil.example",
    "/api/projects",
    "/login",
    "/dashboardx",
    "javascript:alert(1)",
  ])("goes to /dashboard for %s", async (returnTo) => {
    await signInWith(returnTo);
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});
