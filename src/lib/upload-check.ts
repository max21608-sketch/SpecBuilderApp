// The upload screen's check on one chosen file, BEFORE a byte of it is stored.
//
// Browser only: it counts pages with pdfjs (`countPdfPagesInBrowser`). The
// numbers and the words are `upload-limits.ts`, a leaf the server checks read
// too. A file that is not a PDF is never counted, a PDF over the byte cap is
// refused without being opened, and a count that fails means PROCEED.
import { countPdfPagesInBrowser } from "@/lib/pdf-crop";
import { isPdfUpload, pdfUploadVerdict, type UploadVerdict } from "@/lib/upload-limits";

export async function checkUpload(file: File): Promise<UploadVerdict> {
  if (!isPdfUpload(file.name, file.type)) return { kind: "proceed" };
  const bySize = pdfUploadVerdict({ bytes: file.size, pages: null });
  if (bySize.kind === "refuse") return bySize;
  return pdfUploadVerdict({ bytes: file.size, pages: await countPdfPagesInBrowser(file) });
}
