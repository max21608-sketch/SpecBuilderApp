// One Content-Disposition, in the RFC 6266 / 5987 form (audit A6, 2026-11-06).
//
// `Headers` takes a ByteString, so a header value holding any character above
// U+00FF THROWS. Five routes put a stored filename into `filename="…"` with
// only quotes, backslashes and CR/LF stripped, so `Ronnie Scott’s – Drawings.pdf`
// (a curly apostrophe and an en dash, the real pack's own name) could never be
// opened from the review: the source route answered 502, the attachment route
// a bare 500, and every "page N" provenance link on that document was dead.
//
// What is proved: the header value is a legal ByteString for every name, so
// `new Headers` accepts it; the plain `filename` is an ASCII fallback built by
// the ONE allowlist the exports already used; `filename*` carries the real name
// percent-encoded as UTF-8, and decodes back to it.
import { describe, expect, it } from "vitest";
import { asciiFilenamePart, contentDisposition } from "@/lib/content-disposition";

const NAMES = [
  "Ronnie Scott’s – Drawings.pdf",
  "仕様書 (改訂B).pdf",
  "Sofa \u{1F6CB}️ final.xlsx",
  "Résumé — “Bouclé” swatch.png",
];

function filenameStar(header: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1];
  if (!encoded) throw new Error(`no filename* in ${header}`);
  return decodeURIComponent(encoded);
}

describe("contentDisposition", () => {
  it.each(NAMES)("is a legal header for %s, and carries the name exactly", (name) => {
    const header = contentDisposition("attachment", name);
    expect(() => new Headers({ "content-disposition": header })).not.toThrow();
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(filenameStar(header)).toBe(name);
  });

  it("gives an ASCII fallback that keeps the extension", () => {
    expect(contentDisposition("inline", "Ronnie Scott’s – Drawings.pdf")).toBe(
      "inline; filename=\"Ronnie Scotts - Drawings.pdf\"; filename*=UTF-8''Ronnie%20Scott%E2%80%99s%20%E2%80%93%20Drawings.pdf",
    );
    expect(contentDisposition("attachment", "仕様書.pdf")).toMatch(/^attachment; filename="download\.pdf";/);
  });

  it("cannot be broken out of: quotes, backslashes, newlines and path separators", () => {
    const header = contentDisposition("attachment", 'a"b\\c\r\nX-Evil: 1/../d.eml');
    expect(() => new Headers({ "content-disposition": header })).not.toThrow();
    expect(header).not.toMatch(/[\r\n]/);
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
    expect(fallback).not.toMatch(/["\\/]/);
    expect(filenameStar(header)).not.toMatch(/[\r\n/\\]/);
  });

  it("is the bare disposition with no name", () => {
    expect(contentDisposition("inline")).toBe("inline");
    expect(contentDisposition("attachment", "   ")).toBe("attachment");
  });
});

describe("asciiFilenamePart", () => {
  // The one allowlist: the exports, the check sheet, the costing sheet, the
  // quote and the chase .eml all used `[^A-Za-z0-9 &-]`, written five times.
  it("is the exports' allowlist, with typographic dashes and accents folded first", () => {
    expect(asciiFilenamePart('Main "run"\r\n/etc')).toBe("Main runetc");
    expect(asciiFilenamePart("Café – Lounge")).toBe("Cafe - Lounge");
    expect(asciiFilenamePart("x".repeat(100))).toHaveLength(60);
  });
});

// Five routes each wrote their own `filename="${…}"`, which is how the A6 throw
// came to be in three of them. Every route that sets the header now builds it
// here, and this keeps the next route from writing a sixth.
describe("every route builds the header with contentDisposition", () => {
  it("has no hand-written content-disposition value under src/app/api", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts")) files.push(path);
      }
    };
    walk(join(process.cwd(), "src/app/api"));
    const offenders = files.filter((file) =>
      /["']content-disposition["']\s*:(?!\s*contentDisposition\()/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(50);
  });
});
