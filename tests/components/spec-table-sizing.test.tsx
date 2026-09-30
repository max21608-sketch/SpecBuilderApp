// The phase table and the record title are sized for their content (2026-09-30).
//
// On the Aman bill at 1440 px a client ref wrapped `GR-FUR-10` over three lines
// and the Item cell was a narrow column ten lines tall. Two rules hold it: a
// ref never breaks inside itself, and a long name is cut as a STRING with
// `clampText` (never CSS line-clamp), the whole of it one hover away. The refs
// and names here are invented; only the lengths copy the real bill's.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientRefs, ItemName, ITEM_CLAMP } from "@/components/records/SpecTable";
import RecordTitle, { RECORD_TITLE_CHARS } from "@/components/records/RecordTitle";

const LONG_NAME = "Bedframe & Headboard - TWIN (X18 = BED BASES - X1 HEADBOARD PER X2 BED BASES) with a long extra clause to be cut";

describe("a client ref", () => {
  it("is one no-wrap run, printed exactly as the bill wrote it", () => {
    const { container } = render(<ClientRefs code="ZZ-FUR-10" />);
    const run = container.querySelector("span.whitespace-nowrap");
    expect(run?.textContent).toBe("ZZ-FUR-10");
    // ASCII hyphens, never a dash the bill did not print.
    expect(container.textContent).not.toMatch(/[‐-―]/);
  });

  it("keeps each of several refs whole and wraps only between them", () => {
    const { container } = render(<ClientRefs code="ZZ-FUR-10, ZZ-FUR-11" />);
    const runs = [...container.querySelectorAll("span.whitespace-nowrap")].map((span) => span.textContent);
    expect(runs).toEqual(["ZZ-FUR-10", "ZZ-FUR-11"]);
    expect(container.textContent).toBe("ZZ-FUR-10, ZZ-FUR-11");
  });
});

describe("an item name", () => {
  it("is cut as a string, with the whole of it on hover", () => {
    render(<ItemName text={LONG_NAME} />);
    const cut = screen.getByTitle(LONG_NAME);
    expect(cut.textContent!.length).toBeLessThanOrEqual(ITEM_CLAMP.chars + 1);
    expect(cut.textContent).toMatch(/…$/);
    expect(LONG_NAME.startsWith(cut.textContent!.slice(0, -1).trimEnd())).toBe(true);
  });

  it("is left alone when it is short, with no title pretending there is more", () => {
    const { container } = render(<ItemName text="Desk Chair" />);
    expect(container.textContent).toBe("Desk Chair");
    expect(container.querySelector("[title]")).toBeNull();
  });
});

describe("the record title", () => {
  it("carries the label and a one-line name, the whole name on hover", () => {
    render(<RecordTitle label="ZZ-FUR-10" name={LONG_NAME} />);
    const title = screen.getByTitle(LONG_NAME);
    expect(title.textContent!.startsWith("ZZ-FUR-10 · Bedframe & Headboard")).toBe(true);
    expect(title.textContent!.length).toBeLessThanOrEqual("ZZ-FUR-10 · ".length + RECORD_TITLE_CHARS + 1);
  });

  it("prints a short name whole", () => {
    const { container } = render(<RecordTitle label="ZZ-FUR-10" name="Drawers" />);
    expect(container.textContent).toBe("ZZ-FUR-10 · Drawers");
    expect(container.querySelector("[title]")).toBeNull();
  });
});
