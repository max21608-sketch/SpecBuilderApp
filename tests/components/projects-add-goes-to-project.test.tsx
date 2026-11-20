// After "Add project", the new project's page — not the list (2026-11-20, U3).
//
// The list used to stay, form open, the new row at the top, when the next
// thing anybody does with a new project is upload its pack, and the project's
// page opens on exactly that.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectsPage from "@/app/dashboard/projects/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/dashboard/projects",
  useRouter: () => ({ push, replace: () => {} }),
}));

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

const posts: unknown[] = [];

beforeEach(() => {
  push.mockReset();
  posts.length = 0;
  apiFetch.mockReset();
});

function serve(post: () => unknown) {
  apiFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body ?? "{}"));
      return post();
    }
    if (url.startsWith("/api/projects")) {
      return { ok: true, status: 200, data: { projects: [], archivedCount: 0, unplacedMail: 0 } };
    }
    return { ok: true, status: 200, data: {} };
  });
}

async function addProject() {
  render(<ProjectsPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Add a project" }));
  await userEvent.type(screen.getByLabelText("BWS project number"), "P90300");
  await userEvent.type(screen.getByLabelText("Project name"), "Invented hotel");
  await userEvent.click(screen.getByRole("button", { name: "Add project" }));
}

describe("Add project", () => {
  it("goes to the new project's page, where its pack is uploaded", async () => {
    serve(() => ({ ok: true, status: 201, data: { ok: true, project: { id: "new-project-id" } } }));
    await addProject();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/projects/new-project-id"));
    expect(posts).toEqual([{ bwsProjectNumber: "P90300", name: "Invented hotel", client: "" }]);
    // The button stays busy while the page changes, so it cannot be pressed
    // twice into "already exists".
    expect(screen.getByRole("button", { name: "Adding…" })).toHaveProperty("disabled", true);
  });

  it("stays, with the refusal in words and the form usable, when the project already exists", async () => {
    serve(() => ({ ok: false, status: 409, error: "Project P90300 already exists." }));
    await addProject();
    expect(await screen.findByText("Project P90300 already exists.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add project" })).toHaveProperty("disabled", false);
  });
});
