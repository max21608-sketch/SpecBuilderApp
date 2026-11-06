// The project's details form keeps what is being typed (audit G6, 2026-11-06).
//
// `load()` re-seeded the form from the server every time it ran, and seven
// unrelated actions on the same screen run it: starting a change, adding a
// contact, flagging or retiring a note, adding a phase, retrying a document,
// accepting levels. Type a client name, start a change, and the box snapped
// back to the stored value with `dirty` gone quiet. The form is now its own
// component (`ProjectDetailsCard`) that re-seeds from the project ONLY while it
// is not being edited. Its behaviour is otherwise unchanged: one-act save.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectOverviewPage from "@/app/dashboard/projects/[id]/page";
import ProjectDetailsCard, { type ProjectDetails } from "@/components/projects/ProjectDetailsCard";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

const PROJECT = "project-9";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: PROJECT }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/dashboard/projects/${PROJECT}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const project: ProjectDetails & { status: string; archived_at: null; archived_by: null } = {
  id: PROJECT,
  bws_project_number: "ZZ900",
  name: "Invented Hotel",
  client: "Invented Group",
  shared_inbox: null,
  order_date: null,
  specs_agreed_by: null,
  delivery_date: null,
  default_dimension_unit: null,
  finish_code_prefix: null,
  status: "active",
  archived_at: null,
  archived_by: null,
  version: 1,
};

const server = vi.hoisted(() => ({ calls: [] as { url: string; method: string }[] }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    server.calls.push({ url, method });
    const path = url.split("?")[0]!;
    if (path === `/api/projects/${PROJECT}/changes`) {
      return { ok: true, status: 200, data: method === "POST" ? {} : { open: null } };
    }
    if (path === `/api/projects/${PROJECT}` && method === "GET") {
      return {
        ok: true,
        status: 200,
        data: {
          ok: true,
          project,
          completion: { records: 0, outstanding: 0, uncategorised: 0 },
          summary: {
            records: 0,
            uncategorised: 0,
            noLevel: 0,
            levelSuggested: 0,
            toQuote: 0,
            missing: 0,
            tbc: 0,
            settled: 0,
            finishes: 0,
            finishesNoKind: 0,
            documentsReading: 0,
            documentsFailed: 0,
            tgqFromMatrix: 0,
            tgqFromFallback: 0,
          },
          state: "active",
          documents: [],
          runs: [],
          notes: [],
          unlinkedFinishCodes: [],
          failedDocuments: 0,
          designerCodes: {},
        },
      };
    }
    return { ok: false, status: 404, error: "no such route", data: null };
  },
}));

beforeEach(() => {
  server.calls = [];
});

describe("the details form on the project page", () => {
  it("keeps a typed client name when starting a change reloads the project", async () => {
    render(<ProjectOverviewPage />);
    await screen.findByText("Invented Group");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const client = screen.getByPlaceholderText("None recorded") as HTMLInputElement;
    await userEvent.clear(client);
    await userEvent.type(client, "Typed Client Ltd");

    const loadsBefore = server.calls.filter((call) => call.url === `/api/projects/${PROJECT}` && call.method === "GET").length;
    await userEvent.click(screen.getByRole("button", { name: "Start a change" }));
    await userEvent.type(screen.getByPlaceholderText(/Hayley's email/), "Invented email");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(server.calls.filter((call) => call.url === `/api/projects/${PROJECT}` && call.method === "GET").length).toBeGreaterThan(
        loadsBefore,
      ),
    );

    expect((screen.getByPlaceholderText("None recorded") as HTMLInputElement).value).toBe("Typed Client Ltd");
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeTruthy();
  });
});

describe("ProjectDetailsCard", () => {
  it("re-seeds from new props only while it is not being edited", async () => {
    const onSaved = vi.fn();
    const onError = vi.fn();
    const view = render(<ProjectDetailsCard project={project} onSaved={onSaved} onError={onError} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const name = screen.getByDisplayValue("Invented Hotel");
    await userEvent.clear(name);
    await userEvent.type(name, "Typed Name");

    // The parent re-renders with a newer project (somebody else's save).
    view.rerender(
      <ProjectDetailsCard project={{ ...project, client: "Somebody Else", version: 2 }} onSaved={onSaved} onError={onError} />,
    );
    expect(screen.getByDisplayValue("Typed Name")).toBeTruthy();

    // Closed, it shows what the server holds.
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("Somebody Else")).toBeTruthy();
  });
});
