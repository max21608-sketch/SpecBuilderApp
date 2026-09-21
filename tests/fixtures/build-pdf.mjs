// A synthetic PDF, built rather than committed.
//
// ============================================================================
// WHY A BUILDER AND NOT A FIXTURE FILE
//
// Two Stage 2 variance rows need PDFs this repo cannot hold: a page rotated 90
// degrees (row 5) and files of 120 and 601 pages (row 6). A real client drawing is
// exactly what never enters this repo, and a 120-page binary would be a
// megabyte of it. So the bytes are generated, from nothing, by this script —
// invented geometry and invented text, deterministic, and small enough that a
// test can make one per case.
//
// EVERY OBJECT IS UNCOMPRESSED AND THE xref IS A PLAIN TABLE. Not laziness: a
// reader that counts pages out of the bytes has to be tested against a file it
// can read AND one it cannot, and an object-stream PDF — which is what a real
// exporter writes — is the second. The honest answer there is "cannot tell"
// rather than a guess.
//
// Run it directly to write one out:
//   node tests/fixtures/build-pdf.mjs 120 > /tmp/big.pdf
// ============================================================================

/**
 * COMPRESSED CONTENT IS THE NORMAL CASE, which is why a page can ask for it.
 * Every real exporter deflates its content streams, so a reader that greps the
 * raw bytes for a text operator finds none in any real document and calls the
 * whole Panther pack scanned. A page built with `compress` is that document.
 */
import { deflateSync } from "node:zlib";

/** A PDF content stream that draws one line of text, so a page is not blank. */
function contents(label) {
  const escaped = String(label).replace(/([\\()])/g, "\\$1");
  return `BT /F1 24 Tf 40 200 Td (${escaped}) Tj ET\n`;
}

/**
 * A content stream that draws an IMAGE and no text — a scanned page.
 *
 * ============================================================================
 * WHAT A SCAN ACTUALLY LOOKS LIKE, and why the naive test fails it. The page's
 * own content stream places one image XObject and shows no text at all; the
 * pixels sit in a separate `/DCTDecode` stream. So "no `Tj` in the bytes" is
 * true of this file AND of every PDF whose text is inside a compressed stream,
 * which is why `pdfHasTextLayer` decodes rather than greps.
 *
 * It even keeps a `BT`/`ET` pair with nothing shown in it, because an OCR-less
 * scan's stream can carry one: a text object that sets a font and draws nothing
 * is not a text layer, and a reader that stopped at `BT` would call this file
 * readable.
 * ============================================================================
 */
function imageContents() {
  return "q 515 0 0 762 40 40 cm /Im0 Do Q\nBT /F1 12 Tf 40 20 Td ET\n";
}

/** Invented bytes standing in for a JPEG. Never decoded by anything here. */
const IMAGE_BYTES = "\xff\xd8\xff\xe0__QA not a real jpeg__\xff\xd9";

/**
 * @param {{ width?: number, height?: number, rotate?: number, label?: string,
 *           image?: boolean, contentFilter?: string, compress?: boolean }[]} pages
 * @returns {Buffer}
 */
export function buildPdf(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("a PDF needs at least one page");

  // 1 catalog, 2 pages tree, 3 font, then a page object and a content stream
  // for each page.
  const objects = [];
  // A page and its content stream each, then one shared image object at the end
  // for the scanned pages to place.
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const imageId = 4 + pages.length * 2;
  const anyImage = pages.some((page) => page.image);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((page, index) => {
    const width = page.width ?? 595;
    const height = page.height ?? 842;
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    // `/Rotate` is the page's own instruction to a viewer, and it is what row 5
    // is about: the MediaBox does not change, so anything reading a page's width
    // and height off the box alone crops a rotated page against the wrong axes.
    const rotate = page.rotate ? ` /Rotate ${page.rotate}` : "";
    // A scanned page needs the image in its resources; a text page needs the font.
    const resources = page.image
      ? `/Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 3 0 R >> >>`
      : "/Resources << /Font << /F1 3 0 R >> >>";
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]${rotate} ` +
      `${resources} /Contents ${streamId} 0 R >>`;
    const stream = page.image ? imageContents() : contents(page.label ?? `page ${index + 1}`);
    // `contentFilter` names a codec this app does not decode, so the content
    // stream becomes UNREADABLE rather than absent — the "cannot tell" case,
    // which has to proceed rather than be called a scan. The payload is not
    // really encoded: nothing here decodes it, which is the point.
    const filter = page.contentFilter ? ` /Filter /${page.contentFilter}` : "";
    const payload = page.compress ? deflateSync(Buffer.from(stream, "latin1")).toString("latin1") : stream;
    const compressed = page.compress ? " /Filter /FlateDecode" : "";
    objects[streamId] =
      `<< /Length ${Buffer.byteLength(payload, "latin1")}${filter}${compressed} >>\n` +
      `stream\n${payload}\nendstream`;
  });

  if (anyImage) {
    objects[imageId] =
      `<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${IMAGE_BYTES.length} >>\n` +
      `stream\n${IMAGE_BYTES}\nendstream`;
  }

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    if (objects[id] === undefined) continue;
    offsets[id] = header.length + Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const size = objects.length;
  const startxref = header.length + Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id += 1) {
    // A hole in the table is a free entry, which is legal and keeps the
    // offsets honest rather than renumbering the objects.
    xref +=
      offsets[id] === undefined
        ? "0000000000 65535 f \n"
        : `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, "latin1");
}

/** `buildPdf` for the plain case: n pages, portrait, none rotated. */
export function buildPdfOfPages(count, options = {}) {
  return buildPdf(
    Array.from({ length: count }, (_, index) => ({ ...options, label: `__QA page ${index + 1}` })),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = Number(process.argv[2] ?? 1);
  process.stdout.write(buildPdfOfPages(Number.isFinite(count) && count > 0 ? count : 1));
}
