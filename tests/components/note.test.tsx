// A banner, and the one thing about it that is an accessibility decision
// rather than a colour.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Note from "@/components/ui/Note";

describe("a note across the content", () => {
  it("is an alert only when it is danger", () => {
    // A screen reader announces `role="alert"` immediately, interrupting
    // whatever is being read. Doing that for an advisory — a rule worth
    // knowing, a suggestion, a finished state — trains people to dismiss the
    // one that matters.
    const { unmount } = render(<Note tone="danger">Three records have no level.</Note>);
    expect(screen.getByRole("alert")).toHaveTextContent("Three records have no level.");
    unmount();

    for (const tone of ["info", "warn", "good", "blocked"] as const) {
      const view = render(<Note tone={tone}>Something worth knowing.</Note>);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("puts the title and the body in one line, and the actions apart from them", () => {
    render(
      <Note tone="warn" title="Not yet placed" actions={<button type="button">Place it</button>}>
        Nothing on this project matches that code.
      </Note>,
    );
    expect(screen.getByText("Not yet placed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place it" })).toBeInTheDocument();
  });
});
