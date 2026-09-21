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
};

export function buildPdf(pages: SyntheticPage[]): Buffer;
export function buildPdfOfPages(count: number, options?: Omit<SyntheticPage, "label">): Buffer;
