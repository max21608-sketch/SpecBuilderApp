// Turning the invented pack into files: the drawing sheets, the preamble, the
// item pictures and the swatches.
//
// The sheet layout is a caricature of a real one — title block, stamped item
// code, an elevation with dimension figures on leader lines, a titled 3D panel,
// a callout list and a notes block. It exists so the review screen has a page
// to render beside its card, and so the reviewer can see that the card says
// what the page says.
//
// THE 3D PANEL IS WHERE `viewRegions` POINTS. `DemoDrawing.view3d` is a bbox in
// fractions of the page with the origin at the TOP LEFT, which is what
// `ItemView` means by one; PDF's own origin is at the bottom left, so every
// placement here flips it once, in `box()`, and nowhere else.
import { Pdf, Page, SHEET, A4 } from "./pdf";
import { Canvas, type Rgb } from "./raster";
import { FINISH_DETAIL, PROJECT, type DemoDrawing, type Silhouette } from "./content";


type Box = { x: number; y: number; w: number; h: number };

/** A top-left-origin bbox, in PDF's bottom-left-origin points. */
function box(page: Page, bbox: [number, number, number, number]): Box {
  const [x0, y0, x1, y1] = bbox;
  return {
    x: x0 * page.width,
    y: (1 - y1) * page.height,
    w: (x1 - x0) * page.width,
    h: (y1 - y0) * page.height,
  };
}

/** The outline of a piece of furniture, drawn to fit a box. */
function silhouette(page: Page, kind: Silhouette, b: Box): void {
  const { x, y, w, h } = b;
  page.grey(0.25).width_(1.4);
  const rect = (rx: number, ry: number, rw: number, rh: number) =>
    page.rect(x + rx * w, y + ry * h, rw * w, rh * h);

  switch (kind) {
    case "armchair":
    case "deskchair":
      rect(0.18, 0.0, 0.64, 0.1); // legs band
      rect(0.12, 0.1, 0.76, 0.22); // seat
      rect(0.12, 0.32, 0.12, 0.34); // left arm
      rect(0.76, 0.32, 0.12, 0.34); // right arm
      rect(0.24, 0.32, 0.52, 0.6); // back
      break;
    case "sofa":
      rect(0.06, 0.0, 0.88, 0.08);
      rect(0.04, 0.08, 0.92, 0.24);
      rect(0.04, 0.32, 0.1, 0.3);
      rect(0.86, 0.32, 0.1, 0.3);
      rect(0.14, 0.32, 0.36, 0.46);
      rect(0.5, 0.32, 0.36, 0.46);
      break;
    case "headboard":
      rect(0.08, 0.0, 0.84, 0.92);
      for (let i = 1; i < 8; i += 1) page.line(x + (0.08 + (0.84 * i) / 8) * w, y, x + (0.08 + (0.84 * i) / 8) * w, y + 0.92 * h);
      break;
    case "ottoman":
      rect(0.1, 0.0, 0.8, 0.12);
      rect(0.06, 0.12, 0.88, 0.62);
      break;
    case "bedside":
      rect(0.16, 0.0, 0.68, 0.1);
      rect(0.08, 0.1, 0.84, 0.72);
      rect(0.14, 0.46, 0.72, 0.16);
      rect(0.14, 0.24, 0.72, 0.16);
      break;
    case "bench":
      rect(0.08, 0.0, 0.1, 0.36);
      rect(0.82, 0.0, 0.1, 0.36);
      rect(0.04, 0.36, 0.92, 0.2);
      break;
    case "table":
      rect(0.06, 0.62, 0.88, 0.14);
      rect(0.12, 0.0, 0.08, 0.62);
      rect(0.8, 0.0, 0.08, 0.62);
      break;
    case "wardrobe":
      rect(0.08, 0.0, 0.84, 0.92);
      page.line(x + 0.5 * w, y, x + 0.5 * w, y + 0.92 * h);
      break;
  }
}

/** A dimension figure on a leader line, pointing into the elevation. */
function leader(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, label: string): void {
  page.grey(0.45).width_(0.6);
  page.line(from.x, from.y, to.x, to.y);
  page.grey(0.15).text(from.x + 2, from.y + 3, label, 7.5);
}

function titleBlock(page: Page, drawing: DemoDrawing, revision: string, pageNo: number, pages: number): void {
  const w = 300;
  const h = 96;
  const x = page.width - w - 28;
  const y = 28;
  page.grey(0.15).width_(1).rect(x, y, w, h);
  page.line(x, y + 64, x + w, y + 64);
  page.line(x, y + 40, x + w, y + 40);
  page.line(x + 190, y, x + 190, y + 40);
  page.text(x + 8, y + 76, PROJECT.name, 10, true);
  page.text(x + 8, y + 50, drawing.name ?? "General arrangement", 9);
  page.text(x + 8, y + 26, `SHEET ${drawing.sheet}`, 11, true);
  page.text(x + 8, y + 10, `REV ${revision}   ${drawing.scale}`, 8);
  page.text(x + 198, y + 26, `PAGE ${pageNo} OF ${pages}`, 8);
  page.text(x + 198, y + 10, "ASHCOMBE HOUSE STUDIO", 7);
}

export function drawingPdf(drawings: DemoDrawing[], revision: string): Buffer {
  const pdf = new Pdf();
  drawings.forEach((drawing, index) => {
    const page = pdf.page(SHEET.width, SHEET.height);
    page.grey(1).rect(0, 0, page.width, page.height, true);
    page.grey(0.15).width_(1.2).rect(20, 20, page.width - 40, page.height - 40);

    // The item code, stamped as vector outline the way a real sheet does it.
    if (drawing.code) page.stamp(48, page.height - 84, drawing.code, 38);
    else page.grey(0.35).text(48, page.height - 78, "GENERAL ARRANGEMENT", 20, true);
    page.grey(0.35).text(48, page.height - 108, (drawing.name ?? "No single item specified").toUpperCase(), 11);

    // The front elevation, on the left and BELOW the figures.
    //
    // It used to start at 12% of the page height, which is above where the
    // figure block starts — so on every sheet the elevation outline was drawn
    // straight through the dimensions and the remarks, and the unit note came
    // out looking struck through. The text is the part the model reads and the
    // part a person checks a card against; the elevations are the decoration,
    // so they move.
    const front = box(page, [0.06, 0.60, 0.26, 0.30]);
    page.grey(0.55).text(front.x, front.y + front.h + 10, "FRONT", 9, true);
    silhouette(page, drawing.silhouette, front);

    // The titled 3D panel, which is what the item picture is cropped from.
    const three = box(page, drawing.view3d);
    page.grey(0.9).rect(three.x, three.y, three.w, three.h, true);
    page.grey(0.55).width_(0.8).rect(three.x, three.y, three.w, three.h);
    page.grey(0.35).text(three.x + 10, three.y + three.h - 18, "3D VIEW", 10, true);
    silhouette(page, drawing.silhouette, {
      x: three.x + three.w * 0.22,
      y: three.y + three.h * 0.12,
      w: three.w * 0.56,
      h: three.h * 0.68,
    });

    // The side elevation, beside it, where the figures hang off it.
    const side = box(page, [0.34, 0.60, 0.26, 0.30]);
    page.grey(0.55).text(side.x, side.y + side.h + 10, "SIDE", 9, true);
    silhouette(page, drawing.silhouette, side);

    // The figures. By view, labelled, or as one combined line — whichever this
    // sheet's template uses, printed the way that template prints it.
    let cursor = page.height - 150;
    const left = 48;
    if (drawing.byView) {
      page.grey(0.15).text(left, cursor, "DIMENSIONS BY VIEW", 9, true);
      cursor -= 16;
      for (const view of drawing.byView) {
        page.grey(0.25).text(left, cursor, view.view.padEnd(14, " "), 8.5, true);
        page.grey(0.15).text(left + 92, cursor, view.figures.join("    "), 8.5);
        cursor -= 14;
      }
      cursor -= 6;
      // The page says what it says. A sheet declaring a printed unit has to
      // PRINT one, or the note contradicts the sheet and the unit resolution
      // is being tested against a page that lies about itself.
      page
        .grey(0.45)
        .text(
          left,
          cursor,
          drawing.unitPrinted
            ? `ALL DIMENSIONS IN ${drawing.unitPrinted === "mm" ? "MILLIMETRES" : "CENTIMETRES"} UNLESS NOTED.`
            : "FIGURES ARE AS DRAWN. NO UNIT IS PRINTED ON THIS SHEET.",
          7.5,
        );
      cursor -= 18;
    }
    if (drawing.labelled) {
      page.grey(0.15).text(left, cursor, "DIMENSIONS", 9, true);
      cursor -= 16;
      for (const dimension of drawing.labelled) {
        page.grey(0.25).text(left, cursor, dimension.label, 8.5);
        page
          .grey(0.15)
          .text(left + 180, cursor, `${dimension.value}${dimension.unit ?? drawing.unitPrinted ?? ""}`, 8.5, true);
        cursor -= 14;
      }
      cursor -= 10;
    }
    if (drawing.combined) {
      page.grey(0.15).text(left, cursor, "OVERALL SIZE", 9, true);
      cursor -= 20;
      for (const line of drawing.combined) page.text(left, cursor, line, 13, true);
      cursor -= 24;
    }

    // Callouts, on the right, with a leader back into the 3D panel.
    let callout = page.height - 150;
    const calloutX = page.width - 470;
    if (drawing.callouts.length > 0) {
      page.grey(0.15).text(calloutX, callout, "MATERIALS AND FINISHES", 9, true);
      callout -= 16;
      for (const entry of drawing.callouts) {
        page.grey(0.25).text(calloutX, callout, `${entry.label} /`, 8.5, true);
        page.grey(0.15).text(calloutX + 8, callout - 11, `${entry.code ? `${entry.code}  ` : ""}${entry.value}`, 8.5);
        leader(page, { x: calloutX - 14, y: callout + 2 }, { x: three.x + 12, y: three.y + three.h * 0.5 }, "");
        callout -= 28;
      }
    }

    // The notes block, stamped line by line with its field, exactly as a real
    // specification sheet does — which is what `mergeNoteBlocks` folds back
    // into one row on the card.
    let note = cursor;
    for (const block of drawing.notes) {
      for (const line of block.lines) {
        page.grey(0.35).text(left, note, `${block.heading}:`, 7.5, true);
        page.grey(0.15).text(left + 120, note, line.toUpperCase(), 7.5);
        note -= 12;
      }
      note -= 4;
    }

    titleBlock(page, drawing, revision, index + 1, drawings.length);
  });
  return pdf.build(`Ashcombe House shop drawings, issue ${revision}`);
}

export function preamblePdf(sections: { topicRaw: string | null; titleRaw: string | null; bodyRaw: string | null; page: number | null }[]): Buffer {
  const pdf = new Pdf();
  const pageCount = Math.max(...sections.map((section) => section.page ?? 1));
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const page = pdf.page(A4.width, A4.height);
    page.grey(1).rect(0, 0, page.width, page.height, true);
    page.grey(0.15).text(56, page.height - 80, "FF&E SPECIFICATION PREAMBLE", 15, true);
    page.grey(0.35).text(56, page.height - 100, `${PROJECT.name} — issue B`, 10);
    page.grey(0.15).width_(0.8).line(56, page.height - 112, page.width - 56, page.height - 112);

    let y = page.height - 150;
    for (const section of sections.filter((entry) => (entry.page ?? 1) === pageNo)) {
      page.grey(0.35).text(56, y, (section.topicRaw ?? "").toUpperCase(), 8, true);
      y -= 16;
      page.grey(0.1).text(56, y, section.titleRaw ?? "", 11, true);
      y -= 16;
      for (const line of wrap(section.bodyRaw ?? "", 82)) {
        page.grey(0.2).text(56, y, line, 9.5);
        y -= 13;
      }
      y -= 18;
    }
    page.grey(0.45).text(56, 48, `Page ${pageNo} of ${pageCount}`, 8);
  }
  return pdf.build("Ashcombe House FF&E preamble");
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// ---- pictures --------------------------------------------------------------

const PAPER: Rgb = [246, 245, 242];
const LINE: Rgb = [58, 58, 64];

/** The item picture: the 3D panel, as if somebody had cropped it. */
export function itemPicture(drawing: DemoDrawing): Buffer {
  const canvas = new Canvas(520, 380, PAPER);
  canvas.rect(0, 0, 520, 380, [214, 212, 206], 2);
  canvas.text(16, 16, "3D VIEW", [130, 130, 136], 2);
  drawSilhouette(canvas, drawing.silhouette, 110, 60, 300, 260);
  const label = drawing.code ?? "GA";
  canvas.text(16, 380 - 34, label, LINE, 3);
  canvas.text(16 + Canvas.textWidth(label, 3) + 18, 380 - 30, (drawing.name ?? "").toUpperCase().slice(0, 26), [120, 120, 126], 2);
  return canvas.png();
}

function drawSilhouette(canvas: Canvas, kind: Silhouette, x: number, y: number, w: number, h: number): void {
  const shade: Rgb = [226, 223, 216];
  const r = (rx: number, ry: number, rw: number, rh: number) => {
    canvas.fill(Math.round(x + rx * w), Math.round(y + ry * h), Math.round(rw * w), Math.round(rh * h), shade);
    canvas.rect(Math.round(x + rx * w), Math.round(y + ry * h), Math.round(rw * w), Math.round(rh * h), LINE, 2);
  };
  // y here runs DOWNWARD (raster), so every band is measured from the top.
  switch (kind) {
    case "armchair":
    case "deskchair":
      r(0.24, 0.08, 0.52, 0.42); // back
      r(0.12, 0.34, 0.12, 0.34); // left arm
      r(0.76, 0.34, 0.12, 0.34); // right arm
      r(0.12, 0.5, 0.76, 0.22); // seat
      r(0.18, 0.72, 0.08, 0.26);
      r(0.74, 0.72, 0.08, 0.26);
      break;
    case "sofa":
      r(0.14, 0.14, 0.36, 0.34);
      r(0.5, 0.14, 0.36, 0.34);
      r(0.04, 0.32, 0.1, 0.34);
      r(0.86, 0.32, 0.1, 0.34);
      r(0.04, 0.62, 0.92, 0.22);
      r(0.1, 0.84, 0.07, 0.14);
      r(0.83, 0.84, 0.07, 0.14);
      break;
    case "headboard":
      r(0.08, 0.04, 0.84, 0.92);
      for (let i = 1; i < 8; i += 1) {
        const cx = Math.round(x + (0.08 + (0.84 * i) / 8) * w);
        canvas.line(cx, Math.round(y + 0.04 * h), cx, Math.round(y + 0.96 * h), [188, 184, 176], 1);
      }
      break;
    case "ottoman":
      r(0.06, 0.24, 0.88, 0.52);
      r(0.12, 0.76, 0.76, 0.14);
      break;
    case "bedside":
      r(0.08, 0.14, 0.84, 0.7);
      r(0.14, 0.24, 0.72, 0.16);
      r(0.14, 0.46, 0.72, 0.16);
      r(0.16, 0.84, 0.08, 0.14);
      r(0.76, 0.84, 0.08, 0.14);
      break;
    case "bench":
      r(0.04, 0.4, 0.92, 0.18);
      r(0.08, 0.58, 0.1, 0.38);
      r(0.82, 0.58, 0.1, 0.38);
      break;
    case "table":
      r(0.06, 0.22, 0.88, 0.14);
      r(0.12, 0.36, 0.08, 0.6);
      r(0.8, 0.36, 0.08, 0.6);
      break;
    case "wardrobe":
      r(0.08, 0.04, 0.84, 0.92);
      canvas.line(Math.round(x + 0.5 * w), Math.round(y + 0.04 * h), Math.round(x + 0.5 * w), Math.round(y + 0.96 * h), LINE, 2);
      break;
  }
}

/**
 * A swatch chip, as if cropped off the page it is printed on.
 *
 * The weave is a deterministic texture rather than a flat fill, so a screen of
 * them does not read as a colour picker. Nothing here is a claim about what the
 * real cloth looks like — this is an invented finish on an invented project.
 */
export function swatch(code: string): Buffer {
  const detail = FINISH_DETAIL[code];
  const base: Rgb = detail?.colour ?? [190, 188, 182];
  const canvas = new Canvas(260, 200, [250, 250, 248]);
  canvas.fill(10, 10, 240, 150, base);

  // A repeatable weave, from the code itself so the same code always looks the
  // same however often this is re-run.
  let seed = [...code].reduce((total, character) => total * 31 + character.charCodeAt(0), 7) >>> 0;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 2600; i += 1) {
    const x = 10 + Math.floor(next() * 240);
    const y = 10 + Math.floor(next() * 150);
    const lift = next() > 0.5 ? 12 : -12;
    canvas.fill(x, y, 2, 1, [
      Math.max(0, Math.min(255, base[0] + lift)),
      Math.max(0, Math.min(255, base[1] + lift)),
      Math.max(0, Math.min(255, base[2] + lift)),
    ]);
  }
  canvas.rect(10, 10, 240, 150, [120, 118, 114], 2);
  canvas.text(12, 172, code, [40, 40, 44], 3);
  return canvas.png();
}
