// A PDF made only of pictures — a scan, as far as any reader can tell.
//
// ============================================================================
// WHY. A PDF bill with no text layer is transcribed by the model (workstream
// C2), and checking that on the local stack needs a PDF a model can actually
// READ but a program cannot: real pixels of a table, and no text anywhere.
// `build-pdf.mjs`'s scanned page carries invented bytes standing in for a JPEG,
// which is right for a reader that must never decode it and useless to a model.
//
// So this wraps real JPEGs — one per page, drawn to fill an A4 page — and
// nothing else. Render an INVENTED bill to an image first (headless Chrome's
// `--screenshot` of an HTML table does it), then:
//
//   node tests/fixtures/build-image-pdf.mjs out.pdf page1.jpg:1240x1754 page2.jpg:1240x1754
//
// A real client bill never goes through this, and neither its output nor its
// input enters the repo.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";

/**
 * @param {{ jpeg: Buffer, width: number, height: number }[]} pages
 * @returns {Buffer}
 */
export function buildImagePdf(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("a PDF needs at least one page");
  const A4 = [595, 842];
  /** @type {(string | Buffer)[]} */
  const objects = [];
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const draw = `q ${A4[0]} 0 0 ${A4[1]} 0 0 cm /Im0 Do Q\n`;
    objects[contentId] = `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`;
    objects[imageId] = Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
        "latin1",
      ),
      page.jpeg,
      Buffer.from("\nendstream", "latin1"),
    ]);
  });

  const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let length = parts[0].length;
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = length;
    const body = objects[id];
    const chunk = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`, "latin1"),
      typeof body === "string" ? Buffer.from(body, "latin1") : body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(chunk);
    length += chunk.length;
  }
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length === 0) {
    console.error("usage: node tests/fixtures/build-image-pdf.mjs out.pdf page.jpg:WIDTHxHEIGHT [...]");
    process.exit(2);
  }
  const pages = inputs.map((input) => {
    const match = input.match(/^(.+):(\d+)x(\d+)$/);
    if (!match) throw new Error(`${input}: give each JPEG as file.jpg:WIDTHxHEIGHT`);
    return { jpeg: readFileSync(match[1]), width: Number(match[2]), height: Number(match[3]) };
  });
  writeFileSync(out, buildImagePdf(pages));
  console.log(`wrote ${out}: ${pages.length} page${pages.length === 1 ? "" : "s"}, pictures only`);
}
