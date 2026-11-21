// "Fabric 1", with the BWS name small beside it (decision F of 2026-11-20).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import FieldName, { QuestionName } from "@/components/ui/FieldName";

describe("FieldName", () => {
  it("says Fabric 1 and sets BWS's COM 1 small beside it", () => {
    render(<FieldName name="COM 1" jsonId={1} />);
    expect(screen.getByText("Fabric 1")).toBeInTheDocument();
    expect(screen.getByText("BWS: COM 1")).toBeInTheDocument();
  });

  it("prints a field whose name we do not change once, with nothing beside it", () => {
    const { container } = render(<FieldName name="Stud spec" jsonId={16} />);
    expect(container.textContent).toBe("Stud spec");
  });
});

describe("QuestionName", () => {
  it("names a COM prompt as Fabric 1 and the BWS field ONCE, never 'BWS: Fabric 1'", () => {
    const { container } = render(<QuestionName prompt="COM 1" fieldLabel="COM 1" />);
    expect(screen.getByText("Fabric 1")).toBeInTheDocument();
    expect(container.textContent?.match(/BWS: COM 1/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("BWS: Fabric");
  });

  it("names the BWS field under a question worded differently, by BWS's own name", () => {
    const { container } = render(<QuestionName prompt="Seat height (SH)?" fieldLabel="Dimensions" />);
    expect(container.textContent).toContain("Seat height (SH)?");
    expect(container.textContent).toContain("BWS: Dimensions");
  });
});
