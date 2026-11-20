// What a screen says about the finish codes the library does not link
// (prod-ready F4, 2026-11-20). A LEAF, so the project overview and the
// Finishes tab can read it; the loader is `finish-unlinked.ts`.

/**
 * absent      the library has no row for the code — add it, then attach.
 * differs     the library holds it and these specs' words are not the
 *             library's — a person decides which stands.
 * unattached  the library holds it and the words agree — attach them.
 */
export type UnlinkedFinishReason = "absent" | "differs" | "unattached";

export type UnlinkedFinishCode = {
  /** The code as the specs carry it, upper-cased and trimmed. */
  code: string;
  /** How many active items carry it unlinked. */
  records: number;
  /** One of them, so a screen can open the item where the spec is attached. */
  firstRecordId: string;
  reason: UnlinkedFinishReason;
  /** The library row it is, where the library holds it. */
  held: { finishId: string; code: string; description: string | null } | null;
};

/**
 * The Finishes tile's line: "2 codes not in the library", and only of the
 * codes that are not — "1 differs from the library" and "1 to attach" for the
 * ones that are. It said "not in the library" of all three.
 */
export function unlinkedFinishWords(rows: readonly Pick<UnlinkedFinishCode, "reason">[]): string {
  const count = (reason: UnlinkedFinishReason) => rows.filter((row) => row.reason === reason).length;
  const absent = count("absent");
  const differs = count("differs");
  const unattached = count("unattached");
  return [
    absent > 0 ? `${absent} code${absent === 1 ? "" : "s"} not in the library` : null,
    differs > 0 ? `${differs} ${differs === 1 ? "differs" : "differ"} from the library` : null,
    unattached > 0 ? `${unattached} to attach` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
