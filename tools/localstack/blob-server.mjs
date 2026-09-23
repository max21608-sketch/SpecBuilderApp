// A folder standing in for the private Vercel Blob store, for the local stack.
//
// It answers exactly what @vercel/blob 2.8.0 sends, read from its dist rather
// than guessed, and nothing else:
//
//   server   put()   PUT  {api}/?pathname=P            body = the bytes
//            copy()  PUT  {api}?pathname=TO&fromUrl=F
//            head()  GET  {api}?url=P                   JSON metadata, 404 if absent
//            del()   POST {api}/delete                  { urls: [...] }
//            get()   GET  https://<store>.private.blob.vercel-storage.com/P
//                         — a STORE HOST built from the token, never the API
//                         base, so the preload reroutes it to {origin}/store/P
//   browser  upload() asks /api/uploads/token for a client token
//                     (handleUpload runs unchanged in the app, signing with
//                     BLOB_READ_WRITE_TOKEN), then PUTs {api}/?pathname=P with
//                     it — cross-origin, so CORS is answered here
//
// {api} is VERCEL_BLOB_API_URL / NEXT_PUBLIC_VERCEL_BLOB_API_URL, which the SDK
// reads in both places. The SDK's own request headers carry the options:
// x-vercel-blob-access, x-content-type, x-add-random-suffix, x-allow-overwrite.
//
// A client token is checked the way the store checks it — HMAC against the
// read-write token, expiry, pathname, content type, size — because the upload
// token route's project scoping is only worth anything if the store refuses a
// pathname the token did not sign.
//
// Bytes live under BLOB_DIR/files/<pathname>, metadata beside them under
// BLOB_DIR/meta/<pathname>.json. BLOB_DIR is outside the repo
// (~/dev/localstack/blob by default): these are copies of real client
// documents and must never be committed.
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export function blobDir(env = process.env) {
  return env.LOCAL_BLOB_DIR || path.join(os.homedir(), "dev", "localstack", "blob");
}

function cleanPathname(raw) {
  const clean = String(raw ?? "").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\") || clean.includes("//") || clean.includes("\0")) {
    return null;
  }
  return clean;
}

/** A stored `url` or a bare pathname → the pathname. Only our own store's host. */
function pathnameOf(urlOrPathname, storeId) {
  if (/^https?:\/\//i.test(urlOrPathname)) {
    let parsed;
    try {
      parsed = new URL(urlOrPathname);
    } catch {
      return null;
    }
    if (!parsed.hostname.startsWith(`${storeId}.`) || !parsed.hostname.endsWith(".blob.vercel-storage.com")) return null;
    return cleanPathname(decodeURIComponent(parsed.pathname));
  }
  return cleanPathname(urlOrPathname);
}

function storeUrl(storeId, access, pathname) {
  return `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}`;
}

const TYPES = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".json": "application/json",
};

function guessType(pathname) {
  return TYPES[path.extname(pathname).toLowerCase()] ?? "application/octet-stream";
}

// Vercel inserts the suffix before the extension: `S-301.pdf` → `S-301-<suffix>.pdf`.
function withRandomSuffix(pathname) {
  const ext = path.extname(pathname);
  const base = ext ? pathname.slice(0, -ext.length) : pathname;
  return `${base}-${randomBytes(15).toString("base64url").replace(/[-_]/g, "x").slice(0, 21)}${ext}`;
}

function blobError(status, code, message) {
  return { status, body: { error: { code, message } } };
}

export function createBlobStore({ dir, storeId, readWriteToken }) {
  const filesDir = path.join(dir, "files");
  const metaDir = path.join(dir, "meta");
  const filePath = (p) => path.join(filesDir, p);
  const metaPath = (p) => path.join(metaDir, `${p}.json`);

  async function readMeta(pathname) {
    try {
      return JSON.parse(await readFile(metaPath(pathname), "utf8"));
    } catch {
      return null;
    }
  }

  function describe(meta) {
    const url = storeUrl(storeId, meta.access, meta.pathname);
    return {
      url,
      downloadUrl: `${url}?download=1`,
      pathname: meta.pathname,
      size: meta.size,
      contentType: meta.contentType,
      contentDisposition: `attachment; filename="${path.basename(meta.pathname)}"`,
      cacheControl: "public, max-age=2592000",
      uploadedAt: meta.uploadedAt,
      etag: meta.etag,
    };
  }

  // ---- auth -------------------------------------------------------------

  function checkReadWrite(authorization) {
    const token = String(authorization ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(token);
    const b = Buffer.from(readWriteToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** The payload of a client token this store signed, or an error response. */
  function clientTokenPayload(authorization) {
    const token = String(authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token.startsWith(`vercel_blob_client_${storeId}_`)) return { error: blobError(403, "forbidden", "Not a client token for this store.") };
    const encoded = token.slice(`vercel_blob_client_${storeId}_`.length);
    const [signature, payload] = Buffer.from(encoded, "base64").toString().split(".");
    if (!signature || !payload) return { error: blobError(403, "forbidden", "Malformed client token.") };
    const expected = createHmac("sha256", readWriteToken).update(payload).digest("hex");
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
      return { error: blobError(403, "forbidden", "Client token signature does not match.") };
    }
    const parsed = JSON.parse(Buffer.from(payload, "base64").toString());
    if (typeof parsed.validUntil === "number" && Date.now() > parsed.validUntil) {
      return { error: blobError(403, "client_token_expired", "Token expired") };
    }
    return { payload: parsed };
  }

  // ---- operations -------------------------------------------------------

  async function write(pathname, bytes, { access, contentType, addRandomSuffix, allowOverwrite }) {
    let finalPath = addRandomSuffix ? withRandomSuffix(pathname) : pathname;
    finalPath = cleanPathname(finalPath);
    if (!finalPath) return blobError(400, "bad_request", "Invalid pathname.");
    if (!allowOverwrite && (await readMeta(finalPath))) {
      return blobError(400, "bad_request", "This blob already exists, use `allowOverwrite: true` if you want to overwrite it.");
    }
    await mkdir(path.dirname(filePath(finalPath)), { recursive: true });
    await mkdir(path.dirname(metaPath(finalPath)), { recursive: true });
    await writeFile(filePath(finalPath), bytes);
    const meta = {
      pathname: finalPath,
      access: access === "public" ? "public" : "private",
      contentType: contentType || guessType(finalPath),
      size: bytes.byteLength,
      uploadedAt: new Date().toISOString(),
      etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
    };
    await writeFile(metaPath(finalPath), JSON.stringify(meta));
    return { status: 200, body: describe(meta) };
  }

  /**
   * One API request. `url` is a URL object for the request, `headers` lower-cased,
   * `readBody` a function returning the bytes.
   */
  async function handleApi(method, url, headers, readBody) {
    const params = url.searchParams;
    const isDelete = url.pathname.endsWith("/delete");

    // put / upload / copy
    if (method === "PUT") {
      const pathname = cleanPathname(params.get("pathname"));
      if (!pathname) return blobError(400, "bad_request", "pathname is required.");
      const fromUrl = params.get("fromUrl");
      const access = headers["x-vercel-blob-access"] ?? "private";
      const flag = (name) => (headers[name] === undefined ? undefined : headers[name] === "1");

      if (checkReadWrite(headers.authorization)) {
        if (fromUrl !== null) {
          const from = pathnameOf(fromUrl, storeId);
          const meta = from ? await readMeta(from) : null;
          if (!meta) return blobError(404, "not_found", "The source blob does not exist.");
          const bytes = await readFile(filePath(from));
          return write(pathname, bytes, {
            access,
            contentType: headers["x-content-type"] || meta.contentType,
            addRandomSuffix: flag("x-add-random-suffix") ?? false,
            allowOverwrite: flag("x-allow-overwrite") ?? false,
          });
        }
        return write(pathname, await readBody(), {
          access,
          contentType: headers["x-content-type"],
          addRandomSuffix: flag("x-add-random-suffix") ?? false,
          allowOverwrite: flag("x-allow-overwrite") ?? false,
        });
      }

      // A browser upload, under a client token the app's token route signed.
      const { payload, error } = clientTokenPayload(headers.authorization);
      if (error) return error;
      if (fromUrl !== null) return blobError(403, "client_token_not_allowed", "copy is not available with a client token.");
      if (payload.pathname !== pathname) {
        return blobError(400, "bad_request", `The "pathname" ${pathname} does not match the token payload.`);
      }
      const contentType = headers["x-content-type"] || guessType(pathname);
      const allowed = payload.allowedContentTypes;
      if (Array.isArray(allowed) && allowed.length > 0) {
        const ok = allowed.some((t) =>
          t.endsWith("/*") ? contentType.startsWith(t.slice(0, -1)) : t === contentType.split(";")[0].trim(),
        );
        if (!ok) return blobError(400, "bad_request", `contentType ${contentType} is not allowed`);
      }
      const bytes = await readBody();
      if (typeof payload.maximumSizeInBytes === "number" && bytes.byteLength > payload.maximumSizeInBytes) {
        return blobError(400, "file_too_large", `the file length cannot be greater than ${payload.maximumSizeInBytes} bytes`);
      }
      return write(pathname, bytes, {
        access,
        contentType,
        addRandomSuffix: payload.addRandomSuffix ?? false,
        allowOverwrite: payload.allowOverwrite ?? false,
      });
    }

    if (!checkReadWrite(headers.authorization)) return blobError(403, "forbidden", "A read-write token is required.");

    // head
    if (method === "GET" && params.has("url")) {
      const pathname = pathnameOf(params.get("url"), storeId);
      const meta = pathname ? await readMeta(pathname) : null;
      if (!meta) return blobError(404, "not_found", "The requested blob does not exist");
      return { status: 200, body: describe(meta) };
    }

    // del
    if (method === "POST" && isDelete) {
      const body = JSON.parse((await readBody()).toString() || "{}");
      for (const u of body.urls ?? []) {
        const pathname = pathnameOf(u, storeId);
        if (!pathname) continue;
        await rm(filePath(pathname), { force: true });
        await rm(metaPath(pathname), { force: true });
      }
      return { status: 200, body: {} };
    }

    return blobError(400, "bad_request", `The local blob store does not implement ${method} ${url.pathname}${url.search}.`);
  }

  /** A private read, rerouted here from the store host. Honours Range. */
  async function handleRead(pathnameRaw, headers) {
    if (!checkReadWrite(headers.authorization)) return { status: 403, headers: {}, body: "Forbidden" };
    const pathname = cleanPathname(decodeURIComponent(pathnameRaw));
    const meta = pathname ? await readMeta(pathname) : null;
    if (!meta) return { status: 404, headers: {}, body: "Not found" };
    const size = (await stat(filePath(pathname))).size;
    const base = {
      "content-type": meta.contentType,
      "accept-ranges": "bytes",
      etag: meta.etag,
      "last-modified": new Date(meta.uploadedAt).toUTCString(),
      "cache-control": "private, no-cache",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(headers.range ?? "");
    if (range && (range[1] !== "" || range[2] !== "")) {
      let start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      let end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
      if (start > end || start >= size) {
        return { status: 416, headers: { "content-range": `bytes */${size}` }, body: "" };
      }
      return {
        status: 206,
        headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` },
        stream: createReadStream(filePath(pathname), { start, end }),
      };
    }
    return {
      status: 200,
      headers: { ...base, "content-length": String(size) },
      stream: createReadStream(filePath(pathname)),
    };
  }

  return { handleApi, handleRead };
}
