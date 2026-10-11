// Types for the local stack's Blob stand-in, so a TypeScript test can stand
// one up in-process (`tests/lib/copy-project-blobs.test.ts`). The module is
// plain `.mjs` because the stack server runs under bare `node`, and
// `tsc --noEmit` covers the tests, so it needs a declaration rather than an
// implicit `any`. Only what a test calls is declared.
import type { Readable } from "node:stream";

export function blobDir(env?: Record<string, string | undefined>): string;

export type BlobStoreHandlers = {
  handleApi(
    method: string | undefined,
    url: URL,
    headers: Record<string, string | string[] | undefined>,
    readBody: () => Promise<Buffer>,
  ): Promise<{ status: number; body: unknown }>;
  handleRead(
    pathname: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ status: number; headers: Record<string, string>; body?: string; stream?: Readable }>;
};

export function createBlobStore(options: { dir: string; storeId: string; readWriteToken: string }): BlobStoreHandlers;
