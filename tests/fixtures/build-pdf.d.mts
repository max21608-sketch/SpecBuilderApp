// Types for the synthetic PDF builder.
//
// The builder is plain `.mjs` so it can be run from a shell — `node
// tests/fixtures/build-pdf.mjs 120 > /tmp/big.pdf` is how the 120-page case was
// measured — and `tsc --noEmit` covers the tests, so it needs a declaration
// rather than an implicit `any` in two test files.
export type SyntheticPage = {
  width?: number;
  height?: number;
  /** The page's own `/Rotate`, in degrees. Omitted means none. */
  rotate?: number;
  label?: string;
  /**
   * A SCANNED page: it places one image XObject and shows no text, which is
   * what a photographed document looks like inside (§6.10.b).
   */
  image?: boolean;
  /**
   * Deflate the content stream, which is what every real exporter does — so the
   * text operators are NOT legible in the raw bytes.
   */
  compress?: boolean;
  /**
   * A codec this app does not decode (`LZWDecode`), so the content stream is
   * UNREADABLE rather than absent: the "cannot tell" case, which proceeds.
   */
  contentFilter?: string;
};

export function buildPdf(pages: SyntheticPage[]): Buffer;
export function buildPdfOfPages(count: number, options?: Omit<SyntheticPage, "label">): Buffer;
