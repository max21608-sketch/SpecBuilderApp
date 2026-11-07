"use client";

// One line of the bill review's table, every cell it has, and the panels that
// open under it; with the small pieces it draws. Moved out of
// src/app/dashboard/imports/[id]/page.tsx on 2026-11-06 (audit 5.3, cut A).
//
// Display and dispatch only. What a cell shows comes from the function the
// confirm decides with (`effectiveRowImage`, `fabricFilingCode`,
// `effectiveArea`, `composeBillNotes`, the server's filing and description
// plans), and every control writes through the verb the review hands it.
// Keep every `id` here: `billLineId` is where a "needs you" link lands.
import { useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import { Td, Tr } from "@/components/ui/Table";
import { ClientRefs } from "@/components/ui/ClientRefs";
import { TONE } from "@/components/ui/tone";
import BillCategoryCell from "@/components/imports/BillCategoryCell";
import BoqRowKindCell, { RowKindReasoning } from "@/components/imports/BoqRowKindCell";
// What each item's description cell becomes — the plan the confirm writes,
// computed on the server by `planSheetDescriptions` and only rendered here.
import { BillDescriptionPanelRow, BillDescriptionSummary, type ReviewDescription } from "@/components/imports/BillDescription";
// A row's picture opened under it: crop it, take it whole, or take none.
import BillPicturePanelRow from "@/components/imports/BillPicturePanel";
import { PairingCell } from "@/components/imports/RevisionPanel";
import BillTwinCell from "@/components/imports/BillTwinCell";
import { twinPartnerMissing, type TwinSuggestion } from "@/lib/twin-suggest";
import type { BoqImport, Category, Import, Line, Reconciliation, Sheet } from "@/components/imports/use-boq-import";
import { billLineId } from "@/lib/needs-you";
import { ITEM_LEVELS, ITEM_LEVEL_LABELS, isItemLevel } from "@/lib/spec-vocab";
import { quantityNotGiven } from "@/lib/printed-number";
import { pdfPageOfLine } from "@/lib/pdf-bill-source";
import type { LineCheck } from "@/lib/pdf-bill-checks";
import { readMockupQty } from "@/lib/bill-sheet-notices";
import { fabricCodeDisplay, fabricFilingCode } from "@/lib/boq-row-kinds";
import type { BillFamily, BillGroupMember } from "@/lib/bill-review-groups";
import {
  effectiveRowImage,
  isNoPicture,
  isPictureCrop,
  rowImageFor,
  type BillRowImage,
} from "@/lib/bill-row-image";
// Type only: the plan is computed on the server (`planBillFabrics`).
import type { FabricLinePlan } from "@/lib/bill-fabric-filing";
// Pure: the area a record will carry (a Sub-Area composed in), the same
// function the confirm writes it with, so the table shows what will be written.
import { effectiveArea } from "@/lib/boq-reconcile";
import { composeBillNotes } from "@/lib/boq-roles";
import { nonFurnitureOf } from "@/lib/non-furniture-guess";
import { clampText } from "@/lib/shout";

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
export function GroupGap({ columns }: { columns: number }) {
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
export function FamilyHeading({ family, columns }: { family: BillFamily; columns: number }) {
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
export function listOf(values: number[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
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

/**
 * WHERE `groupBillLines` PUT A LINE: a fabric HANGING off the item above is
 * drawn on a rail, a member of a family carries the sky bar, and every member
 * of a family after the first opens with a dashed rule rather than a gap.
 */
export type BillLinePlace = {
  member: BillGroupMember<Line>;
  hanging: boolean;
  more: boolean;
  family: boolean;
  familyRule: boolean;
};

/** One bill line's row, and the picture and description panels opened under it. */
export default function BillLineRow({
  line,
  place,
  sheet,
  sheetIndex,
  importId,
  run,
  columns,
  reconciliation,
  pairing,
  categories,
  descriptionPlan,
  fabricFiling,
  problem,
  flags,
  transcribed,
  busy,
  pictureOpen,
  onTogglePicture,
  onClosePicture,
  whyOpen,
  onToggleWhy,
  descriptionOpen,
  onToggleDescription,
  setLine,
  setPicture,
  setSlot,
  setUnit,
  setLineKind,
  twinSuggestion,
  onAcceptTwin,
  onClearTwin,
}: {
  line: Line;
  place: BillLinePlace;
  sheet: Pick<Sheet, "sheetName" | "lines">;
  sheetIndex: number;
  /** The import id the page was opened with: the row-image route's address. */
  importId: string;
  run: Pick<Import, "id" | "status" | "parsed" | "project_id">;
  /** How many columns the table has, for the panels that span it. */
  columns: number;
  /** The tab's reconciliation where the tab revises a phase; null otherwise. */
  reconciliation: Reconciliation | null;
  pairing: Reconciliation["lines"][number] | null;
  categories: Category[];
  /** What the line's description cell becomes, where it has a plan. A fabric line shows none. */
  descriptionPlan: ReviewDescription | undefined;
  /** What a finish line does to the finishes library, in words. */
  fabricFiling: FabricLinePlan | undefined;
  /** Why this line cannot be written as it stands (`rowKindProblems`), or null. */
  problem: string | null;
  /** C2: what code's cross-checks found on this transcribed line. Red where any failed. */
  flags: LineCheck[];
  transcribed: boolean;
  busy: boolean;
  pictureOpen: boolean;
  onTogglePicture: () => void;
  onClosePicture: () => void;
  whyOpen: boolean;
  onToggleWhy: () => void;
  descriptionOpen: boolean;
  onToggleDescription: () => void;
  /** 0060: the twin `suggestTwins` reads off the sheet for this line, if any. */
  twinSuggestion?: TwinSuggestion;
  onAcceptTwin?: () => void;
  onClearTwin?: () => void;
} & Pick<BoqImport, "setLine" | "setPicture" | "setSlot" | "setUnit" | "setLineKind">) {
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
  const canChangePicture = run.status === "parsed" && Boolean(printed || line.picture);
  const togglePicture = canChangePicture ? onTogglePicture : undefined;
  const chosenNone = isNoPicture(line.picture);
  const description = fabric ? undefined : descriptionPlan;
  const pdfPage = pdfPageOfLine(run.parsed?.pdfSource, sheet.sheetName, line.lineNo);
  return (
    <>
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
          problem={problem}
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
            importId={importId}
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
                    fabricFiling?.goesTo ?? "→ a spec on its item"
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
                  onClick={onToggleWhy}
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
            {fabricFiling?.forRows && (
              <span className="mt-0.5 block text-[11px] text-neutral-700" role="note">
                {fabricFiling?.forRows?.sentence}
              </span>
            )}
            {/* THE CONFIRM WILL REFUSE THIS, said where it is
                (audit 2026-11-06, 1.5): the plan the confirm
                executes found a finish the item holds from
                the bill that this revision no longer lists.
                A few words in red; the sentence behind Why. */}
            {fabricFiling?.refusal && (
              <details className="mt-0.5 text-[11px] text-red-800" role="alert">
                <summary className="cursor-pointer font-medium">
                  Confirm will refuse: retire the held finish on the record first. Why?
                </summary>
                {fabricFiling?.refusal}
              </details>
            )}
            {fabricFiling && (
              <FabricFilingLine
                plan={fabricFiling as FabricLinePlan}
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
            importId={importId}
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
            {/* ONE ITEM ON TWO LINES (0060): a suggestion with its
                evidence, or the twin a person accepted. */}
            {!line.ignored && (
              <BillTwinCell
                accepted={line.twinOf}
                partnerMissing={twinPartnerMissing(sheet.lines, line)}
                suggestion={twinSuggestion}
                editable={run.status === "parsed" && Boolean(onAcceptTwin)}
                busy={busy}
                onAccept={() => onAcceptTwin?.()}
                onClear={() => onClearTwin?.()}
              />
            )}
            {description && (
              <BillDescriptionSummary
                plan={description}
                open={descriptionOpen}
                onToggle={onToggleDescription}
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
            pairing={pairing}
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
          categories={categories}
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
        importId={importId}
        projectId={run.project_id}
        sheetIndex={sheetIndex}
        lineNo={line.lineNo}
        kind={fabric ? "swatch" : "item"}
        original={printed}
        now={chosenNone ? "none" : isPictureCrop(line.picture) ? "crop" : "own"}
        colSpan={columns}
        busy={busy}
        onChoose={(choice) => setPicture(sheetIndex, line, choice)}
        onClose={onClosePicture}
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
    </>
  );
}
