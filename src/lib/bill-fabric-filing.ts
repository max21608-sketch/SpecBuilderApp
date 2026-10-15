// What a bill's fabric lines do to the project's finishes library — the code
// each one is filed under, and the swatch each code takes.
//
// ============================================================================
// THE BILL FILLS THE LIBRARY (Max, 2026-10-05).
//
// "the fabric's picture should be assigned to that fabric code in the fabric
// library … it is the swatch for the fabric code … as soon as the BOQ's in, it
// should be there." And a fabric with real words and no code is filed as an
// IN-HOUSE fabric by default; a placeholder ("Fabric @ Armchair (Option 1)
// Technical details TBC") is never filed and never matched.
//
// EVERY FINISH LINE, NOT ONLY A FABRIC (2026-10-06). A bill's `finish_for`
// line may be a timber, a metal or a trim; WHICH BWS FIELD it fills is
// `bill-finish-kind.ts` (`decideBillFinishSlot`), and the review's plan below
// carries that sentence ("→ Main metal finish") beside the filing. Every kind
// is filed in the library the same way: the library is the client's codes,
// not BWS's fields. The names here still say "fabric" — they are the words
// every caller and the review screen already use for a `finish_for` line.
//
// PURE, and called by BOTH the confirm (`confirm-boq.ts`) and the review GET,
// which shows one line per fabric row saying what the confirm will do. Two
// rules — one deciding and one describing — is how a review promises a swatch
// the confirm does not take. So:
//
//   * `decideFabricFiling` is the ONE decision for one line, against the
//     library as it stands at that line. The confirm executes it with the
//     live library (updated in-loop as it files); the review runs
//     `planBillFabrics`, which walks the bill in the confirm's own order and
//     adds what each line would file to a copy of the library, so a code new
//     on row 3 is "the same code" on row 5 in both.
//   * `planFinishSwatches` is the ONE swatch rule, over every fabric line of a
//     finish across the whole bill. The confirm calls it after filing, with
//     real finish ids; the review calls it with the copy's.
//
// ---- THE SWATCH RULE, AND ITS TRAPS -----------------------------------------
//
//   * A finish takes a swatch only where EVERY fabric line of it that carries
//     a picture carries the SAME one. Pathnames are content-addressed (the
//     bytes' sha, `bill-images.ts`), so "the same pathname" is "the same
//     picture". Two different pictures on one code is a question for a
//     person, not a pick — none is taken and the code is named.
//   * An existing swatch is NEVER replaced. A swatch somebody uploaded or
//     cropped off a drawing is a decision; a bill is not a reason to undo it.
//   * A row printing two different pictures (`pathname: null`) gives none —
//     which one is the swatch is a person's call — and does not veto a row
//     that gives one.
//   * A placeholder's picture is filed nowhere: it has no finish to belong to.
// ============================================================================
import {
  fabricFilingCode,
  fabricLineIsPlaceholder,
  fabricLineState,
  fabricScheduleCode,
  type RowKindFields,
} from "@/lib/boq-row-kinds";
import { billItemName } from "@/lib/bill-description";
import {
  billFinishLineKind,
  billFinishLineWords,
  billFinishNoun,
  decideBillFinishSlot,
  describeBillFinishSlot,
  type BillFinishKind,
} from "@/lib/bill-finish-kind";
import {
  effectiveRowImage,
  isNoPicture,
  isPictureCrop,
  type BillPictureOverride,
  type BillRowImage,
  type BoqRowImages,
} from "@/lib/bill-row-image";
import {
  internalFinishSeries,
  normaliseFinishCode,
  readUncodedFinish,
  resolveFinishCodeInWalk,
  INTERNAL_FINISH_PREFIX,
  type Finish,
} from "@/lib/finishes";

/** What one fabric line does to the library. */
export type FabricFiling =
  /** Coded, and the library holds the code saying the same (or nothing yet). Linked. */
  | { outcome: "matched"; finish: Finish; readAs?: string }
  /**
   * Coded, and the library has no such code: a new CLIENT finish, TBC, with the
   * line's words as its description — or with NONE where the words are only a
   * placeholder (`describe: false`), so "Technical details TBC" never becomes
   * what the library says the code is.
   */
  | { outcome: "new"; code: string; describe: boolean }
  /** Coded, and the library describes the code differently: linked to nothing (the CONFLICT rule). */
  | { outcome: "conflict"; finish: Finish; saysInstead: string; readAs?: string }
  /** No code, and an in-house finish is worded exactly the same. Linked. */
  | { outcome: "same_words"; finish: Finish }
  /** No code, real words: an in-house code is minted at confirm, TBC, the line's words. */
  | { outcome: "mint" }
  /** No code and nothing beyond TBC and filler: never filed, never matched. */
  | { outcome: "placeholder" };

type FabricLine = {
  code: string | null;
  itemDescription: string;
  itemDescriptionRaw?: string | null;
  /** The bill's own Finish column, as printed (`boq-import.ts`). */
  finishRaw?: string | null;
  /** The bill's own finish-code column — the COM CODE (`fabricScheduleCode`). */
  finishCode?: string | null;
} & RowKindFields;

// ============================================================================
// A LINE THAT NAMES ITS FINISH BY A SCHEDULE CODE (2026-10-15, the Ronnie
// Scott's procurement schedule, LBPCo).
//
// Each COM, leather and trim line there reads, across its columns:
//
//   FF&E CODE FB-SO-01 · COM CODE FB_16 · DESCRIPTION "SOFA @ FABRIC" ·
//   FINISH / REFERENCE "NAME: POLLACK - EMBELLUSHED PLUSH / CODE: 5046/06
//   CAYENNE / COLOUR: …"
//
// The description is WHERE the cloth goes ("POUFFE DEPTH FABRIC", "ARMCHAIR
// MAIN BODY FABRIC") or a placeholder; the cloth is in the finish column; and
// the cloth's identity is the COM code, which the project's COM LIST
// describes. Read as every other bill's finish line, the confirm wrote "SOFA @
// FABRIC" into COM 1 as a TBC and filed FB-SO-01, a position code two
// different cloths share on that schedule, so nothing linked to the COM list.
//
// So where a line carries a schedule code, and only there (every other bill
// has no such column and writes exactly as before):
//
//   * THE VALUE IS THE FINISH COLUMN'S CLOTH, whitespace folded to one line as
//     every Finish column cell is (`columnStatements`). A blank finish cell
//     keeps the description, as before.
//   * THE QUALIFIER IS THE DESCRIPTION'S PLACEMENT (0029): "POUFFE DEPTH",
//     the material word at its end taken off. None where the description is
//     a placeholder ("SOFA @ FABRIC") or a bare code ("TR-CH-01").
//   * IT IS FILED UNDER THE SCHEDULE CODE (`fabricFilingCode`), and the
//     bill's cloth is NEITHER offered to the CONFLICT rule NOR written as the
//     library's description. The bill's finish cell is its COPY of the COM
//     list, in its own layout: against the list's entry ("CARYATIS - MADAME
//     E; Colour: CUIVRE") the copy ("NAME: CARYATIS - MADAME E CODE: M441
//     909 COLOUR: CUIVRE …") disagrees in formatting alone, so compared it
//     linked nothing whichever was read first, and written as the description
//     it turned the list's own entry into a conflict. The code is the key, as
//     a drawing callout printing only `GR TIM 04` is (`finishWordsOf`); the
//     list describes it. Until a list is read the library row is TBC with no
//     words, and the item's attribute keeps the cloth as the evidence.
//
// The cost, knowingly: two lines quoting one COM code with different cloth
// link to one finish without a question. One code, one cloth is what a COM
// code means, and the review prints both lines' cloth.
// ============================================================================

/** True where the line names its finish by a schedule code (the bill's COM CODE). */
export function filedByScheduleCode(line: FabricLine): boolean {
  return fabricScheduleCode(line) !== null;
}

/** The cloth a schedule-coded line's finish column states, on one line, or "" where it states none. */
function scheduleLineCloth(line: FabricLine): string {
  return (line.finishRaw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The words a fabric line writes as its spec — the description verbatim, or
 * "" where it has none (never its code). A line filed by a schedule code
 * writes its finish column's cloth instead, where it has one.
 */
export function fabricLineValue(line: FabricLine): string {
  if (filedByScheduleCode(line)) {
    const cloth = scheduleLineCloth(line);
    if (cloth !== "") return cloth;
  }
  return billFinishLineWords(line);
}

/** A material word at the END of a placement ("POUFFE DEPTH FABRIC", "BAR STOOL @ LEATHER"). */
const TRAILING_MATERIAL = /\s*@?\s*\b(?:fabrics?|leathers?|trims?|com)\s*$/i;

const foldWords = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * WHERE ON THE ITEM a schedule-coded line's cloth goes — its description,
 * the material word at its end taken off — or null. Only where the value is
 * the finish column's cloth: otherwise the description IS the value.
 *
 * Null where what is left says nothing about where: the item's own name
 * ("SOFA @ FABRIC" under a SOFA), a bare code ("TR-CH-01"), or a TBC. NOT the
 * placeholder test: that one takes position words ("main", "body", "seat")
 * as filler, which is right for whether a line names a fabric and wrong here,
 * where the position words are the whole point ("ARMCHAIR MAIN BODY").
 */
export function fabricLinePlacement(line: FabricLine, parentName: string | null): string | null {
  if (!filedByScheduleCode(line) || scheduleLineCloth(line) === "") return null;
  const words = billFinishLineWords(line).replace(/\s+/g, " ").trim();
  const placement = words.replace(TRAILING_MATERIAL, "").replace(/\s*@\s*$/, "").trim();
  if (placement === "") return null;
  if (parentName && foldWords(placement) === foldWords(parentName)) return null;
  if (!/\s/.test(placement) && /\d/.test(placement)) return null;
  if (fabricLineIsPlaceholder(placement, null) && !/[a-z]{3,}/i.test(placement.replace(/\b(?:tbc|tba|tbd|n\/?a)\b/gi, ""))) {
    return null;
  }
  return placement;
}

/**
 * WHAT A FINISH LINE WRITES: its value and its state. The ONE decision the
 * confirm writes and the review predicts (Max, 2026-10-13).
 *
 * A PLACEHOLDER IS TBC. "Fabric @ Armchair (Option 1)", "Fabric: N/A", or no
 * words at all name no fabric, and `fabricLineState` alone stored them
 * CONFIRMED unless they carried a TBC phrase — a settled COM answer that
 * shipped to BWS as written and was never chased. `fabricLineIsPlaceholder`
 * is the existing rule (the bill's lead, the item's name, filler and TBC
 * phrases taken off). A line with no words is a TBC with NO value: its code
 * cell is never its words. Anything else keeps `fabricLineState`.
 */
export function fabricLineWrite(
  line: FabricLine,
  parentName: string | null,
): { value: string | null; state: "tbc" | "confirmed"; qualifier?: string } {
  const value = fabricLineValue(line);
  // Only a schedule-coded line has one, so every other line's write is the
  // shape it always was.
  const placement = fabricLinePlacement(line, parentName);
  const qualifier = placement ? { qualifier: placement } : {};
  if (value === "") return { value: null, state: "tbc", ...qualifier };
  if (fabricLineIsPlaceholder(value, parentName)) return { value, state: "tbc", ...qualifier };
  return { value, state: fabricLineState(value), ...qualifier };
}

/**
 * The code a fabric line is filed under (`fabricFilingCode`): its schedule
 * code where the bill gives one, otherwise its own — the bracket removed,
 * `N/A` and blank as none, and NONE where it is the item's own code (a
 * fabric line whose code is its item's names no fabric at all).
 */
export function fabricMaterialCode(line: FabricLine): string | null {
  return fabricFilingCode(line);
}

/** WHAT A FINISH LINE IS (`bill-finish-kind.ts`), re-exported for the confirm. */
export { billFinishLineKind };

/**
 * THE ONE DECISION for one fabric line, against the library as it stands.
 *
 * Coded: exactly as before 2026-10-05 — `resolveFinishCode`, with its
 * CONFLICT rule. Uncoded: a placeholder files nothing; otherwise an in-house
 * finish worded EXACTLY the same is linked (`readUncodedFinish`'s first step,
 * internal rows only), and anything else mints. A near miss is NOT taken: an
 * uncoded line that is nearly an existing in-house fabric mints its own code,
 * which the review shows and a person can merge.
 */
export function decideFabricFiling(input: {
  materialCode: string | null;
  /** What the attribute's value will be (`fabricLineValue`). */
  says: string;
  /** The line's description alone, without the code fallback — what the placeholder test reads. */
  words: string;
  /** The item line's name, which the bill's lead repeats. */
  parentName: string | null;
  library: readonly Finish[];
  /**
   * The line is filed by a schedule code (`filedByScheduleCode`): the code
   * links, and the line's words neither describe nor contradict it.
   */
  byScheduleCode?: boolean;
}): FabricFiling {
  const { materialCode, says, words, parentName, library } = input;
  if (input.byScheduleCode && materialCode) {
    const byCode = resolveFinishCodeInWalk(materialCode, null, [...library]);
    if (byCode.status === "matched") {
      return { outcome: "matched", finish: byCode.finish, ...(byCode.readAs ? { readAs: byCode.readAs } : {}) };
    }
    if (byCode.status === "new") return { outcome: "new", code: byCode.code, describe: false };
  }
  const placeholder = fabricLineIsPlaceholder(words, parentName);
  // A CODED PLACEHOLDER LINKS BY ITS CODE. The Aman bill names GR-FAB-13 under
  // the stool with its collection and colour, and again under the desk chair
  // as "Technical Details TBC": the client is naming the same fabric and not
  // repeating it. Words that say nothing cannot disagree with the library, so
  // they are not offered to the CONFLICT rule (found 2026-10-05, the local walk).
  const coded = resolveFinishCodeInWalk(materialCode, placeholder ? null : says, [...library]);
  // A ZONE TWIN (`findFinishByCode`) keeps its sentence, so the review says it.
  const readAs = (status: { readAs?: string }) => (status.readAs ? { readAs: status.readAs } : {});
  if (coded.status === "matched") return { outcome: "matched", finish: coded.finish, ...readAs(coded) };
  if (coded.status === "new") return { outcome: "new", code: coded.code, describe: !placeholder };
  if (coded.status === "conflict") {
    return { outcome: "conflict", finish: coded.finish, saysInstead: coded.saysInstead, ...readAs(coded) };
  }

  if (placeholder) return { outcome: "placeholder" };
  const reading = readUncodedFinish(says, library, null);
  if (reading.outcome === "link" && reading.finish) return { outcome: "same_words", finish: reading.finish };
  return { outcome: "mint" };
}

/**
 * Whether a planned description attribute files a finish code — the
 * confirm's `writeDescriptionAttributes` test, here so the review's
 * simulation and the confirm ask one function.
 */
export function descriptionFilesAFinish(attribute: { materialCode: string | null; attrGroup: string }): boolean {
  return Boolean(attribute.materialCode) && attribute.attrGroup !== "note" && attribute.attrGroup !== "dimension";
}

// ---- the swatch ------------------------------------------------------------------

/** One fabric line of a finish, and the picture its row prints (or null). */
export type SwatchCandidate = { sheetName: string; rowNo: number; image: BillRowImage | null };

export type SwatchDecision =
  /** Take this row's picture as the code's swatch. */
  | { take: SwatchCandidate & { image: BillRowImage & { pathname: string } } }
  /** The library already has a swatch for the code: never replaced. */
  | { none: "held" }
  /** Two or more different pictures across the code's lines: none, and the rows are named. */
  | { none: "differ"; rows: number[] }
  /** No line of the code carries a single picture. */
  | { none: "no_picture" };

/**
 * THE SWATCH RULE, per finish across the whole bill. `held` is the finishes
 * that already have a current swatch. Keys are whatever identifies a finish
 * to the caller — a real id at confirm, a planned one on the review.
 */
export function planFinishSwatches(
  groups: ReadonlyMap<string, readonly SwatchCandidate[]>,
  held: ReadonlySet<string>,
): Map<string, SwatchDecision> {
  const out = new Map<string, SwatchDecision>();
  for (const [key, candidates] of groups) {
    if (held.has(key)) {
      out.set(key, { none: "held" });
      continue;
    }
    const pictured = candidates.filter(
      (candidate): candidate is SwatchCandidate & { image: BillRowImage & { pathname: string } } =>
        typeof candidate.image?.pathname === "string" && candidate.image.pathname !== "",
    );
    if (pictured.length === 0) {
      out.set(key, { none: "no_picture" });
      continue;
    }
    const firstOf = new Map<string, number>();
    for (const candidate of pictured) {
      if (!firstOf.has(candidate.image.pathname)) firstOf.set(candidate.image.pathname, candidate.rowNo);
    }
    if (firstOf.size > 1) {
      out.set(key, { none: "differ", rows: [...firstOf.values()] });
      continue;
    }
    out.set(key, { take: pictured[0] as SwatchCandidate & { image: BillRowImage & { pathname: string } } });
  }
  return out;
}

const listRows = (rows: readonly number[]): string =>
  rows.length <= 1 ? String(rows[0] ?? "") : `${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`;

/** The confirm's notice for a code whose lines carry different pictures. */
export function swatchDifferNotice(code: string, rows: readonly number[]): string {
  return `${code}: rows ${listRows(rows)} carry different pictures — no swatch taken`;
}

// ---- the review's simulation -------------------------------------------------------

type PlanLine = FabricLine & {
  index: number;
  lineNo: number;
  ignored: boolean;
  /** A person's choice of picture for the row (`effectiveRowImage`). */
  picture?: BillPictureOverride | null;
  itemDescriptionRaw?: string | null;
  replaces?: { recordId: string; recordVersion: number } | null;
};
type PlanSheet = {
  sheetName: string;
  ignored: boolean;
  lines: readonly PlanLine[];
  /** The finish-code column's heading as printed, for the sentence ("by its COM CODE"). */
  columns?: { finishCode?: { heading: string } } | null;
};

/** A finish the bill would create, in the review's copy of the library. */
type Planned = { finish: Finish; rowNo: number; minted: boolean };

/** What one fabric line will do, as the review says it. */
export type FabricLinePlan = {
  /**
   * The BWS field the line fills, or why it is kept with none, in words —
   * "→ Main metal finish", "→ kept, COM 1–3 are full" (`decideBillFinishSlot`).
   */
  goesTo: string;
  /** The filing, in words. */
  filing: string;
  /** The swatch, in words; null where the line files no finish. */
  swatch: string | null;
  /** True where the line mints in `BW-F-` because the project has no short code. */
  askForShortCode: boolean;
  /** The state the confirm will store (`fabricLineWrite`): a placeholder is TBC. Absent on a carried line, which writes nothing. */
  tbc?: boolean;
  /**
   * WHAT IS WRITTEN, where it is not the description the row already shows: a
   * line filed by a schedule code writes its finish column's cloth, with its
   * placement as the qualifier (`fabricLineWrite`). Absent otherwise.
   */
  writes?: { value: string; qualifier: string | null };
};

/**
 * WHAT THE CONFIRM WILL DO WITH EVERY FABRIC LINE, walked in the confirm's own
 * order: sheet by sheet, each sheet's item lines (whose description cells file
 * their own codes) and then its fabric lines; a sheet with no item line is
 * skipped whole, as the confirm skips it.
 *
 * `descriptionCodes(sheetIndex, lineIndex)` is the coded finishes an item
 * line's description cell will file (`descriptionFilesAFinish` over its plan),
 * or none where a revision holds it back. `heldFabric(recordId)` is the bill
 * finishes OF THAT KIND a carried record already holds: a carried line holding
 * the same words files nothing, as at confirm. `heldSlots(sheetIndex,
 * lineIndex)` is the BWS slots (json ids) the item line's record will hold
 * before its finish lines are written — what a carried record holds from any
 * document, and what its description cell is planned to write — so each
 * finish line's slot is decided against what the confirm's own read will
 * find (`decideBillFinishSlot`).
 */
export function planBillFabrics(input: {
  sheets: readonly PlanSheet[];
  rowImages: BoqRowImages | null | undefined;
  library: readonly Finish[];
  heldSwatches: ReadonlySet<string>;
  prefix: string | null;
  descriptionCodes: (sheetIndex: number, lineIndex: number) => readonly { code: string; words: string | null }[];
  heldFabric: (recordId: string, kind: BillFinishKind) => readonly string[];
  heldSlots: (sheetIndex: number, lineIndex: number) => readonly number[];
}): Map<string, FabricLinePlan> {
  const library: Finish[] = [...input.library];
  const planned = new Map<string, Planned>();
  const series = internalFinishSeries(input.prefix);
  const groups = new Map<string, SwatchCandidate[]>();
  /** Per line: what it files (null where a carried record already holds it), and under which finish. */
  const filings = new Map<
    string,
    {
      filing: FabricFiling | null;
      candidate: SwatchCandidate;
      key: string | null;
      chosen: ChosenPicture;
      goesTo: string;
      kind: BillFinishKind;
      tbc?: boolean;
      writes?: { value: string; qualifier: string | null };
      byCodeHeading?: string;
    }
  >();
  /** The slots each item holds as its finish lines are walked, by the item's row on the sheet. */
  const slotsByItem = new Map<number, Set<number>>();
  const plan = (finish: Finish, rowNo: number, minted: boolean) => {
    library.push(finish);
    planned.set(finish.id, { finish, rowNo, minted });
  };

  for (const [sheetIndex, sheet] of input.sheets.entries()) {
    if (sheet.ignored) continue;
    const live = sheet.lines.filter((line) => !line.ignored);
    const items = live.filter((line) => line.rowKind !== "finish_for");
    if (items.length === 0) continue;

    for (const line of items) {
      for (const { code, words } of input.descriptionCodes(sheetIndex, line.index)) {
        const resolution = resolveFinishCodeInWalk(code, words, library);
        if (resolution.status !== "new") continue;
        plan(pendingFinish(`planned:${sheetIndex}:${line.lineNo}:${resolution.codeNorm}`, resolution.code, "client", words), line.lineNo, false);
      }
    }

    for (const line of items) {
      slotsByItem.set(line.lineNo, new Set(input.heldSlots(sheetIndex, line.index)));
    }

    for (const line of live.filter((entry) => entry.rowKind === "finish_for")) {
      const key = `${sheetIndex}:${line.index}`;
      const parent = line.finishFor ? sheet.lines.find((entry) => entry.lineNo === line.finishFor?.row) : undefined;
      // What the confirm will write, decided by the confirm's own function.
      const written = fabricLineWrite(line, parent ? billItemName(parent) : null);
      const says = written.value ?? "";
      const { kind } = billFinishLineKind(line);
      const candidate: SwatchCandidate = {
        sheetName: sheet.sheetName,
        rowNo: line.lineNo,
        // THE PICTURE THE CONFIRM WILL FILE: a person's crop or "no picture"
        // where they chose one, the bill's own otherwise.
        image: effectiveRowImage({ rowImages: input.rowImages }, sheet.sheetName, line),
      };
      if (parent?.replaces && input.heldFabric(parent.replaces.recordId, kind).includes(says)) {
        filings.set(key, {
          filing: null,
          candidate,
          key: null,
          chosen: chosenPicture(line.picture),
          goesTo: "→ nothing written",
          kind,
        });
        continue;
      }
      // THE SLOT, decided as the confirm decides it: against what the item
      // holds, then each finish line above this one under the same item.
      const taken = (parent && slotsByItem.get(parent.lineNo)) || new Set<number>();
      const placement = decideBillFinishSlot(kind, taken);
      if (placement.jsonId !== null) taken.add(placement.jsonId);
      const byScheduleCode = filedByScheduleCode(line);
      const filing = decideFabricFiling({
        materialCode: fabricMaterialCode(line),
        says,
        words: line.itemDescription,
        parentName: parent ? billItemName(parent) : null,
        library,
        byScheduleCode,
      });
      let finishKey: string | null = null;
      if (filing.outcome === "matched" || filing.outcome === "same_words") finishKey = filing.finish.id;
      else if (filing.outcome === "new") {
        finishKey = `planned:${sheetIndex}:${line.lineNo}`;
        plan(pendingFinish(finishKey, filing.code, "client", filing.describe ? says : null), line.lineNo, false);
      } else if (filing.outcome === "mint") {
        finishKey = `planned:${sheetIndex}:${line.lineNo}`;
        plan(pendingFinish(finishKey, `${series}…`, "internal", says), line.lineNo, true);
      }
      if (finishKey) groups.set(finishKey, [...(groups.get(finishKey) ?? []), candidate]);
      filings.set(key, {
        filing,
        candidate,
        key: finishKey,
        chosen: chosenPicture(line.picture),
        goesTo: describeBillFinishSlot(placement),
        kind,
        tbc: written.state === "tbc",
        ...(byScheduleCode && written.value && written.value !== billFinishLineWords(line)
          ? { writes: { value: written.value, qualifier: written.qualifier ?? null } }
          : {}),
        ...(byScheduleCode ? { byCodeHeading: sheet.columns?.finishCode?.heading?.trim() || "finish code" } : {}),
      });
    }
  }

  const swatches = planFinishSwatches(groups, input.heldSwatches);
  const out = new Map<string, FabricLinePlan>();
  for (const [key, { filing, candidate, key: finishKey, chosen, goesTo, kind, tbc, writes, byCodeHeading }] of filings) {
    if (filing === null) {
      out.set(key, {
        goesTo,
        filing: "already on the record from the bill — nothing filed",
        swatch: null,
        askForShortCode: false,
      });
      continue;
    }
    const filed = describeFiling(filing, planned, series, candidate.rowNo, kind);
    out.set(key, {
      goesTo,
      // A schedule-coded line says which column it was filed by, and that the
      // schedule — not the bill's copy of it — describes the code.
      filing:
        byCodeHeading && (filing.outcome === "new" || filing.outcome === "matched")
          ? `${filed}, by its ${byCodeHeading}${filing.outcome === "new" ? " — described when the finishes schedule is read" : ""}`
          : filed,
      swatch: finishKey ? describeSwatch(swatches.get(finishKey), candidate, chosen) : null,
      askForShortCode: filing.outcome === "mint" && series === INTERNAL_FINISH_PREFIX,
      tbc,
      ...(writes ? { writes } : {}),
    });
  }
  return out;
}

function pendingFinish(id: string, code: string, origin: Finish["codeOrigin"], description: string | null): Finish {
  return {
    id,
    code,
    codeNorm: normaliseFinishCode(code),
    codeOrigin: origin,
    kind: null,
    description,
    supplierRaw: null,
    reference: null,
    colour: null,
    state: "tbc",
  };
}

/** The filing half of a finish line's sentence on the review; `kind` names what a minted code is. */
export function describeFiling(
  filing: FabricFiling,
  planned: ReadonlyMap<string, { finish: Finish; rowNo: number; minted: boolean }>,
  series: string,
  rowNo: number,
  kind: BillFinishKind = "fabric",
): string {
  switch (filing.outcome) {
    case "new":
      return `new library entry ${filing.code}`;
    case "matched": {
      const earlier = planned.get(filing.finish.id);
      if (earlier && earlier.rowNo !== rowNo) return `new library entry ${filing.finish.code}, with row ${earlier.rowNo}`;
      return filing.readAs ? `matches ${filing.finish.code} in the library — ${filing.readAs}` : `matches ${filing.finish.code} in the library`;
    }
    case "conflict":
      return `${filing.finish.code} — the library describes it differently; not linked${filing.readAs ? ` (${filing.readAs})` : ""}`;
    case "same_words": {
      const earlier = planned.get(filing.finish.id);
      if (earlier?.minted) return `same words as row ${earlier.rowNo} — one in-house code`;
      return `matches ${filing.finish.code} (same words)`;
    }
    case "mint":
      return `new in-house ${billFinishNoun(kind)} — numbered ${series}… at confirm`;
    case "placeholder":
      return "placeholder — not filed";
  }
}

/** What a person chose for a row's picture on the review, as the swatch sentence needs it. */
export type ChosenPicture = "crop" | "none" | null;

function chosenPicture(picture: BillPictureOverride | null | undefined): ChosenPicture {
  return isNoPicture(picture) ? "none" : isPictureCrop(picture) ? "crop" : null;
}

/** The swatch half of a fabric row's line on the review. */
export function describeSwatch(
  decision: SwatchDecision | undefined,
  line: SwatchCandidate,
  chosen: ChosenPicture = null,
): string | null {
  if (!decision) return null;
  if ("take" in decision) {
    if (line.image?.pathname === decision.take.image.pathname) {
      return chosen === "crop" ? "swatch: this row's crop" : "swatch: this row's picture";
    }
    return `swatch: row ${decision.take.rowNo}'s picture`;
  }
  if (decision.none === "held") return "swatch: none (the library already has one)";
  if (decision.none === "differ") return `swatch: none — rows ${listRows(decision.rows)} differ`;
  if (chosen === "none") return "swatch: none — no picture chosen for this row";
  if (line.image && !line.image.pathname && line.image.pictures > 1) {
    return `swatch: none — ${line.image.pictures} pictures on this row`;
  }
  return "swatch: none in the bill";
}
