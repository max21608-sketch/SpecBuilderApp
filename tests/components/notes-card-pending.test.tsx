// The preamble notes card's Flag and Retire (review 2026-11-16, item 1.5).
//
// Neither control had a pending state, so a double-click sent the same
// version twice and the second came back a 409 that read as somebody else's
// change. And a refusal returned without reloading, so the stale note stayed
// on screen and the next click was refused the same way. The app's rule is
// reload first, then say why.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotesCard, { type ProjectNote } from "@/components/projects/NotesCard";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

type Reply = { ok: true; status: 200; data: unknown } | { ok: false; status: number; error: string; data: null };
const server = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; body: unknown }>,
  release: null as null | ((reply: Reply) => void),
}));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: (target: string, init?: RequestInit) => {
    server.calls.push({ url: target, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Promise<Reply>((resolve) => {
      server.release = resolve;
    });
  },
}));

const NOTE: ProjectNote = {
  id: "note-1",
  topic: "Fire",
  title: "Flame retardancy",
  body: "All upholstery to an invented standard.",
  flagged: false,
  source_page: 3,
  source_filename: "preamble.pdf",
  version: 4,
};

function mount() {
  const events: string[] = [];
  const onError = vi.fn((message: string | null) => {
    if (message) events.push(`error: ${message}`);
  });
  const onChanged = vi.fn(async () => {
    events.push("reload");
  });
  render(<NotesCard projectId="project-7" notes={[NOTE]} onError={onError} onChanged={onChanged} />);
  return { events, onChanged };
}

async function openNotes() {
  await userEvent.click(screen.getByRole("button", { name: "Show the 1" }));
}

beforeEach(() => {
  server.calls.length = 0;
  server.release = null;
});

describe("NotesCard", () => {
  it("sends one Flag for a double-click, and disables the note's controls while it is out", async () => {
    mount();
    await openNotes();
    const flag = screen.getByRole("button", { name: /Flag/ });
    await userEvent.dblClick(flag);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]!.body).toEqual({ flagged: true, version: 4 });
    expect(screen.getByRole("button", { name: /Flag/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retire" })).toBeDisabled();

    await act(async () => server.release!({ ok: true, status: 200, data: {} }));
    expect(screen.getByRole("button", { name: "Retire" })).not.toBeDisabled();
  });

  it("reloads after a refusal, then shows the server's words", async () => {
    const { events, onChanged } = mount();
    await openNotes();
    await userEvent.click(screen.getByRole("button", { name: "Retire" }));
    await act(async () =>
      server.release!({
        ok: false,
        status: 409,
        error: "This note changed while you had it open. Reload before saving.",
        data: null,
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["reload", "error: This note changed while you had it open. Reload before saving."]);
  });
});
