// The file copy of tools/copy-project.ts, run for real against the local
// stack's Blob stand-in -- never against a company store.
//
// Two tiers in one file:
//
// - IN-MEMORY: the copy's rules (same pathname, skip what is already there at
//   the same size, refuse a different file at that pathname, report a missing
//   source file rather than stopping) against two stub stores. Always runs.
// - THE SDK, END TO END: `vercelBlobStore` -- the same @vercel/blob calls the
//   tool makes against a real store -- with a stub source and a TARGET that is
//   `createBlobStore` from tools/localstack/blob-server.mjs, stood up in this
//   process on a free port with its own folder and token. Always runs: it
//   touches nothing but a temporary folder.
// - LOCAL TO LOCAL: under `npm run checks:local` the stack's own store is also
//   used as the SOURCE, so `get()` runs through the preload's reroute exactly
//   as a real private read does. Gated on LOCAL_STACK=1 AND a `localstack`
//   token, so `npm run checks` -- whose env carries the SANDBOX store's token --
//   can never reach it.
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { del, put } from "@vercel/blob";
import { copyFiles, vercelBlobStore, type BlobStore, type StoredFile } from "../../tools/lib/copy-project-blobs";
import { createBlobStore } from "../../tools/localstack/blob-server.mjs";

function memoryStore(label: string, files: Record<string, string> = {}): BlobStore & { files: Map<string, Buffer> } {
  const held = new Map<string, Buffer>(Object.entries(files).map(([p, text]) => [p, Buffer.from(text)]));
  return {
    label,
    files: held,
    async head(pathname): Promise<StoredFile | null> {
      const bytes = held.get(pathname);
      return bytes ? { size: bytes.byteLength, contentType: "image/png" } : null;
    },
    async read(pathname) {
      const bytes = held.get(pathname);
      if (!bytes) throw new Error("no such file");
      return { bytes, contentType: "image/png" };
    },
    async write(pathname, bytes) {
      if (held.has(pathname)) throw new Error("would overwrite");
      held.set(pathname, bytes);
    },
  };
}

const P = "projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("copyFiles (in memory)", () => {
  it("copies at the same pathname, skips what is already there at the same size, reports a missing source file", async () => {
    const source = memoryStore("source", { [`${P}/a.png`]: "aaaa", [`${P}/b.png`]: "bb" });
    const target = memoryStore("target", { [`${P}/b.png`]: "bb" });
    const outcome = await copyFiles(source, target, [`${P}/a.png`, `${P}/b.png`, `${P}/gone.png`]);
    expect(outcome).toEqual({ copied: [`${P}/a.png`], skipped: [`${P}/b.png`], missing: [`${P}/gone.png`], refused: [], bytesCopied: 4 });
    expect(target.files.get(`${P}/a.png`)?.toString()).toBe("aaaa");
  });

  it("refuses, and never overwrites, a DIFFERENT file already at the pathname", async () => {
    const source = memoryStore("source", { [`${P}/a.png`]: "aaaa" });
    const target = memoryStore("target", { [`${P}/a.png`]: "something else" });
    const outcome = await copyFiles(source, target, [`${P}/a.png`]);
    expect(outcome.refused).toEqual([`${P}/a.png`]);
    expect(target.files.get(`${P}/a.png`)?.toString()).toBe("something else");
  });

  it("is idempotent: a second run copies nothing", async () => {
    const source = memoryStore("source", { [`${P}/a.png`]: "aaaa" });
    const target = memoryStore("target");
    await copyFiles(source, target, [`${P}/a.png`]);
    const again = await copyFiles(source, target, [`${P}/a.png`]);
    expect(again.copied).toEqual([]);
    expect(again.skipped).toEqual([`${P}/a.png`]);
  });
});

describe("vercelBlobStore against the local Blob stand-in", () => {
  const storeId = "localstackcopytest";
  const token = `vercel_blob_rw_${storeId}_secretsecret`;
  let dir = "";
  let server: http.Server;
  let apiUrl = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "copy-project-blobs-"));
    const store = createBlobStore({ dir, storeId, readWriteToken: token });
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const readBody = () =>
        new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
      const out = await store.handleApi(req.method, url, req.headers, readBody);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it("writes through the real SDK at the same pathname, then skips it on a second run", async () => {
    const before = process.env.VERCEL_BLOB_API_URL;
    const source = memoryStore("stub source", { [`${P}/bill-images/one.png`]: "png-bytes", [`${P}/doc.pdf`]: "%PDF-1.7" });
    const target = vercelBlobStore({ label: "local target", token, apiUrl });

    expect(await target.head(`${P}/doc.pdf`)).toBeNull();
    const first = await copyFiles(source, target, [`${P}/bill-images/one.png`, `${P}/doc.pdf`]);
    expect(first.copied).toHaveLength(2);
    expect(await target.head(`${P}/doc.pdf`)).toEqual({ size: 8, contentType: expect.any(String) });

    const second = await copyFiles(source, target, [`${P}/bill-images/one.png`, `${P}/doc.pdf`]);
    expect(second.copied).toEqual([]);
    expect(second.skipped).toHaveLength(2);
    // The per-call API override is put back, so nothing else in the process is rerouted.
    expect(process.env.VERCEL_BLOB_API_URL).toBe(before);
  });

  const localStack =
    process.env.LOCAL_STACK === "1" &&
    String(process.env.BLOB_READ_WRITE_TOKEN ?? "").startsWith("vercel_blob_rw_localstack") &&
    Boolean(process.env.VERCEL_BLOB_API_URL);

  it.skipIf(!localStack)("copies from the local stack's own store to another, local to local, through get()", async () => {
    const stackToken = process.env.BLOB_READ_WRITE_TOKEN!;
    const stackApi = process.env.VERCEL_BLOB_API_URL!;
    const pathname = `${P}/__qa-copy-project/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    await put(pathname, "copied through get()", { access: "private", token: stackToken, addRandomSuffix: false, contentType: "text/plain" });
    try {
      const source = vercelBlobStore({ label: "local stack", token: stackToken, apiUrl: stackApi });
      const target = vercelBlobStore({ label: "test store", token, apiUrl });
      const outcome = await copyFiles(source, target, [pathname]);
      expect(outcome.copied).toEqual([pathname]);
      expect(outcome.bytesCopied).toBe("copied through get()".length);
      expect((await target.head(pathname))?.size).toBe("copied through get()".length);
    } finally {
      await del(pathname, { token: stackToken });
    }
  });
});
