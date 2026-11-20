// The client finish codes a project's specs carry and the library does not
// link — and WHY each is unlinked (prod-ready F4, 2026-11-20).
//
// ============================================================================
// "NOT IN THE LIBRARY" ABOUT A CODE THAT IS IN THE LIBRARY.
//
// A drawing or bill spec whose code the library holds, but whose words differ,
// is left unlinked BY DESIGN ("A CONFLICT links nothing",
// specs-and-finishes.md). This list did not tell that case apart, so the
// project overview's "Unresolved finish codes", its Finishes tile ("2 codes not
// in the library") and the Finishes tab's banner ("… is not in the library yet
// … Next: add it with Add a finish") all called WD-01 absent and sent a person
// to create a duplicate of a row the library already had.
//
// So each code says which of three it is, decided by the functions every
// confirm links with (`findFinishByCode`, `resolveFinishCode`), against the
// one library loader:
//   absent      the library has no row for it — add it, then attach.
//   differs     the library holds it and these specs' words are not the
//               library's — a person decides which stands: attach the item to
//               the library's finish, or edit the library row.
//   unattached  the library holds it and the words agree — attach them.
//
// NAMED RATHER THAN COUNTED, and ONE LOADER FOR BOTH SCREENS, as before: the
// overview and the library page call this and nothing else.
//
// Its own module because it needs the library loader, which imports
// `finishes.ts`: a loader there would make the two a cycle.
// ============================================================================
import type { SqlLike } from "@/lib/record-atoms";
import { findFinishByCode, resolveFinishCode } from "@/lib/finishes";
import { loadFinishLibrary } from "@/lib/bill-fabric-load";
import type { UnlinkedFinishCode } from "@/lib/finish-unlinked-words";

export type { UnlinkedFinishCode, UnlinkedFinishReason } from "@/lib/finish-unlinked-words";

/** Pure: the rows grouped by code and each given its reason, against a library. */
export function classifyUnlinkedFinishCodes(
  rows: readonly { code: string; materialCode: string; value: string | null; recordId: string }[],
  library: Parameters<typeof findFinishByCode>[1],
): UnlinkedFinishCode[] {
  const byCode = new Map<string, { records: Set<string>; differs: boolean }>();
  for (const row of rows) {
    const entry = byCode.get(row.code) ?? { records: new Set<string>(), differs: false };
    entry.records.add(row.recordId);
    if (resolveFinishCode(row.materialCode, row.value, [...library]).status === "conflict") entry.differs = true;
    byCode.set(row.code, entry);
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) => {
      const found = findFinishByCode(code, library)?.finish ?? null;
      return {
        code,
        records: entry.records.size,
        firstRecordId: [...entry.records].sort()[0] ?? "",
        reason: !found ? "absent" : entry.differs ? "differs" : "unattached",
        held: found ? { finishId: found.id, code: found.code, description: found.description } : null,
      };
    });
}

/**
 * Every code on an active item that no library row is linked to, with its
 * reason — the scope the list always had (retiring a phase retires its items).
 */
export async function loadUnlinkedFinishCodes(exec: SqlLike, projectId: string): Promise<UnlinkedFinishCode[]> {
  const rows = await exec`
    select upper(btrim(a.material_code)) as code, a.material_code, a.value, a.record_id
    from record_attributes a
    join spec_records r on r.id = a.record_id
    where r.project_id = ${projectId}
      and a.status = 'active'
      and r.status = 'active'
      and a.material_code is not null
      and btrim(a.material_code) <> ''
      and a.finish_id is null
  `;
  if (rows.length === 0) return [];
  const library = await loadFinishLibrary(exec, projectId);
  return classifyUnlinkedFinishCodes(
    rows.map((row) => ({
      code: String(row.code),
      materialCode: String(row.material_code),
      value: row.value === null || row.value === undefined ? null : String(row.value),
      recordId: String(row.record_id),
    })),
    library,
  );
}

/** The codes the library has no row for — the only ones "Add a finish" is the answer to. */
export const absentCodes = (rows: readonly UnlinkedFinishCode[]) => rows.filter((row) => row.reason === "absent");
/** The codes the library holds whose specs are not attached to it. */
export const heldCodes = (rows: readonly UnlinkedFinishCode[]) => rows.filter((row) => row.reason !== "absent");
