// The specification a person has already worked up, so the demo opens on a
// project somebody has clearly been living with rather than an empty grid.
//
// ============================================================================
// WHY THIS IS TYPED IN RATHER THAN EXTRACTED
//
// Everything in tools/demo/content.ts came off a document — the bill, the
// drawings, the preamble, the email — and reaches the checklist through the
// app's own confirm paths, carrying its page. That is the part of the product
// worth demonstrating and it is left exactly as it was.
//
// These are the OTHER kind of answer, and the product has always had both: the
// ones a KAM answers from a phone call, a site visit or the terms of business,
// which no document in the pack states. `editAnswer` marks them `manual`, and
// CLAUDE.md's rule is that a person's answer is the one thing no later
// document may overwrite — so writing them here also demonstrates that rule,
// because the drawings already on record cannot reach them.
//
// ---- THE GAP IS DESIGNED, NOT LEFT OVER ------------------------------------
//
// A project answered 100% has nothing to chase, no TGQ blockers and no reason
// for the drafts screen to exist. `OUTSTANDING` below names the questions that
// stay unanswered, and they are all the same KIND of question: the fabric and
// upholstery detail a designer settles, which is what a real chase is about.
// That concentration is deliberate — twenty percent scattered at random reads
// as carelessness, twenty percent sitting on COM 2, stitching and stud specs
// reads as a project waiting on one reply.
//
// NOTHING HERE IS OVERWRITTEN ONTO AN EXISTING ANSWER. Only rows still
// `missing` are touched, so the 49 answers the drawings and the preamble
// already filled keep their provenance and their source page.
// ============================================================================

export type DemoAnswerState = "confirmed" | "tbc" | "na";
export type DemoAnswer = { value: string | null; state: DemoAnswerState };

/** What the bank knows about the record it is answering for. */
export type RecordContext = {
  code: string | null;
  description: string;
  category: string | null;
  level: string | null;
};

type Resolver = DemoAnswer | null | ((context: RecordContext) => DemoAnswer | null);

const confirmed = (value: string): DemoAnswer => ({ value, state: "confirmed" });
const tbc = (value: string | null = null): DemoAnswer => ({ value, state: "tbc" });
const na: DemoAnswer = { value: null, state: "na" };

// ---------------------------------------------------------------------------
// Which item is this? The bill's own codes, read off the two-letter prefix,
// because the category is null on the one record nothing could place.
// ---------------------------------------------------------------------------
const prefix = (context: RecordContext): string => (context.code ?? "").slice(0, 2).toUpperCase();

const isUpholstered = (context: RecordContext): boolean =>
  ["AC", "SO", "BE", "ST", "HB", "OT", "LB"].includes(prefix(context));
const isCasegoods = (context: RecordContext): boolean =>
  ["DK", "WR", "DR", "BT", "CT", "SD", "MR", "JU"].includes(prefix(context));
const isSeating = (context: RecordContext): boolean => ["AC", "SO", "BE", "ST", "LB"].includes(prefix(context));
const isTable = (context: RecordContext): boolean => ["CT", "SD", "BT", "DK"].includes(prefix(context));
const isHeadboard = (context: RecordContext): boolean => prefix(context) === "HB";
const isDeskChair = (context: RecordContext): boolean => (context.code ?? "") === "AC-102";

// ---------------------------------------------------------------------------
// THE QUESTIONS THAT STAY OPEN.
//
// Everything a designer has to settle before a fabric can be cut. They are the
// demo's chase list and its TGQ blockers, and they are the reason the Waiting
// column and the "Needed to quote" banner have anything in them.
// ---------------------------------------------------------------------------
export const OUTSTANDING = new Set<string>([
  "COM 2",
  "COM 3",
  "Fabric quantities",
  "Stitching spec",
  "Stud spec",
  "Timber finish 2 + location",
  "Timber finish 3 + location",
  "Fluted, Deep buttons & pleats specs",
]);

// ---------------------------------------------------------------------------
// The bank. Keyed on the requirement's own prompt, exactly as it is seeded —
// the cheat sheets are seed data, so a prompt that changes should MISS here
// and leave the question unanswered, rather than a fuzzy match landing a
// warranty answer on a fire question.
// ---------------------------------------------------------------------------
export const ANSWER_BANK: Record<string, Resolver> = {
  // ---- Project and commercial ---------------------------------------------
  // Answered once, true of every item, which is exactly why a KAM resents
  // being asked them twenty-nine times.
  "BWS project page/folder set up":
    confirmed("Yes — project folder opened 12 Aug 2026, drawings and correspondence filed under it"),
  "COM Payment Plan":
    confirmed("50% with order, 40% on completion of production, 10% on delivery to site"),
  "Can Design and Projects proced without deposit confirmed?":
    confirmed("No — deposit must be receipted before production drawings are issued"),
  "Client contact list":
    confirmed("Priya Raman (Ashcombe House Studio, design); Dominic Searle (Larkspur Hotel Group, project management)"),
  "Client sign off visit required? BG or PT? What type?":
    confirmed("Yes — BG. Mock-up room sign off at the factory, one visit, before bulk release"),
  "Counter samples from client required?":
    confirmed("Yes — one counter sample per upholstered item, approved in writing before bulk cutting"),
  "Delivery direct to the client from PT or BG?":
    confirmed("BG — consolidated delivery to site, phased by floor"),
  "Expedited project confirmed by Jason?": confirmed("No — standard programme, delivery 18 Dec 2026"),
  "FSC required?": confirmed("Yes — FSC Mix 70% minimum on all timber, certificates with the first delivery"),
  "Floor Plans": confirmed("Issued with the tender pack — AH-GA-100 rev C, suites and bedrooms"),
  "Have you allowed for Access Check and Site Survey?":
    confirmed("Yes — site survey booked 6 Oct 2026, access check carried out with it"),
  "Is access ok? Lift info (is there a lift or lift size) Standard door (740 x 1900 mm)":
    confirmed("Goods lift 1100 x 2000 x 2200mm. Doors 780 x 1980mm throughout — narrower than standard, see split note"),
  "Project / Client context":
    confirmed("Ashcombe House, a 96-key country house hotel for Larkspur. Bedrooms and suites package; the suites are the client's showcase"),
  "Prototype required? Raw or with finish?":
    (context) =>
      isUpholstered(context) && context.level === "hero"
        ? confirmed("Yes — with finish. Full prototype for sign off at the mock-up room review")
        : confirmed("No — mock-up room sample stands as the prototype"),
  "Sales folder - folder selection": confirmed("Contract seating and casegoods — hospitality"),
  "Special finish required?": (context) =>
    isUpholstered(context)
      ? confirmed("No — standard BW finishes throughout, hand-finished to the approved sample")
      : confirmed("Yes — hand-applied ceruse on the oak, to the approved panel"),
  "TOE agreement": confirmed("Signed 10 Aug 2026. Order date 10 Aug, specs agreed by 25 Sep, delivery 18 Dec 2026"),
  "The client is expecting exact copy from their drawing or there is possibility of sugestion BW standards? (sabos, metal bars, curved back, leg thickness, etc)":
    confirmed("BW standards may be suggested and are welcomed where they improve durability — the designer asks to see them drawn before they are adopted"),
  "Purchasing notes":
    confirmed("Fabric free-issued by the client through Marchetti Contract Furnishings; BW to supply all timber, metalwork and hardware"),
  "Assembly guide required": confirmed("No — items deliver assembled other than the wardrobes"),

  // ---- Design intent -------------------------------------------------------
  "Image/ Drawing/ Repeat Reference":
    confirmed("Shop drawings issue A, sheets SD-100 to SD-103, issued 28 Aug 2026"),

  // ---- Build details -------------------------------------------------------
  "Floor type": (context) =>
    isHeadboard(context)
      ? confirmed("Wall fixed — carpet on underlay below, 12mm pile")
      : confirmed("Carpet on 10mm underlay in bedrooms; engineered oak in the suite living areas"),
  "Needs split? Where?": (context) => {
    if (prefix(context) === "WR") return confirmed("Yes — carcass, doors and cornice separate. Doors hung on site");
    if (prefix(context) === "SO") return confirmed("Yes — back demountable, to pass a 780mm door");
    if (prefix(context) === "JU") return tbc("Detail drawing not yet issued — split to be agreed with the joiner");
    return confirmed("No — passes a 780mm door assembled");
  },
  Substrate: (context) =>
    isUpholstered(context)
      ? confirmed("Kiln-dried hardwood frame, 18mm birch ply panels, webbed and sprung seat platform")
      : confirmed("18mm veneered MDF carcass on a solid oak frame, 25mm tops"),
  "Indoor/ Outdoor / Humid environment": confirmed("Indoor"),
  "Is fully outdoor or partially protected?": na,
  "Storm covers needed?": na,
  "Interliner required?": (context) =>
    isUpholstered(context)
      ? confirmed("Yes — FR interliner throughout, Crib 5")
      : na,
  "Fabric with pattern? Direction?": (context) =>
    isUpholstered(context)
      ? confirmed("UPH-03 is a plain weave, railroaded. UPH-08 carries a vertical stripe — run up the back, no match required across seams")
      : na,
  "Seat upholstery build — loose or fixed?": (context) =>
    isSeating(context) ? confirmed("Fixed seat, feather and foam wrap over a sprung platform") : na,
  "Back upholstery build — loose or fixed?": (context) =>
    isSeating(context) ? confirmed("Loose back cushion, feather wrapped foam core") : na,
  "Back cushion type": (context) =>
    isSeating(context) ? confirmed("Feather wrapped foam, 30% down, channelled to hold shape") : na,
  "Swivel Mechanism 360 or 180 (return or non return also)?": (context) =>
    isDeskChair(context) ? confirmed("360° swivel, self-returning, on a concealed plate") : na,
  "Headboard fitted?": (context) =>
    isHeadboard(context) ? confirmed("Yes — wall fixed on a French cleat, 1200mm above finished floor") : na,
  "Is skirting present?": (context) =>
    isHeadboard(context) ? confirmed("Yes — 120mm skirting. Headboard scribed over it") : na,
  "Wall build": (context) =>
    isHeadboard(context) ? confirmed("Stud with 18mm ply pattress behind every headboard position") : na,
  "Handles spec, etc": (context) =>
    isCasegoods(context)
      ? confirmed("MT-05 antique brass pull, 128mm centres, to the designer's drawing AH-DT-410")
      : na,
  "Any Specialist Hardware required?": (context) =>
    isCasegoods(context) ? confirmed("Soft-close throughout. Wardrobe doors on concealed pivot hinges") : confirmed("No"),
  "Any Specialist Lighting/ Power Required?": (context) => {
    if (prefix(context) === "WR") return confirmed("Yes — LED strip to the hanging rail, driver in the carcass head");
    if (prefix(context) === "DK") return confirmed("Yes — twin socket and USB-C in a brushed brass grommet");
    if (prefix(context) === "BT") return confirmed("Yes — twin socket and USB-C to the rear of the drawer box");
    return na;
  },
  "Do we need to have access for wires through the table?": (context) =>
    prefix(context) === "DK" || prefix(context) === "BT"
      ? confirmed("Yes — 60mm brushed brass grommet, rear right, with a cable route to the floor")
      : na,
  "Lighting spec and positions": (context) =>
    prefix(context) === "WR" ? confirmed("LED strip 2700K, 90 CRI, to the underside of the carcass head") : na,
  "Socket spec and positions": (context) =>
    prefix(context) === "DK" || prefix(context) === "BT"
      ? confirmed("Twin 13A and USB-C, brushed brass, rear right at 150mm above the floor")
      : na,
  "Is it sitting alongside sofa's tables BW need to be aware of?": (context) =>
    isTable(context)
      ? confirmed("Yes — the side table sits to the lounge armchair AC-101; top set 20mm below the arm")
      : confirmed("No"),
  "Has the client provided details (heights, top thickness, base design) of the tables?": (context) =>
    isTable(context) ? confirmed("Yes — shop drawings issue A, 25mm tops on a bronze frame") : na,
  "Has the client provided details (heights, SH, etc.) of the chairs?": (context) =>
    isSeating(context) ? confirmed("Yes — seat heights dimensioned on the issue A drawings") : na,
  "Has client been advised of BW Standards?": confirmed("Yes — BW standards pack issued with the tender return, 28 Aug 2026"),
  "BW Standard felt or COM/BOM?": confirmed("BW standard felt, dark grey, on all floor-contact surfaces"),
  "Make client aware of BW standard lid stays": confirmed("Yes — client accepts the BW standard soft-close lid stay"),
  "Runners": (context) =>
    isCasegoods(context) ? confirmed("Blum Movento, full extension, soft-close, concealed") : na,
  "Door Hinges": (context) =>
    prefix(context) === "WR" || prefix(context) === "DR"
      ? confirmed("Concealed pivot hinge, soft-close, adjustable in three planes")
      : na,
  "Drawer Liner": (context) =>
    isCasegoods(context) ? confirmed("Taupe suede-effect liner, loose laid, to the designer's sample") : na,
  "Glass / Mirror Details": (context) =>
    prefix(context) === "MR"
      ? confirmed("GLS-02 — 6mm low-iron mirror, polished edge, safety backed to BS EN 12600")
      : na,
  "Stone Details": (context) =>
    prefix(context) === "CT" || prefix(context) === "SD"
      ? confirmed("STO-01 — honed Calacatta Viola, 20mm with a 5mm arris, sealed")
      : na,

  // ---- Metalwork -----------------------------------------------------------
  "Project sold with metal finish or metal paint effect?":
    confirmed("Metal finish — MT-05 antique brass and MT-02 blackened bronze. No paint effect anywhere on this project"),
  "Visible fixinings standard RAL 9005 Powder Coated":
    confirmed("Yes — RAL 9005 unless the fixing falls on a brass frame, where it matches MT-05"),
  "Metal finish 2 + location": (context) =>
    prefix(context) === "DK" || prefix(context) === "WR"
      ? confirmed("MT-02 blackened bronze — frame and stretchers")
      : na,

  // ---- Dimensions ----------------------------------------------------------
  // Left alone. Every one of these that is answered came off a drawing and
  // composed through `composeDimensionCell`; typing one here would put a
  // dimension on a record no attribute backs, which is the one thing
  // promote-answers.ts exists to keep true.
  Dimensions: null,

  // Filled by the drawings where a drawing exists. Everything else waits for
  // the finishes schedule, which is the point of the library screen.
  "Main timber finish": (context) =>
    isCasegoods(context) ? confirmed("WD-04 — European oak, hand-applied ceruse, matt lacquer") : null,
};

/**
 * What to write on one answer, or null to leave it alone.
 *
 * A prompt the bank does not know, and every prompt named in `OUTSTANDING`,
 * returns null — which is what keeps the gap in the demo the shape it was
 * designed to be rather than whatever happened to be missing from the bank.
 */
export function demoAnswerFor(prompt: string, context: RecordContext): DemoAnswer | null {
  if (OUTSTANDING.has(prompt)) return null;
  const entry = ANSWER_BANK[prompt];
  if (entry === undefined || entry === null) return null;
  return typeof entry === "function" ? entry(context) : entry;
}
