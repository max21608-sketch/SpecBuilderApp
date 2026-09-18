// The app's suggestion, and the rule that it never appears alone.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SuggestButton from "@/components/ui/SuggestButton";

describe("a suggestion the app has worked out", () => {
  it("prints the evidence beside the value", () => {
    render(<SuggestButton value="Complex" evidence="brass legs on the drawing" onAccept={() => {}} />);
    // `evidence` is a REQUIRED prop, which is the whole argument for this being
    // a component rather than a fifth Button variant: a variant could be used
    // without it, and then the app would be asserting something it has not
    // shown its working for.
    expect(screen.getByText("brass legs on the drawing")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Complex");
  });

  it("files the suggestion once when pressed", async () => {
    const onAccept = vi.fn();
    render(<SuggestButton value="Timber" evidence="code prefix WD" onAccept={onAccept} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("cannot be pressed twice while the first press is in flight", async () => {
    const onAccept = vi.fn();
    render(<SuggestButton value="Timber" evidence="code prefix WD" busy onAccept={onAccept} />);
    expect(screen.getByRole("button")).toBeDisabled();
    await userEvent.click(screen.getByRole("button"));
    expect(onAccept).not.toHaveBeenCalled();
  });
});
