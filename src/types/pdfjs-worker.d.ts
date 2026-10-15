// pdfjs ships no types for its worker module. `pdf-bill.ts` imports it only
// to hand it to pdfjs as the fake worker on the server, and reads nothing off it.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
