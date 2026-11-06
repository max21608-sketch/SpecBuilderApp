"use client";

// The review screen. Everything here is a draft: nothing has been written to a
// spec record until Confirm.
//
// Category suggestions are shown with the document's own wording next to them,
// and an ambiguous match offers candidates rather than picking one. A line the
// matcher could not resolve stays blank — a plausible guess in a field a human
// skims past is worse than an obvious gap.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PreambleReview from "@/components/imports/PreambleReview";
import FinishScheduleReview from "@/components/imports/FinishScheduleReview";
import Button, { buttonClass } from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import NeedsYou from "@/components/ui/NeedsYou";
import { billLineId, billNeedsYou, needsYouListId, sheetColumnsId, sheetsWaiting, transcriptionNeedsYou } from "@/lib/needs-you";
import { goToAndFlash } from "@/lib/go-to";
import { TONE } from "@/components/ui/tone";
import PageHeader from "@/components/ui/PageHeader";
import NextStepAction from "@/components/ui/NextStepAction";
import { useNextStep } from "@/lib/use-next-step";
import SuggestButton from "@/components/ui/SuggestButton";
import BillCategoryCell from "@/components/imports/BillCategoryCell";
import { suggestedCategoryId } from "@/lib/bill-category";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import Tip from "@/components/ui/Tip";
import { ClientRefs } from "@/components/ui/ClientRefs";
import { ITEM_LEVELS, ITEM_LEVEL_LABELS, isItemLevel } from "@/lib/spec-vocab";
// Pure and type-only inside: the parser's own wording for what it did with a
// sheet, so the screen cannot describe the parse differently from the parser.
import { describeHeader, sheetsAwaitingColumnCheck, sheetsNeedingColumns } from "@/lib/boq-import";
import { quantityNotGiven } from "@/lib/printed-number";
import { pdfPageOfLine } from "@/lib/pdf-bill-source";
import { transcriptionChecks, type LineCheck } from "@/lib/pdf-bill-checks";
import PdfTranscriptionPanel from "@/components/imports/PdfTranscriptionPanel";
import { sheetWantsStructureRead } from "@/lib/boq-structure-wanted";
import {
  NO_CODES_REVIEW_SENTENCE,
  readMockupQty,
} from "@/lib/bill-sheet-notices";
// Pure: the one rule about what a row is, what stops a fabric line, and what
// the Confirm button says it will write — the same functions the confirm runs.
import {
  boqConfirmCounts,
  boqConfirmBlocker,
  boqConfirmLabel,
  rowKindProblems,
} from "@/lib/boq-row-kinds";
import BoqRowKindCell, { RowKindReasoning } from "@/components/imports/BoqRowKindCell";
import { fabricCodeDisplay, fabricFilingCode } from "@/lib/boq-row-kinds";
// Pure: where the review draws its lines — an item and the fabrics under it as
// one group, a gap between groups, consecutive items of one code bracketed.
// Layout only; nothing the confirm writes reads it.
import { groupBillLines, type BillFamily, type BillGroupMember } from "@/lib/bill-review-groups";
// What each item's description cell becomes — the plan the confirm writes,
// computed on the server by `planSheetDescriptions` and only rendered here.
import {
  BillDescriptionPanelRow,
  BillDescriptionSummary,
} from "@/components/imports/BillDescription";
import { BillUnitAll } from "@/components/imports/BillDescription";
import {
  effectiveRowImage,
  isNoPicture,
  isPictureCrop,
  rowImageFor,
  type BillRowImage,
} from "@/lib/bill-row-image";
// A row's picture opened under it: crop it, take it whole, or take none.
import BillPicturePanelRow from "@/components/imports/BillPicturePanel";
// Type only: the plan is computed on the server (`planBillFabrics`).
import type { FabricLinePlan } from "@/lib/bill-fabric-filing";
// Pure: the area a record will carry (a Sub-Area composed in), the same
// function the confirm writes it with, so the table shows what will be written.
import { effectiveArea } from "@/lib/boq-reconcile";
import {
  BOQ_ROLE_LABELS,
  BOQ_MAPPING_SOURCE_LABELS,
  columnLetter,
  columnsAwaitingALook,
  composeBillNotes,
  type BoqReadRole,
} from "@/lib/boq-roles";
import BoqColumnsPanel from "@/components/imports/BoqColumnsPanel";
// Pure: the "this may not be furniture" question, and the set the batch action
// acts on. The page NEVER decides either for itself — one function behind the
// count on the button and the loop behind it.
import { linesToIgnore, nonFurnitureOf } from "@/lib/non-furniture-guess";
// Pure: the refs one tab carries twice, and — the same set, which is why it is
// one module — the rows a decision on this tab reaches on the others. The
// duplicate panel used to compute its own fold here; the carry must use
// `normaliseRef`, and two folds is how the amber panel and the carry come to
// disagree about which rows are ambiguous.
import { duplicateGroups } from "@/lib/boq-carry";
import { formatDay } from "@/lib/format-day";
import { clampText } from "@/lib/shout";
import PageBody from "@/components/ui/PageBody";
import Tabs from "@/components/ui/Tabs";
import { useBoqImport, type Line, type StructureReadState } from "@/components/imports/use-boq-import";
import RevisionPanel, { PairingCell } from "@/components/imports/RevisionPanel";


/**
 * WHAT A FINISH LINE DOES TO THE FINISHES LIBRARY — "new library entry
 * GR-FAB-13 · swatch: this row's picture" — one quiet line under the chip,
 * which says where it goes ("GR-FAB-13 → COM 2", "→ kept, no BWS field
 * (trim)"), since 2026-10-06 in place of "→ next free COM", which a metal is not;
 * the layout's density rule. Where the line mints in the default `BW-F-`
 * series because the project has no short code, the way to set one is a link
 * to the project's details: setting it changes what is minted, not what is
 * already there.
 */
/**
 * A FABRIC LINE'S CODE COLUMN prints the code it is filed under — the one the
 * chip beside it and the confirm both read (`fabricFilingCode`) — or TBC where it has
 * none (2026-10-12: Sebastian, a fabric with no code of its own reads TBC,
 * never N/A and never the item's code). Where the bill's cell says something
 * else it stays underneath, small and grey, because it is what the document
 * said. Display only.
 */
function FabricCodeCell({ line }: { line: Pick<Line, "code" | "finishCode" | "finishFor"> }) {
  const { own, billCell, billCellIsItemCode } = fabricCodeDisplay(line);
  return (
    <>
      {own ? (
        <ClientRefs code={own} />
      ) : (
        <Chip tone="warn" className="font-sans">
          TBC: no code
        </Chip>
      )}
      {billCell && (
        <span className="mt-0.5 block font-sans text-[10.5px] text-neutral-400" title="The bill's own cell">
          {/* Never broken at its hyphens: `MUR-FUR--04` split over two lines
              reads as two codes (the ClientRefs rule). */}
          bill: <ClientRefs code={billCell} />
          {billCellIsItemCode ? " (the item's code)" : ""}
        </span>
      )}
    </>
  );
}

function FabricFilingLine({ plan, projectId }: { plan: FabricLinePlan; projectId: string }) {
  return (
    <span className="mt-0.5 block text-[11px] leading-4 text-neutral-500">
      {/* The field is on the chip above it; this is the filing. */}
      {/* THE STATE THE CONFIRM WILL STORE (`fabricLineWrite`): a line that
          names no fabric is written TBC, so it is chased rather than shipped. */}
      {plan.tbc && <span className="font-medium text-amber-800">written TBC · </span>}
      {/* A line filed by its COM code writes its finish column's cloth, not
          the description printed above it — said, so the row is not read as
          writing "SOFA @ FABRIC". */}
      {plan.writes && (
        <span className="block text-neutral-700">
          writes “{plan.writes.value}”{plan.writes.qualifier ? ` — ${plan.writes.qualifier}` : ""}
        </span>
      )}
      {plan.filing}
      {plan.askForShortCode && (
        <>
          {" ("}
          <a
            href={`/dashboard/projects/${encodeURIComponent(projectId)}#project-details`}
            className="text-blue-700 no-underline hover:underline"
          >
            set a short code on the project
          </a>
          {")"}
        </>
      )}
      {plan.swatch && <> · {plan.swatch}</>}
    </span>
  );
}

/**
 * THE PICTURE THE BILL PRINTS ON THIS ROW, at a FIXED size beside the item's
 * name — never a column of its own and never wider than 52px, so a bill of
 * three hundred pictures cannot push the table past its box (the overflow
 * rule). It is what the confirm gives the record where the record has no
 * picture; a drawing crop later replaces it. Several different pictures on one
 * row are said in words by the caller, and none is taken.
 *
 * A FABRIC LINE'S picture is its SWATCH, 36px, from the same route. It used to
 * be suppressed altogether, so a bill that prints a swatch on every fabric line
 * stored them all and showed none. A fabric line with no single picture shows
 * an empty dashed frame that says so, so a missing swatch reads as the bill's
 * and not the app's.
 */
function BillRowPicture({
  importId,
  sheetIndex,
  lineNo,
  image,
  size,
  version = 0,
  chosenNone = false,
  open = false,
  onOpen,
}: {
  importId: string;
  sheetIndex: number;
  lineNo: number;
  /** What the row will give — `effectiveRowImage`, the confirm's own answer. */
  image: BillRowImage | null;
  size: "thumb" | "swatch";
  /** The row's picture version: a new one is a new URL, so a crop is not hidden behind the cache. */
  version?: number;
  /** A person chose no picture for the row. */
  chosenNone?: boolean;
  open?: boolean;
  /** Opens the row's picture panel. Absent where nothing about the picture can change. */
  onOpen?: () => void;
}) {
  const swatch = size === "swatch";
  const what = swatch ? "swatch" : "picture";
  const wrap = (content: ReactNode) =>
    onOpen ? (
      // A BUTTON, not a link: it opens a panel in place and goes nowhere.
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-label={`Change the ${what} on row ${lineNo}`}
        title={`Crop the ${what}, take it whole, or take none`}
        className="block shrink-0 cursor-pointer rounded hover:ring-2 hover:ring-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        {content}
      </button>
    ) : (
      content
    );
  if (!image?.pathname) {
    // An item with nothing to show draws nothing — unless there is something
    // to change: a "no picture" somebody chose, or two pictures nobody took.
    if (!swatch && !(onOpen && (chosenNone || image))) return null;
    return wrap(
      <span
        className={
          swatch
            ? "block h-9 w-9 shrink-0 rounded border border-dashed border-neutral-300 bg-white"
            : "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded border border-dashed border-neutral-300 bg-white text-center text-[10px] leading-tight text-neutral-500"
        }
        title={
          chosenNone
            ? `No ${what} — chosen on this review`
            : image
              ? `${image.pictures} pictures on this row — none is taken as the swatch`
              : "The bill has no picture on this row"
        }
      >
        {!swatch && (chosenNone || !image ? "no picture" : `${image.pictures} pictures`)}
      </span>,
    );
  }
  const versioned = version > 0 ? `&v=${version}` : "";
  return wrap(
    // eslint-disable-next-line @next/next/no-img-element -- a private, session-scoped stream; next/image would proxy it
    <img
      src={`/api/imports/${importId}/row-image?sheet=${sheetIndex}&row=${lineNo}${versioned}`}
      alt={swatch ? `The swatch on row ${lineNo} of the bill` : `The picture on row ${lineNo} of the bill`}
      title={
        onOpen
          ? undefined
          : swatch
            ? "The bill's picture for this fabric line"
            : "The bill's picture for this line — the record's picture until a drawing crop replaces it"
      }
      loading="lazy"
      width={swatch ? 36 : 52}
      height={swatch ? 36 : 52}
      className={
        swatch
          ? "block h-9 w-9 shrink-0 rounded border border-neutral-200 bg-white object-cover"
          : "block h-[52px] w-[52px] shrink-0 rounded border border-neutral-200 bg-white object-contain"
      }
    />,
  );
}

// ---- how the bill's groups are drawn (`groupBillLines`) ----------------------
//
// Every class below is a complete literal: Tailwind purges anything it cannot
// read in source. The row variants (`[&>td]:…`) out-rank `Td`'s own bottom
// border, which is the point — inside a group the GAP separates, not a rule.

/** No rule under any data row: the gap between groups does the separating. */
const ROW_NO_RULE = "[&>td]:border-b-0";
/** A fabric line's band. */
const ROW_FABRIC = "[&>td]:bg-neutral-50";
/** The sky bar down the left of every row a family of one code owns. */
const ROW_FAMILY_BAR = "[&>td:first-child]:shadow-[inset_4px_0_0_#7dd3fc]";
const CELL_FAMILY_BAR = "shadow-[inset_4px_0_0_#7dd3fc]";
/** The light rule between two members of one family, in place of a gap. */
const ROW_FAMILY_RULE = "[&>td]:border-t [&>td]:border-dashed [&>td]:border-sky-200";
/** The L-shaped connector from a fabric line up to its item. */
const RAIL =
  "relative pl-7 before:absolute before:-top-2.5 before:bottom-1/2 before:left-2.5 before:w-3 before:rounded-bl-md before:border-b-2 before:border-l-2 before:border-neutral-300 before:content-['']";
/** …and its continuation down to the next fabric line of the same item. */
const RAIL_MORE =
  "after:absolute after:-bottom-2.5 after:left-2.5 after:top-1/2 after:border-l-2 after:border-neutral-300 after:content-['']";
/**
 * The Item column's floor, on a block INSIDE the cell. A `min-width` on a th
 * or td is only a hint under table-layout auto — the column came out at 200px
 * beside a 280px Category, and `GR-TIM-13 → Main timber finish` broke over two
 * lines. A block's min-width is honoured, so the column cannot shrink below it.
 */
const ITEM_CELL = "min-w-[340px]";
/** A chip that wraps inside the Item column instead of running across Area. */
const CHIP_WRAPS = "!whitespace-normal max-w-full [overflow-wrap:anywhere]";

/**
 * A FABRIC LINE'S WORDS, CUT TO ABOUT TWO LINES. The bill writes the whole
 * fabric specification in one cell — collection, colour, width, composition,
 * certifications — and printed whole it ran a dozen lines under a 36px swatch.
 * `clampText` cuts the STRING (CSS `line-clamp` does nothing here, the rule
 * `shout.ts` records), and the rest is one quiet press away. Display only:
 * the staged value is untouched.
 */
function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { clamped, wasClamped } = clampText(text, 2, 110);
  return (
    <>
      {open || !wasClamped ? text : clamped}
      {wasClamped && (
        <Button
          variant="quiet"
          size="xs"
          className="-my-0.5 ml-1 px-1 py-0 text-[11px]"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "less" : "more"}
        </Button>
      )}
    </>
  );
}

/** The grey gutter between two groups. The one legitimate full-width cell. */
function GroupGap({ columns }: { columns: number }) {
  return (
    <tr aria-hidden="true" data-bill-gap="">
      <td colSpan={columns} className="h-[18px] border-y border-neutral-200 bg-neutral-100 p-0" />
    </tr>
  );
}

/**
 * The heading over consecutive lines of one code. A bracket, never a merge:
 * each line under it is still its own record. "N options" only where every
 * line's own words say option — otherwise the bill has not said why it repeats
 * the code, and the heading says only that it does.
 */
function FamilyHeading({ family, columns }: { family: BillFamily; columns: number }) {
  return (
    <tr data-bill-family={family.code}>
      <td colSpan={columns} className={`px-3 pb-1 pt-3 ${CELL_FAMILY_BAR}`}>
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12.5px] font-semibold text-neutral-900">{family.code}</span>
          {family.options ? (
            <Chip tone="live">{family.lines} options</Chip>
          ) : (
            <span className="text-xs text-neutral-700">{family.lines} lines share this code</span>
          )}
          <span className="text-xs text-neutral-500">
            {family.options
              ? "each option is its own item, with its own size, quantity and fabric"
              : "each line becomes its own record"}
          </span>
        </span>
      </td>
    </tr>
  );
}

/**
 * The area on its own lines: the area, then the sub-area muted under it. The
 * stored value is `effectiveArea`'s composition, so the slash it writes stays
 * at the end of the first line and the whole string is the cell's title.
 */
function AreaLines({ line }: { line: Pick<Line, "area" | "subArea" | "boqCategory"> }) {
  const area = line.area?.trim() || null;
  const subArea = line.subArea?.trim() || null;
  if (area && subArea) {
    return (
      <>
        {area} <span className="text-neutral-400">/</span>
        <span className="block text-neutral-500">{subArea}</span>
      </>
    );
  }
  return <>{effectiveArea(line) ?? "—"}</>;
}

/** "17 and 18", "17, 18 and 19" — a list a person reads rather than parses. */
function listOf(values: number[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** One read-only fact about the sheet, in the run card's four-column grid. */
function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-th font-semibold uppercase tracking-wider text-neutral-500">
        {label}
        {tip && <Tip>{tip}</Tip>}
      </span>
      <span className="mt-1.5 block font-mono text-[13px] text-neutral-900">{children}</span>
    </div>
  );
}

/**
 * WHERE A VALUE WAS DECIDED, where it was not decided here.
 *
 * A bill's tabs are PHASES quoting the same codes, so accepting a level on
 * `S-100` in MUR is a decision about the item and it lands on `S-100` wherever
 * else the bill lists it. The receiving row says so, because a decision that
 * appeared on a tab nobody was looking at is one nobody can check — and it can
 * be changed here, which is what makes the carry safe for a value-engineered
 * phase that genuinely differs.
 *
 * It renders nothing at all on the ordinary row, so the column does not grow a
 * line of grey text on every item in the bill.
 */
function CarriedFrom({ tab }: { tab?: string | null }) {
  if (!tab) return null;
  return (
    <span className="mt-1 block text-[10.5px] text-neutral-500">
      carried from <span className="font-mono">{tab}</span>
    </span>
  );
}

/**
 * The level cell: a decision, a suggestion, or nothing to read it from.
 *
 * Three shapes rather than one select, because they are three different states
 * and a select cannot tell them apart. A CHOSEN level is a `Chip` with a quiet
 * Change beside it — it is a decision, and a select showing it invites an
 * accidental edit. A SUGGESTED one is a `SuggestButton` carrying the words it
 * was read from, never a pre-selected select: a select already reading "Hero"
 * fires no change event when somebody picks Hero, so the one act that records
 * their agreement would do nothing at all. Where nothing was suggested the
 * select is offered with nothing selected, and the screen says why.
 */
function LevelCell({
  line,
  editable,
  busy,
  onSet,
}: {
  line: Line;
  editable: boolean;
  busy: boolean;
  onSet: (level: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const chosen = line.levelStatus === "chosen" && line.level;
  /**
   * A LINE THAT MAY NOT BE FURNITURE IS NOT OFFERED A LEVEL TO ACCEPT.
   *
   * `guessLevelFromBill` stopped guessing one the day this question was added,
   * so nothing is stored on a bill staged since — but the staged JSON is data
   * from the past and every bill staged before it carries `Simple · the bill
   * names no metalwork` on its packaging line. Reading it here suppresses the
   * SUGGESTION on both, without touching a level somebody actually chose:
   * accepting a guess is a decision, and the cheaper decision — whether the row
   * belongs in the bill at all — has not been taken yet.
   */
  const notFurniture = nonFurnitureOf(line) !== null;

  if (chosen && !editing) {
    return (
      <>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Chip tone="good">{ITEM_LEVEL_LABELS[line.level as keyof typeof ITEM_LEVEL_LABELS] ?? line.level}</Chip>
          {editable && (
            <Button variant="quiet" size="xs" onClick={() => setEditing(true)}>
              Change
            </Button>
          )}
        </span>
        <CarriedFrom tab={line.levelCarriedFrom} />
      </>
    );
  }

  if (!editing && !notFurniture && line.level && isItemLevel(line.level)) {
    return (
      <SuggestButton
        value={ITEM_LEVEL_LABELS[line.level]}
        evidence={line.levelReason ?? "read off the bill"}
        busy={busy}
        disabled={!editable}
        onAccept={() => onSet(line.level ?? null)}
        className="max-w-[160px]"
      />
    );
  }

  return (
    <>
      <select
        value={notFurniture && line.levelStatus !== "chosen" ? "" : (line.level ?? "")}
        disabled={!editable}
        onChange={(event) => {
          onSet(event.target.value || null);
          setEditing(false);
        }}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
      >
        <option value="">— not set —</option>
        {ITEM_LEVELS.map((level) => (
          <option key={level} value={level}>
            {ITEM_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
      {notFurniture ? (
        <span className="mt-1 block text-[10.5px] text-neutral-500">not furniture?</span>
      ) : (
        !line.level && <span className="mt-1 block text-[10.5px] text-neutral-500">nothing to read it from</span>
      )}
    </>
  );
}

/** A claim this old is a request that died, and the screen stops waiting on it. */
const STRUCTURE_CLAIM_MS = 330_000;

function structurePending(state: StructureReadState | undefined): boolean {
  const pending = state?.pending;
  return Boolean(pending && Date.now() - new Date(pending.at).getTime() < STRUCTURE_CLAIM_MS);
}

/** A reason sentence joined into another, without its own full stop. */
function asClause(text: string): string {
  return text.trim().replace(/[.!\s]+$/, "");
}

export default function ReviewImportPage() {
  const { id } = useParams<{ id: string }>();
  const {
    data,
    load,
    loading,
    error,
    setError,
    notice,
    setNotice,
    busy,
    blocked,
    mockupNotice,
    specsBusy,
    setLine,
    setPicture,
    setSheet,
    acceptAllLevels,
    acceptAllCategories,
    acceptAllPairings,
    ignoreAllSuggested,
    readAgain,
    setSlot,
    setUnit,
    setUnitAll,
    setLineKind,
    readSpecifications,
    confirm,
  } = useBoqImport(id);
  /** Which sheet is shown. A BOQ tab is a sub-quote, so a tab each. */
  const [sheetTab, setSheetTab] = useState(0);
  /**
   * Sheets whose Columns panel somebody opened with "Change columns". A sheet
   * nobody has mapped, and one a saved layout read that nobody has checked,
   * show theirs regardless — see `panelOpen` below.
   */
  const [openPanels, setOpenPanels] = useState<Set<number>>(() => new Set());
  /**
   * The pack this document arrived in, for the crumb.
   *
   * Read from the project's batches rather than from the import, because
   * `/api/imports/[id]` carries no batch id and this screen is not where an API
   * shape is changed. An absent pack is normal — anything uploaded before
   * deliveries were grouped has none — and the crumb falls back to the project,
   * which is the way back either way.
   */
  const [pack, setPack] = useState<{ id: string; created_at: string; drawings: number } | null>(null);
  /**
   * THE MODEL IS READING THIS BILL'S COLUMNS, from this tab — `all` for the
   * automatic read, or the sheet a panel's button asked about. A read another
   * tab started shows the same sentence, from the server's own claim.
   */
  const [asking, setAsking] = useState<"all" | number | null>(null);
  /** Why the last structure read did not land, with the retry beside it. */
  const [structureError, setStructureError] = useState<string | null>(null);
  /** Once per visit: the automatic read never fires twice from one screen. */
  const autoAsked = useRef(false);
  /** Lines whose description panel is open, as `sheet:index`. */
  const [openDescriptions, setOpenDescriptions] = useState<Set<string>>(() => new Set());
  const toggleDescription = (key: string) =>
    setOpenDescriptions((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /**
   * THE ONE ROW WHOSE PICTURE IS OPEN, as `sheet:index` — one at a time, like
   * the crops it makes: a second panel would be a second crop competing for
   * the same queue, and a second place to lose track of which row is which.
   */
  const [openPicture, setOpenPicture] = useState<string | null>(null);

  /** Fabric lines whose "why?" is open, as `sheet:index`. */
  const [openWhy, setOpenWhy] = useState<Set<string>>(() => new Set());
  const toggleWhy = (key: string) =>
    setOpenWhy((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const projectId = data?.import.project_id ?? "";
  /**
   * WHAT COMES AFTER THIS BILL. The confirm already pushes to the phase tabs,
   * where the header's own primary is this same step; this is the other half —
   * a bill somebody comes BACK to, already confirmed, whose screen said "This
   * import has already been confirmed" and offered nothing to do about it.
   *
   * Re-read whenever THIS document moves: a confirm that stays on the page
   * otherwise keeps the step computed while the bill was waiting, "Review the
   * bill", linking here (audit 2026-11-06, G7).
   */
  const step = useNextStep(projectId || null, data ? `${data.import.status}:${data.import.version}` : null);
  useEffect(() => {
    if (!projectId || !id) return;
    void apiFetch<{ batches: { id: string; created_at: string; runs: { id: string; documentKind: string | null }[] }[] }>(
      `/api/projects/${projectId}/batches`,
    ).then((res) => {
      if (!res.ok) return;
      const found = res.data.batches.find((batch) => batch.runs.some((batchRun) => batchRun.id === id));
      setPack(
        found
          ? {
              id: found.id,
              created_at: found.created_at,
              drawings: found.runs.filter((batchRun) => batchRun.documentKind === "shop_drawings").length,
            }
          : null,
      );
    });
  }, [projectId, id]);

  /** After the Columns panel wrote: reload, THEN say what happened. */
  async function afterColumns(sheetIndex: number, message: string | null) {
    await load();
    setError(null);
    if (message) setNotice(message);
    setOpenPanels((current) => {
      const next = new Set(current);
      next.delete(sheetIndex);
      return next;
    });
  }

  /**
   * ASK THE MODEL TO READ THE COLUMNS — one small read, charged. `sheetIndex`
   * absent is the automatic read of every live sheet nobody could map. A
   * request id per press, so a retried request is answered from the record
   * rather than read (and charged) again. Reload first, then report.
   */
  const askModel = useCallback(
    async (sheetIndex?: number) => {
      if (!data) return;
      setAsking(sheetIndex ?? "all");
      setStructureError(null);
      setNotice(null);
      try {
        const requestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
        const res = await apiFetch<{ nothing?: boolean; charged?: number }>(`/api/imports/${id}/suggest-columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: data.import.version,
            requestId,
            ...(sheetIndex === undefined ? {} : { sheetIndex }),
          }),
        });
        await load(true);
        if (!res.ok) {
          const code = (res.data as { code?: string } | null)?.code;
          // Another tab's read is not a failure: this screen waits for it.
          if (code === "structure_read_running") setNotice(res.error);
          else setStructureError(res.error);
          return;
        }
        // No notice on success: the yellow banner that the reload brings up
        // says the same thing, on every sheet the model read, until the
        // reviewer checks it — two banners for one fact is one to ignore.
      } finally {
        setAsking(null);
      }
    },
    [data, id, load, setNotice],
  );

  /**
   * THE AUTOMATIC READ: once, the first time this screen opens a bill with a
   * live sheet nobody could map — or one the known headings mapped with no
   * quantity column (`sheetWantsStructureRead`) — and no structure read on
   * record. Never on a
   * bill whose original was not kept (there is nothing to re-read with the
   * answer), never while another tab's read is in flight, and never twice
   * from one visit.
   */
  useEffect(() => {
    if (!data || autoAsked.current) return;
    const bill = data.import;
    if (bill.source_kind !== "boq_xlsx" || bill.status !== "parsed" || bill.has_source === false) return;
    if (bill.parsed?.sourcePreserved === false) return;
    const state = bill.model_metadata?.structureRead;
    if (structurePending(state)) return;
    const wanted = (bill.parsed?.sheets ?? []).some((sheet) =>
      sheetWantsStructureRead(sheet, Boolean(state?.sheets?.[sheet.sheetName])),
    );
    if (!wanted) return;
    autoAsked.current = true;
    void askModel();
  }, [data, askModel]);

  /** Another tab is reading: look again quietly until its claim clears. */
  const otherTabReading = asking === null && structurePending(data?.import.model_metadata?.structureRead);
  useEffect(() => {
    if (!otherTabReading) return;
    const timer = setInterval(() => void load(true), 4000);
    return () => clearInterval(timer);
  }, [otherTabReading, load]);

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading import" />;

  const run = data.import;
  const sheets = run.parsed?.sheets ?? [];
  // The runs this bill could revise, and the live per-sheet reconciliation.
  // Both come from the server on every read: a record retired or paired since
  // the page loaded has to show as it is now.
  const runs = data.runs.filter((projectRun) => projectRun.status === "active");
  const activeSheets = sheets.filter((sheet) => !sheet.ignored);
  /**
   * Live sheets nobody has said the columns of. The confirm refuses while any
   * remain (`sheetsNeedingColumns`, the same function it calls), so the button
   * is disabled and the screen says which, rather than letting a press fail.
   */
  const unmapped = sheetsNeedingColumns({ sheets });
  const activeLines = activeSheets.flatMap((sheet) => sheet.lines.filter((line) => !line.ignored));
  /**
   * Is this bill REVISING a run, or creating one?
   *
   * The button has to say which, because they are not the same act at all: a
   * revision writes the bill's own columns over records that already exist and
   * keeps everything hanging off them, and retires the ones the revision no
   * longer lists. "Confirm 57 lines" describes both equally and warns about
   * neither.
   */
  const revising = Object.keys(data.reconciliation ?? {}).length > 0;
  /** Live sheets whose columns a model read and nobody has agreed to — the confirm waits. */
  const unchecked = sheetsAwaitingColumnCheck({ sheets });
  /** Fabric lines that cannot be written, from the function the confirm runs. */
  const kindProblems = activeSheets.flatMap((sheet) => rowKindProblems(sheet.lines));
  const counts = boqConfirmCounts(sheets);
  const structureState = run.model_metadata?.structureRead;
  const reading = asking !== null || structurePending(structureState);
  /** A sheet as its tab names it — the words the reason beside Confirm uses, so it points at a tab you can see. */
  const tabName = (sheet: (typeof sheets)[number]) => sheet.proposedRunName || sheet.sheetName;
  // A PDF BILL THE MODEL TRANSCRIBES (C2): waiting while it runs, then every
  // line marked, and code's cross-checks re-run on every render — never stored,
  // so a person changing the columns re-checks against the new mapping.
  const transcription = run.parsed?.pdfTranscription ?? null;
  const transcribing = transcription?.state === "waiting";
  const transcribed = transcription?.state === "done";
  const pageOfLine = (sheet: (typeof sheets)[number], lineNo: number) => pdfPageOfLine(run.parsed?.pdfSource, sheet.sheetName, lineNo);
  const lineChecks = new Map<number, Map<number, LineCheck[]>>();
  const checkSummaries: string[] = [];
  if (transcribed && transcription) {
    sheets.forEach((sheet, index) => {
      if (sheet.ignored) return;
      const result = transcriptionChecks({
        lines: sheet.lines.map((line) => ({ lineNo: line.lineNo, code: line.code, qty: line.qty, rowKind: line.rowKind })),
        qtyColumn: sheet.columns?.qty?.index ?? null,
        pageOf: (lineNo) => pageOfLine(sheet, lineNo),
        transcription,
      });
      lineChecks.set(index, result.byLine);
      checkSummaries.push(...result.summary);
    });
  }
  const checkNeedsYou = transcribed
    ? sheets.flatMap((sheet, index) =>
        sheet.ignored
          ? []
          : transcriptionNeedsYou({
              sheetIndex: index,
              tab: tabName(sheet),
              single: sheets.length === 1,
              lines: sheet.lines,
              checks: lineChecks.get(index) ?? new Map(),
              pageOf: (lineNo) => pageOfLine(sheet, lineNo),
            }),
      )
    : [];
  const confirmBlocker = transcribing
    ? "Wait for the model to transcribe the PDF."
    : run.status === "parsed"
      ? boqConfirmBlocker({
          single: sheets.length === 1,
          reading,
          unmapped: unmapped.map(tabName),
          unchecked: unchecked.map(tabName),
          kindProblems: activeSheets
            .map((sheet) => ({ tab: tabName(sheet), count: rowKindProblems(sheet.lines).length }))
            .filter((entry) => entry.count > 0),
          noLiveLines: activeLines.length === 0,
        })
      : null;
  // WHAT THE CONFIRM WAITS ON, AS PLACES TO GO (2026-10-15): the same reasons
  // as `confirmBlocker`, each a link to the panel or line on its own tab, and
  // the tabs that still need somebody painted red.
  const needsYou =
    run.status === "parsed" && !transcribing
      ? billNeedsYou({
          sheets: sheets.map((sheet, index) => ({
            index,
            tab: tabName(sheet),
            unmapped: unmapped.includes(sheet),
            unchecked: unchecked.includes(sheet),
            problems: sheet.ignored ? [] : rowKindProblems(sheet.lines),
          })),
          single: sheets.length === 1,
          reading,
          noLiveLines: activeLines.length === 0,
        })
      : [];
  const waitingSheets = sheetsWaiting(needsYou);
  const canAsk = run.status === "parsed" && run.has_source !== false && run.parsed?.sourcePreserved !== false;
  const ignoredSheets = sheets.filter((sheet) => sheet.ignored);
  /** The revision and date the FIRST live tab printed, as text. Both stay text. */
  const revisionLabel = (() => {
    const first = activeSheets[0];
    if (!first) return null;
    const parts = [first.metadata?.revision ? `rev ${first.metadata.revision}` : null, first.metadata?.date]
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  })();
  const packCrumb = pack
    ? {
        label: `Pack delivered ${formatDay(pack.created_at.slice(0, 10))}`,
        href: `/dashboard/projects/${run.project_id}/intake/${pack.id}`,
      }
    : { label: `${run.bws_project_number} — ${run.project_name}`, href: `/dashboard/projects/${run.project_id}` };

  // Four documents, four review screens, one route. Each staged shape is edited
  // by the screen that understands it; nothing shares a component with a shape
  // it cannot display.
  if (run.document_kind === "shop_drawings") {
    return (
      // The review component renders its own band — see the note on the
      // spec-document branch below.
      <DrawingsReview
        importId={run.id}
        crumb={packCrumb}
        packHref={pack ? `/dashboard/projects/${run.project_id}/intake/${pack.id}/drawings` : undefined}
        packDrawingCount={pack?.drawings}
      />
    );
  }

  if (run.document_kind === "preamble") {
    return (
      <PreambleReview
        importId={run.id}
        crumb={packCrumb}
        project={{ id: run.project_id, number: run.bws_project_number, name: run.project_name }}
      />
    );
  }

  // A finishes schedule read as ENTRIES (schemaVersion 2), or one not read yet
  // — which will be. A version 1 schedule (proposals) keeps the screen below.
  if (
    run.document_kind === "finishes_schedule" &&
    (!run.parsed || (run.parsed as unknown as { kind?: string }).kind === "finishes_schedule")
  ) {
    return (
      <FinishScheduleReview
        importId={run.id}
        crumb={packCrumb}
        project={{ id: run.project_id, number: run.bws_project_number, name: run.project_name }}
      />
    );
  }

  if (run.source_kind === "spec_document") {
    if (!data.registers) return <Spinner label="Loading the document" />;
    return (
      // The review component renders its OWN band: `PageHeader` is full-bleed
      // and sits outside `PageBody`, and the tabs, the Re-match button and the
      // confirm footer all read state that lives inside it.
      <SpecDocumentReview
        data={{ import: run as unknown as SpecImport, registers: data.registers, message: data.message }}
        reload={() => load()}
        quietReload={() => load(true)}
        crumb={
          run.document_kind === "email" ? { label: "Inbox", href: "/dashboard/inbox" } : packCrumb
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[packCrumb]}
        title={run.filename ?? "Bill of quantities"}
        subtitle={
          <>
            {/* WHAT THIS SCREEN COST, FIRST. Every other review screen in the
                app was read by a model and charged for it; a bill is parsed by
                code, and a reviewer who does not know that treats the figures
                as something to second-guess. */}
            {/* A BILL READ FROM A PDF SAYS SO FIRST, and where to check it:
                its cells are the PDF's text put back by position, by code,
                and a person checks a few lines against the PDF (C1). */}
            {/* A BILL THE MODEL TRANSCRIBED SAYS SO INSTEAD (C2): the one
                bill whose cells a model wrote, every line marked. */}
            {transcribed && (
              <>
                <span className={TONE.danger.text}>Transcribed by the model from a PDF with no usable text: check every line against its page in the</span>{" "}
                <a href={`/api/imports/${run.id}/source?document=pdf`} className="text-blue-700 no-underline hover:underline">
                  PDF
                </a>
                <Tip>
                  {`${transcription?.reason ?? ""} So the model copied the table — one charged read — and code then read that copy as it reads any spreadsheet. Every line is marked “transcribed” with its page. A line whose quantity does not add up to a total the PDF prints, whose code is not in the page's own text, or that the model said it could not read clearly, is red. Pictures in the PDF are not carried over.`.trim()}
                </Tip>
                {". "}
              </>
            )}
            {run.parsed?.pdfSource && !run.parsed?.pdfTranscription && (
              <>
                <span className={TONE.warn.text}>Read from a PDF by its text: check a few lines against the</span>{" "}
                <a
                  href={`/api/imports/${run.id}/source?document=pdf`}
                  className="text-blue-700 no-underline hover:underline"
                >
                  PDF
                </a>
                <Tip>
                  Every cell is text the PDF printed, put back into columns by position — no model read it. Each
                  line shows the PDF page it came from. Pictures in the PDF are not carried over.
                </Tip>
                {". "}
              </>
            )}
            {transcribing && (
              <>
                <span className={TONE.warn.text}>A PDF a program could not read: the model transcribes it, every line marked.</span>{" "}
              </>
            )}
            {transcription
              ? null
              : Object.keys(run.model_metadata?.structureRead?.sheets ?? {}).length > 0
                ? "Every cell read by code; the model read the columns (one small read, charged)."
                : "Parsed by code, not by a model — nothing here was charged."}{" "}
            {!transcribing && (
              <>
                {sheets.length} tab
                {sheets.length === 1 ? "" : "s"}
              </>
            )}
            {revisionLabel && <> · {revisionLabel}</>}
            {/* A reload after an action. Inline rather than a spinner over the
                table: the rows stay readable and nothing on the page moves. */}
            {loading && <> · <span className="text-neutral-500">reloading…</span></>}
            {run.parsed?.sourcePreserved !== false && !transcribing && (
              <>
                {" · "}
                <a
                  href={`/api/imports/${run.id}/source`}
                  className="text-blue-700 no-underline hover:underline"
                >
                  open the spreadsheet
                </a>
              </>
            )}
          </>
        }
        actions={
          // A CONFIRMED BILL HAS NO CONFIRM. It used to render disabled and
          // still wearing the primary's dark fill, so the screen's most
          // emphatic control was one nobody could press — beside a green box
          // whose own action IS the next step. §0.3: one primary, and it is
          // what a person does next. Every other reason the button is disabled
          // (nothing parsed yet, no active lines) keeps it on screen, because
          // then it is the control being refused and it has to say so.
          run.status === "confirmed" ? null : (
          <>
          {/* THE REASON, BESIDE THE BUTTON IT DISABLES, naming the tab that
              waits (2026-10-15). It used to be the button's hover title only,
              and a person scrolled into a tab saw neither it nor the banner. */}
          {confirmBlocker && !busy && (
            <p className={`max-w-[26rem] text-right text-xs ${TONE.warn.text}`}>
              {confirmBlocker}
              {needsYou.some((entry) => entry.target) && (
                <>
                  {" "}
                  <a
                    href={`#${needsYouListId("bill")}`}
                    className="font-medium underline decoration-amber-500 underline-offset-2"
                    onClick={(event) => {
                      event.preventDefault();
                      goToAndFlash(needsYouListId("bill"));
                    }}
                  >
                    Take me there
                  </a>
                </>
              )}
            </p>
          )}
          <Button
            variant="primary"
            onClick={confirm}
            disabled={
              busy ||
              reading ||
              run.status !== "parsed" ||
              activeLines.length === 0 ||
              unmapped.length > 0 ||
              unchecked.length > 0 ||
              kindProblems.length > 0
            }
            title={confirmBlocker ?? undefined}
          >
            {boqConfirmLabel({ counts, revising, unmapped: unmapped.length, busy })}
          </Button>
          </>
          )
        }
        tabs={
          sheets.length > 1 ? (
            // `useState`, not the URL: nothing links to a sheet of a staged
            // bill, and a `?tab=` here would be a second address for a screen
            // that already has one.
            //
            // AN IGNORED SHEET KEEPS ITS OWN TAB, struck through, rather than
            // being folded into an "Ignored tabs (n)" pile. Dismissing a sheet
            // is a decision somebody took and has to be able to undo, and the
            // undo lives on the sheet's own panel — a grouped tab would say how
            // many were dropped without saying which, and the way back would be
            // a click further away than the way in.
            <Tabs
              label="Sheets in this bill"
              value={String(sheetTab)}
              onChange={(tabId) => setSheetTab(Number(tabId))}
              items={sheets.map((sheet, index) => ({
                id: String(index),
                label: sheet.proposedRunName || sheet.sheetName,
                count: sheet.lines.filter((line) => !line.ignored).length,
                muted: sheet.ignored,
                // RED WHILE IT WAITS ON SOMEBODY (Matthew, 2026-10-15 part 2,
                // 1:46): the confirm is refused until it is done.
                attention: waitingSheets.has(index),
              }))}
            />
          ) : undefined
        }
      />

      <PageBody width="wide">
        {/* ONE LIST OF WHAT THE CONFIRM WAITS ON, FIRST ON THE PAGE, each item
            a link that switches to its tab and lights the panel or line
            (2026-10-15). It replaces two amber banners whose sentences are now
            each item's "Why". */}
        <NeedsYou
          id={needsYouListId("bill")}
          items={needsYou}
          className="mt-3"
          onGo={(entry) => {
            if (entry.sheetIndex === undefined) return;
            setSheetTab(entry.sheetIndex);
            // A Columns link opens the panel, so there is a panel to land on.
            if (entry.target === sheetColumnsId(entry.sheetIndex)) {
              const index = entry.sheetIndex;
              setOpenPanels((current) => new Set(current).add(index));
            }
          }}
        />
        {/* A PDF BILL THE MODEL TRANSCRIBES (C2): the panel while it waits or
            runs; then, RED and apart from what the confirm waits on, every
            line code's cross-checks flagged — a mis-copied quantity looks
            exactly like a real one. */}
        {transcription && (
          <PdfTranscriptionPanel
            importId={run.id}
            version={run.version}
            transcription={transcription}
            record={run.model_metadata?.transcription}
            pdfHref={`/api/imports/${run.id}/source?document=pdf`}
            reload={() => load(true)}
          />
        )}
        <NeedsYou
          id={needsYouListId("transcribed")}
          items={checkNeedsYou}
          title="Check against the PDF"
          tone="danger"
          className="mt-3"
          onGo={(entry) => {
            if (entry.sheetIndex !== undefined) setSheetTab(entry.sheetIndex);
          }}
        />
        {transcribed && checkSummaries.length > 0 && (
          <details className="mt-1 text-[11.5px] text-neutral-600">
            <summary className="cursor-pointer">What code checked of the transcription</summary>
            <ul className="mt-1 list-disc pl-5">
              {[...new Set(checkSummaries)].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        )}
        {/* THE BILL THAT COULD NOT BE READ SAYS SO ON THIS SCREEN.
            ==================================================================
            The parser's refusal was returned by the registration route as a 422
            and shown on the UPLOAD screen — and then never again. A reviewer who
            followed the link from the pack, or came back to the run later, got
            this page with no sheets, no error and a blue note explaining that a
            tab is a phase. `intake_runs.error` has carried the sentence all
            along and nothing rendered it.

            Row 1 of the variance matrix (§6.10.a) is a REFUSAL, and a refusal
            has to be readable where the document is. `parseBoqSheets` names the
            columns it looked for, the words it accepts, and the closest row's
            own headings, so the sentence below is the one thing a person needs
            in order to act. */}
        {run.status === "failed" && (
          <Note
            tone="danger"
            title="This bill could not be read, and nothing was staged from it."
            actions={
              // A BILL IS NEVER READ BY A MODEL, so "Try again" here is free:
              // the stored spreadsheet is read again by code, with the columns
              // a person can now set. The bills refused before 0040 recover
              // this way, without a new upload.
              run.has_source ? (
                <Button size="sm" disabled={busy} onClick={() => void readAgain()}>
                  {busy ? "Reading…" : "Read it again"}
                </Button>
              ) : undefined
            }
          >
            {run.error ?? "The reader gave no reason, which is itself worth reporting."}
            {run.has_source ? (
              <span className="mt-1 block">
                Reading it again is free — the stored spreadsheet is read by code — and a bill whose columns the
                reader does not know now opens on a Columns panel instead of stopping here.
              </span>
            ) : run.has_source === false ? (
              <span className="mt-1 block">
                The original was not kept when it was uploaded, so it cannot be read again. Upload the file again.
              </span>
            ) : null}
          </Note>
        )}

        {/* THE MODEL IS READING THE COLUMNS — said before it answers, with the
            charge, because the screen is otherwise a panel nobody should start
            filling in while the reading is about to replace it. */}
        {reading && (
          <Note tone="info" title="Reading the columns…">
            One small read, charged. The model reads the layout — the header, what each column is and which rows
            are finish lines, sections or subtotals — and code then reads every cell from the stored spreadsheet.
            {asking === null && " It was started from another tab or a moment ago; this screen shows the result when it lands."}
          </Note>
        )}
        {structureError && !reading && (
          <Note
            tone="warn"
            title="The model did not read the columns."
            actions={
              canAsk ? (
                <Button size="sm" onClick={() => void askModel()}>
                  Ask again
                </Button>
              ) : undefined
            }
          >
            {structureError} The Columns panel still works by hand, and that is free.
          </Note>
        )}
        {/* A MODEL'S COLUMNS, NOT YET AGREED TO. Yellow, because it is a guess
            until a person has looked; the confirm refuses until they say so. */}
        {run.status === "parsed" && unchecked.length > 0 && (
          <Note tone="guess" title="Columns and row kinds read by the model — check them.">
            {unchecked.length === 1 ? (
              <>
                On <span className="font-mono">{unchecked[0]?.sheetName}</span>, check each column on the panel and
                the Kind of each line, then press <b>The columns are right</b>.
              </>
            ) : (
              <>
                On {unchecked.map((sheet) => sheet.sheetName).join(", ")}, check each column and the Kind of each line,
                then press <b>The columns are right</b> on each.
              </>
            )}{" "}
            The model never typed a value: every code, description and quantity below was read by code.
          </Note>
        )}
        {/* THE SENTENCES THAT WERE TWO AMBER BANNERS HERE — a finish line
            with no item, a sheet nobody has mapped — are each item's "Why" on
            the list above, one click away and never deleted. */}

        {/* A TAB IS A PHASE, NOT A REVISION. Three tabs quote the same codes at
            different quantities and can all be live at once, which is why they
            become `spec_runs` rows rather than versions of one.

            Only where there ARE tabs: on a bill that failed to parse it was a
            standing explanation of something the screen was not showing. */}
        {sheets.length > 0 && (
        <Note tone="info" title="A tab is a phase, not a revision.">
          {sheets.length > 1 ? "These" : "This"} quote the same codes at different quantities and can all be live at
          once. Drop a tab to leave it out
          {ignoredSheets.length > 0 ? (
            <>
              {" — "}
              {ignoredSheets.map((sheet, index) => (
                <span key={sheet.sheetName + String(index)}>
                  {index > 0 && ", "}
                  <span className="font-mono">{sheet.sheetName}</span>
                </span>
              ))}{" "}
              already {ignoredSheets.length === 1 ? "is" : "are"}
              {ignoredSheets[0]?.ignoredReason ? ` — ${asClause(ignoredSheets[0].ignoredReason)}` : ""}.
            </>
          ) : (
            "."
          )}
        </Note>
        )}

        {run.parsed?.rowImagesNote && run.status === "parsed" && (
          <Note
            tone="warn"
            title={
              // A sheet whose in-cell pictures could not be read keeps its floating ones.
              Object.keys(run.parsed.rowImages ?? {}).length > 0
                ? "Some pictures in this workbook were not read."
                : "No pictures from this workbook."
            }
          >
            {run.parsed.rowImagesNote} The bill itself is read as normal.
          </Note>
        )}

        {run.parsed?.sourcePreserved === false && (
          <Note tone="warn" title="The source file was not kept.">
            There is no blob store configured, so this import read the spreadsheet and discarded it. The records
            below will have no document to check back against.
          </Note>
        )}

        {run.status === "confirmed" && (
          <Note tone="good" actions={<NextStepAction step={step} size="sm" />}>
            This import has already been confirmed.
          </Note>
        )}
        {run.status === "confirmed" && mockupNotice && (
          <Note tone="warn" title="The Mock-up phase needs a look.">
            {mockupNotice}
          </Note>
        )}
        {/* THE SPECIFICATIONS IN THE BILL'S OWN WORDS. A description cell packs
            sizes, models and finishes; the confirm made records and never read
            what the words say. One press registers this file as a specification
            document and reads it — charged, and said so on the button. */}
        {/* A BILL WHOSE CONFIRM READ ITS DESCRIPTIONS has nothing left for a
            charged read to find, so none is offered — and the route refuses
            one too. Said where the button would have been, so its absence is
            not a mystery. */}
        {run.status === "confirmed" && data.descriptionsRead && !data.billSpecs && (
          <Note tone="good" title="The descriptions in this bill were read when it was confirmed.">
            Each record carries its name and what its description cell said — sizes in their slots, finish codes
            in their fields, every other line as a note — sourced to this bill. There is nothing more to read, so no
            charged read is offered.
          </Note>
        )}
        {run.status === "confirmed" && run.has_source !== false && (!data.descriptionsRead || data.billSpecs) && (
          <Note
            tone="info"
            title="The descriptions in this bill carry specifications."
            actions={
              data.billSpecs ? (
                <a href={`/dashboard/imports/${data.billSpecs.id}`} className={buttonClass("secondary", "sm", "no-underline")}>
                  Open the specifications read
                </a>
              ) : (
                <Button size="sm" disabled={specsBusy} onClick={() => void readSpecifications()}>
                  {specsBusy ? "Registering…" : "Read the specifications in this bill — one read, charged"}
                </Button>
              )
            }
          >
            {data.billSpecs
              ? "They are being read, or have been, as a document of their own: sizes by slot, finishes by code, each for you to confirm."
              : "Reading them turns each line's sizes, models and finishes into proposals on its record, for you to confirm like any document's."}
          </Note>
        )}

        {notice && !error && <Note tone="info">{notice}</Note>}

        {error && (
          <Note tone="danger">
            {error}
            {blocked.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {blocked.map((line) => (
                  <li key={line.lineNo}>
                    Row {line.lineNo}
                    {line.code ? ` (${line.code})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Note>
        )}

        {sheets.map((sheet, sheetIndex) => {
          if (sheets.length > 1 && sheetIndex !== sheetTab) return null;
          const reconciliation = data.reconciliation[sheetIndex] ?? null;
          const pairingFor = (index: number) => reconciliation?.lines.find((line) => line.index === index) ?? null;
          const live = sheet.lines.filter((line) => !line.ignored);
          // The set *Ignore all suggested* acts on, from the one function the
          // per-row buttons read — so the count on the control is exactly what
          // the control does.
          const notFurniture = linesToIgnore(live);
          const notFurnitureIds = new Set(notFurniture.map((line) => line.index));
          const noLevel = live.filter((line) => !line.level && !notFurnitureIds.has(line.index)).length;
          // A line asked about as packaging is not also offered a level to
          // accept: its cell prints "not furniture?" instead, so counting it
          // here would put a number on the button the table does not show.
          const suggested = live.filter(
            // A fabric line is not a record, so it has no level to accept:
            // counting the 34 under the Aman items made "Accept all 101".
            (line) =>
              line.level && line.levelStatus !== "chosen" && !notFurnitureIds.has(line.index) && line.rowKind !== "finish_for",
          );
          // The same three exclusions for the CATEGORY a line suggests: a
          // fabric line is not a record, and a line asked about as packaging
          // is not offered a sheet to accept before that cheaper question.
          const suggestedCategories = live.filter(
            (line) =>
              suggestedCategoryId(line) !== null && !notFurnitureIds.has(line.index) && line.rowKind !== "finish_for",
          );
          // A fabric line is not a record, so the code it carries is not a client
          // ref two records share: `GR-FAB-13` under six items is one fabric.
          const duplicates = duplicateGroups({ ...sheet, lines: sheet.lines.filter((line) => line.rowKind !== "finish_for") });
          const problemByRow = new Map(rowKindProblems(sheet.lines).map((problem) => [problem.lineNo, problem.problem]));
          // Row, Kind, Client ref, Item, Area, Qty, Designer, (Against the
          // phase), Category, Level, Include.
          const columns = reconciliation ? 11 : 10;
          const descriptions = data.descriptions[sheetIndex] ?? {};
          const described = Object.keys(descriptions).length;
          // Lines whose plan reads the bill's own Dims / Finish columns, so the
          // note below says so rather than only describing a multi-line cell.
          const fromColumns = Object.values(descriptions).filter((plan) => (plan.columnCells ?? []).length > 0).length;
          const fromCells = Object.values(descriptions).filter((plan) => plan.statements.some((statement) => !statement.column)).length;
          // The lines whose size prints no unit and nobody has set one yet —
          // exactly what "set them all" writes, so its count is what it does.
          const unitless = live.filter((line) => {
            const plan = descriptions[line.index];
            return plan?.unitMissing === true && !plan.unitSetOnReview && !line.unitOverride;
          });
          const fabricFilings = data.fabricFilings[sheetIndex] ?? {};
          /**
           * THE COLUMNS PANEL IS OPEN when nobody has mapped this sheet yet
           * (unless it is dropped, when it waits to be asked for), when a
           * PERSON'S saved layout or a model read it and nobody has looked — a
           * remembered layout must never apply unseen — or when somebody
           * pressed Change columns. A SEEDED layout reads like a known heading
           * and opens nothing (`columnsAwaitingALook`, the panel's own test).
           */
          const layoutUnchecked = columnsAwaitingALook(sheet);
          const panelOpen =
            openPanels.has(sheetIndex) || (sheet.needsColumns === true && !sheet.ignored) || layoutUnchecked;
          const setPanel = (open: boolean) =>
            setOpenPanels((current) => {
              const next = new Set(current);
              if (open) next.add(sheetIndex);
              else next.delete(sheetIndex);
              return next;
            });
          return (
            <div key={sheet.sheetName + String(sheetIndex)} className={sheet.ignored ? "opacity-60" : undefined}>
              <Card
                title="This tab becomes a phase"
                actions={
                  <>
                    {/* OFFERED ON EVERY BILL SHEET, including one the synonyms
                        read: a wrong match is correctable only if it is
                        visible, and the panel is where it is visible. */}
                    {!panelOpen && run.status === "parsed" && (
                      <Button size="xs" onClick={() => setPanel(true)}>
                        {sheet.needsColumns ? "Set the columns" : "Change columns"}
                      </Button>
                    )}
                    <Button
                      size="xs"
                      disabled={run.status !== "parsed"}
                      onClick={() => void setSheet(sheetIndex, { ignored: !sheet.ignored })}
                    >
                      {sheet.ignored ? "Include this sheet" : "Drop this sheet"}
                    </Button>
                  </>
                }
              >
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="block text-th font-semibold uppercase tracking-wider text-neutral-500">
                      Phase name
                    </span>
                    <input
                      defaultValue={sheet.proposedRunName}
                      disabled={run.status !== "parsed" || sheet.ignored}
                      onBlur={(event) => {
                        if (event.target.value.trim() === sheet.proposedRunName) return;
                        void setSheet(sheetIndex, { runName: event.target.value });
                      }}
                      className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 disabled:opacity-50"
                    />
                  </label>
                  <Field label="Sheet">{sheet.sheetName}</Field>
                  <Field
                    label="Revision"
                    tip="Kept as text, exactly as the sheet printed it. Parsing “14-Sep-26” into a date is how a day goes missing."
                  >
                    {[sheet.metadata?.revision, sheet.metadata?.date].filter(Boolean).join(" · ") || "— none printed —"}
                  </Field>
                </div>

                {/* WHAT THE READER DID WITH THE SHEET, in sentences.
                    Two bare fragments — "row 6 · 1 skipped" — read as a
                    contradiction beside each other, and neither said what
                    happened to the rows above the header. `describeHeader` is
                    the single wording, so the screen cannot describe the parse
                    differently from the parser. Printed, not a Tip: a reviewer
                    who never hovers must not be left believing five rows were
                    thrown away. */}
                <p className="mt-3 text-xs text-neutral-500">
                  {/* A sheet nobody has mapped has a CANDIDATE header row — the
                      closest the synonyms came — and describing it as "the
                      header" would say the sheet was read when it was not. */}
                  {sheet.needsColumns
                    ? "Nothing has been read from this sheet yet — nobody has said which column is which."
                    : describeHeader(sheet)}
                </p>

                {/* WHICH COLUMN EACH ROLE CAME FROM, printed with the panel
                    closed too: "Spec Code is the code" is a statement a
                    reviewer can check in a glance, where a column of codes
                    alone does not say which column they came from. Absent on
                    a v3 sheet, which never recorded it. */}
                {!sheet.needsColumns && sheet.columns && Object.keys(sheet.columns).length > 0 && (
                  <p className="mt-1 text-xs text-neutral-500">
                    {sheet.mappingSource === "layout" && sheet.layout ? (
                      <>
                        Read with the {sheet.layoutOrigin === "seed" ? "standard " : ""}
                        <b className="text-neutral-700">{sheet.layout.name}</b> layout:{" "}
                      </>
                    ) : sheet.mappingSource ? (
                      <>Columns ({BOQ_MAPPING_SOURCE_LABELS[sheet.mappingSource]}): </>
                    ) : null}
                    {(Object.entries(sheet.columns) as [BoqReadRole, { index: number; heading: string }][])
                      .sort((a, b) => a[1].index - b[1].index)
                      .map(([role, ref]) => `${BOQ_ROLE_LABELS[role]} ← “${ref.heading || "no heading"}” (${columnLetter(ref.index)})`)
                      .concat(
                        (sheet.kept ?? []).map(
                          (ref) => `${BOQ_ROLE_LABELS.keep} ← “${ref.heading || "no heading"}” (${columnLetter(ref.index)})`,
                        ),
                      )
                      .join(" · ")}
                  </p>
                )}

                {/* WHAT THIS SHEET WILL DO BEYOND ITS OWN PHASE, AND WHAT IT
                    WILL COST LATER — both said before the confirm, from the
                    function the confirm reads (`bill-sheet-notices.ts`). */}
                {!sheet.ignored && !sheet.needsColumns && data.sheetNotices[sheetIndex]?.mockup && (
                  <Note tone="info" className="mt-3">
                    {data.sheetNotices[sheetIndex]?.mockup?.sentence} Each takes the item&rsquo;s name, category and
                    codes, and the bill&rsquo;s mock-up figure as its quantity where it is a number — never its specs.
                  </Note>
                )}
                {!sheet.ignored && !sheet.needsColumns && data.sheetNotices[sheetIndex]?.noCodes && (
                  <Note tone="warn" className="mt-3" title="This sheet gives its items no codes.">
                    {NO_CODES_REVIEW_SENTENCE}
                  </Note>
                )}

                {/* IS THIS A NEW RUN, OR A REVISION OF ONE?
                    Never chosen automatically. A revised bill that silently
                    replaced a run would rewrite quantities on records somebody
                    is already working from; one that silently made a new run
                    leaves the work stranded on the old copy. Both are
                    consequential, so a person says which. */}
                {!sheet.ignored && runs.length > 0 && run.status === "parsed" && (
                  <label className="mt-3.5 block text-sm text-neutral-600">
                    This sheet is
                    <select
                      value={sheet.replacesRunId ?? ""}
                      disabled={busy}
                      onChange={(event) => void setSheet(sheetIndex, { replacesRunId: event.target.value || null })}
                      className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50"
                    >
                      <option value="">a new phase</option>
                      {runs.map((projectRun) => (
                        <option key={projectRun.id} value={projectRun.id}>
                          a revision of “{projectRun.name}” ({projectRun.record_count} items
                          {projectRun.boq_revision ? `, ${projectRun.boq_revision}` : ""})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </Card>

              {/* Where a "needs you" link about this sheet's columns lands. */}
              <div id={sheetColumnsId(sheetIndex)} className="rounded-[10px]">
              {panelOpen && (
                <BoqColumnsPanel
                  // Re-mounted when what was READ changes, so a successful read
                  // shows the new mapping — and NOT on every autosave, which
                  // bumps the version and would throw away half-set selects.
                  key={`${sheetIndex}:${sheet.headerRow}:${sheet.headerRows ?? 1}:${JSON.stringify(sheet.columns ?? {})}`}
                  importId={run.id}
                  sheetIndex={sheetIndex}
                  sheet={sheet}
                  version={run.version}
                  editable={run.status === "parsed"}
                  sourceKept={run.parsed?.sourcePreserved !== false && run.has_source !== false}
                  onRead={(message) => afterColumns(sheetIndex, message)}
                  onClose={sheet.needsColumns ? undefined : () => setPanel(false)}
                  onIgnoreSheet={() => {
                    setPanel(false);
                    void setSheet(sheetIndex, { ignored: true });
                  }}
                  onAsk={canAsk ? () => void askModel(sheetIndex) : undefined}
                  asking={reading}
                />
              )}
              </div>
              {panelOpen && (sheet.preview?.length ?? 0) === 0 && run.status === "parsed" && run.has_source && (
                <div className="mt-2">
                  <Button size="sm" disabled={busy} onClick={() => void readAgain()}>
                    {busy ? "Reading…" : "Read the whole bill again"}
                  </Button>
                </div>
              )}

              {reconciliation && (
                <RevisionPanel
                  reconciliation={reconciliation}
                  status={run.status}
                  busy={busy}
                  onAcceptPairings={(pairs) => acceptAllPairings(sheetIndex, pairs)}
                />
              )}

              {/* THE REVIEW IS THE GATE FOR WHAT THE DESCRIPTIONS SAY: the
                  confirm writes exactly what is shown under each line. */}
              {!sheet.ignored && !sheet.needsColumns && described > 0 && run.status === "parsed" && (
                <Note tone="info" title="Each item's description is read as you confirm.">
                  {fromCells > 0 && (
                    <>
                      {fromCells} line{fromCells === 1 ? "'s" : "s'"} description cell
                      {fromCells === 1 ? " is" : "s are"} more than a name: the first line becomes the
                      item&rsquo;s name, and the rest is written to its record — sizes in their slots, finish codes in
                      their BWS fields and the finishes library, every other line as a note.{" "}
                    </>
                  )}
                  {fromColumns > 0 && (
                    <>
                      {fromColumns} line{fromColumns === 1 ? "" : "s"} carr{fromColumns === 1 ? "ies" : "y"} a size or a
                      finish in the bill&rsquo;s own Dims or Finish column, read the same way: a size into its slots, a
                      finish into the BWS field of its one kind, or kept whole as a note.{" "}
                    </>
                  )}
                  Check what is shown under each line; amber is what needs a look.
                </Note>
              )}
              {!sheet.ignored && !sheet.needsColumns && run.status === "parsed" && (
                <BillUnitAll
                  count={unitless.length}
                  busy={busy}
                  onApply={(unit) => void setUnitAll(sheetIndex, unitless, unit)}
                />
              )}
              {!sheet.ignored && !sheet.needsColumns && (
                <Card
                  flush
                  title={
                    <>
                      {live.length} line{live.length === 1 ? "" : "s"}
                      {noLevel > 0 && (
                        <Chip tone="warn">
                          {noLevel} need{noLevel === 1 ? "s" : ""} a level
                        </Chip>
                      )}
                      {suggested.length > 0 && (
                        <Chip tone="info">
                          {suggested.length} {suggested.length === 1 ? "has" : "have"} a suggested level
                        </Chip>
                      )}
                      {suggestedCategories.length > 0 && (
                        <Chip tone="info">
                          {suggestedCategories.length} {suggestedCategories.length === 1 ? "has" : "have"} a suggested
                          category
                        </Chip>
                      )}
                      {notFurniture.length > 0 && (
                        <Chip tone="info">
                          {notFurniture.length} may not be furniture
                        </Chip>
                      )}
                    </>
                  }
                  actions={
                    run.status === "parsed" &&
                    (notFurniture.length > 0 || suggested.length > 0 || suggestedCategories.length > 0) ? (
                      <span className="inline-flex flex-wrap items-center gap-4">
                        {/* FIRST, because it is the cheaper decision: whether a
                            row belongs in the bill at all comes before how
                            complex it is. Neither is a `primary` — the screen's
                            one primary is Confirm, in the header. */}
                        {notFurniture.length > 0 && (
                          <SuggestButton
                            value={`Ignore all ${notFurniture.length} suggested`}
                            evidence="each row says what it was read from · the Include box puts one back"
                            busy={busy}
                            onAccept={() => void ignoreAllSuggested(sheetIndex, notFurniture)}
                          />
                        )}
                        {/* Category before level: the category decides
                            which questions the record has at all. */}
                        {suggestedCategories.length > 0 && (
                          <SuggestButton
                            value="Accept all suggested categories on this tab"
                            evidence={`accepts ${suggestedCategories.length} suggestion${suggestedCategories.length === 1 ? "" : "s"} · each row says what it matched`}
                            busy={busy}
                            onAccept={() => void acceptAllCategories(sheetIndex, suggestedCategories)}
                          />
                        )}
                        {suggested.length > 0 && (
                          <SuggestButton
                            value={`Accept all ${suggested.length} suggested level${suggested.length === 1 ? "" : "s"}`}
                            evidence="each row says what it was read from"
                            busy={busy}
                            onAccept={() => void acceptAllLevels(sheetIndex, suggested)}
                          />
                        )}
                      </span>
                    ) : undefined
                  }
                >
                  {/* Ten columns, two of them selects: a notch tighter than the
                      primitive, or the category select pushed the bill 29px past
                      its box at 1440 and 1920 (the overflow rule caught it). */}
                  <Table scroll className="[&_td]:px-3 [&_th]:px-3">
                    <thead>
                      <tr>
                        <Th>Row</Th>
                        {/* Narrower than it was: the kind is quiet text until
                            clicked, and the select opens in place. */}
                        <Th className="w-[120px]">
                          Kind
                          <Tip>
                            A finish line — fabric, timber, metal, trim — is not a record: it is written as a spec on its
                            item, in the next free field of its kind, or kept with no field. A section, subtotal or blank
                            row is left out, and its Include box brings it back.
                          </Tip>
                        </Th>
                        <Th>Client ref</Th>
                        {/* The floor is on a BLOCK inside each Item cell
                            (`ITEM_CELL`): under table-layout auto a min-width on
                            a th or td is only a hint. */}
                        <Th>Item</Th>
                        <Th>Area</Th>
                        <Th num>Qty</Th>
                        <Th>Designer</Th>
                        {reconciliation && <Th>Against the phase</Th>}
                        {/* Capped, so the select does not take the slack the
                            Item column needs: a select is as wide as its
                            longest option, and a category name is long. */}
                        <Th className="w-[180px]">
                          Category
                          <Tip>A line with no category still imports — it simply has no checklist yet.</Tip>
                        </Th>
                        <Th className="w-[170px]">Level</Th>
                        {/* Wide enough for the "Not furniture?" question and
                            its evidence, which live under the checkbox they
                            act on. */}
                        <Th className="w-[190px]">Include</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                      /**
                       * One bill line's row, and its description panel.
                       * `place` is where `groupBillLines` put it: a fabric
                       * HANGING off the item above is drawn on a rail, a member
                       * of a family carries the sky bar, and every member of a
                       * family after the first opens with a dashed rule rather
                       * than a gap.
                       */
                      const lineRows = (
                        line: Line,
                        place: {
                          member: BillGroupMember<Line>;
                          hanging: boolean;
                          more: boolean;
                          family: boolean;
                          familyRule: boolean;
                        },
                      ) => {
                        const fabric = line.rowKind === "finish_for";
                        // The SAME code on a line that is not beside this one.
                        // Inside a family the heading says it, so the family's
                        // own members are not listed and the row is not amber.
                        const alsoOn = place.hanging ? [] : place.member.alsoOn;
                        const duplicated = !fabric && alsoOn.length > 0;
                        // WHAT THE ROW WILL GIVE — the confirm's own answer
                        // (`effectiveRowImage`) — and what the bill printed,
                        // which the panel crops from.
                        const image = effectiveRowImage(run.parsed, sheet.sheetName, line);
                        const printed = rowImageFor(run.parsed?.rowImages, sheet.sheetName, line.lineNo);
                        const pictureKey = `${sheetIndex}:${line.index}`;
                        const pictureOpen = openPicture === pictureKey;
                        const canChangePicture = run.status === "parsed" && Boolean(printed || line.picture);
                        const togglePicture = canChangePicture
                          ? () => setOpenPicture((current) => (current === pictureKey ? null : pictureKey))
                          : undefined;
                        const chosenNone = isNoPicture(line.picture);
                        const whyKey = `${sheetIndex}:${line.index}`;
                        const whyOpen = openWhy.has(whyKey);
                        const description = fabric ? undefined : descriptions[line.index];
                        const descriptionKey = `${sheetIndex}:${line.index}`;
                        const descriptionOpen = openDescriptions.has(descriptionKey);
                        const pdfPage = pdfPageOfLine(run.parsed?.pdfSource, sheet.sheetName, line.lineNo);
                        // C2: what code's cross-checks found on this transcribed line. Red where any failed.
                        const flags = lineChecks.get(sheetIndex)?.get(line.lineNo) ?? [];
                        return (
                          <Fragment key={line.index}>
                          <Tr
                            id={billLineId(sheetIndex, line.lineNo)}
                            tone={flags.length > 0 ? "danger" : duplicated ? "warn" : "plain"}
                            className={[
                              ROW_NO_RULE,
                              fabric ? ROW_FABRIC : "",
                              place.family ? ROW_FAMILY_BAR : "",
                              place.familyRule ? ROW_FAMILY_RULE : "",
                              line.ignored ? "opacity-40" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {/* ONE NUMBER: the spreadsheet row, the one you
                                scroll to in Excel. The bill's OWN line number,
                                where it has a column for one, is the hover —
                                two near-identical columns of digits in the
                                margin read as one too many. */}
                            <Td
                              muted={!fabric}
                              className={fabric ? "text-[11.5px] text-neutral-400" : undefined}
                              title={line.sourceLine ? `line ${line.sourceLine} on the bill` : undefined}
                            >
                              {/* A PDF BILL'S LINE NAMES ITS PAGE: the workbook
                                  row means nothing to somebody holding the PDF. */}
                              {pdfPage !== null ? (
                                <a
                                  href={`/api/imports/${run.id}/source?document=pdf#page=${pdfPage}`}
                                  className="whitespace-nowrap text-blue-700 no-underline hover:underline"
                                  title={`Row ${line.lineNo} of the spreadsheet read from the PDF`}
                                >
                                  p.&nbsp;{pdfPage}
                                </a>
                              ) : (
                                line.lineNo
                              )}
                            </Td>
                            <Td>
                              <BoqRowKindCell
                                line={line}
                                lines={sheet.lines}
                                editable={run.status === "parsed"}
                                busy={busy}
                                problem={problemByRow.get(line.lineNo) ?? null}
                                onSet={(kind, finishForRow) => void setLineKind(sheetIndex, line.index, kind, finishForRow)}
                              />
                            </Td>
                            <Td mono className={fabric ? "text-neutral-500" : undefined}>
                              {fabric ? (
                                <FabricCodeCell line={line} />
                              ) : line.code ? (
                                <ClientRefs code={line.code} />
                              ) : (
                                "—"
                              )}
                              {alsoOn.length > 0 && (
                                <span className="mt-0.5 block font-sans text-[10.5px] text-amber-800">
                                  also on row{alsoOn.length === 1 ? "" : "s"} {listOf(alsoOn)}
                                </span>
                              )}
                              {/* EVERY TRANSCRIBED LINE SAYS SO (C2, Max's
                                  condition): a few words in place, its page one
                                  click away in the first cell, red where a check
                                  failed, the whole sentence on hover. */}
                              {transcribed && pdfPage !== null && (
                                <span
                                  className={`mt-0.5 block max-w-[15rem] whitespace-normal font-sans text-[10.5px] ${flags.length > 0 ? `font-medium ${TONE.danger.text}` : TONE.guess.text}`}
                                  title={flags.length > 0 ? flags.map((flag) => flag.why).join("\n") : `Transcribed by the model from page ${pdfPage}: check it against the PDF.`}
                                >
                                  transcribed
                                  {flags.length > 0 && ` · ${flags[0]!.words}${flags.length > 1 ? ` (+${flags.length - 1})` : ""}`}
                                </span>
                              )}
                            </Td>
                            {fabric ? (
                            <Td>
                              {/* A FABRIC HANGS OFF ITS ITEM: its swatch on a
                                  rail, its words, and one chip saying where it
                                  goes. Why it is a fabric line is one press
                                  away rather than three lines on every row. A
                                  fabric the bill printed elsewhere stays where
                                  the bill put it, off the rail, naming its row. */}
                              <div
                                className={
                                  place.hanging
                                    ? `${ITEM_CELL} flex items-center gap-2.5 ${RAIL} ${place.more ? RAIL_MORE : ""}`
                                    : `${ITEM_CELL} flex items-center gap-2.5`
                                }
                              >
                                <BillRowPicture
                                  importId={id}
                                  sheetIndex={sheetIndex}
                                  lineNo={line.lineNo}
                                  image={image}
                                  size="swatch"
                                  version={line.pictureVersion ?? 0}
                                  chosenNone={chosenNone}
                                  open={pictureOpen}
                                  onOpen={togglePicture}
                                />
                                <div className="min-w-0">
                                  <span className="block text-[12.5px] text-neutral-800">
                                    <ClampedText text={line.itemDescription} />
                                    {line.productReference && (
                                      <span className="text-neutral-500"> · {line.productReference}</span>
                                    )}
                                  </span>
                                  {line.notes && (
                                    <span className="block text-xs text-neutral-500">Notes: {line.notes}</span>
                                  )}
                                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                    {line.finishFor && (
                                      <Chip mono className={CHIP_WRAPS}>
                                        {/* WHERE IT GOES, from the decision the
                                            confirm writes with — a metal is not
                                            "the next free COM". */}
                                        {`${fabricFilingCode(line) ?? "no code"} ${
                                          fabricFilings[line.index]?.goesTo ?? "→ a spec on its item"
                                        }`}
                                      </Chip>
                                    )}
                                    <span className="text-[11px] text-neutral-500">
                                      {line.finishFor
                                        ? place.hanging
                                          ? `on ${line.finishFor.code ?? `row ${line.finishFor.row}`}`
                                          : `for row ${line.finishFor.row}${
                                              line.finishFor.code ? ` (${line.finishFor.code})` : ""
                                            } — not the line above`
                                        : "no item chosen yet"}
                                      {" · "}
                                      <Button
                                        variant="quiet"
                                        size="xs"
                                        className="-my-0.5 px-1 py-0 text-[11px]"
                                        aria-expanded={whyOpen}
                                        aria-label={`Why row ${line.lineNo} is a fabric line`}
                                        onClick={() => toggleWhy(whyKey)}
                                      >
                                        why?
                                      </Button>
                                    </span>
                                  </span>
                                  {/* WHAT IT DOES TO THE FINISHES LIBRARY, in
                                      one quiet line: the code it is filed
                                      under and the swatch its picture becomes
                                      — computed on the server by the function
                                      the confirm decides with. */}
                                  {/* ONE LINE, SEVERAL ITEMS: said in words,
                                      from the decision the confirm writes
                                      with (`finishLineTargets`). */}
                                  {fabricFilings[line.index]?.forRows && (
                                    <span className="mt-0.5 block text-[11px] text-neutral-700" role="note">
                                      {fabricFilings[line.index]?.forRows?.sentence}
                                    </span>
                                  )}
                                  {/* THE CONFIRM WILL REFUSE THIS, said where it is
                                      (audit 2026-11-06, 1.5): the plan the confirm
                                      executes found a finish the item holds from
                                      the bill that this revision no longer lists.
                                      A few words in red; the sentence behind Why. */}
                                  {fabricFilings[line.index]?.refusal && (
                                    <details className="mt-0.5 text-[11px] text-red-800" role="alert">
                                      <summary className="cursor-pointer font-medium">
                                        Confirm will refuse: retire the held finish on the record first. Why?
                                      </summary>
                                      {fabricFilings[line.index]?.refusal}
                                    </details>
                                  )}
                                  {fabricFilings[line.index] && (
                                    <FabricFilingLine
                                      plan={fabricFilings[line.index] as FabricLinePlan}
                                      projectId={run.project_id}
                                    />
                                  )}
                                  {/* A FLAGGED READING IS SAID HERE, in amber,
                                      never behind the why?: it asks a person to
                                      check which item this is, and the Item
                                      column is wide enough to read it. */}
                                  {line.rowKindFlag && (
                                    <span className="mt-0.5 block text-[11px] text-amber-800" role="note">
                                      {line.rowKindFlag}
                                    </span>
                                  )}
                                  {whyOpen && <RowKindReasoning line={line} lines={sheet.lines} />}
                                </div>
                              </div>
                            </Td>
                            ) : (
                            <Td>
                              <div className={`${ITEM_CELL} flex gap-3`}>
                                <BillRowPicture
                                  importId={id}
                                  sheetIndex={sheetIndex}
                                  lineNo={line.lineNo}
                                  image={image}
                                  size="thumb"
                                  version={line.pictureVersion ?? 0}
                                  chosenNone={chosenNone}
                                  open={pictureOpen}
                                  onOpen={togglePicture}
                                />
                                <div className="min-w-0 flex-1">
                                  {image && !image.pathname && (
                                    <span className="mb-0.5 block text-[10.5px] text-neutral-500">
                                      {image.pictures} pictures on this row — none is taken as the item&apos;s
                                    </span>
                                  )}
                                  {isPictureCrop(line.picture) && (
                                    <span className="mb-0.5 block text-[10.5px] text-neutral-500">
                                      cropped on this review
                                    </span>
                                  )}
                                  {description ? (
                                    <span className="font-medium text-neutral-900">{description.name}</span>
                                  ) : (
                                    line.itemDescription
                                  )}
                                  {line.productReference && (
                                    <span className="text-neutral-500"> · {line.productReference}</span>
                                  )}
                                  {/* WHAT THE NEW RECORD'S NOTES WILL SAY: the
                                      notes column, then every kept column as
                                      "heading: value" — `composeBillNotes`, the
                                      function the confirm writes them with. */}
                                  {composeBillNotes(line.notes, line.kept) && (
                                    <span className="mt-0.5 block text-xs text-neutral-500">
                                      Notes: {composeBillNotes(line.notes, line.kept)?.split("\n").join(" · ")}
                                    </span>
                                  )}
                                  {description && (
                                    <BillDescriptionSummary
                                      plan={description}
                                      open={descriptionOpen}
                                      onToggle={() => toggleDescription(descriptionKey)}
                                      busy={busy}
                                      chipClassName={CHIP_WRAPS}
                                      onSetSlot={
                                        run.status === "parsed" && !line.ignored
                                          ? (key, slot) => void setSlot(sheetIndex, line, key, slot)
                                          : undefined
                                      }
                                      onSetUnit={
                                        run.status === "parsed" && !line.ignored
                                          ? (unit) => void setUnit(sheetIndex, line, unit)
                                          : undefined
                                      }
                                    />
                                  )}
                                </div>
                              </div>
                            </Td>
                            )}
                            {/* A FABRIC LINE IS NOT A RECORD: no area to
                                carry, no quantity to ask for, no designer. One
                                empty cell, rather than the item's area again
                                and an amber "not given" nobody has to answer. */}
                            {fabric ? (
                              <Td colSpan={3} />
                            ) : (
                            <>
                            {/* What the record will carry: `effectiveArea` is
                                the function the confirm writes it with, so a
                                Sub-Area shows here as stored — the area, then
                                the sub-area under it, the whole as the title. */}
                            <Td className="text-[12.5px] leading-5" title={effectiveArea(line) ?? undefined}>
                              <AreaLines line={line} />
                            </Td>
                            {/* NO QUANTITY IS NOT A DASH AND IT IS NEVER A 1.
                                A bill with no `TOTAL Q-ty` column gives every
                                line a null quantity (variance matrix row 2),
                                and an em dash there reads as "nothing to say"
                                rather than as a gap somebody has to close. The
                                tab's own sentence above says it once for the
                                whole sheet; this is short because the column is
                                narrow and there are three hundred of them. */}
                            <Td num>
                              {line.qty === null ? (
                                // WHAT THE BILL PRINTED, where it printed
                                // something that is not a count (C3,
                                // 2026-11-06): "TBC", "1.5", "2 x 3". The cell
                                // says so in its own words; the whole sentence
                                // is the title, from the one reader that
                                // refused it.
                                <span
                                  className="text-[11px] text-amber-800"
                                  title={
                                    line.qtyRaw
                                      ? `${quantityNotGiven(line.qtyRaw)}. Nothing is assumed.`
                                      : "The bill gave no quantity for this line. Nothing is assumed."
                                  }
                                >
                                  not given
                                  {line.qtyRaw && (
                                    <span className="block max-w-[9rem] truncate text-neutral-500">
                                      bill says “{line.qtyRaw}”
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <>
                                  {line.qty}
                                  {line.qtyUnit && <span className="text-neutral-400"> {line.qtyUnit}</span>}
                                </>
                              )}
                              {/* THE BILL'S MOCK-UP FIGURE, as printed, beside
                                  the order quantity — and only where it puts
                                  the item on the mock-up phase. */}
                              {readMockupQty(line.mockupQtyRaw).on && (
                                <span
                                  className="mt-0.5 block text-[11px] text-neutral-600"
                                  title="Also added to the Mock-up phase at confirm, from the bill's mock-up column."
                                >
                                  Mock-up: {line.mockupQtyRaw}
                                </span>
                              )}
                            </Td>
                            <Td mono muted>
                              {line.designer ?? "—"}
                            </Td>
                            </>
                            )}
                            {reconciliation && (
                              <Td>
                                <PairingCell
                                  line={line}
                                  pairing={pairingFor(line.index)}
                                  reconciliation={reconciliation}
                                  status={run.status}
                                  busy={busy}
                                  onSet={(patch) => setLine(sheetIndex, line.index, patch)}
                                />
                              </Td>
                            )}
                            {/* Category and level: a record's, so a fabric
                                line's are empty — what it is instead sits
                                behind its "why?". */}
                            {fabric ? (
                              <Td colSpan={2} />
                            ) : (
                            <Td>
                              {/* A GUESS IS A SUGGESTION UNTIL SOMEBODY ACCEPTS
                                  IT, and only an accepted one is written
                                  (audit 2026-11-06, G8): the Level cell's
                                  rule, in `BillCategoryCell`. */}
                              <BillCategoryCell
                                line={line}
                                categories={data.categories}
                                editable={run.status === "parsed" && !line.ignored}
                                busy={busy}
                                onSet={(categoryId) => void setLine(sheetIndex, line.index, { categoryId })}
                              />
                              <CarriedFrom tab={line.categoryCarriedFrom} />
                            </Td>
                            )}
                            {/* THE LEVEL, GUESSED AND ONE CLICK FROM A DECISION.
                                A record with no level cannot be tiered at all,
                                so a 59-line bill used to arrive as 59 records
                                reading "Set level". A guess is a
                                `SuggestButton` with the words it was read from
                                beside it, NEVER a select already showing the
                                guess: a select reading "Hero" fires no change
                                event when somebody chooses Hero, so the one act
                                recording their agreement would do nothing. */}
                            {!fabric && (
                            <Td>
                              <LevelCell
                                line={line}
                                editable={run.status === "parsed" && !line.ignored}
                                busy={busy}
                                onSet={(level) => void setLine(sheetIndex, line.index, { level })}
                              />
                            </Td>
                            )}
                            {/* INCLUDE, AND THE ONE QUESTION THAT ASKS TO CHANGE
                                IT. The suggestion sits in this cell rather than
                                beside the description, because what it acts on
                                is the checkbox under it: a reviewer who accepts
                                it and changes their mind can see the way back
                                without moving their eyes. Nothing is ignored on
                                its own — this is the only control that does it,
                                and the checkbox undoes it. */}
                            <Td>
                              <input
                                type="checkbox"
                                checked={!line.ignored}
                                disabled={run.status !== "parsed"}
                                aria-label={`Include row ${line.lineNo}`}
                                onChange={() => setLine(sheetIndex, line.index, { ignored: !line.ignored })}
                              />
                              {line.ignored && line.ignoredBecause && (
                                <span className="mt-1 block text-[10.5px] text-neutral-500">
                                  left out: {line.ignoredBecause}
                                </span>
                              )}
                              {(() => {
                                const guess = fabric ? null : nonFurnitureOf(line);
                                if (!guess || line.ignored || run.status !== "parsed") return null;
                                return (
                                  <SuggestButton
                                    value="Not furniture"
                                    evidence={guess.reason}
                                    busy={busy}
                                    onAccept={() => void setLine(sheetIndex, line.index, { ignored: true })}
                                    className="mt-1.5"
                                  />
                                );
                              })()}
                            </Td>
                          </Tr>
                          {/* THE ROW'S PICTURE, opened under it as its OWN
                              row — never a cell beside the data — and before
                              the description panel, nearest the thumbnail
                              that opened it. */}
                          {pictureOpen && canChangePicture && (
                            <BillPicturePanelRow
                              importId={id}
                              projectId={run.project_id}
                              sheetIndex={sheetIndex}
                              lineNo={line.lineNo}
                              kind={fabric ? "swatch" : "item"}
                              original={printed}
                              now={chosenNone ? "none" : isPictureCrop(line.picture) ? "crop" : "own"}
                              colSpan={columns}
                              busy={busy}
                              onChoose={(choice) => setPicture(sheetIndex, line, choice)}
                              onClose={() => setOpenPicture(null)}
                            />
                          )}
                          {description && descriptionOpen && (
                            <BillDescriptionPanelRow
                              plan={description}
                              raw={line.itemDescriptionRaw ?? line.itemDescription}
                              colSpan={columns}
                              busy={busy}
                              onSetSlot={
                                run.status === "parsed" && !line.ignored
                                  ? (key, slot) => void setSlot(sheetIndex, line, key, slot)
                                  : undefined
                              }
                            />
                          )}
                          </Fragment>
                        );
                      };
                      return groupBillLines(sheet.lines).map((group, groupIndex) => (
                        <Fragment key={`group-${group.members[0]?.line.index ?? groupIndex}`}>
                          {groupIndex > 0 && <GroupGap columns={columns} />}
                          {group.family && <FamilyHeading family={group.family} columns={columns} />}
                          {group.members.map((member, memberIndex) => (
                            <Fragment key={`member-${member.line.index}`}>
                              {lineRows(member.line, {
                                member,
                                hanging: false,
                                more: false,
                                family: group.family !== null,
                                familyRule: group.family !== null && memberIndex > 0,
                              })}
                              {member.fabrics.map((fabricLine, fabricIndex) =>
                                lineRows(fabricLine, {
                                  member,
                                  hanging: true,
                                  more: fabricIndex < member.fabrics.length - 1,
                                  family: group.family !== null,
                                  familyRule: false,
                                }),
                              )}
                            </Fragment>
                          ))}
                        </Fragment>
                      ));
                      })()}
                      {/* THE SAME CLIENT REF ON TWO LINES IS NORMAL, AND IS THE
                          MOST CONFUSING THING IN THE REAL PILOT BILL. `SX11A`
                          appears twice in the P17231 BOQ at different
                          quantities. A ref is the CLIENT'S key, not ours —
                          which is why records carry a surrogate id and a
                          `record_no`. The explanation sits UNDER the rows it is
                          about, not in a banner at the top of the page. */}
                      {duplicates.map((group) => (
                        <tr key={group.code}>
                          <td
                            colSpan={columns}
                            className="border-b border-neutral-100 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900"
                          >
                            <b>
                              Row{group.lineNos.length === 1 ? "" : "s"} {listOf(group.lineNos)} carry the same client
                              ref <span className="font-mono">{group.code}</span> at different quantities.
                            </b>{" "}
                            That is normal — a ref is the client&rsquo;s key, not ours. Both become records; each gets
                            its own <span className="font-mono">record_no</span>.
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}

              {(sheet.metadata?.notes?.length ?? 0) > 0 && (
                <Card
                  title={
                    <>
                      Read off the rows above the header
                      <CardHeadingNote>kept on the phase as text</CardHeadingNote>
                    </>
                  }
                >
                  <p className="text-neutral-600">
                    {sheet.metadata.notes.map((note, index) => (
                      <span key={index} className="block">
                        {note}
                      </span>
                    ))}
                  </p>
                </Card>
              )}
            </div>
          );
        })}
      </PageBody>
    </>
  );
}
