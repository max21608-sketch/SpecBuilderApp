import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // KEEP THIS if the app reads PDFs with pdfjs-dist. Its legacy Node build
  // resolves a worker file relative to its own location, and once the bundler
  // rewrites it into a vendor chunk that path no longer exists -- reading a PDF
  // then fails with "Setting up fake worker failed", at runtime, in production
  // only. Left external, Node resolves it from node_modules as the package
  // expects. Remove the entry (and the dependency) if the app never reads PDFs.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
