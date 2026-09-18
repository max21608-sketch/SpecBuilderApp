// A very small raster canvas that writes a PNG, with no dependency beyond
// node:zlib.
//
// WHY THIS EXISTS. The demo project needs pictures — an item picture on every
// record, a swatch on every finish — and the app gets those from a person
// cropping a PDF page in the browser. A demo cannot wait for that, and there
// is no image library in this repo (see docs/stack.md on what the app
// deliberately lacks). So the demo DRAWS its own: a few hundred lines of
// rectangles, lines and a 5x7 font, encoded as a PNG by hand.
//
// It is deliberately crude. These are invented pictures of invented furniture
// for a walkthrough; anything more would be a graphics library nobody asked
// for, sitting in a repo that has managed without one.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export type Rgb = [number, number, number];

/** A 5x7 bitmap font. Each glyph is seven rows, five bits wide, MSB left. */
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 21, 19, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  "/": [1, 1, 2, 4, 8, 16, 16],
  " ": [0, 0, 0, 0, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "+": [0, 4, 4, 31, 4, 4, 0],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ",": [0, 0, 0, 0, 12, 4, 8],
  "'": [12, 4, 8, 0, 0, 0, 0],
};

export class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number, background: Rgb = [255, 255, 255]) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, background);
  }

  private set(x: number, y: number, colour: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.pixels[i] = colour[0];
    this.pixels[i + 1] = colour[1];
    this.pixels[i + 2] = colour[2];
  }

  fill(x: number, y: number, w: number, h: number, colour: Rgb): void {
    for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, colour);
  }

  /** A rectangle outline `weight` pixels thick, drawn inside the bounds. */
  rect(x: number, y: number, w: number, h: number, colour: Rgb, weight = 2): void {
    this.fill(x, y, w, weight, colour);
    this.fill(x, y + h - weight, w, weight, colour);
    this.fill(x, y, weight, h, colour);
    this.fill(x + w - weight, y, weight, h, colour);
  }

  line(x0: number, y0: number, x1: number, y1: number, colour: Rgb, weight = 2): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      this.fill(x - ((weight / 2) | 0), y - ((weight / 2) | 0), weight, weight, colour);
    }
  }

  /** A filled rounded rectangle, which is what most of this furniture is. */
  rounded(x: number, y: number, w: number, h: number, r: number, colour: Rgb): void {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) {
        const cx = dx < r ? r - dx : dx >= w - r ? dx - (w - r - 1) : 0;
        const cy = dy < r ? r - dy : dy >= h - r ? dy - (h - r - 1) : 0;
        if (cx * cx + cy * cy > r * r) continue;
        this.set(x + dx, y + dy, colour);
      }
    }
  }

  text(x: number, y: number, value: string, colour: Rgb, scale = 2): void {
    let cursor = x;
    for (const character of value.toUpperCase()) {
      const glyph = FONT[character] ?? FONT[" "]!;
      for (let row = 0; row < 7; row += 1) {
        const bits = glyph[row] ?? 0;
        for (let column = 0; column < 5; column += 1) {
          if (!(bits & (1 << (4 - column)))) continue;
          this.fill(cursor + column * scale, y + row * scale, scale, scale, colour);
        }
      }
      cursor += 6 * scale;
    }
  }

  /** Width in pixels that `text` will occupy at `scale`. */
  static textWidth(value: string, scale = 2): number {
    return value.length * 6 * scale;
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      const offset = y * (this.width * 3 + 1);
      raw[offset] = 0; // filter: none
      Buffer.from(this.pixels.buffer, y * this.width * 3, this.width * 3).copy(raw, offset + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: truecolour
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", new Uint8Array(0)),
    ]);
  }
}
