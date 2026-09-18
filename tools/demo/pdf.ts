// A very small PDF writer: vector lines, rectangles and Helvetica text.
//
// WHY THIS EXISTS. The drawings review screen renders the SOURCE PAGE beside
// every card — that is the whole point of it, and a demo where the page cannot
// be opened demonstrates the opposite of what the screen is for. So the demo
// pack is a real PDF, drawn here, with the same figures printed on the page
// that the staged observations carry. A reviewer walking the demo can check a
// card against its page exactly as they would a real one.
//
// Uncompressed content streams on purpose: the file is a few hundred KB, and a
// demo artefact that can be read in a text editor is easier to correct than one
// that cannot.
//
// It is NOT a general PDF library. No images, no unicode, no wrapping beyond
// what is written here. pdfjs (the app's own reader) is what it is verified
// against, because that is the only thing that ever opens it.

export type Point = { x: number; y: number };

/** A3 landscape in points, which is what a shop drawing sheet is. */
export const SHEET = { width: 1191, height: 842 };
/** A4 portrait, for a preamble. */
export const A4 = { width: 595, height: 842 };

type Op = string;

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function n(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * One page. Coordinates are PDF's own: origin bottom-left, y upwards. The
 * helpers take them that way rather than flipping, because the only reader is
 * this file's own callers and a hidden flip is a bug waiting to happen.
 */
export class Page {
  readonly ops: Op[] = [];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  grey(value: number): this {
    this.ops.push(`${n(value)} g`, `${n(value)} G`);
    return this;
  }

  rgb(r: number, g: number, b: number): this {
    this.ops.push(`${n(r)} ${n(g)} ${n(b)} rg`, `${n(r)} ${n(g)} ${n(b)} RG`);
    return this;
  }

  width_(value: number): this {
    this.ops.push(`${n(value)} w`);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number): this {
    this.ops.push(`${n(x0)} ${n(y0)} m ${n(x1)} ${n(y1)} l S`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, fill = false): this {
    this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re ${fill ? "f" : "S"}`);
    return this;
  }

  /** A dashed line, for a dimension witness line. */
  dashed(x0: number, y0: number, x1: number, y1: number): this {
    this.ops.push("[3 3] 0 d");
    this.line(x0, y0, x1, y1);
    this.ops.push("[] 0 d");
    return this;
  }

  text(x: number, y: number, value: string, size = 9, bold = false): this {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(x)} ${n(y)} Td (${escapeText(value)}) Tj ET`);
    return this;
  }

  /** Helvetica is roughly 0.52em average; good enough to centre a label. */
  centred(cx: number, y: number, value: string, size = 9, bold = false): this {
    return this.text(cx - (value.length * size * (bold ? 0.56 : 0.52)) / 2, y, value, size, bold);
  }

  /** An outlined item code, the way a drawing sheet stamps one. */
  stamp(x: number, y: number, value: string, size = 34): this {
    this.ops.push(`BT /F2 ${n(size)} Tf 1 Tr ${n(0.9)} w ${n(x)} ${n(y)} Td (${escapeText(value)}) Tj 0 Tr ET`);
    return this;
  }

  stream(): string {
    return this.ops.join("\n");
  }
}

export class Pdf {
  private readonly pages: Page[] = [];

  page(width = SHEET.width, height = SHEET.height): Page {
    const page = new Page(width, height);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  build(title: string): Buffer {
    const objects: string[] = [];
    const add = (body: string): number => {
      objects.push(body);
      return objects.length; // 1-based object number
    };

    const catalogNo = 1;
    const pagesNo = 2;
    objects.push("", ""); // reserved for catalog and pages

    const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    const pageNos: number[] = [];
    for (const page of this.pages) {
      const stream = page.stream();
      const contentNo = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      pageNos.push(
        add(
          `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] ` +
            `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentNo} 0 R >>`,
        ),
      );
    }

    objects[catalogNo - 1] = `<< /Type /Catalog /Pages ${pagesNo} 0 R >>`;
    objects[pagesNo - 1] =
      `<< /Type /Pages /Kids [${pageNos.map((no) => `${no} 0 R`).join(" ")}] /Count ${pageNos.length} >>`;

    const infoNo = add(
      `<< /Title (${escapeText(title)}) /Producer (Project Spec Builder demo generator) /Creator (Project Spec Builder demo generator) >>`,
    );

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 0; i < objects.length; i += 1) {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefAt = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

    return Buffer.from(out, "latin1");
  }
}
