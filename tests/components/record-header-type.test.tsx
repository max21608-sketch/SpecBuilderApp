// The record header's TYPE control and provisional note (0061, decision B).
//
// A sheet covering several of Matthew's types answers for their union. The
// header shows the app's SUGGESTED type with its reason as a SuggestButton —
// a press accepts, nothing is written unseen — and an accepted type as a
// settled chip a person can change. A provisional gate model's sentence is
// printed as the data carries it.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecordHeader from "@/components/records/RecordHeader";
import type { MatrixTypeState, SpecRecord } from "@/components/records/record-payload";

const record = {
  id: "rec-1",
  project_id: "proj-1",
  bws_project_number: "T90111",
  run_id: "run-1",
  run_name: "Lobby",
  item_description: "Invented three seat sofa",
  area: null,
  qty: 2,
  qty_raw: null,
  parent_id: null,
  variant_label: null,
  source_line_no: 4,
  category_name: "Armchairs / benches / stools / sofas",
  level: "simple",
  level_suggested: null,
  level_suggested_reason: null,
  designer: null,
} as unknown as SpecRecord;

const options = [
  { code: "S", name: "Sofas" },
  { code: "A", name: "Armchairs & Occasional Chairs" },
  { code: "B", name: "Benches" },
];

function header(matrixType: MatrixTypeState | null, setMatrixType = vi.fn(async () => {}), provisionalNote: string | null = null) {
  render(
    <RecordHeader
      record={record}
      data={{ mockup: null, designerContact: null, twins: [] } as never}
      parentRefs="SF-01"
      recordLabel="T90111-004"
      runHref="/dashboard/projects/proj-1?tab=run-1"
      level="simple"
      savingLevel={false}
      setLevel={async () => {}}
      readiness={{ toQuote: 3, toChase: 2, projectWide: 0 }}
      chaseHref="/dashboard/drafts?projectId=proj-1"
      chaseWhy={null}
      onAddSpec={() => {}}
      tabs={null}
      matrixType={matrixType}
      savingMatrixType={false}
      setMatrixType={setMatrixType}
      provisionalNote={provisionalNote}
    />,
  );
  return setMatrixType;
}

describe("the record header's type", () => {
  it("offers the suggested type with its reason, and a press accepts it", async () => {
    const set = header({ accepted: null, suggestion: { code: "S", name: "Sofas", reason: "The name says “sofa”." }, options });
    expect(screen.getByText("The name says “sofa”.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Sofas/ }));
    expect(set).toHaveBeenCalledWith("accept", "S");
  });

  it("shows an accepted type as settled, and Change offers every type and the sheet's union", async () => {
    const set = header({ accepted: { code: "S", name: "Sofas" }, suggestion: null, options });
    expect(screen.getByText("Sofas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change type" }));
    await userEvent.click(screen.getByRole("button", { name: "Benches" }));
    expect(set).toHaveBeenCalledWith("set", "B");
    await userEvent.click(screen.getByRole("button", { name: "Change type" }));
    await userEvent.click(screen.getByRole("button", { name: "Any of them" }));
    expect(set).toHaveBeenLastCalledWith("set", null);
  });

  it("says nothing about a type on a one-type sheet", () => {
    header(null);
    expect(screen.queryByRole("button", { name: /type/i })).not.toBeInTheDocument();
  });

  it("prints a provisional model's sentence as the data carries it", () => {
    const sentence = "Provisional cabinetry gate model, drafted by AI on 20 Nov 2026, not yet confirmed by Matthew";
    header(null, undefined, sentence);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });
});
