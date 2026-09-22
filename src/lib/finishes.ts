// The project's finishes library: one row per client finish code.
//
// ============================================================================
// THE LIBRARY IS THE TRUTH; THE ATTRIBUTE IS THE EVIDENCE.
//
// `record_attributes.value` keeps what the drawing literally said about THIS
// item, verbatim, because that is what makes a value re-checkable against its
// page. The FINISH holds what the code currently means. A linked attribute
// therefore renders as the finish, and correcting CH-01.1 once corrects every
// item carrying it — which is not a convenience here but the only correction
// mechanism there is: the pilot's finishes schedule is confirmed absent, so
// the codes exist only on the drawings.
//
// ---- ONE COMPOSER, THREE CALLERS ---------------------------------------
//
// `composeFinishCell` is called by the export composer, by the record screen,
// and by promote-answers when it writes the checklist answer. If the export
// rendered the finish and the checklist kept the old attribute text, editing
// the library would silently change forty export cells while every row a
// person can see said something else. That is the failure CLAUDE.md names
// about `composeDimensionCell`, in a second place.
//
// ---- THE STATE RULE ----------------------------------------------------
//
// A cell is only as settled as the weaker of the two: a `tbc` finish can never
// produce a confirmed value, whatever the attribute said. The Panther sofa
// records a fabric reading "TBC – Yarn Collective…", and a gate reporting
// satisfied over a fabric nobody has chosen is the exact trap promote-answers
// was written to avoid.
// ============================================================================
import type { AttributeState } from "@/lib/spec-vocab";
import type { Row } from "@/lib/db";

/**
 * Either driver, declared HERE rather than imported.
 *
 * `record-atoms.ts` exports the same shape and imports `isFinishKind` from this
 * file, so taking its type would close an import cycle — erased at compile time
 * today, and a real one the moment anything in it is read at import time. Six
 * lines is cheaper than the failure that produces, which lands somewhere
 * unrelated.
 */
type FinishSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

export const FINISH_KINDS = ["fabric", "leather", "timber", "metal", "stone", "glass", "paint", "other"] as const;
export type FinishKind = (typeof FINISH_KINDS)[number];

export const FINISH_KIND_LABELS: Record<FinishKind, string> = {
  fabric: "Fabric",
  leather: "Leather",
  timber: "Timber",
  metal: "Metal",
  stone: "Stone",
  glass: "Glass or mirror",
  paint: "Paint or lacquer",
  other: "Other",
};

export function isFinishKind(value: unknown): value is FinishKind {
  return typeof value === "string" && (FINISH_KINDS as readonly string[]).includes(value);
}

export const FINISH_CODE_ORIGINS = ["client", "internal"] as const;
/**
 * WHOSE code this is.
 *
 * `client` — the code the client's own document carried. `internal` — one this
 * app minted (`BW-F-001` upward, per project) because the document stated a
 * finish and gave it no code. The distinction exists for exactly one reason
 * and it is load-bearing: an internal code must never reach the BWS export,
 * the quote or the costing sheet, where it would read as a code the client
 * issued. `composeFinishCell` is where that is enforced.
 *
 * It is a COLUMN and not a reading of the code's spelling. A client who writes
 * `BW-F-…` on their own schedule must not be able to take a value out of the
 * file, and neither must somebody editing a code on the library screen.
 */
export type FinishCodeOrigin = (typeof FINISH_CODE_ORIGINS)[number];

export function isFinishCodeOrigin(value: unknown): value is FinishCodeOrigin {
  return value === "client" || value === "internal";
}

/** What this app's own finish codes are called. Never emitted to BWS. */
export const INTERNAL_FINISH_PREFIX = "BW-F-";

/** The number inside `BW-F-007`, or null for anything that is not one. */
export function internalFinishNumber(code: string): number | null {
  const match = /^BW-F-(\d+)$/i.exec(code.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** `1` → `BW-F-001`. Three digits, and wider than three when it has to be. */
export function formatInternalFinishCode(n: number): string {
  return `${INTERNAL_FINISH_PREFIX}${String(n).padStart(3, "0")}`;
}

export type Finish = {
  id: string;
  code: string;
  codeNorm: string;
  codeOrigin: FinishCodeOrigin;
  kind: FinishKind | null;
  description: string | null;
  supplierRaw: string | null;
  reference: string | null;
  colour: string | null;
  state: AttributeState;
};

/**
 * Case and whitespace, and NOTHING ELSE.
 *
 * `CH-01.1` and `CH-01-1` stay two finishes. A normaliser clever enough to
 * merge them is clever enough to merge two codes a client meant to keep apart
 * — and there is no way back from a silent merge, because the two sets of
 * items are now one. Merging is a button somebody presses.
 */
export function normaliseFinishCode(code: string): string {
  return code.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * How a linked finish reads in a BWS cell.
 *
 * Follows FMT-COM-01 from docs/bws-spec-grid.md: the client's own code first,
 * because that is how the fabric is tracked on their schedule, then the
 * supplier's reference, because that is what gets ordered. Dropping either
 * makes the line unorderable or untraceable.
 *
 * The quantity FMT-COM-01 also asks for is not here: nothing in this app knows
 * a fabric's metreage, and inventing a number for a cell somebody orders
 * against would be worse than leaving the gap visible.
 */
export function composeFinishCell(finish: Finish): string {
  const parts = [finish.description, finish.supplierRaw, finish.reference, finish.colour]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const body = parts.join(" ");
  // ========================================================================
  // AN INTERNAL CODE NEVER LEAVES THIS APP.
  //
  // `BW-F-001` is ours, minted because the client gave no code. Emitted here
  // it would arrive in the BWS file, the quote and the costing sheet FIRST in
  // the cell, in the position the client's own schedule reference occupies —
  // a code somebody would go looking for on a document that has never carried
  // it. The description alone is exactly what the page said, which is what
  // those three files were showing before the library could hold this fabric
  // at all.
  //
  // It returns EMPTY, not the code, where there is no body: the callers each
  // fall back to the attribute's own words, and a bare `BW-F-001` in a BWS
  // cell is the one thing this branch exists to prevent. A confirmed finish
  // cannot be in that state (`project_finishes_confirmed_has_description`),
  // so it is reachable only by clearing a TBC one's description on the
  // library screen.
  // ========================================================================
  if (finish.codeOrigin === "internal") return body;
  if (!body) return finish.code;
  return `${finish.code}; ${body}`;
}

/**
 * The state a value takes when it comes through a finish: the weaker of the
 * two. Only a confirmed attribute carrying a confirmed finish is confirmed.
 */
export function combineFinishState(attributeState: AttributeState, finish: Finish | null): AttributeState {
  if (!finish) return attributeState;
  return attributeState === "confirmed" && finish.state === "confirmed" ? "confirmed" : "tbc";
}

/**
 * What a drawing's raw code resolves to against the library.
 *
 * `conflict` is the case that must never be resolved automatically: the code
 * exists and says something different from what this page says. Either the
 * library is out of date or this page is, and the reviewer is the only one who
 * can tell. Offered as a choice, never picked.
 */
export type FinishResolution =
  | { status: "none" }
  | { status: "new"; code: string; codeNorm: string }
  | { status: "matched"; finish: Finish }
  | { status: "conflict"; finish: Finish; saysInstead: string };

/**
 * Client finish codes the drawings carry that the library does not hold.
 *
 * NAMED RATHER THAN COUNTED, which is why it returns rows: an unlinked code is
 * a finish nobody can correct once, and "three codes are not in the library" is
 * a number somebody dismisses where `MOR005, WD-05, CH-01.1` is a job.
 *
 * ONE QUERY, TWO SCREENS. It was inline in the finishes route, and the project
 * overview needs the same list — a second copy is how the overview comes to say
 * two where the library shows three, which is the disagreement the check sheet
 * exists to prevent, between two screens instead of two files. Both the record
 * and its run must be ACTIVE, the same scope everything else on a project reads.
 */
export async function loadUnlinkedFinishCodes(
  exec: FinishSql,
  projectId: string,
): Promise<{ code: string; records: number }[]> {
  const rows = await exec`
    select upper(btrim(a.material_code)) as code, count(distinct a.record_id)::int as records
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where r.project_id = ${projectId}
      and a.status = 'active'
      and r.status = 'active'
      and a.material_code is not null
      and btrim(a.material_code) <> ''
      and a.finish_id is null
    group by upper(btrim(a.material_code))
    order by 1
  `;
  return rows.map((row) => ({ code: String(row.code), records: Number(row.records) }));
}

export function resolveFinishCode(
  materialCodeRaw: string | null,
  observedValue: string | null,
  library: Finish[],
): FinishResolution {
  const raw = materialCodeRaw?.trim();
  if (!raw) return { status: "none" };
  const codeNorm = normaliseFinishCode(raw);
  if (!codeNorm) return { status: "none" };

  const finish = library.find((entry) => entry.codeNorm === codeNorm);
  if (!finish) return { status: "new", code: raw, codeNorm };

  // A conflict only when the library has actually committed to a description.
  // A `tbc` finish with no description is waiting to be told, not disagreeing.
  const described = finish.description?.trim();
  const says = observedValue?.trim();
  if (described && says && described.toLowerCase() !== says.toLowerCase()) {
    return { status: "conflict", finish, saysInstead: says };
  }
  return { status: "matched", finish };
}

// ===========================================================================
// FILING A FINISH THE CLIENT GAVE NO CODE FOR
//
// The S-203 sheet states `Fabric reference: Aissa Dione, ref. Losange raphia
// beige et écru` and prints no code, so `resolveFinishCode` answers `none`,
// nothing is filed, and the fabric sits on the record while the project's
// library is empty. Max's decision, 2026-09-22: the reviewer files it, the app
// mints `BW-F-001` where there is no client code, and the same fabric on a
// later item uses the same row.
//
// ---- WHY MATCHING ON THE DESCRIPTION IS ALLOWED *HERE*, AND ONLY HERE ----
//
// This repo refuses description matching everywhere else, and `found-in-use.md`
// names it as the trap in this very entry: the same fabric written two ways on
// two pages becomes two rows, and a normaliser clever enough to merge them is
// clever enough to merge two things somebody kept apart. It is here BY MAX'S
// DECISION ("use this again if it matches in another line item where the same
// fabric appears"), not by drift, and the line is drawn where that reasoning
// stops applying:
//
//   * EXACT, folding case and whitespace and NOTHING else — `normaliseFinishCode`'s
//     own rule, for `normaliseFinishCode`'s own reason. Two strings that fold
//     to one are the same sentence typed twice, not two things.
//   * INTERNAL FINISHES ONLY. Where the client issued a code, the code is the
//     key and stays the key; a description must never be able to reach a
//     client-coded row, or the register's addressing has two answers.
//   * Anything less is OFFERED and files nothing. The near-miss reading below
//     exists to put a candidate in front of a person, never to act.
// ===========================================================================

/** Case and whitespace, and nothing else. The EXACT step, as for a code. */
export function foldFinishDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The same fold with accents and punctuation dropped as well — for SUGGESTING
 * a candidate, and for nothing else.
 *
 * `…beige et écru` and `…beige et ecru` are one character apart and are almost
 * certainly one fabric; they are still two different strings and this app does
 * not get to decide that. A loose fold that matches where the exact one does
 * not is the whole definition of "nearly the same wording" here — a reading a
 * person can check in a second, rather than a distance threshold nobody can
 * argue with.
 */
export function looseFoldFinishDescription(text: string): string {
  return foldFinishDescription(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What the reviewer said to do with an uncoded finish, recorded on the staged
 * row by a press and read back here.
 *
 * OPTIONAL on the observation and absent on every run staged before this
 * existed — absent means "nobody has been asked yet", which is what the card
 * shows the controls for.
 */
export type FinishFiling =
  | { mode: "internal" }
  /** A near miss a person accepted. Carries the CODE, so it survives a reload. */
  | { mode: "link"; codeNorm: string }
  /**
   * The way out of an automatic link. An exact wording match links on its own,
   * which is Max's approval 3 — and a reviewer who knows the two are different
   * fabrics has to be able to say so, or the one automatic step in this item
   * would be the one nobody can undo.
   */
  | { mode: "apart" };

export type UncodedFinishReading = {
  /** What a confirm would do: nothing, link to `finish`, or mint a new code. */
  outcome: "none" | "link" | "mint";
  finish: Finish | null;
  /** Why, in the reviewer's terms. Null where there is nothing to say. */
  why: string | null;
  /**
   * A candidate the app found and did NOT take. Rendered as a suggestion with
   * its evidence; pressing it is what files anything.
   */
  suggestion: { finish: Finish; why: string } | null;
};

const NOTHING: UncodedFinishReading = { outcome: "none", finish: null, why: null, suggestion: null };

/**
 * How a finish carrying no client code files, given the library and whatever
 * the reviewer has said.
 *
 * PURE, and called by both the review screen and the confirm route — the
 * `proposalBlockers()` rule. A screen offering a chip the confirm disagrees
 * with is how a card comes to promise something the file does not deliver.
 */
export function readUncodedFinish(
  value: string | null,
  library: readonly Finish[],
  filing: FinishFiling | null | undefined,
): UncodedFinishReading {
  const words = value?.trim();
  if (!words) return NOTHING;

  // 0. KEPT APART, deliberately: the reviewer says this is not the library's
  //    fabric however alike the two read. Ahead of the exact match, because it
  //    is the only thing that can overrule it.
  if (filing?.mode === "apart") {
    return { outcome: "none", finish: null, why: "Kept apart from the library, by you", suggestion: null };
  }

  const internal = library.filter((entry) => entry.codeOrigin === "internal");

  // 1. EXACT WORDING, on an internal row: links on its own. Ahead of every
  //    other branch deliberately — pressing "file it internally" on the second
  //    item must join the first's row rather than mint a second code for one
  //    fabric, which is the whole of what Max asked for.
  const folded = foldFinishDescription(words);
  const exact = internal.find((entry) => entry.description && foldFinishDescription(entry.description) === folded);
  if (exact) {
    return { outcome: "link", finish: exact, why: `Same wording as ${exact.code}`, suggestion: null };
  }

  // 2. A near miss the reviewer already accepted, by code so it survives a
  //    reload. Re-checked against the live library rather than trusted: a
  //    finish retired since the press files nothing.
  if (filing?.mode === "link") {
    const chosen = internal.find((entry) => entry.codeNorm === filing.codeNorm);
    if (chosen) {
      return { outcome: "link", finish: chosen, why: `Filed under ${chosen.code} by you`, suggestion: null };
    }
    return NOTHING;
  }

  // 3. The reviewer said there is no client code. A code is minted at confirm,
  //    which is also the only moment it can be: two reviewers pressing at once
  //    are serialised by the project row lock, and a number shown before that
  //    would be a number somebody else may take.
  if (filing?.mode === "internal") {
    return { outcome: "mint", finish: null, why: "The client gave no code", suggestion: null };
  }

  // 4. Nothing decided. Offer a candidate if one is close, and file nothing.
  const loose = looseFoldFinishDescription(words);
  const near =
    loose.length > 0
      ? internal.find(
          (entry) => entry.description && looseFoldFinishDescription(entry.description) === loose,
        )
      : undefined;
  if (near) {
    return {
      outcome: "none",
      finish: null,
      why: null,
      suggestion: { finish: near, why: `Nearly the same wording as ${near.code} — accents or punctuation apart` },
    };
  }
  return NOTHING;
}

/**
 * The attribute groups that are a FINISH for filing purposes.
 *
 * `classifyCallout` files a fabric as `material` and a timber or metal as
 * `finish` (this app's word for the hard finishes), so both are rows the
 * library is addressed by. A dimension, a note, a hardware row and an `other`
 * are not, and are never offered a code.
 */
export const FINISH_GROUPS = ["material", "finish"] as const;

export function isFinishGroup(attrGroup: string): boolean {
  return (FINISH_GROUPS as readonly string[]).includes(attrGroup);
}
