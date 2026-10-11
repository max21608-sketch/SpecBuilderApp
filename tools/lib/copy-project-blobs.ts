// The file half of `tools/copy-project.ts`: copy each stored file from one
// private Blob store to another at the SAME pathname, so the copied rows'
// `storage_path` values need no change.
//
// Three rules, each one somebody would otherwise relax:
//
// - A file is addressed by PATHNAME, never by a URL taken from data. The store
//   resolves a pathname against its own host from its own token
//   (`src/lib/blob-source.ts`, "Never fetch a client-supplied URL with a store
//   credential"). The pathnames here come off the source's own rows and were
//   scope-checked by `collectFiles` before they reach this file.
// - Idempotent, never overwriting. A pathname already on the target with the
//   same size is skipped, so a run that died half way is simply run again. A
//   pathname already there with a DIFFERENT size is a refusal: it is some
//   other file, and `allowOverwrite: false` would refuse it at the store
//   anyway.
// - A missing source file is reported, not fatal (`--strict` makes it fatal).
//   A row whose file has gone is still the row the project held, and stopping
//   a whole copy over one lost picture would leave the project behind for the
//   sake of the picture.
//
// The tokens never leave this module's arguments. Neither is printed, logged
// or written anywhere; an error message from the SDK is reported by its
// message alone, which carries no token.
import { get, head, put, BlobNotFoundError } from "@vercel/blob";

export type StoredFile = { size: number; contentType: string };

export interface BlobStore {
  /** What the person reads in the output: never the token. */
  readonly label: string;
  head(pathname: string): Promise<StoredFile | null>;
  read(pathname: string): Promise<{ bytes: Buffer; contentType: string }>;
  write(pathname: string, bytes: Buffer, contentType: string): Promise<void>;
}

/** Large enough for any drawing set this app accepts; a file past it is a refusal, not a buffer. */
const MAX_FILE_BYTES = 512 * 1024 * 1024;

/**
 * A Vercel Blob store (or the local stack's stand-in) through the app's own
 * SDK. `apiUrl` is the store's API base when it is not Vercel's own -- the
 * local stack sets `VERCEL_BLOB_API_URL` -- and the SDK reads that variable
 * AT CALL TIME, so it is set around each call and restored after. That is
 * safe only because every call here is awaited one at a time; nothing in
 * this module runs two calls at once, and nothing may.
 */
export function vercelBlobStore({ label, token, apiUrl }: { label: string; token: string; apiUrl: string | null }): BlobStore {
  const withApi = async <T>(fn: () => Promise<T>): Promise<T> => {
    const saved = {
      api: process.env.VERCEL_BLOB_API_URL,
      publicApi: process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL,
    };
    const set = (name: "VERCEL_BLOB_API_URL" | "NEXT_PUBLIC_VERCEL_BLOB_API_URL", value: string | undefined | null) => {
      if (value) process.env[name] = value;
      else delete process.env[name];
    };
    set("VERCEL_BLOB_API_URL", apiUrl);
    set("NEXT_PUBLIC_VERCEL_BLOB_API_URL", apiUrl);
    try {
      return await fn();
    } finally {
      set("VERCEL_BLOB_API_URL", saved.api);
      set("NEXT_PUBLIC_VERCEL_BLOB_API_URL", saved.publicApi);
    }
  };

  return {
    label,
    head: (pathname) =>
      withApi(async () => {
        try {
          const meta = await head(pathname, { token });
          return { size: meta.size, contentType: meta.contentType };
        } catch (error) {
          if (error instanceof BlobNotFoundError) return null;
          throw error;
        }
      }),
    read: (pathname) =>
      withApi(async () => {
        const result = await get(pathname, { access: "private", token });
        if (!result || result.statusCode !== 200 || !result.stream) throw new Error(`${label}: ${pathname} could not be read.`);
        const chunks: Uint8Array[] = [];
        let total = 0;
        const reader = result.stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > MAX_FILE_BYTES) {
            await reader.cancel().catch(() => {});
            throw new Error(`${label}: ${pathname} is larger than ${MAX_FILE_BYTES} bytes.`);
          }
          chunks.push(value);
        }
        return { bytes: Buffer.concat(chunks), contentType: result.blob.contentType || "application/octet-stream" };
      }),
    write: (pathname, bytes, contentType) =>
      withApi(async () => {
        await put(pathname, bytes, {
          access: "private",
          token,
          contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
      }),
  };
}

export type CopyOutcome = {
  copied: string[];
  skipped: string[];
  missing: string[];
  refused: string[];
  bytesCopied: number;
};

/** Copy each pathname, one at a time, source to target. */
export async function copyFiles(
  source: BlobStore,
  target: BlobStore,
  pathnames: string[],
  log: (line: string) => void = () => {},
): Promise<CopyOutcome> {
  const outcome: CopyOutcome = { copied: [], skipped: [], missing: [], refused: [], bytesCopied: 0 };
  for (const pathname of pathnames) {
    const from = await source.head(pathname);
    if (!from) {
      outcome.missing.push(pathname);
      log(`  missing on ${source.label}: ${pathname}`);
      continue;
    }
    const already = await target.head(pathname);
    if (already) {
      if (already.size === from.size) {
        outcome.skipped.push(pathname);
        continue;
      }
      outcome.refused.push(pathname);
      log(`  REFUSED ${pathname}: ${target.label} already holds a different file there (${already.size} bytes, the source's is ${from.size}).`);
      continue;
    }
    const { bytes, contentType } = await source.read(pathname);
    if (bytes.byteLength !== from.size) {
      outcome.refused.push(pathname);
      log(`  REFUSED ${pathname}: read ${bytes.byteLength} bytes where ${source.label} reports ${from.size}.`);
      continue;
    }
    await target.write(pathname, bytes, contentType || from.contentType);
    outcome.copied.push(pathname);
    outcome.bytesCopied += bytes.byteLength;
    log(`  copied ${pathname} (${bytes.byteLength} bytes)`);
  }
  return outcome;
}
