// Writing an item's picture: a drawing crop at confirm, and a person's swap.
//
// ============================================================================
// SUPERSEDE, NEVER DELETE — AND A DRAWING DOES NOT DISPLACE A PHOTOGRAPH.
//
// `item-image.ts` carries the reasoning; this is the database half. Three rules
// hold here and each is a trap rather than a preference:
//
// - NOTHING IS DELETED. A replaced picture gets `superseded_at` (0013), so a
//   version taken last week still points at a file that exists, and "what did
//   the record look like when we quoted it" has an answer. The drawings confirm
//   used to delete, on the argument that a crop can always be re-made — true
//   of a crop and false of the bill's picture it was deleting.
// - A ROW IS NEVER RE-POINTED OR RE-KINDED. Choosing a picture INSERTS a new
//   `item_image` naming the same file and supersedes the row it came from; an
//   alternative never has its `kind` updated in place. The audit trail then
//   says what was current when, row by row, which an update would erase.
// - THE CHOICE IS A PERSON'S, under a change set and a version. The record's
//   atoms carry `itemImage` (record-atoms.ts), so a swap is a new version of
//   the record exactly as a corrected spec is. `spec_records.version` is NOT
//   touched: a picture is its own row, and bumping the record would invalidate
//   every extraction snapshot and chase coverage row taken against it.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import type { SqlLike } from "@/lib/record-atoms";
import { assertProjectScopedPathname, blobPathname } from "@/lib/blob-source";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import {
  ITEM_IMAGE_ALTERNATIVE_KIND,
  ITEM_IMAGE_KIND,
  currentPicture,
  itemImageCaption,
  itemImageSource,
  type ItemImageSource,
  type ItemPictureRow,
} from "@/lib/item-image";

/** Every picture row a record has ever had, current or not, of both kinds. */
export async function loadItemPictures(exec: SqlLike, recordId: string): Promise<ItemPictureRow[]> {
  const rows = await exec`
    select id, kind, storage_path, filename, created_at::text as created_at, superseded_at::text as superseded_at
    from attachments
    where entity_type = 'spec_records' and entity_id = ${recordId}
      and kind in (${ITEM_IMAGE_KIND}, ${ITEM_IMAGE_ALTERNATIVE_KIND})
    order by created_at desc, id desc
  `;
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    storagePath: String(row.storage_path),
    filename: row.filename === null || row.filename === undefined ? null : String(row.filename),
    createdAt: String(row.created_at),
    supersededAt: row.superseded_at === null || row.superseded_at === undefined ? null : String(row.superseded_at),
  }));
}

export type DrawingCrop = {
  storagePath: string;
  filename: string;
  size: number | null;
  width: number | null;
  height: number | null;
};

/**
 * A drawing crop, given to one record at drawings confirm.
 *
 * Where the record's CURRENT picture is the bill's, the crop is stored beside
 * it as an alternative and the bill's picture stays — "we always prefer a
 * picture over a drawing". A second drawings confirm over the same bill
 * picture supersedes the first offer rather than stacking them: the record
 * offers ONE drawing crop, the newest.
 *
 * Otherwise — a drawing crop is current, a picture of no known source is, or
 * there is none — it behaves as it always did, except that the old picture is
 * superseded rather than deleted: the crop becomes the picture. Any offer still
 * waiting goes too, because a crop that is now current makes an older one moot.
 *
 * Returns which of the two happened. The caller holds the record's row lock.
 */
export async function placeDrawingCrop(
  txn: TxnSql,
  recordId: string,
  crop: DrawingCrop,
  actor: string,
): Promise<"current" | "alternative"> {
  const current = currentPicture(await loadItemPictures(txn, recordId));
  const keepsBillPicture = current !== null && itemImageSource(current).kind === "bill";

  await txn`
    update attachments set superseded_at = now()
    where entity_type = 'spec_records' and entity_id = ${recordId}
      and kind = ${ITEM_IMAGE_ALTERNATIVE_KIND} and superseded_at is null
  `;
  if (!keepsBillPicture) {
    await txn`
      update attachments set superseded_at = now()
      where entity_type = 'spec_records' and entity_id = ${recordId}
        and kind = ${ITEM_IMAGE_KIND} and superseded_at is null
    `;
  }
  await txn`
    insert into attachments
      (entity_type, entity_id, kind, storage_path, filename, content_type, size,
       image_width, image_height, uploaded_by)
    values
      ('spec_records', ${recordId}, ${keepsBillPicture ? ITEM_IMAGE_ALTERNATIVE_KIND : ITEM_IMAGE_KIND},
       ${crop.storagePath}, ${crop.filename}, 'image/png', ${crop.size},
       ${crop.width}, ${crop.height}, ${actor})
  `;
  return keepsBillPicture ? "alternative" : "current";
}

export type ChoosePictureResult = {
  recordId: string;
  /** The new current row: a choice inserts one, it never re-points the old. */
  attachmentId: string;
  source: ItemImageSource;
  changeSetId: string;
  version: number | null;
};

/**
 * A person makes one of the record's own pictures its current one.
 *
 * THE OPTIMISTIC CHECK IS THE CURRENT PICTURE'S ID, not the record's version.
 * Nothing that changes a picture bumps `spec_records.version` — not a drawings
 * confirm, not a bill's picture, not this — and it must not, so a version
 * check would let a crop confirmed a second ago be superseded by a person who
 * never saw it. The id of the picture they were looking at is exactly the
 * thing that has to be unchanged. `null` means "there was no picture".
 */
export async function chooseItemPicture(
  txn: TxnSql,
  {
    recordId,
    attachmentId,
    currentAttachmentId,
    actor,
  }: { recordId: string; attachmentId: string; currentAttachmentId: string | null; actor: string },
): Promise<ChoosePictureResult> {
  // The record's row lock first, as the drawings confirm takes it, so a swap
  // and a confirm placing a crop on the same record cannot interleave.
  const locked = await txn`select id, project_id from spec_records where id = ${recordId} for update`;
  const record = locked[0];
  if (!record) throw new DomainConflictError("not_found", "No such item.", { status: 404 });
  const projectId = String(record.project_id);

  const rows = await loadItemPictures(txn, recordId);
  const current = currentPicture(rows);
  if ((current?.id ?? null) !== currentAttachmentId) {
    throw new DomainConflictError(
      "picture_changed",
      "This item's picture changed since you looked at it. Nothing was written — reload and choose again.",
    );
  }
  const chosen = rows.find((row) => row.id === attachmentId);
  if (!chosen) {
    throw new DomainConflictError("not_this_record", "That picture is not one of this item's.", { status: 404 });
  }
  if (chosen.id === current?.id) {
    throw new DomainConflictError("already_current", "That is already this item's picture.", { status: 400 });
  }
  // The file the new row will name, re-checked against the record's project:
  // it is about to become the picture every screen and the costing sheet
  // show, and a check in only one place is a check the others skipped.
  try {
    assertProjectScopedPathname(blobPathname(chosen.storagePath), projectId);
  } catch {
    throw new DomainConflictError("picture_elsewhere", "That picture is not stored under this project.", { status: 400 });
  }

  const source = itemImageSource(chosen);
  const changeSetId = await openChangeSet(txn, {
    projectId,
    kind: "manual_edit",
    actor,
    reason: `Picture chosen: ${itemImageCaption(source).toLowerCase()}`,
  });

  if (current) {
    await txn`update attachments set superseded_at = now() where id = ${current.id} and superseded_at is null`;
  }
  if (chosen.kind === ITEM_IMAGE_ALTERNATIVE_KIND && !chosen.supersededAt) {
    await txn`update attachments set superseded_at = now() where id = ${chosen.id} and superseded_at is null`;
  }
  const inserted = await txn`
    insert into attachments
      (entity_type, entity_id, kind, storage_path, filename, content_type, size,
       image_width, image_height, uploaded_by)
    select entity_type, entity_id, ${ITEM_IMAGE_KIND}, storage_path, filename, content_type, size,
           image_width, image_height, ${actor}
    from attachments where id = ${chosen.id}
    returning id
  `;

  const versions = await snapshotRecords(txn, [recordId], changeSetId);
  return {
    recordId,
    attachmentId: String(inserted[0]!.id),
    source,
    changeSetId,
    version: versions.get(recordId) ?? null,
  };
}
