// The synthetic bill the first-session walk uploads.
//
// ============================================================================
// SYNTHETIC, AND THAT IS THE POINT.
//
// `CLAUDE.md`: real client material — the BOQ, the BWS job export, the
// SharePoint cheat sheets — never enters this repo, a fixture, or a seed. So
// this is written from scratch, in the SHAPE the real bills have, carrying
// none of their content. The codes, the areas and the descriptions are
// invented; what is copied from reality is the structure, and the four rows
// that exist to make the app do something interesting:
//
//   * TWO TABS. A bill tab is a PHASE, not a revision, and `parseBoqSheets`
//     returned on the first sheet with a header until 0007 — so a bill with
//     one tab proves nothing about the one thing that was wrong.
//   * `SX11A` ON TWO LINES, different quantities. The pilot bill does this and
//     it is why a record is keyed by a surrogate id rather than by its client
//     ref. Two records, not one, and nothing may pair them.
//   * A `PACK` line and a `DEL` line. Packaging and delivery are not furniture
//     and must not arrive as records reading "Simple · guessed" (plan 1.5).
//   * `S-100`, because the walk clones a staged drawings run that carries that
//     code and the card has to resolve onto a record this bill made.
//
// It uses `exceljs`, which the repo already depends on — so this file resolves
// it from the repo's own node_modules and is run from the repo, not from the
// scratchpad Playwright project.
// ============================================================================
import ExcelJS from "exceljs";

/** The header row `parseBoqSheets` looks for, in the order a client writes it. */
const HEADER = ["Designer", "Category", "Area", "Code", "Item Description", "Product Reference", "TOTAL Q-ty", "Unit"];

/**
 * One row per bill line. `main` and `ve` are the quantities on each tab, and a
 * null means the line is not on that tab at all — which is what makes the two
 * tabs two sub-quotes rather than two copies.
 */
const LINES = [
  { designer: "QA", category: "Sofa", area: "Lounge", code: "S-100", description: "Two-seat sofa", ref: "QA-S100", main: 6, ve: 6 },
  { designer: "QA", category: "Armchair", area: "Lounge", code: "S-200", description: "Lounge armchair", ref: "QA-S200", main: 12, ve: 10 },
  { designer: "QA", category: "Armchair", area: "Lounge", code: "S-201", description: "Armchair, low back", ref: "QA-S201", main: 8, ve: null },
  { designer: "QA", category: "Desk chair", area: "Study", code: "S-301", description: "Desk chair", ref: "QA-S301", main: 4, ve: 4 },
  { designer: "QA", category: "Bench", area: "Corridor", code: "S-402", description: "Upholstered bench", ref: "QA-S402", main: 3, ve: 3 },
  { designer: "QA", category: "Headboard", area: "Bedroom", code: "UP-100", description: "Headboard, buttoned", ref: "QA-UP100", main: 20, ve: 18 },
  { designer: "QA", category: "Headboard", area: "Bedroom", code: "UP-101", description: "Headboard, plain", ref: "QA-UP101", main: 14, ve: 14 },
  { designer: "QA", category: "Stool", area: "Bedroom", code: "ST-110", description: "Dressing stool", ref: "QA-ST110", main: 20, ve: 20 },
  { designer: "QA", category: "Sofa", area: "Suite", code: "S-500", description: "Corner sofa", ref: "QA-S500", main: 2, ve: 2 },
  { designer: "QA", category: "Table", area: "Lounge", code: "T-600", description: "Side table", ref: "QA-T600", main: 16, ve: 16 },
  { designer: "QA", category: "Table", area: "Suite", code: "T-601", description: "Console table", ref: "QA-T601", main: 5, ve: null },
  // THE SAME CODE TWICE, at different quantities. Two records; a reconcile
  // that tried to pair them would have to pick one, and must not.
  { designer: "QA", category: "Armchair", area: "Lounge", code: "SX11A", description: "Occasional chair, fabric A", ref: "QA-SX11A", main: 9, ve: 9 },
  { designer: "QA", category: "Armchair", area: "Study", code: "SX11A", description: "Occasional chair, fabric B", ref: "QA-SX11A", main: 7, ve: 7 },
  // Not furniture. Neither should read "Simple · guessed" on the review.
  { designer: "QA", category: "Packaging", area: "", code: "PACK", description: "Protective packaging, all items", ref: "", main: 1, ve: 1 },
  { designer: "QA", category: "Delivery", area: "", code: "DEL", description: "Delivery to site, two loads", ref: "", main: 1, ve: 1 },
];

/** The tabs, and the revision each one is priced under. */
const TABS = [
  { name: "MAIN RUN", key: "main", revision: "B", date: "14-Sep-26" },
  { name: "MAIN RUN - VE", key: "ve", revision: "B", date: "14-Sep-26" },
];

export const FIXTURE_BILL_FILENAME = "__QA first-session bill (synthetic).xlsx";

/** How many records the confirm should create, per tab and in total. */
export const FIXTURE_BILL_COUNTS = {
  tabs: TABS.length,
  perTab: Object.fromEntries(TABS.map((tab) => [tab.name, LINES.filter((line) => line[tab.key] !== null).length])),
  total: TABS.reduce((sum, tab) => sum + LINES.filter((line) => line[tab.key] !== null).length, 0),
};

/** The bill as .xlsx bytes. */
export async function buildFixtureBill() {
  const workbook = new ExcelJS.Workbook();
  for (const tab of TABS) {
    const sheet = workbook.addWorksheet(tab.name);
    // The rows ABOVE the header carry the revision and the date the tab is
    // priced under, and a client template writes the label in one cell and the
    // value in the NEXT one. Both forms are read; this is the split one.
    sheet.addRow(["__QA first session — synthetic bill, no client content"]);
    sheet.addRow(["Revision:", tab.revision, "", "Date:", tab.date]);
    sheet.addRow([]);
    sheet.addRow(HEADER);
    for (const line of LINES) {
      const qty = line[tab.key];
      if (qty === null) continue;
      sheet.addRow([line.designer, line.category, line.area, line.code, line.description, line.ref, qty, "pcs"]);
    }
    sheet.addRow([]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
