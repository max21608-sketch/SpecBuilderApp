// The table primitives, and the two DOM traps this app has already paid for.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, Th, Td, Tr, GroupRow } from "@/components/ui/Table";

describe("the table wrapper", () => {
  it("never clips its own overflow", () => {
    // THE TRAP. `overflow-hidden` is the obvious way to make a rounded border
    // clip the first and last rows, and it makes the wrapper the sticky scroll
    // container: the column header then offsets down from the top of the TABLE
    // rather than the viewport and covers a furniture line — a row nobody would
    // know to look for, because it is under the thing they are reading.
    const { container } = render(
      <Table scroll>
        <tbody>
          <tr>
            <Td>a</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(container.innerHTML).not.toContain("overflow-hidden");
    expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
  });

  it("adds no scroll container to a table that fits", () => {
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <Td>a</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("puts no divide-y on the body, because a panel row is its own tr", () => {
    // A spanning panel is its OWN `<tr>`, never an extra `<td colSpan>` beside
    // the data cells — and once it is, `divide-y` on the tbody draws a line
    // between a value and its own panel. Every `Td` carries its own border.
    const { container } = render(
      <Table>
        <tbody>
          <Tr>
            <Td>a</Td>
          </Tr>
        </tbody>
      </Table>,
    );
    expect(container.innerHTML).not.toContain("divide-y");
  });
});

describe("a group row", () => {
  it("spans the columns it was given, and keeps its aside readable", () => {
    render(
      <Table>
        <tbody>
          <GroupRow span={7} aside="nothing can be suggested for these">
            Unclassified
          </GroupRow>
        </tbody>
      </Table>,
    );
    const cell = screen.getByText("Unclassified").closest("td");
    expect(cell).toHaveAttribute("colspan", "7");
    // Normal case beside the uppercase label: uppercase tracking turns a
    // half-sentence into something to decipher rather than read.
    expect(screen.getByText("nothing can be suggested for these").className).toContain("normal-case");
  });
});

describe("a numeric column", () => {
  it("is right-aligned and tabular on both the header and the cell", () => {
    render(
      <Table>
        <thead>
          <tr>
            <Th num>Items</Th>
          </tr>
        </thead>
        <tbody>
          <Tr>
            <Td num>45</Td>
          </Tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByText("Items").className).toContain("tabular-nums");
    expect(screen.getByText("45").className).toContain("text-right");
  });
});
