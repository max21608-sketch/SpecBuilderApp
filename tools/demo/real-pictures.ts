// Real item pictures, borrowed from a pack that has already been through the
// app, so the demo's seating looks like furniture instead of a silhouette.
//
// ============================================================================
// WHY THIS IS THE ONE THING THAT IS NOT INVENTED
//
// Everything else about the demo project is made up, for the reasons at the
// top of tools/qa-demo-project.ts. Pictures are the exception Max asked for
// directly: the drawn silhouettes in sheets.ts are legible but obviously
// synthetic, and the screens they appear on — the spec table, the record page,
// the quote — are the ones a walkthrough spends most of its time looking at.
//
// So the item images are COPIED from the AP364c drawings already staged in the
// sandbox: real cropped 3D views off real shop drawings. Two limits on that,
// and both are deliberate:
//
//   ONLY PICTURES, AND ONLY SEATING. No codes, no descriptions, no dimensions
//   and no client names cross over — the specification of the demo project is
//   still entirely invented. The source pack is a seating package, so seating
//   gets a real picture and the casegoods keep their drawn silhouette, which
//   is an honest mix rather than a gap.
//
//   NOTHING ENTERS THE REPO. The copy is store-side, sandbox blob to sandbox
//   blob, under the demo project's own prefix. CLAUDE.md's rule is that real
//   client material never enters this repo, a fixture or a seed, and none of
//   it does.
//
// ---- IT MUST DEGRADE, NOT FAIL --------------------------------------------
//
// A database with no AP364c is a perfectly normal database — a fresh restore,
// somebody else's sandbox — and the demo has to build there too. Every lookup
// here returns null rather than throwing, and the caller falls back to the
// drawn silhouette it was going to use anyway.
//
// ---- THE COPY IS WHAT MAKES IT READABLE ------------------------------------
//
// It would be less work to point the demo's attachment row at the source
// project's pathname. It would also be unreadable: `assertProjectScopedPathname`
// refuses anything outside `projects/<id>/`, which is the same rule that broke
// every Graph-ingested email until the mailbox copy was added. The bytes move.
// ============================================================================
import { copy } from "@vercel/blob";

import { sql } from "@/lib/db";

/** The pack the pictures come from. Absent is a normal state, not an error. */
const SOURCE_PROJECT_NUMBER = "AP364c";

/**
 * Which of the source pack's items stands in for which of ours, by the demo
 * bill's own two-letter code prefix.
 *
 * A stool, a bench and a bed-end ottoman are all upholstered boxes, so one
 * ottoman view serves them. Casegoods are deliberately absent: the source pack
 * has none, and inventing a wardrobe by cropping a sofa would be worse than
 * the silhouette it replaced.
 */
const SOURCE_ITEM_BY_PREFIX: Record<string, string> = {
  AC: "Armchair",
  SO: "Sofa",
  BE: "Ottoman",
  ST: "Ottoman",
  LB: "Ottoman",
  OT: "Ottoman",
  HB: "Headboard",
};

/** `AC-102` is the desk chair and the source pack drew one. */
const SOURCE_ITEM_BY_CODE: Record<string, string> = {
  "AC-102": "Desk chair",
};

export type RealPicture = { pathname: string; width: number; height: number; size: number };

/**
 * PNG width and height, off the IHDR chunk.
 *
 * The attachment row records them and the record screen lays out against them,
 * so a guess would show as a stretched picture. Eight bytes at a fixed offset
 * is cheaper than decoding the image.
 */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

type SourceImage = { storagePath: string; size: number; width: number; height: number };

/**
 * Loads the source pack's pictures once, keyed by the item they show.
 *
 * Returns an empty map where the pack is not in this database, which is what
 * makes every caller fall back to a drawn silhouette without a branch of its
 * own.
 */
export async function loadSourcePictures(): Promise<Map<string, SourceImage>> {
  const found = new Map<string, SourceImage>();
  const project = await sql`
    select id from projects where bws_project_number = ${SOURCE_PROJECT_NUMBER} limit 1
  `.catch(() => []);
  const projectId = project[0]?.id ? String(project[0].id) : null;
  if (!projectId) return found;

  const rows = await sql`
    select distinct on (r.item_description)
           r.item_description, a.storage_path, a.size
    from attachments a
    join spec_records r on r.id = a.entity_id
    where a.entity_type = 'spec_records' and a.kind = 'item_image' and a.superseded_at is null
      and r.project_id = ${projectId} and a.size > 20000
    order by r.item_description, a.size desc
  `.catch(() => []);

  for (const row of rows) {
    // The stored size is what the uploader declared. Dimensions are not stored
    // on the attachment, so they come off the bytes at copy time instead; the
    // placeholder here is replaced in `copyPictureInto`.
    found.set(String(row.item_description), {
      storagePath: String(row.storage_path),
      size: Number(row.size ?? 0),
      width: 0,
      height: 0,
    });
  }
  return found;
}

/** The source item that stands in for one of the demo's codes, if any. */
export function sourceItemFor(code: string | null): string | null {
  if (!code) return null;
  return SOURCE_ITEM_BY_CODE[code] ?? SOURCE_ITEM_BY_PREFIX[code.slice(0, 2).toUpperCase()] ?? null;
}

/**
 * Copies one source picture under the demo project's prefix and returns what
 * an attachment row needs. Null on any failure, so the caller falls back.
 *
 * `copy` is the store's own server-side copy: nothing is downloaded and
 * re-uploaded, and the demo project ends up holding its own bytes at its own
 * pathname, which is the only thing `readTrustedBlob` will serve.
 */
export async function copyPictureInto(
  source: SourceImage,
  destinationPathname: string,
  token: string,
): Promise<RealPicture | null> {
  try {
    const result = await copy(source.storagePath, destinationPathname, {
      access: "private",
      addRandomSuffix: false,
      contentType: "image/png",
      token,
    });

    // Dimensions come off the first bytes of the copy. A range request would
    // be neater; the store's SDK does not expose one, and a picture is small.
    let width = 640;
    let height = 480;
    try {
      const response = await fetch(result.downloadUrl ?? result.url);
      if (response.ok) {
        const measured = pngSize(Buffer.from(await response.arrayBuffer()));
        if (measured) {
          width = measured.width;
          height = measured.height;
        }
      }
    } catch {
      // The copy succeeded; only the measurement did not. The defaults are
      // close enough that the picture renders, and a failed measurement must
      // not lose a picture that is already stored.
    }

    return { pathname: result.pathname, width, height, size: source.size };
  } catch {
    return null;
  }
}
