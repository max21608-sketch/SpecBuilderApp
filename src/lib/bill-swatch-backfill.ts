// Filing the fabric lines of bills confirmed BEFORE the bill filled the
// finishes library (2026-10-05), as a fresh confirm would have filed them.
//
// ============================================================================
// WHAT A CONFIRM NOW DOES THAT AN OLDER ONE DID NOT (`confirm-boq.ts`):
//
//   (a) a fabric line's picture becomes its code's SWATCH, where every line of
//       the code carries the same picture and the code has none yet;
//   (b) an UNCODED fabric line with real words is filed as an IN-HOUSE fabric
//       — linked to one worded exactly the same, or given a minted code.
//
// This pass does both for bills already confirmed, using the SAME pure rules
// the confirm uses (`decideFabricFiling`, `planFinishSwatches`), so what it
// writes is what a fresh confirm of that bill would have written. A coded
// fabric whose attribute links nothing (a CONFLICT at its confirm) is left
// alone: that is a person's question, and `db:backfill-finishes` is where
// coded links are made.
//
// ---- HOW AN ATTRIBUTE IS FOUND FROM ITS LINE ------------------------------------
//
// A fabric attribute carries no row number: it is sourced to the bill's run
// with no page. So it is found by its WORDS (`fabricLineValue`, exactly what
// the confirm wrote) among the run's active fabric attributes, narrowed by the
// item's sheet and row where more than one carries those words. Where that
// still leaves more than one, nothing is guessed: the line is REPORTED and
// left. Each attribute answers for one line.
//
// ---- WHAT IT NEVER DOES ------------------------------------------------------------
//
//   * Replace a swatch. A finish with a current swatch keeps it.
//   * Re-link an attribute somebody linked. Only `finish_id is null` moves,
//     re-checked in the write itself, so a second run writes nothing.
//   * Write an answer directly. The checklist is recomposed through
//     `recomposeAnswers`, the one path every other writer uses, and every
//     record whose attribute moved gets a version.
//
// One change set per project (`finish_link` — the kind `db:backfill-finishes`
// uses for the same act; no kind is added), opened only where there is
// something to write.
// ============================================================================
import type { TxnSql } from "@/lib/db-transaction";
import type { SqlLike } from "@/lib/record-atoms";
import { assertBoqDocument } from "@/lib/boq-import";
import { billItemName } from "@/lib/bill-description";
import { rowImageFor, type BillRowImage } from "@/lib/bill-row-image";
import {
  decideFabricFiling,
  fabricLineValue,
  fabricMaterialCode,
  planFinishSwatches,
  swatchDifferNotice,
  type SwatchCandidate,
} from "@/lib/bill-fabric-filing";
import { loadCurrentSwatches, loadFinishCodePrefix, loadFinishLibrary } from "@/lib/bill-fabric-load";
import { internalFinishSeries, normaliseFinishCode, type Finish } from "@/lib/finishes";
import { createFinish, mintInternalFinishCode } from "@/lib/finish-edit";
import { openChangeSet } from "@/lib/change-sets";
import { recomposeAnswers } from "@/lib/attribute-retire";
import { snapshotRecords } from "@/lib/record-snapshot";
import { giveBillSwatch } from "@/lib/confirm-boq";

type Where = { runId: string; sheetName: string; rowNo: number };

export type BillSwatchBackfillAction =
  /** Link an uncoded fabric to an in-house finish worded exactly the same. */
  | (Where & { kind: "link"; attributeId: string; recordId: string; finishId: string; code: string })
  /**
   * Mint an in-house code and link to it. Lines sharing a `mintKey` share ONE
   * code — the same words twice, as at confirm.
   */
  | (Where & { kind: "mint"; attributeId: string; recordId: string; mintKey: string; says: string; firstRow: number })
  /** Give a finish its fabric line's picture as its swatch. `finishKey` is a finish id or a `mintKey`. */
  | (Where & { kind: "swatch"; finishKey: string; code: string; image: BillRowImage & { pathname: string } });

export type BillSwatchBackfillProject = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  /** The short code the mint will use, for the printout. */
  series: string;
  actions: BillSwatchBackfillAction[];
  /** Lines left for a person — an attribute that could not be told apart, a code with differing pictures. */
  notes: string[];
};

type FabricAttribute = {
  id: string;
  recordId: string;
  value: string;
  finishId: string | null;
  materialCode: string | null;
  sourceSheet: string | null;
  sourceLineNo: number | null;
};

/** What the pass would do, read only. The dry run prints this; `--apply` writes exactly this. */
export async function planBillSwatchBackfill(
  exec: SqlLike,
  projectId: string | null,
): Promise<BillSwatchBackfillProject[]> {
  const runs = await exec`
    select r.id, r.project_id, r.parsed, p.bws_project_number, p.name
      from intake_runs r
      join projects p on p.id = r.project_id
     where r.source_kind = 'boq_xlsx' and r.status = 'confirmed'
       and (${projectId}::uuid is null or r.project_id = ${projectId}::uuid)
     order by p.bws_project_number, r.confirmed_at, r.created_at
  `;
  const out = new Map<string, BillSwatchBackfillProject & { library: Finish[]; held: Set<string>; pending: Set<string> }>();

  for (const run of runs) {
    const runId = String(run.id);
    const pid = String(run.project_id);
    let parsed: ReturnType<typeof assertBoqDocument>;
    try {
      parsed = assertBoqDocument(run.parsed);
    } catch {
      continue;
    }
    const hasFabric = parsed.sheets.some((sheet) => sheet.lines.some((line) => line.rowKind === "finish_for"));
    if (!hasFabric) continue;

    let project = out.get(pid);
    if (!project) {
      const library = await loadFinishLibrary(exec, pid);
      const prefix = await loadFinishCodePrefix(exec, pid);
      project = {
        projectId: pid,
        projectNumber: String(run.bws_project_number),
        projectName: String(run.name),
        series: internalFinishSeries(prefix),
        actions: [],
        notes: [],
        library,
        held: await loadCurrentSwatches(exec, library.map((finish) => finish.id)),
        pending: new Set(),
      };
      out.set(pid, project);
    }

    const attributeRows = await exec`
      select a.id, a.record_id, a.value, a.finish_id, a.material_code, sr.source_sheet, r.source_line_no
        from record_attributes a
        join spec_records r on r.id = a.record_id
        join spec_runs sr on sr.id = r.run_id
       where a.source_run_id = ${runId} and a.status = 'active' and r.status = 'active'
         and a.attr_group = 'material' and a.label = 'Fabric'
       order by r.record_no, a.sort_order
    `;
    const attributes: FabricAttribute[] = attributeRows.map((row) => ({
      id: String(row.id),
      recordId: String(row.record_id),
      value: String(row.value ?? ""),
      finishId: row.finish_id ? String(row.finish_id) : null,
      materialCode: row.material_code ? String(row.material_code) : null,
      sourceSheet: row.source_sheet ? String(row.source_sheet) : null,
      sourceLineNo: row.source_line_no === null || row.source_line_no === undefined ? null : Number(row.source_line_no),
    }));
    const used = new Set<string>();
    const groups = new Map<string, SwatchCandidate[]>();
    const codeOfKey = new Map<string, string>();

    for (const sheet of parsed.sheets) {
      if (sheet.ignored) continue;
      for (const line of sheet.lines) {
        if (line.ignored || line.rowKind !== "finish_for") continue;
        const says = fabricLineValue(line);
        const byWords = attributes.filter((attribute) => !used.has(attribute.id) && attribute.value === says);
        const narrowed = byWords.filter(
          (attribute) => attribute.sourceSheet === sheet.sheetName && attribute.sourceLineNo === line.finishFor?.row,
        );
        const found = narrowed.length === 1 ? narrowed[0] : byWords.length === 1 ? byWords[0] : undefined;
        if (!found) {
          if (byWords.length > 1) {
            project.notes.push(
              `Row ${line.lineNo} (${sheet.sheetName}): ${byWords.length} fabric specs carry its words and none can be told apart — left for a person.`,
            );
          }
          continue;
        }
        used.add(found.id);
        const where: Where = { runId, sheetName: sheet.sheetName, rowNo: line.lineNo };

        let finishKey: string | null = found.finishId;
        if (!finishKey && !fabricMaterialCode(line)) {
          const parent = sheet.lines.find((entry) => entry.lineNo === line.finishFor?.row);
          const filing = decideFabricFiling({
            materialCode: null,
            says,
            words: line.itemDescription,
            parentName: parent ? billItemName(parent) : null,
            library: project.library,
          });
          if (filing.outcome === "same_words") {
            finishKey = filing.finish.id;
            if (project.pending.has(finishKey)) {
              const first = project.actions.find(
                (action) => action.kind === "mint" && action.mintKey === finishKey,
              ) as Extract<BillSwatchBackfillAction, { kind: "mint" }> | undefined;
              project.actions.push({
                ...where,
                kind: "mint",
                attributeId: found.id,
                recordId: found.recordId,
                mintKey: finishKey,
                says,
                firstRow: first?.firstRow ?? line.lineNo,
              });
            } else {
              project.actions.push({
                ...where,
                kind: "link",
                attributeId: found.id,
                recordId: found.recordId,
                finishId: finishKey,
                code: filing.finish.code,
              });
            }
          } else if (filing.outcome === "mint") {
            finishKey = `mint:${runId}:${sheet.sheetName}:${line.lineNo}`;
            project.pending.add(finishKey);
            project.library.push({
              id: finishKey,
              code: `${project.series}…`,
              codeNorm: normaliseFinishCode(finishKey),
              codeOrigin: "internal",
              kind: null,
              description: says,
              supplierRaw: null,
              reference: null,
              colour: null,
              state: "tbc",
            });
            project.actions.push({
              ...where,
              kind: "mint",
              attributeId: found.id,
              recordId: found.recordId,
              mintKey: finishKey,
              says,
              firstRow: line.lineNo,
            });
          }
        }
        if (!finishKey) continue;
        codeOfKey.set(finishKey, project.library.find((finish) => finish.id === finishKey)?.code ?? "A fabric");
        groups.set(finishKey, [
          ...(groups.get(finishKey) ?? []),
          { sheetName: sheet.sheetName, rowNo: line.lineNo, image: rowImageFor(parsed.rowImages, sheet.sheetName, line.lineNo) },
        ]);
      }
    }

    // One bill, one swatch decision per code — as one confirm made it. A
    // swatch an earlier bill gave counts as held for a later one.
    for (const [finishKey, decision] of planFinishSwatches(groups, project.held)) {
      const code = codeOfKey.get(finishKey) ?? "A fabric";
      if ("take" in decision) {
        project.actions.push({
          runId,
          sheetName: decision.take.sheetName,
          rowNo: decision.take.rowNo,
          kind: "swatch",
          finishKey,
          code,
          image: decision.take.image,
        });
        project.held.add(finishKey);
      } else if (decision.none === "differ") {
        project.notes.push(swatchDifferNotice(code, decision.rows));
      }
    }
  }

  return [...out.values()]
    .filter((project) => project.actions.length > 0 || project.notes.length > 0)
    .map((project) => ({
      projectId: project.projectId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      series: project.series,
      actions: project.actions,
      notes: project.notes,
    }));
}

/**
 * Writes one project's plan inside the caller's transaction. Returns what it
 * actually wrote — nothing, on a second run.
 */
export async function applyBillSwatchBackfill(
  txn: TxnSql,
  project: BillSwatchBackfillProject,
  actor: string,
): Promise<{ minted: number; linked: number; swatches: number; changeSetId: string | null }> {
  if (project.actions.length === 0) return { minted: 0, linked: 0, swatches: 0, changeSetId: null };
  const changeSetId = await openChangeSet(txn, {
    projectId: project.projectId,
    kind: "finish_link",
    reason:
      "Filed the bill's fabric lines in the finishes library as a confirm now does: uncoded fabrics as in-house " +
      "finishes, and each fabric line's picture as its code's swatch.",
    actor,
  });

  const mintedIds = new Map<string, string>();
  const changedRecords = new Set<string>();
  let minted = 0;
  let linked = 0;
  let swatches = 0;

  const link = async (attributeId: string, recordId: string, finishId: string) => {
    const moved = await txn`
      update record_attributes set finish_id = ${finishId}, updated_by = ${actor}
      where id = ${attributeId} and status = 'active' and finish_id is null
      returning id
    `;
    if (moved[0]) {
      linked += 1;
      changedRecords.add(recordId);
    }
  };

  for (const action of project.actions) {
    if (action.kind === "link") {
      await link(action.attributeId, action.recordId, action.finishId);
    } else if (action.kind === "mint") {
      let finishId = mintedIds.get(action.mintKey);
      if (!finishId) {
        // Only mint where the attribute is still unlinked: a second run, or a
        // person's link in between, must not leave an orphan code behind.
        const still = await txn`
          select id from record_attributes where id = ${action.attributeId} and status = 'active' and finish_id is null
        `;
        if (!still[0]) continue;
        const code = await mintInternalFinishCode(txn, project.projectId);
        finishId = await createFinish(txn, {
          projectId: project.projectId,
          fields: { code, codeOrigin: "internal", description: action.says, state: "tbc" },
          actor,
        });
        mintedIds.set(action.mintKey, finishId);
        minted += 1;
      }
      await link(action.attributeId, action.recordId, finishId);
    } else {
      const finishId = mintedIds.get(action.finishKey) ?? (action.finishKey.startsWith("mint:") ? null : action.finishKey);
      if (!finishId) continue;
      swatches += await giveBillSwatch(txn, {
        projectId: project.projectId,
        finishId,
        rowNo: action.rowNo,
        image: action.image,
        actor,
      });
    }
  }

  for (const recordId of changedRecords) await recomposeAnswers(txn, recordId, null, actor);
  await snapshotRecords(txn, [...changedRecords], changeSetId);
  return { minted, linked, swatches, changeSetId };
}
