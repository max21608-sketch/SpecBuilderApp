// Component tier. A bill's finish line is labelled by WHAT it is — the reading
// the confirm slots it by — not "Fabric" for every kind (2026-10-06: a timber
// line read "Fabric ▾" beside its own "→ Main timber finish"). Invented lines.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BoqRowKindCell, { type KindCellLine } from "@/components/imports/BoqRowKindCell";

const item: KindCellLine = { index: 0, lineNo: 9, code: "ZZ-SE-01", itemDescription: "BAR STOOL", ignored: false, rowKind: "item" };
const finish = (lineNo: number, code: string | null, words: string): KindCellLine => ({
  index: lineNo,
  lineNo,
  code,
  itemDescription: words,
  ignored: false,
  rowKind: "finish_for",
  finishFor: { row: 9, code: "ZZ-SE-01" },
  rowKindSource: "model",
});

describe("a finish line's kind label", () => {
  it.each([
    [finish(10, "F-FA-01", "EXAMPLE MILL | PLAIN | FABRIC | BLUE"), "Fabric"],
    [finish(11, "F-MT-01", "TO ELECT | POLISHED NICKEL"), "Metal"],
    [finish(12, "F-WD-01", "TO ELECT | OAK | MATT"), "Timber"],
    [finish(13, "F-TR-01", "EXAMPLE MAKER | CORD WITH TAPE | CORD"), "Trim"],
    [finish(14, null, "EXAMPLE NOTHING IN PARTICULAR"), "Finish"],
  ])("row %#", (line, label) => {
    render(<BoqRowKindCell line={line} lines={[item, line]} editable busy={false} onSet={() => {}} />);
    expect(screen.getByRole("button", { name: `Row ${line.lineNo} is ${label} — change` })).toHaveTextContent(`${label} ▾`);
  });
});
