// Synthetic bills of quantities — the SHAPES a real bill arrives in, none of
// its content.
//
// ============================================================================
// MODELLED, NEVER COPIED.
//
// `CLAUDE.md`: real client material never enters this repo, a fixture or a
// seed. A real bill's SHAPE may be modelled — a title block, a late header,
// per-level quantity columns, a totals row, forty areas, a packaging line —
// and its content may not. So every code here is invented (`ZZ-`), every
// description is a generic piece of furniture and every area is "Example
// <something>".
//
// ONE DEFINITION, TWO CONSUMERS. These functions return `SheetData` — the
// positional rows `read-excel-file` hands the parser — and `build-boq.ts`
// builds the same rows into real `.xlsx` bytes. A shape that only ever exists
// as an array of arrays cannot prove anything about merged cells, which is why
// row 3's fixture has to survive a real workbook. Nothing is written into the
// repo: see the note in `build-boq.ts` about `.gitignore`'s NDA guard.
// ============================================================================
import type { SheetData } from "read-excel-file/node";

/**
 * A bill with per-level quantity columns and NO total.
 *
 * The trap this one carries: `L1`..`L6` are quantities and are deliberately
 * absent from the header synonyms, because a bill that read `L1` where `qty`
 * belonged would order 3 sofas instead of 14. With no `TOTAL Q-ty` column
 * there is no quantity at all, and the only honest answer is null — never 1,
 * and never the first level's figure.
 */
export function noQtyColumn(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null, null, null, null, null, null],
    ["TENDER - EXAMPLE PACKAGE", null, null, null, null, null, null, null, null],
    ["Area", "FF&E code", "Item description", "unit", "L1", "L2", "L3", "L4", "L5"],
    ["Example lounge", "ZZ-101", "Sofa", "pcs", 3, 1, 4, 3, 2],
    ["Example lounge", "ZZ-102", "Armchair", "pcs", 14, 13, 11, 12, 6],
    ["Example suite", "ZZ-103", "Side table", "pcs", 1, null, null, null, null],
  ];
}

/**
 * A bill with a quantity column that some rows leave blank.
 *
 * Different from the above and it must read the same way: "the bill gave no
 * quantity for this line" is one statement whether the column is missing or
 * the cell is empty, and neither is a reason to write a number nobody stated.
 */
export function blankQtyCells(): SheetData {
  return [
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty"],
    ["Example lounge", "ZZ-201", "Sofa", 4],
    ["Example lounge", "ZZ-202", "Armchair", null],
    ["Example suite", "ZZ-203", "Bench", ""],
  ];
}

/**
 * A two-row header: "FF&E" over "code", "Item" over "description", "Total"
 * over "Q-ty", with the Area heading merged down both rows.
 *
 * Neither row is a header on its own — the upper names an area and an item and
 * no code, the lower names a code and a description and no total — and the
 * pair completes. `build-boq.ts` writes this same shape as a real workbook with
 * A3:A4 merged, because a merged cell is only a merged cell in a file: as an
 * array of arrays it is indistinguishable from a blank.
 */
export function twoRowHeader(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null],
    ["Revision: ", "2", null, null],
    ["Area", "FF&E", "Item", "Total"],
    [null, "code", "description", "Q-ty"],
    ["Example lounge", "ZZ-101", "Sofa", 14],
    ["Example lounge", "ZZ-102", "Armchair", 58],
    ["Example suite", "ZZ-103", "Side table", 2],
  ];
}

/**
 * A two-row header that does NOT complete: the lower row names the quantity
 * and nothing names a code.
 *
 * The expected behaviour is a refusal that says which rows it read together,
 * because a person looking at a split heading needs to know that reading was
 * tried before they go hunting for a different cause.
 */
export function twoRowHeaderIncomplete(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null],
    ["Room", "Item", "Nr", null],
    [null, "description", "Total Q-ty", null],
    ["Example lounge", "Sofa", 14, null],
  ];
}

/**
 * A bill laid out in sections, with a subtotal under each and a grand total
 * at the foot — the shape most client templates print.
 *
 * Three populations, and they are NOT the same:
 *
 *   * A SPACER or a total row carrying neither a code nor a description
 *     ("", "", "", 16). Counted and passed over.
 *   * A SECTION HEADING carrying a description and no code ("SEATING").
 *     Staged as a line, because a bill line with no code is normal — a real
 *     "Bench @ entrance" often has none — and dropping a described row would
 *     lose items nothing downstream could ever ask about.
 *   * A SUBTOTAL carrying a description ("Subtotal — seating") and a figure.
 *     Staged as a line too, for the same reason and with the same cost.
 *
 * The last two are the finding this fixture exists to pin, not a behaviour it
 * asserts is right.
 */
export function sectionedBill(): SheetData {
  return [
    ["ZZ001 - Example Project", null, null, null],
    ["Area", "FF&E code", "Item description", "TOTAL Q-ty"],
    [null, null, "SEATING", null],
    ["Example lounge", "ZZ-101", "Sofa", 14],
    ["Example lounge", "ZZ-102", "Armchair", 2],
    [null, null, "Subtotal — seating", 16],
    [null, null, null, null],
    [null, null, "TABLES", null],
    ["Example suite", "ZZ-201", "Side table", 4],
    [null, null, null, 4],
    [null, null, null, 20],
  ];
}

/** Generic furniture, so a description matches no "not furniture" word. */
const FURNITURE = [
  "Sofa",
  "Armchair",
  "Side table",
  "Bench",
  "Desk chair",
  "Headboard",
  "Stool",
  "Coffee table",
  "Dressing stool",
  "Ottoman",
];

/** The lines a bill carries that are not items, with the code each uses. */
const NOT_FURNITURE = [
  ["PACK", "Packaging and protection"],
  ["DEL", "Delivery to site"],
  ["INST", "Installation, second fix"],
  ["FREIGHT", "Freight, sea"],
  ["SHIP", "Shipping and handling"],
  ["CRATE", "Crating, export standard"],
] as const;

/**
 * THREE HUNDRED LINES, FORTY AREAS, SIXTY LINES THAT ARE NOT FURNITURE.
 *
 * The shape §6.10.a row 7 names, and the size Matthew's real projects reach —
 * the sandbox's own 300-line phase is what every Stage 2 measurement has been
 * taken against. Every fifth line is packaging, delivery, installation,
 * freight, shipping or crating, which is exactly 60 of them, so *Ignore all
 * suggested* has a real number behind it rather than two rows.
 *
 * Deterministic, with no randomness at all: a fixture that generates a
 * different bill on every run turns a timing measurement into a lottery and a
 * failure into something nobody can reproduce.
 */
export function bill300(): SheetData {
  const rows: SheetData = [
    ["ZZ001 - Example Project", null, null, null, null],
    ["TENDER - EXAMPLE PACKAGE", null, null, null, null],
    ["Revision: ", "3", null, null, null],
    ["Area", "FF&E code", "Item description", "Product reference", "TOTAL Q-ty"],
  ];
  for (let index = 0; index < 300; index += 1) {
    // Forty areas, each with its own name as a bill would print it.
    const area = `Example area ${String((index % 40) + 1).padStart(2, "0")}`;
    if (index % 5 === 0) {
      const [prefix, description] = NOT_FURNITURE[(index / 5) % NOT_FURNITURE.length] as readonly [string, string];
      rows.push([area, `${prefix}-${String(index + 1).padStart(3, "0")}`, description, null, 1]);
      continue;
    }
    const description = FURNITURE[index % FURNITURE.length] as string;
    rows.push([
      area,
      `ZZ-${String(index + 100).padStart(4, "0")}`,
      description,
      `Model ${String.fromCharCode(65 + (index % 26))}`,
      (index % 9) + 1,
    ]);
  }
  return rows;
}

// ============================================================================
// THE PRICING-DOCUMENT LAYOUT — the bill that was refused on 2026-09-23.
//
// A real specifier's "Bill of Quantities (Pricing Document)" arrived with its
// code under "Spec Code" and three columns no synonym knew ("Line",
// "Sub-Area", "Category Code"), so no row on either sheet read as a header and
// the bill was refused with nowhere to go. These are that layout's HEADINGS,
// in its order, with its blanks where a heading is merged across two columns —
// and nothing else of it: every row below is invented (`ZZ-`), the category
// codes are made up, and the descriptions are generic furniture.
//
// What the shape carries, because each is a thing the reader has to survive:
//
//   * `Line` is a FORMULA column on the real sheet, so its values run from a
//     negative number upward, and one copy of the bill saved a shared formula
//     with no cached result. The workbook builder writes both; as an array the
//     line numbers are the cached values.
//   * ITEM ROWS AND FABRIC ROWS INTERLEAVE. An item has a category, a code, a
//     unit of `ea` and a quantity; the fabric row under it names its own code
//     with the item's in brackets, a unit of `m` and NO quantity — or `N/A`,
//     or no code at all. They are all lines to this reader: telling a fabric
//     row from an item is Step 2's, with evidence.
//   * THE SAME CODE ON TWO LINES, different sizes, told apart only by the
//     Notes column (`OPTION 1` / `OPTION 2`).
//   * Descriptions carrying the spec inline, over several lines of one cell.
//   * Prices and a picture column, which are never read.
// ============================================================================

/** The pricing document's header, exactly as its columns are laid out. */
export const PRICING_DOC_HEADINGS = [
  "Line",
  "Area",
  "Sub-Area",
  "Category Code",
  "Spec Code",
  null, // "Spec Code" is merged over two columns
  "Image",
  "Item Description",
  null, // merged
  "Target Unit Cost",
  null, // merged
  "Unit",
  "Total QTY",
  "Unit Price \nUSD $",
  "Total Price \nUSD $",
  null,
  "Notes",
] as const;

/** One invented line in the pricing-document layout. */
function pricingRow(line: number, cells: {
  area: string;
  subArea: string;
  category: string;
  code: string | null;
  description: string;
  target?: number | null;
  unit: string;
  qty: number | null;
  notes?: string | null;
}): SheetData[number] {
  return [
    line,
    cells.area,
    cells.subArea,
    cells.category,
    cells.code,
    null,
    null,
    cells.description,
    null,
    cells.target ?? null,
    null,
    cells.unit,
    cells.qty,
    null,
    null,
    null,
    cells.notes ?? null,
  ];
}

/**
 * The data rows, invented, starting at the formula's first value.
 *
 * `firstLine` is what `=ROW()-8` evaluates to on the first data row: 1 with the
 * title block above the header, -6 once the title rows are deleted and the
 * formula was not.
 */
export function pricingDocRows(firstLine: number): SheetData {
  const n = (offset: number) => firstLine + offset;
  return [
    pricingRow(n(0), {
      area: "Example Suites", subArea: "Example Corridor", category: "SEAT-X", code: "ZZ-FUR-10",
      description: "Stool\nModel Ref: Bespoke\nSizes (mm): W 450 x D 450 x SH 460\nFinish: Example oak\nFabric: COM",
      target: 350, unit: "ea", qty: 54,
    }),
    pricingRow(n(1), {
      area: "Example Suites", subArea: "Example Corridor", category: "FAB-SEAT-X", code: "ZZ-FAB-13\n\n(ZZ-FUR-10)",
      description: "Fabric @ Stool\nCollection & Pattern: Example weave", unit: "m", qty: null,
    }),
    pricingRow(n(2), {
      area: "Example Suites", subArea: "Example Lounge", category: "CASE-X", code: "ZZ-FUR-26",
      description: "Drawers\nModel Ref: Bespoke\nSizes (mm): W 900 x D 500 x H 800", target: 2800, unit: "ea", qty: 36,
    }),
    pricingRow(n(3), {
      area: "Example Suites", subArea: "Example Lounge", category: "SEAT-X", code: "ZZ-FUR-03",
      description: "Sofa\nSizes (mm): W 2000 x D 900 x SH 450/H 780", target: 1350, unit: "ea", qty: 9, notes: "OPTION 1",
    }),
    pricingRow(n(4), {
      area: "Example Suites", subArea: "Example Lounge", category: "SEAT-X", code: "ZZ-FUR-03",
      description: "Sofa\nSizes (mm): W 2400 x D 900 x SH 450/H 780", target: 1450, unit: "ea", qty: 3, notes: "OPTION 2",
    }),
    pricingRow(n(5), {
      area: "Example Suites", subArea: "Example Lounge", category: "FAB-SEAT-X", code: "N/A",
      description: "Fabric @ Sofa\nCollection & Pattern: Example plain", unit: "m", qty: null,
    }),
    pricingRow(n(6), {
      area: "Example Suites", subArea: "Example Lounge", category: "FAB-SEAT-X", code: null,
      description: "Fabric @ Sofa piping", unit: "m", qty: null,
    }),
    pricingRow(n(7), {
      area: "Example Terrace", subArea: "Example Deck", category: "SEAT-OUT", code: "ZZ-FUR-40",
      description: "Lounger\nSizes (mm): W 700 x D 1900 x H 350", target: 900, unit: "ea", qty: 12,
    }),
  ];
}

/**
 * The pricing document as its copies arrive.
 *
 * `titled`: the original — a title block of seven rows, the date and the
 * revision INLINE in column M ("Date: XX", "Revision: Rev 0"), a note in
 * column H, and the header on row 8. Untitled: the same sheet with the title
 * rows deleted, header on row 1, and the line formula still counting from row
 * 8 — so the first line number is -6.
 */
export function pricingDoc({ titled, codeHeading = "Spec Code" }: { titled: boolean; codeHeading?: string }): SheetData {
  const blank = () => Array.from({ length: PRICING_DOC_HEADINGS.length }, () => null) as (string | null)[];
  const put = (row: (string | null)[], index: number, value: string) => {
    row[index] = value;
    return row;
  };
  const title: SheetData = titled
    ? [
        blank(),
        put(put(blank(), 7, "Note: Example note about the quoted product."), 12, "Date: XX"),
        put(blank(), 12, "Revision: Rev 0"),
        blank(),
        put(put(blank(), 0, "Bill Of Quantities/Pricing Document"), 12, "Note: Example note about the rates."),
        put(blank(), 0, "Project: Example Project"),
        put(blank(), 0, "Tendering Company Name:"),
      ]
    : [];
  const header = PRICING_DOC_HEADINGS.map((heading) => (heading === "Spec Code" ? codeHeading : heading));
  return [...title, header, ...pricingDocRows(titled ? 1 : -6)];
}

/**
 * The tender summary beside the bill: NOT a bill, and it must not read as one.
 * Its own date and revision, a title, a site block and a price table — none of
 * which names a code and a description on one row.
 */
export function tenderSummarySheet(): SheetData {
  return [
    [null, null, null, null, "Date:", "XX", null, null],
    [null, null, null, null, "Revision:", "Rev 0", null, null],
    [null, null, null, null, null, null, null, null],
    ["TENDER SUMMARY", null, null, null, null, null, null, null],
    ["Project: Example Project", null, null, null, "Note: Example note.", null, null, null],
    ["SITE ADDRESS:", null, null, null, "1 Example Street", null, null, null],
    [null, null, null, null, "OPTION 1", null, null, "OPTION 2"],
    ["DELIVERY LOCATION:", null, null, null, "Example warehouse", null, null, "Direct to site"],
    ["SUBTOTAL (GOODS ONLY)", null, null, null, null, null, null, null],
    ["LOGISTICS", null, null, null, null, null, null, null],
    ["Packing Costs", null, null, null, null, null, null, null],
  ];
}

/**
 * A programme-dates sheet: its own `LINE | ACTIVITY | …` header two rows deep,
 * months across the top, and nobody would declare it a bill. It must not crash
 * the reader, and it must not read.
 */
export function programmeDatesSheet(): SheetData {
  return [
    [null, "Appendix 3", null, null, null, null, null, null],
    [null, "Programme Dates", null, "Version:", "Rev 0", null, null, null],
    [null, "Project: Example Project", null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["LINE", "ACTIVITY", "ACTIVITY BREAKDOWN", "Start", "Finish", "Duration\n(weeks)", "Month 1", "Notes"],
    [null, null, null, null, null, null, null, null],
    [1, null, null, null, null, null, null, null],
    [2, "DEVELOPMENT", "Mobilisation deposit due", "XX", "XX", null, null, null],
  ];
}
