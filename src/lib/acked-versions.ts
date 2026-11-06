// ============================================================================
// THE VERSION A CLICK SENDS IS NOT THE VERSION OF ITS RENDER (audit G1,
// 2026-11-06).
//
// A review screen autosaves on blur and commits on a button. The blur fires
// first, queues its save, and the click handler then waits for that save
// before it confirms. But the click handler was created by the render the
// click happened in, so the versions it read off its rows were the versions
// from BEFORE the save it had just waited for. The server had moved each
// edited row on by one; the confirm sent the old number; the server refused
// with "'Seat height' was edited in another tab. Reload before confirming."
// with nobody else in the document. The same happened to a second autosave
// queued behind a slow first one, and to "Confirm everything".
//
// So the versions a request sends are read from a LEDGER the save chain keeps,
// at the moment the request is built, never from the arguments a closure
// captured. The ledger holds what the server ACKNOWLEDGED to this screen; the
// version sent is the larger of that and the version the row rendered with.
//
// Why the larger, and not "the ledger wins": the ledger only ever learns of
// this screen's OWN writes. A row somebody else edited reaches this screen by
// a reload, so its rendered version is newer than anything the ledger holds,
// and the reviewer has seen it on screen. A row somebody else edited that has
// NOT been rendered yet is in neither place, so the request carries the older
// number and the server refuses it, which is the refusal that is true.
//
// Pure, and shared: the drawings PATCH says which versions it wrote
// (`versionsWritten`), and the two drawings screens and the spec-document
// review read the ledger.
// ============================================================================
import type { DrawingItem } from "./drawing-document";

/** The versions one write produced, by id, for the staged items and their rows. */
export type WrittenVersions = {
  items: Record<string, number>;
  observations: Record<string, number>;
};

/**
 * Which item and observation versions moved between two copies of a staged
 * drawings document. The PATCH returns this so the screen learns every row a
 * write bumped, including the ones it did not name (a slot swap moves the row
 * it displaced; "set the unit on all of them" moves every measured row).
 */
export function versionsWritten(before: readonly DrawingItem[], after: readonly DrawingItem[]): WrittenVersions {
  const items: Record<string, number> = {};
  const observations: Record<string, number> = {};
  const was = new Map<string, number>();
  const itemWas = new Map<string, number>();
  for (const item of before) {
    itemWas.set(item.id, item.version);
    for (const observation of item.observations) was.set(observation.id, observation.version);
  }
  for (const item of after) {
    if (itemWas.get(item.id) !== item.version) items[item.id] = item.version;
    for (const observation of item.observations) {
      if (was.get(observation.id) !== observation.version) observations[observation.id] = observation.version;
    }
  }
  return { items, observations };
}

/**
 * The versions the server acknowledged to this screen. One instance per
 * mounted screen, held in a ref so a re-render never replaces it.
 *
 * Item and observation ids are kept apart: they are separate namespaces in
 * the staged JSON, and nothing promises they never collide.
 */
export class VersionLedger {
  private readonly acked = new Map<string, number>();

  private key(kind: "item" | "row", id: string) {
    return `${kind}\u0000${id}`;
  }

  private remember(key: string, version: number) {
    const held = this.acked.get(key);
    // Never backwards: two responses landing out of order must not undo the
    // newer one.
    if (held === undefined || version > held) this.acked.set(key, version);
  }

  /** What a successful write said it produced. */
  record(written: Partial<WrittenVersions> | null | undefined): void {
    if (!written) return;
    for (const [id, version] of Object.entries(written.items ?? {})) {
      if (Number.isInteger(version)) this.remember(this.key("item", id), version);
    }
    for (const [id, version] of Object.entries(written.observations ?? {})) {
      if (Number.isInteger(version)) this.remember(this.key("row", id), version);
    }
  }

  /** One row (an observation, or a spec-document proposal) at a known version. */
  recordRow(id: string, version: number): void {
    if (Number.isInteger(version)) this.remember(this.key("row", id), version);
  }

  /** The version to send for a row that rendered at `rendered`. */
  row(id: string, rendered: number): number {
    return Math.max(rendered, this.acked.get(this.key("row", id)) ?? rendered);
  }

  /** The version to send for an item that rendered at `rendered`. */
  item(id: string, rendered: number): number {
    return Math.max(rendered, this.acked.get(this.key("item", id)) ?? rendered);
  }
}
