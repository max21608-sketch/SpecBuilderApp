// A person's press that writes `spec_records.matrix_type` (0061, decision B).
//
// ============================================================================
// THE SUGGESTION IS NEVER STORED, SO THE SERVER RE-DERIVES IT.
//
// `suggestMatrixType` reads an item's name and the seed. The screen shows the
// suggestion with its reason and "Accept"; the request carries each record's
// id, the version the screen drew it at, and the type it showed. Under the
// lock this re-reads every record, refuses the WHOLE press if any of them
// moved, and in `accept` mode refuses it too if the suggestion it re-derives
// is not the one the screen showed (a renamed item, a re-seeded word list).
// Nothing is accepted unseen — "A level is guessed at intake, and a guess is
// not a level", for a type.
//
// `set` mode is a person choosing a type themselves ("Change…"), or clearing
// it back to the sheet's union. The type must be one the record's sheet maps.
//
// One `category_set` change set and one version per record written, as every
// bulk decision here is (`acceptSuggestedLevels`). A type is part of the
// category decision: it says which of the sheet's questions the item is asked.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { changeSetForEdit } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { suggestMatrixType, type SuggestableType } from "@/lib/matrix-type";

export type MatrixTypeWrite = { id: string; version: number; matrixType: string | null };

export async function setMatrixTypes(
  txn: TxnSql,
  {
    projectId,
    records,
    mode,
    actor,
  }: { projectId: string; records: MatrixTypeWrite[]; mode: "accept" | "set"; actor: string },
): Promise<{ set: number }> {
  const wanted = new Map(records.map((record) => [record.id, record]));
  const ids = [...wanted.keys()];
  if (ids.length === 0) return { set: 0 };

  // Locked in id order, so two presses over overlapping sets cannot deadlock.
  // The screens' scope: live items on a live phase, never a split line's
  // heading (its configurations are the items).
  const found = await txn`
    select r.id, r.version, r.category_id, r.item_description, r.matrix_type, r.record_no
      from spec_records r
      join spec_runs run on run.id = r.run_id
     where r.id = any(${ids}::uuid[])
       and r.project_id = ${projectId}
       and r.status = 'active'
       and run.status = 'active'
       and not exists (select 1 from spec_records v where v.parent_id = r.id and v.status = 'active')
     order by r.id
     for update of r
  `;
  if (found.length !== ids.length) {
    throw new DomainConflictError(
      "matrix_type_scope",
      ids.length - found.length === 1
        ? "One of these items is no longer a live item on this project. Reload, then try again. Nothing was changed."
        : `${ids.length - found.length} of these items are no longer live items on this project. Reload, then try again. Nothing was changed.`,
      { status: 409 },
    );
  }
  const moved = found.filter((row) => Number(row.version) !== wanted.get(String(row.id))!.version);
  if (moved.length > 0) {
    throw new DomainConflictError(
      "matrix_type_stale",
      moved.length === 1
        ? "One of these items changed since this screen loaded. Reload and look again. Nothing was changed."
        : `${moved.length} of these items changed since this screen loaded. Reload and look again. Nothing was changed.`,
    );
  }

  const categoryIds = [...new Set(found.map((row) => (row.category_id ? String(row.category_id) : "")).filter(Boolean))];
  const typeRows =
    categoryIds.length === 0
      ? []
      : await txn`
          select m.item_category_id, t.code, t.name, t.suggest_words, m.suggest_default
            from spec_matrix_category_map m join spec_matrix_categories t on t.code = m.matrix_code
           where m.item_category_id = any(${categoryIds}::uuid[])
           order by t.sort_order, t.code
        `;
  const typesBySheet = new Map<string, SuggestableType[]>();
  for (const row of typeRows) {
    const key = String(row.item_category_id);
    const list = typesBySheet.get(key) ?? [];
    list.push({
      code: String(row.code),
      name: String(row.name),
      suggestWords: ((row.suggest_words ?? []) as unknown[]).map(String),
      suggestDefault: row.suggest_default === true,
    });
    typesBySheet.set(key, list);
  }

  const changes: { id: string; matrixType: string | null }[] = [];
  for (const row of found) {
    const id = String(row.id);
    const asked = wanted.get(id)!.matrixType;
    const types = row.category_id ? (typesBySheet.get(String(row.category_id)) ?? []) : [];
    const label = `Item ${Number(row.record_no)}`;
    if (types.length < 2) {
      throw new DomainConflictError(
        "matrix_type_not_offered",
        `${label}'s category covers one type, so there is no type to choose. Nothing was changed.`,
        { status: 400 },
      );
    }
    if (mode === "accept") {
      const current = row.matrix_type ? String(row.matrix_type) : null;
      const suggestion = current && types.some((type) => type.code === current)
        ? null
        : suggestMatrixType(String(row.item_description ?? ""), types);
      if (!suggestion || suggestion.code !== asked) {
        throw new DomainConflictError(
          "matrix_type_suggestion_moved",
          `The suggested type for ${label} is not the one this screen showed. Reload and look again. Nothing was changed.`,
        );
      }
    } else if (asked !== null && !types.some((type) => type.code === asked)) {
      throw new DomainConflictError(
        "matrix_type_unknown",
        `“${asked}” is not one of the types ${label}'s category covers. Nothing was changed.`,
        { status: 400 },
      );
    }
    if ((row.matrix_type ?? null) !== asked) changes.push({ id, matrixType: asked });
  }
  if (changes.length === 0) return { set: 0 };

  const { changeSetId } = await changeSetForEdit(txn, { projectId, actor, kind: "category_set" });
  for (const change of changes) {
    await txn`
      update spec_records set matrix_type = ${change.matrixType}, updated_by = ${actor}
       where id = ${change.id}
    `;
  }
  await snapshotRecords(
    txn,
    changes.map((change) => change.id),
    changeSetId,
  );
  return { set: changes.length };
}
