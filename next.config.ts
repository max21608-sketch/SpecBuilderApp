import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // NO `serverExternalPackages: ["pdfjs-dist"]`, deliberately, and the reason
  // is the opposite of what it looks like.
  //
  // The chassis carried that entry for an app that reads PDFs ON THE SERVER:
  // pdfjs's legacy Node build resolves its worker relative to its own location,
  // and once a bundler rewrites it into a vendor chunk that path is gone —
  // "Setting up fake worker failed", at runtime, in production only.
  //
  // This app reads PDFs in the BROWSER instead (see src/lib/pdf-crop.ts for
  // why), and marking the package external breaks exactly that: webpack then
  // refuses `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`
  // with "ESM packages need to be imported", because an external cannot be
  // resolved to an emitted asset.
  //
  // So: PUT IT BACK the moment anything reads a PDF server-side, and expect to
  // need a different worker strategy for the client at the same time. The two
  // uses cannot share one setting.
};

export default nextConfig;
