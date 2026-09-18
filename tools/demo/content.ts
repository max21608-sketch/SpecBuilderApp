// The demo project's invented contents: the bill, the drawings, the preamble
// and the correspondence.
//
// EVERYTHING HERE IS MADE UP, and it has to be. Real client specification
// material never enters this repo (CLAUDE.md, "Reference material"), and a
// walkthrough given to somebody outside the business must not be a walkthrough
// of an NDA-covered pack. So this is a hotel bedroom package that does not
// exist, for a client that does not exist, drawn by a studio that does not
// exist. Every address is at example.com, which IANA reserves and nobody can
// register.
//
// ONE SOURCE FOR THE PAGE AND FOR THE CARD. `drawingPage()` in sheets.ts
// prints these figures onto the PDF, and `rawDrawingItems()` hands the SAME
// figures to the app's own `stageDrawings`. That is what makes the demo worth
// walking: the card beside the page says what the page says, so the review
// screen can be judged rather than taken on faith.
import type { RawDrawingItem } from "@/lib/extraction-schema";

// The number is the sweep marker (`like 'DEMO%'`, --clear) AND the thing that
// says on every screen that this is not a real job. Both halves carry TEST, so
// a screenshot taken out of the demo cannot be mistaken for a live project.
export const PROJECT = {
  number: "DEMO-TEST-01",
  name: "Ashcombe House — Bedrooms & Suites (TEST)",
  client: "Larkspur Hotel Group",
  inbox: "ashcombe.specs@example.com",
  /** The sheets print millimetres, so this default is almost never reached. */
  defaultUnit: "mm" as const,
};

export const CONTACTS = [
  {
    code: "AHS",
    name: "Priya Raman",
    email: "priya.raman@example.com",
    organisation: "Ashcombe House Studio",
    role: "Interior designer",
  },
  {
    code: "LHG",
    name: "Dominic Searle",
    email: "dominic.searle@example.com",
    organisation: "Larkspur Hotel Group",
    role: "Project manager",
  },
  {
    code: "MCF",
    name: "Elena Marchetti",
    email: "elena.marchetti@example.com",
    organisation: "Marchetti Contract Furnishings",
    role: "Fabric supplier",
  },
];

// ---------------------------------------------------------------------------
// The bill of quantities.
//
// Three tabs, which is three RUNS and not three revisions: a mock-up room, the
// main package, and a value-engineered alternative quoting the same codes at
// different quantities. CLAUDE.md's "A BOQ tab is a RUN, not a revision".
// ---------------------------------------------------------------------------

export type BillLine = {
  designer: string;
  category: string;
  area: string;
  code: string;
  description: string;
  productReference: string | null;
  mockUp: number | null;
  main: number | null;
  ve: number | null;
};

export const BILL: BillLine[] = [
  // designer, category, area, code, description, product ref, mock-up, main, VE
  { designer: "AHS", category: "Seating", area: "Suite living area", code: "AC-101", description: "Armchair, lounge @ suite living area", productReference: "AHS-LR-01", mockUp: 2, main: 24, ve: 24 },
  { designer: "AHS", category: "Seating", area: "Suite study", code: "AC-102", description: "Desk chair @ suite study", productReference: "AHS-DC-01", mockUp: 1, main: 24, ve: null },
  { designer: "AHS", category: "Seating", area: "Suite living area", code: "SO-201", description: "Sofa, two seat, feature @ suite living area", productReference: "AHS-SF-02", mockUp: 1, main: 12, ve: 12 },
  { designer: "AHS", category: "Seating", area: "Suite living area", code: "BE-202", description: "Bench @ window, suite", productReference: null, mockUp: null, main: 12, ve: null },
  { designer: "AHS", category: "Seating", area: "Dressing area", code: "ST-203", description: "Dressing Stool @ dressing area", productReference: "AHS-ST-01", mockUp: null, main: 24, ve: 24 },
  { designer: "AHS", category: "Upholstery", area: "Bedroom", code: "HB-301", description: "Headboard @ king bedroom, upholstered", productReference: "AHS-HB-K", mockUp: 1, main: 18, ve: 18 },
  { designer: "AHS", category: "Upholstery", area: "Bedroom", code: "HB-302", description: "Headboard @ twin bedroom, upholstered", productReference: "AHS-HB-T", mockUp: null, main: 12, ve: null },
  { designer: "AHS", category: "Upholstery", area: "Bedroom", code: "OT-401", description: "Ottoman @ bed end", productReference: "AHS-OT-01", mockUp: null, main: 30, ve: 30 },
  { designer: "AHS", category: "Casegoods", area: "Suite living area", code: "CT-501", description: "Coffee table @ suite living area", productReference: "AHS-CT-01", mockUp: null, main: 12, ve: null },
  // The same code on two lines with different quantities, which is the `SX11A`
  // case: two separate records, and a matcher that deduplicated them would be
  // wrong. Worth having in a demo, because it is the first thing that looks
  // like a bug and is not.
  { designer: "AHS", category: "Casegoods", area: "Suite living area", code: "SD-502", description: "Side table @ armchair", productReference: "AHS-SD-01", mockUp: null, main: 24, ve: null },
  { designer: "AHS", category: "Casegoods", area: "Bedroom", code: "SD-502", description: "Side table @ window seat", productReference: "AHS-SD-01", mockUp: null, main: 12, ve: null },
  { designer: "AHS", category: "Casegoods", area: "Bedroom", code: "BT-503", description: "Bedside table @ bedroom", productReference: "AHS-BT-01", mockUp: 2, main: 48, ve: 48 },
  { designer: "AHS", category: "Casegoods", area: "Suite study", code: "DK-601", description: "Desk @ suite study, bronze framed", productReference: "AHS-DK-01", mockUp: null, main: 24, ve: null },
  { designer: "AHS", category: "Casegoods", area: "Entrance lobby", code: "WR-701", description: "Wardrobe @ entrance lobby, brass framed doors", productReference: "AHS-WR-01", mockUp: null, main: 24, ve: 24 },
  { designer: "AHS", category: "Casegoods", area: "Bedroom", code: "DR-702", description: "Dresser @ bedroom", productReference: "AHS-DR-01", mockUp: null, main: 24, ve: null },
  { designer: "AHS", category: "Accessories", area: "Dressing area", code: "MR-801", description: "Mirror @ dressing area", productReference: "AHS-MR-01", mockUp: null, main: 24, ve: null },
  { designer: "LHG", category: "Seating", area: "Entrance lobby", code: "LB-901", description: "Bench, luggage @ entrance", productReference: null, mockUp: null, main: 24, ve: null },
  // Deliberately unmatchable, so the demo has a record with no category: no
  // checklist, nothing outstanding, and the screens say so in words rather
  // than scoring it as finished.
  { designer: "AHS", category: "Joinery", area: "Entrance lobby", code: "JU-950", description: "Bespoke joinery unit @ lobby, refer to detail", productReference: null, mockUp: null, main: 12, ve: null },
];

export const BILL_METADATA = {
  mockUp: { revision: "A", date: "04-Aug-26" },
  main: { revision: "B", date: "28-Aug-26" },
  ve: { revision: "B", date: "28-Aug-26" },
  notes: [
    "Ashcombe House — Bedrooms & Suites. Bill of quantities, seating and casegoods.",
    "*All fabrics are COM and are not to be included in the unit costs.",
    "Quantities include a 2% attrition allowance agreed with the operator.",
  ],
};

// ---------------------------------------------------------------------------
// The shop drawings.
// ---------------------------------------------------------------------------

export type Silhouette =
  | "armchair"
  | "deskchair"
  | "sofa"
  | "headboard"
  | "ottoman"
  | "bedside"
  | "bench"
  | "table"
  | "wardrobe";

export type Callout = { label: string; value: string; code: string | null };

export type DemoDrawing = {
  sheet: string;
  code: string | null;
  name: string | null;
  silhouette: Silhouette;
  /** Figures printed against the view they are drawn on, and nothing else. */
  byView?: { view: string; figures: string[] }[];
  /** Figures printed with a label that names what they measure. */
  labelled?: { label: string; value: string; unit?: string | null }[];
  /** An overall size printed as ONE line, the way a spec sheet does it. */
  combined?: string[];
  callouts: Callout[];
  notes: { heading: string; lines: string[] }[];
  /** Printed on the sheet, if the sheet prints one. */
  unitPrinted: "mm" | "cm" | null;
  scale: string;
  /** What the item picture should be cropped from, as a fraction of the page. */
  view3d: [number, number, number, number];
};

/** Issue A: the four items that were drawn first, and are already confirmed. */
export const DRAWINGS_A: DemoDrawing[] = [
  {
    sheet: "SD-100",
    code: "AC-101",
    name: "Lounge armchair",
    silhouette: "armchair",
    // Labelled by VIEW, not by what they measure — so the slots come from the
    // figures agreeing across views, which is `guessSlotsFromViews`.
    byView: [
      { view: "FRONT", figures: ["720", "450", "880", "60", "115", "540"] },
      { view: "SIDE", figures: ["780", "880", "450", "310"] },
      { view: "PLAN", figures: ["720", "780"] },
      { view: "SIDE SECTION", figures: ["780", "450", "215"] },
    ],
    callouts: [
      { label: "SEAT & BACK", value: "Marchetti Lindow wool, colourway Fen", code: "UPH-12" },
      { label: "OUTER BACK", value: "Marchetti Lindow wool, colourway Fen", code: "UPH-12" },
      { label: "LEGS", value: "American black walnut, satin lacquer", code: "WD-04" },
      { label: "GLIDES", value: "Antique brass, screw fixed", code: "MT-02" },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Seat cushion to be feather wrapped foam, 30% feather.",
          "Back cushion fixed. No loose cushions to this item.",
          "Self piping to seat and back, single row.",
          "All exposed timber to be finished to approved sample.",
        ],
      },
      { heading: "SUPPLIER", lines: ["Manufacturer nominated at award."] },
      { heading: "REQUIRED SUBMITTALS", lines: ["Finish sample, fabric cutting, strike off."] },
    ],
    unitPrinted: null,
    scale: "1:10 @ A3",
    view3d: [0.56, 0.08, 0.96, 0.62],
  },
  {
    sheet: "SD-110",
    code: "SO-201",
    name: "Two seat sofa",
    silhouette: "sofa",
    labelled: [
      { label: "OVERALL WIDTH", value: "1820", unit: "mm" },
      { label: "OVERALL DEPTH", value: "880", unit: "mm" },
      { label: "OVERALL HEIGHT", value: "760", unit: "mm" },
      { label: "SEAT HEIGHT", value: "440", unit: "mm" },
      { label: "ARM HEIGHT", value: "620", unit: "mm" },
      { label: "SEAT DEPTH", value: "590", unit: "mm" },
    ],
    callouts: [
      { label: "SOFA", value: "Marchetti Ravello boucle, colourway Chalk", code: "UPH-08" },
      { label: "SCATTER CUSHIONS", value: "Marchetti Ravello boucle, colourway Ink", code: "UPH-09" },
      { label: "SOFA FEET", value: "American black walnut, satin lacquer", code: "WD-04" },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Two seat cushions, one back cushion per seat.",
          "Feet to be demountable for delivery through a 780mm door.",
          "Contrast piping to scatter cushions only.",
        ],
      },
      { heading: "SUPPLIER", lines: ["Manufacturer nominated at award."] },
    ],
    unitPrinted: "mm",
    scale: "1:20 @ A3",
    view3d: [0.54, 0.1, 0.96, 0.6],
  },
  {
    sheet: "SD-200",
    code: "HB-301",
    name: "Headboard, king",
    silhouette: "headboard",
    labelled: [
      { label: "OVERALL WIDTH", value: "1900", unit: "mm" },
      { label: "OVERALL DEPTH", value: "80", unit: "mm" },
      { label: "OVERALL HEIGHT", value: "1400", unit: "mm" },
      { label: "PANEL HEIGHT", value: "1180", unit: "mm" },
      { label: "FIXING CENTRES", value: "600", unit: "mm" },
    ],
    callouts: [
      { label: "FRONT FACE", value: "Marchetti Sallow linen, colourway Oat", code: "UPH-15" },
      { label: "PIPING", value: "Marchetti Sallow linen, colourway Clay", code: "UPH-03" },
      { label: "FIXING RAIL", value: "Powder coated steel, RAL 9005", code: "MT-05" },
      { label: "PIPING THREAD", value: "TBC", code: null },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Wall fixed. Split into two panels for delivery, joint on centre line.",
          "Fluting at 120mm centres, vertical.",
          "Fire retardancy to Crib 5 throughout.",
        ],
      },
      { heading: "REQUIRED SUBMITTALS", lines: ["Fabric cutting, fluting sample, fixing method statement."] },
    ],
    unitPrinted: "mm",
    scale: "1:20 @ A3",
    view3d: [0.55, 0.12, 0.96, 0.58],
  },
  {
    sheet: "SD-300",
    code: "OT-401",
    name: "Bed end ottoman",
    silhouette: "ottoman",
    // The other specification-sheet template: the overall size as ONE line,
    // no labels, and in CENTIMETRES. `parseCombinedDimensions` reads it
    // positionally and the card badges the reading as assumed.
    combined: ["80 x 70 x 42 cm"],
    callouts: [
      { label: "TOP & SIDES", value: "Marchetti Ravello boucle, colourway Chalk", code: "UPH-08" },
      { label: "BASE TRIM", value: "Bridle leather, colourway Tan", code: "LEA-02" },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Overall size is stated in centimetres on this sheet.",
          "Base trim to be applied on all four sides.",
        ],
      },
    ],
    unitPrinted: "cm",
    scale: "1:10 @ A3",
    view3d: [0.55, 0.14, 0.94, 0.56],
  },
];

/**
 * Issue B: what is still on the reviewer's desk, and deliberately awkward.
 *
 * The desk chair is drawn TWICE, once per fabric, which is 0024's
 * configuration split — one bill line, two things to make. The last sheet
 * carries no item code at all, which is the page that can never commit and is
 * collapsed on arrival.
 */
export const DRAWINGS_B: DemoDrawing[] = [
  {
    sheet: "SD-400",
    code: "BT-503",
    name: "Bedside table",
    silhouette: "bedside",
    labelled: [
      { label: "OVERALL WIDTH", value: "520", unit: "mm" },
      { label: "OVERALL DEPTH", value: "420", unit: "mm" },
      { label: "OVERALL HEIGHT", value: "580", unit: "mm" },
      { label: "DRAWER FRONT HEIGHT", value: "160", unit: "mm" },
    ],
    callouts: [
      { label: "CARCASS & TOP", value: "European oak, fumed, satin lacquer", code: "WD-06" },
      { label: "DRAWER PULLS", value: "Antique brass, machined", code: "MT-02" },
      { label: "DRAWER LINING", value: "Bridle leather, colourway to be confirmed", code: "LEA-02" },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Two drawers, soft close.",
          "Cable cut out to rear panel, 60mm diameter, grommet to match pulls.",
          "Top to be 20mm solid, edge profile to approved sample.",
        ],
      },
      { heading: "SUPPLIER", lines: ["To be confirmed at tender."] },
    ],
    unitPrinted: "mm",
    scale: "1:10 @ A3",
    view3d: [0.56, 0.12, 0.95, 0.6],
  },
  {
    sheet: "SD-120",
    code: "AC-102",
    name: "Desk chair (A configuration)",
    silhouette: "deskchair",
    labelled: [
      { label: "OVERALL WIDTH", value: "560", unit: "mm" },
      { label: "OVERALL DEPTH", value: "580", unit: "mm" },
      { label: "OVERALL HEIGHT", value: "840", unit: "mm" },
      { label: "SEAT HEIGHT", value: "470", unit: "mm" },
    ],
    callouts: [
      { label: "SEAT & INNER BACK", value: "Marchetti Lindow wool, colourway Fen", code: "UPH-12" },
      { label: "FRAME", value: "European oak, fumed, satin lacquer", code: "WD-06" },
    ],
    notes: [
      { heading: "REMARKS", lines: ["A configuration. Suite study, desk position."] },
    ],
    unitPrinted: "mm",
    scale: "1:10 @ A3",
    view3d: [0.56, 0.12, 0.95, 0.6],
  },
  {
    sheet: "SD-121",
    code: "AC-102",
    name: "Desk chair (B configuration)",
    silhouette: "deskchair",
    labelled: [
      { label: "OVERALL WIDTH", value: "560", unit: "mm" },
      { label: "OVERALL DEPTH", value: "580", unit: "mm" },
      { label: "OVERALL HEIGHT", value: "840", unit: "mm" },
      { label: "SEAT HEIGHT", value: "470", unit: "mm" },
    ],
    callouts: [
      { label: "SEAT & INNER BACK", value: "Bridle leather, colourway Tan", code: "LEA-02" },
      { label: "FRAME", value: "European oak, fumed, satin lacquer", code: "WD-06" },
    ],
    notes: [
      { heading: "REMARKS", lines: ["B configuration. Accessible rooms, leather seat."] },
    ],
    unitPrinted: "mm",
    scale: "1:10 @ A3",
    view3d: [0.56, 0.12, 0.95, 0.6],
  },
  {
    sheet: "SD-002",
    code: null,
    name: null,
    silhouette: "bench",
    labelled: [
      { label: "ROOM WIDTH", value: "4200", unit: "mm" },
      { label: "ROOM DEPTH", value: "5600", unit: "mm" },
    ],
    callouts: [],
    notes: [
      {
        heading: "GENERAL NOTES",
        lines: [
          "Do not scale from this drawing.",
          "All dimensions to be checked on site before manufacture.",
          "This sheet is a general arrangement and specifies no single item.",
        ],
      },
    ],
    unitPrinted: "mm",
    scale: "1:50 @ A3",
    view3d: [0.08, 0.1, 0.62, 0.72],
  },
];

/** The raw model output shape, from the same figures the sheet prints. */
export function rawDrawingItems(drawings: DemoDrawing[]): RawDrawingItem[] {
  return drawings.map((drawing, index) => {
    const page = index + 1;
    const dimensions = [
      ...(drawing.byView ?? []).flatMap((view) =>
        view.figures.map((figure) => ({ labelRaw: view.view, valueRaw: figure, unitRaw: drawing.unitPrinted })),
      ),
      ...(drawing.labelled ?? []).map((dimension) => ({
        labelRaw: dimension.label,
        valueRaw: dimension.value,
        unitRaw: dimension.unit ?? drawing.unitPrinted,
      })),
    ];
    return {
      itemCodeRaw: drawing.code,
      itemNameRaw: drawing.name,
      page,
      dimensions,
      dimensionsCombinedRaw: drawing.combined ?? [],
      materials: drawing.callouts.map((callout) => ({
        labelRaw: callout.label,
        valueRaw: callout.value,
        materialCodeRaw: callout.code,
      })),
      notesRaw: drawing.notes.flatMap((note) => note.lines.map((line) => `${note.heading}: ${line}`)),
      confidence: drawing.code ? ("high" as const) : ("low" as const),
      viewRegions: [
        { viewType: "3d" as const, page, bbox: drawing.view3d },
        { viewType: "front" as const, page, bbox: [0.06, 0.12, 0.34, 0.62] as [number, number, number, number] },
      ],
    };
  });
}

/**
 * Issue C: the sheet that is NOT loaded, and is written to disk instead.
 *
 * ============================================================================
 * THE ONE DOCUMENT THE DEMO DOES NOT STAGE
 *
 * Everything else arrives already read, because a walkthrough should open on a
 * project somebody has been living with. But the thing worth WATCHING is a
 * document going in — upload, read, review, confirm — and that cannot be
 * demonstrated on a pack that is already confirmed.
 *
 * So this set is built into a PDF and left on disk. Uploading it on the call
 * is a real registration: a real model read against the real prompt, staged by
 * the real worker, reviewed on the real screen. Nothing about it is special-
 * cased, which is the point — it is the only part of the demo that proves the
 * rest.
 *
 * ---- WHY THESE TWO ITEMS ---------------------------------------------------
 *
 * Both are on the bill TWICE — main run and VE — and neither has a drawing
 * yet. So each card fans out to two records across two runs, which is the
 * behaviour that is hardest to believe when it is described and obvious when
 * it is watched. They also differ from each other on purpose: the stool is
 * upholstered and labels its figures by VIEW, so the slots come from the views
 * agreeing; the wardrobe is casegoods and prints one combined overall line,
 * which is the other reader entirely. One sheet exercises both.
 *
 * It states millimetres, because a live demo is the wrong place to find out
 * whether the unit resolution abstains.
 * ============================================================================
 */
export const DRAWINGS_LIVE: DemoDrawing[] = [
  {
    sheet: "SD-500",
    code: "ST-203",
    name: "Dressing stool",
    silhouette: "ottoman",
    byView: [
      { view: "FRONT", figures: ["520", "450", "120", "40"] },
      { view: "SIDE", figures: ["400", "450", "120"] },
      { view: "PLAN", figures: ["520", "400"] },
    ],
    callouts: [
      { label: "SEAT", value: "Marchetti Sallow linen, colourway Oat", code: "UPH-15" },
      { label: "LEGS", value: "European oak, fumed, satin lacquer", code: "WD-06" },
      { label: "GLIDES", value: "Antique brass, screw fixed", code: "MT-02" },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Seat pad to be 60mm foam, wrapped, on a webbed platform.",
          "Self piping to the seat edge, single row.",
          "Legs to be removable for transit.",
        ],
      },
      { heading: "REQUIRED SUBMITTALS", lines: ["Finish sample, fabric cutting."] },
    ],
    unitPrinted: "mm",
    scale: "1:5 @ A3",
    view3d: [0.55, 0.1, 0.95, 0.6],
  },
  {
    sheet: "SD-700",
    code: "WR-701",
    name: "Wardrobe, brass framed doors",
    silhouette: "wardrobe",
    // One combined line with a printed prefix on each part, which
    // `parseCombinedDimensions` takes exactly rather than positionally.
    combined: ["W1200 x D620 x H2100 mm"],
    labelled: [{ label: "DOOR THICKNESS", value: "42", unit: "mm" }],
    callouts: [
      { label: "CARCASS", value: "European oak, fumed, satin lacquer", code: "WD-06" },
      { label: "DOOR FRAMES", value: "Antique brass, brushed", code: "MT-05" },
      { label: "DOOR PANELS", value: "Antique bronze mirror glass", code: "GLS-02" },
      { label: "INTERIOR", value: "European oak, natural, matt lacquer", code: "WD-11" },
    ],
    notes: [
      {
        heading: "REMARKS",
        lines: [
          "Carcass, doors and cornice to deliver separately and assemble on site.",
          "Hanging rail to be brass, with LED strip above.",
          "All exposed timber to be finished to approved sample.",
        ],
      },
      { heading: "SUPPLIER", lines: ["Manufacturer nominated at award."] },
      { heading: "REQUIRED SUBMITTALS", lines: ["Finish sample, glass sample, hardware sample."] },
    ],
    unitPrinted: "mm",
    scale: "1:20 @ A3",
    view3d: [0.55, 0.08, 0.95, 0.66],
  },
];

// ---------------------------------------------------------------------------
// The FF&E preamble.
// ---------------------------------------------------------------------------

export const PREAMBLE_NOTES = [
  {
    topicRaw: "Fire retardancy",
    titleRaw: "All upholstery to Crib 5",
    bodyRaw:
      "All upholstered items are to meet BS 5852 Crib 5 throughout, including scatter cushions and any decorative trim. Certification is to be provided with the first delivery of each item.",
    page: 1,
  },
  {
    topicRaw: "Fabric supply",
    titleRaw: "COM supplied free issue",
    bodyRaw:
      "All fabrics are client's own material, supplied free issue to the manufacturer. Metreage is to be confirmed by the manufacturer at order stage and is not included in the unit rates.",
    page: 1,
  },
  {
    topicRaw: "Samples",
    titleRaw: "Strike off before bulk",
    bodyRaw:
      "A strike off is required for every upholstered item before bulk manufacture. Two sets of finish samples are required for each timber and metal finish.",
    page: 1,
  },
  {
    topicRaw: "Delivery",
    titleRaw: "Access is 780mm",
    bodyRaw:
      "The narrowest access to the guest floors is 780mm. Any item wider than this is to be demountable, and the method is to be agreed before manufacture.",
    page: 2,
  },
  {
    topicRaw: "Warranty",
    titleRaw: "Five years on frames",
    bodyRaw:
      "Frames carry a five year warranty. Upholstery, foam and finishes carry two years from the date of practical completion.",
    page: 2,
  },
];

// ---------------------------------------------------------------------------
// The correspondence.
// ---------------------------------------------------------------------------

export const FROM = {
  designer: `${CONTACTS[0]!.name} <${CONTACTS[0]!.email}>`,
  pm: `${CONTACTS[1]!.name} <${CONTACTS[1]!.email}>`,
  supplier: `${CONTACTS[2]!.name} <${CONTACTS[2]!.email}>`,
  us: "Max de Groot <max.degroot@example.com>",
  accounts: "Accounts <accounts@example.com>",
};

export type DemoMessage = {
  key: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  daysAgo: number;
  hour: number;
  body: string;
  /** What routing is EXPECTED to do. Printed beside what it actually did. */
  expect: string;
};

/** Held in the shared inbox, waiting for somebody to place them. */
export const INBOX: DemoMessage[] = [
  {
    key: "ottoman-fabric",
    from: FROM.designer,
    to: [PROJECT.inbox],
    subject: "Ashcombe House — OT-401 bed end ottoman, fabric",
    daysAgo: 1,
    hour: 9,
    body: [
      "Morning,",
      "",
      "Confirming the bed end ottoman OT-401 is to be in the Ravello boucle, colourway Chalk, same as the sofa. The base trim stays as the bridle leather in Tan.",
      "",
      "Could you also let me know whether the trim is applied on all four sides — the drawing says so but the FF&E schedule only mentions the front.",
      "",
      "Priya",
    ].join("\n"),
    expect: "assigned — the project inbox is in To",
  },
  {
    key: "headboard-query",
    from: FROM.pm,
    to: ["specs@example.com"],
    cc: [FROM.designer],
    subject: "HB-302 twin headboards — fabric still showing TBC",
    daysAgo: 2,
    hour: 16,
    body: [
      "Hello,",
      "",
      "The twin room headboards HB-302 are still showing TBC against the fabric on the last issue. We need this for the quote — can you chase Priya?",
      "",
      "Dominic",
    ].join("\n"),
    expect: "held — the sender is a contact, but the inbox is not named",
  },
  {
    key: "lead-times",
    from: FROM.supplier,
    to: ["max.degroot@example.com"],
    subject: "Lindow wool — lead times for the autumn",
    daysAgo: 3,
    hour: 11,
    body: [
      "Hi Max,",
      "",
      "The Lindow wool in Fen is running at eleven weeks from order at the moment. Ravello is six.",
      "",
      "Nothing to action, just so you have it for the programme.",
      "",
      "Elena",
    ].join("\n"),
    expect: "held — a supplier on no project we can see",
  },
  {
    key: "invoice",
    from: FROM.accounts,
    to: ["accounts@example.com"],
    subject: "Statement of account — August",
    daysAgo: 4,
    hour: 8,
    body: ["Please find the August statement attached.", "", "Accounts"].join("\n"),
    expect: "held — nothing about it names a project, correctly",
  },
  {
    key: "site-visit",
    from: FROM.pm,
    to: [PROJECT.inbox],
    cc: [FROM.designer],
    subject: "DEMO-01 — mock up room sign off, Thursday",
    daysAgo: 5,
    hour: 14,
    body: [
      "All,",
      "",
      "The mock up room is ready for sign off on Thursday at 10. Priya will walk it with the operator.",
      "",
      "Dominic",
    ].join("\n"),
    expect: "assigned — the project inbox is in To",
  },
];

/**
 * The email that is ON the project and still on the reviewer's desk.
 *
 * Written so every value in it lands somewhere different: a seat height into a
 * dimension slot, two fabrics into COM fields, a timber into the main timber
 * finish, and one line that places nowhere at all and is correct to leave
 * unplaced.
 */
export const REVIEW_EMAIL = {
  key: "ac101-specs",
  from: FROM.designer,
  to: [PROJECT.inbox],
  cc: [FROM.pm],
  subject: "Ashcombe House — AC-101 lounge armchair, revised specification",
  daysAgo: 1,
  hour: 15,
  body: [
    "Hello,",
    "",
    "Following the mock up room, a few changes to the lounge armchair AC-101:",
    "",
    "The seat height is to come up to 465mm (measured to the top of the cushion, uncompressed). Overall height is unchanged at 880mm.",
    "",
    "The seat and inner back move to the Ravello boucle in Chalk, same cloth as the sofa. The outer back stays in the Lindow wool in Fen.",
    "",
    "Legs are now to be the fumed European oak rather than the walnut, to match the desk chair frame.",
    "",
    "Arm height stays as drawn at 620mm.",
    "",
    "Priya",
  ].join("\n"),
  /** What the model would have returned, in its own output shape. */
  proposals: [
    {
      refRaw: "AC-101",
      attributeRaw: "Seat height",
      valueRaw: "465mm (measured to the top of the cushion, uncompressed)",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "high" as const,
      note: null,
      quotedText: "The seat height is to come up to 465mm (measured to the top of the cushion, uncompressed).",
      changeIntent: "changes" as const,
    },
    {
      refRaw: "AC-101",
      attributeRaw: "Overall height",
      valueRaw: "880mm",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "high" as const,
      note: null,
      quotedText: "Overall height is unchanged at 880mm.",
      changeIntent: "confirms_tbc" as const,
    },
    {
      refRaw: "AC-101",
      attributeRaw: "Seat and inner back fabric",
      valueRaw: "UPH-08 Marchetti Ravello boucle, colourway Chalk",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "high" as const,
      note: null,
      quotedText: "The seat and inner back move to the Ravello boucle in Chalk, same cloth as the sofa.",
      changeIntent: "changes" as const,
    },
    {
      refRaw: "AC-101",
      attributeRaw: "Outer back fabric",
      valueRaw: "UPH-12 Marchetti Lindow wool, colourway Fen",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "medium" as const,
      note: null,
      quotedText: "The outer back stays in the Lindow wool in Fen.",
      changeIntent: "adds" as const,
    },
    {
      refRaw: "AC-101",
      attributeRaw: "Leg timber finish",
      valueRaw: "WD-06 European oak, fumed, satin lacquer",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "high" as const,
      note: null,
      quotedText: "Legs are now to be the fumed European oak rather than the walnut.",
      changeIntent: "changes" as const,
    },
    {
      refRaw: "AC-101",
      attributeRaw: "Arm height",
      valueRaw: "620mm",
      page: null,
      sourceSheet: null,
      sourceRow: null,
      confidence: "medium" as const,
      note: null,
      quotedText: "Arm height stays as drawn at 620mm.",
      changeIntent: "adds" as const,
    },
  ],
  documentNotes:
    "A reply to the mock up room review. It changes the armchair's seat height, its seat fabric and its leg timber, and confirms two values that were already drawn.",
};

// ---------------------------------------------------------------------------
// The finishes library.
//
// The drawing confirms create most of these from the codes their callouts
// carry. These are the rest: the codes a person pastes in from the finishes
// schedule before anything has been drawn.
// ---------------------------------------------------------------------------

export const PASTED_FINISHES = ["UPH-09", "WD-11", "MT-08", "STO-01", "GLS-02"];

export const FINISH_DETAIL: Record<string, { kind: string; description: string; supplier: string | null; reference: string | null; colour: [number, number, number] }> = {
  "UPH-03": { kind: "fabric", description: "Marchetti Sallow linen, colourway Clay", supplier: "Marchetti Contract Furnishings", reference: "SAL/CLA", colour: [176, 154, 137] },
  "UPH-08": { kind: "fabric", description: "Marchetti Ravello boucle, colourway Chalk", supplier: "Marchetti Contract Furnishings", reference: "RAV/CHA", colour: [226, 219, 205] },
  "UPH-09": { kind: "fabric", description: "Marchetti Ravello boucle, colourway Ink", supplier: "Marchetti Contract Furnishings", reference: "RAV/INK", colour: [44, 52, 72] },
  "UPH-12": { kind: "fabric", description: "Marchetti Lindow wool, colourway Fen", supplier: "Marchetti Contract Furnishings", reference: "LIN/FEN", colour: [96, 110, 92] },
  "UPH-15": { kind: "fabric", description: "Marchetti Sallow linen, colourway Oat", supplier: "Marchetti Contract Furnishings", reference: "SAL/OAT", colour: [210, 197, 172] },
  "LEA-02": { kind: "leather", description: "Bridle leather, colourway Tan", supplier: "Northbank Hides", reference: "BRD/TAN", colour: [150, 100, 62] },
  "WD-04": { kind: "timber", description: "American black walnut, satin lacquer", supplier: null, reference: null, colour: [92, 66, 47] },
  "WD-06": { kind: "timber", description: "European oak, fumed, satin lacquer", supplier: null, reference: null, colour: [128, 103, 74] },
  "WD-11": { kind: "timber", description: "Sycamore, dyed, open pore", supplier: null, reference: null, colour: [196, 176, 143] },
  "MT-02": { kind: "metal", description: "Antique brass, screw fixed", supplier: null, reference: null, colour: [166, 134, 70] },
  "MT-05": { kind: "metal", description: "Powder coated steel, RAL 9005", supplier: null, reference: null, colour: [40, 40, 42] },
  "MT-08": { kind: "metal", description: "Polished nickel", supplier: null, reference: null, colour: [178, 182, 186] },
  "STO-01": { kind: "stone", description: "Calacatta Viola, honed", supplier: null, reference: null, colour: [214, 204, 200] },
  "GLS-02": { kind: "glass", description: "Bronze tinted mirror", supplier: null, reference: null, colour: [128, 104, 84] },
};
