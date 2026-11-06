// A screen that throws while it renders shows a Note, not a white page
// (audit G4, 2026-11-06), and an expired session shows where to sign in
// (audit G11).
//
// There was no `error.tsx` anywhere under src/app, so one render-time
// TypeError (CLAUDE.md: "every screen reading the first version 2 run threw")
// took out the whole dashboard, nav bar included. Next wraps each segment in
// its error file; here a plain error boundary stands in for Next's so the
// file's own component is what renders the failure.
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardError from "@/app/dashboard/error";
import RecordError from "@/app/dashboard/records/[id]/error";
import ImportError from "@/app/dashboard/imports/[id]/error";
import ProjectError from "@/app/dashboard/projects/[id]/error";
import SessionExpiredNote from "@/components/layout/SessionExpiredNote";
import { SESSION_EXPIRED_EVENT } from "@/lib/api-fetch";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/records/rec-1",
  useParams: () => ({ id: "project-9" }),
}));

type Fallback = (props: { error: Error & { digest?: string }; reset: () => void }) => ReactNode;

class Boundary extends Component<{ fallback: Fallback; reset: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? this.props.fallback({ error: this.state.error, reset: this.props.reset }) : this.props.children;
  }
}

function Broken(): ReactNode {
  const data = {} as { record: { parent_id: string } };
  // The crash a `setData({})` produced.
  return <p>{data.record.parent_id}</p>;
}

describe("the dashboard's error boundary", () => {
  it("renders a Note with the message, the path and a way back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.fn();
    render(
      <Boundary fallback={(props) => <DashboardError {...props} />} reset={reset}>
        <Broken />
      </Boundary>,
    );
    const note = screen.getByRole("alert");
    expect(note.textContent).toMatch(/Cannot read properties of undefined/);
    expect(note.textContent).toContain("/dashboard/records/rec-1");
    await userEvent.click(screen.getByRole("button", { name: "Reload this page" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open the projects list" }).getAttribute("href")).toBe("/dashboard/projects");
  });

  it("each busy segment has its own, and the project's links to the project", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    const { unmount } = render(<RecordError error={error} reset={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
    expect(screen.getByText(/abc123/)).toBeTruthy();
    unmount();
    const second = render(<ImportError error={error} reset={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
    second.unmount();
    render(<ProjectError error={error} reset={() => undefined} />);
    expect(screen.getByRole("link", { name: "Open the project page" }).getAttribute("href")).toBe(
      "/dashboard/projects/project-9",
    );
  });
});

describe("an expired session", () => {
  it("shows where to sign in again, once something has found out", () => {
    render(<SessionExpiredNote />);
    expect(screen.queryByText(/session has expired/)).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { signIn: "/login?from=%2Fdashboard" } }));
    });
    expect(screen.getByText(/session has expired/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe("/login?from=%2Fdashboard");
  });
});
