// Staging a parsed bill: the registers the reader needs, and the per-line
// suggestions a reviewer is shown.
//
// Server-side, and the ONE place both halves live, because two routes now stage
// a bill — registration (`/api/imports`) and a re-read from the stored source
// (`/api/imports/[id]/columns`) — and a line read by the second must carry the
// same category, level and not-furniture question as one read by the first. Two
// copies of `suggest` is how a bill read with a person's columns would come to
// be suggested differently from the same bill read by the synonyms.
//
// Nothing here writes, and nothing here calls a model. The suggestions are
// computed once and STORED on the staged line, for the reason the route always
// gave: the confirm writes what is stored, and what gets written is what the
// reviewer approved, never what a fresh match would produce later.
import type { TxnSql } from "@/lib/db-transaction";
import { matchName, type MatchCandidate } from "@/lib/matching";
import { guessLevelFromBill } from "@/lib/level-guess";
import { guessNonFurniture } from "@/lib/non-furniture-guess";
import type {
  BoqAlias,
  BoqLayout,
  BoqLine,
  BoqReadingRegisters,
  ParsedBoqSheet,
  StagedBoqLine,
  StagedBoqSheet,
} from "@/lib/boq-import";
import { isBoqReadRole, isBoqRole, type BoqReadRole } from "@/lib/boq-roles";

/**
 * The headings the reader knows and the layouts people have saved, from the
 * database.
 *
 * AN EMPTY ALIAS TABLE IS REFUSED, NOT READ. It means the seed never ran on
 * this database, and reading with no vocabulary would stage every bill as
 * "needs columns" — a sentence about the bill that is really a sentence about
 * a deployment. The run then fails with this reason, and "Read it again" on
 * its review recovers it once the seed is in.
 */
export async function loadBoqReadingRegisters(exec: TxnSql): Promise<BoqReadingRegisters> {
  const aliasRows = await exec`select role, term from boq_column_aliases order by created_at, term_norm`;
  const aliases: BoqAlias[] = aliasRows
    .filter((row) => isBoqRole(row.role))
    .map((row) => ({ role: row.role as BoqAlias["role"], term: String(row.term) }));
  if (aliases.length === 0) {
    throw new Error(
      "This deployment has no bill column vocabulary (boq_column_aliases is empty), so no bill can be read. " +
        "Run the database seed, then read the bill again.",
    );
  }

  // Newest first, so of two equally specific layouts the one saved later —
  // the one somebody set most recently for this specifier — is tried first.
  const layoutRows = await exec`
    select id, name, header_rows, mapping
    from boq_layouts
    where retired_at is null
    order by created_at desc, name
  `;
  const layouts: BoqLayout[] = layoutRows.flatMap((row) => {
    const mapping: Partial<Record<BoqReadRole, string>> = {};
    for (const [role, heading] of Object.entries((row.mapping ?? {}) as Record<string, unknown>)) {
      if (isBoqReadRole(role) && typeof heading === "string" && heading.trim() !== "") mapping[role] = heading;
    }
    // A row that decodes to nothing would apply to every sheet; 0040's CHECK
    // refuses an empty object, and this refuses one that is empty after the
    // unknown roles are dropped.
    if (Object.keys(mapping).length === 0) return [];
    return [
      {
        id: String(row.id),
        name: String(row.name),
        headerRows: Number(row.header_rows) === 2 ? (2 as const) : (1 as const),
        mapping,
      },
    ];
  });
  return { aliases, layouts };
}

/** A line as the parser read it, plus its index on the sheet. */
type SuggestInput = BoqLine;

/**
 * The per-line suggester: category, level and "is this furniture at all",
 * with the registers it reads loaded once.
 *
 * Moved here unchanged from `/api/imports`, which is where the reasons below
 * were first written.
 */
export async function loadLineSuggester(exec: TxnSql): Promise<(line: SuggestInput, index: number) => StagedBoqLine> {
  // Candidates are the category names plus the BOQ vocabulary in
  // item_category_aliases: a BOQ says "Sofa" and the sheet is called
  // "Armchairs, Benches, Stools, Sofas", which share no word.
  const categories = await exec`select id, name from item_categories`;
  const aliases = await exec`select category_id, term from item_category_aliases`;
  const candidates: MatchCandidate[] = [
    ...categories.map((c) => ({ id: String(c.id), name: String(c.name) })),
    ...aliases.map((a) => ({ id: String(a.category_id), name: String(a.term) })),
  ];

  // The LEVEL, guessed the same way and for the same reason: stored at parse
  // time so the confirm writes what the reviewer saw. Unlike the category it
  // is never written straight into the column the gate reads — a guessed
  // level lands in `level_suggested` unless the reviewer picks one. See
  // src/lib/level-guess.ts for what it reads, and what it refuses to.
  const levelOf = (line: SuggestInput, categoryStatus: string) => {
    const guess = guessLevelFromBill({ ...line, categoryStatus });
    return guess
      ? { level: guess.level, levelStatus: "suggested" as const, levelReason: guess.reason }
      : { level: null, levelStatus: "suggested" as const, levelReason: null };
  };

  // IS THIS A PIECE OF FURNITURE AT ALL? Asked at staging and STORED, like
  // the category and the level, so the reviewer reads one answer rather than
  // one per render. It is a question and nothing else: only the reviewer's
  // click writes `ignored`, which is the only field the confirm reads.
  //
  // The CATEGORY is worked out first, because "nothing matched a category
  // either" is supporting evidence the suggester is allowed to append — and
  // never to fire on. And the level is worked out LAST, because a line this
  // suggests is not furniture gets no level at all.
  return (line, index) => {
    const match = matchName(line.itemDescription, candidates);
    const decided = (
      categoryId: string | null,
      categoryStatus: string,
      extra: Partial<StagedBoqLine> = {},
    ): StagedBoqLine => ({
      index,
      ...line,
      ...levelOf(line, categoryStatus),
      nonFurnitureSuggested: guessNonFurniture({ ...line, categoryStatus }),
      categoryId,
      categoryStatus,
      ignored: false,
      ...extra,
    });

    if (match.status === "confident") return decided(match.id, "suggested");
    if (match.status === "ambiguous") {
      // Several terms pointing at ONE category is agreement, not ambiguity.
      const ids = [...new Set(match.candidates.map((candidate) => candidate.id))];
      if (ids.length === 1) return decided(ids[0] ?? null, "suggested");
      return decided(null, "ambiguous", {
        categoryCandidates: ids.map((id) => ({
          id,
          name: String(categories.find((c) => String(c.id) === id)?.name ?? id),
        })),
      });
    }
    return decided(null, "none");
  };
}

/** A parsed sheet, staged: the same sheet with every line suggested. The line index is per sheet. */
export function stageSheet(
  sheet: ParsedBoqSheet,
  suggest: (line: SuggestInput, index: number) => StagedBoqLine,
): StagedBoqSheet {
  return { ...sheet, lines: sheet.lines.map(suggest) };
}
