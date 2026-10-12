// The Documents list's action on a confirmed bill (pilot walk, 2026-10-12).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReadBillSpecsAction from "@/components/imports/ReadBillSpecsAction";

vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));

describe("ReadBillSpecsAction", () => {
  it("offers the charged read on a bill whose descriptions were not read", () => {
    render(<ReadBillSpecsAction billRunId="b1" specsRunId={null} />);
    expect(screen.getByRole("button", { name: /Read the specifications/ })).toBeInTheDocument();
  });

  it("offers no charged read where the confirm read the descriptions, and says so", () => {
    render(<ReadBillSpecsAction billRunId="b1" specsRunId={null} descriptionsRead />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Specifications read from its descriptions at confirm")).toBeInTheDocument();
  });

  it("still links to a read that exists", () => {
    render(<ReadBillSpecsAction billRunId="b1" specsRunId="s1" descriptionsRead />);
    expect(screen.getByRole("link", { name: "Its specifications" }).getAttribute("href")).toBe("/dashboard/imports/s1");
  });
});
