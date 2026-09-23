// The local stack's one HTTP server: the blob store and the SQL-over-HTTP
// endpoint on one port (LOCAL_STACK_PORT, default 3101).
//
//   POST /sql        neon() queries          → tools/localstack/neon-http.mjs
//   *    /api...     the Vercel Blob API     → tools/localstack/blob-server.mjs
//   GET  /store/P    a private blob read     → tools/localstack/blob-server.mjs
//
// Run on its own with `node --env-file=.env.localstack.local tools/localstack/server.mjs`,
// or through `npm run dev:local` / `npm run checks:local`, which start it for you.
import http from "node:http";
import { fileURLToPath } from "node:url";
import { assertLocalStack, localStoreId, stackPort } from "./guard.mjs";
import { handleSql, closeSqlPools } from "./neon-http.mjs";
import { blobDir, createBlobStore } from "./blob-server.mjs";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cors(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export async function startStackServer(env = process.env) {
  assertLocalStack("the local stack server", env);
  const port = stackPort(env);
  const store = createBlobStore({
    dir: blobDir(env),
    storeId: localStoreId(env),
    readWriteToken: env.BLOB_READ_WRITE_TOKEN,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const extra = cors(req);
    const sendJson = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", ...extra });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, extra);
        res.end();
        return;
      }
      if (url.pathname === "/sql" && req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const { status, body: out } = await handleSql(req.headers, body);
        sendJson(status, out);
        return;
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        const { status, body } = await store.handleApi(req.method, url, req.headers, () => readBody(req));
        sendJson(status, body);
        return;
      }
      if (url.pathname.startsWith("/store/") && req.method === "GET") {
        const out = await store.handleRead(url.pathname.slice("/store/".length), req.headers);
        res.writeHead(out.status, { ...out.headers, ...extra });
        if (out.stream) out.stream.pipe(res);
        else res.end(out.body ?? "");
        return;
      }
      if (url.pathname === "/health") {
        sendJson(200, { ok: true });
        return;
      }
      sendJson(404, { error: { code: "not_found", message: `Nothing at ${req.method} ${url.pathname}` } });
    } catch (error) {
      console.error("[localstack]", req.method, url.pathname, error);
      if (!res.headersSent) sendJson(500, { error: { code: "internal_server_error", message: String(error?.message ?? error) } });
      else res.end();
    }
  });

  // Loopback only, on both families: the browser is sent to `localhost`
  // (see .env.localstack.example), which may resolve to ::1 first.
  const servers = [server];
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const v6 = http.createServer((req, res) => server.emit("request", req, res));
  await new Promise((resolve) => {
    v6.once("error", () => resolve()); // no IPv6 loopback: the IPv4 one is enough
    v6.listen(port, "::1", () => {
      servers.push(v6);
      resolve();
    });
  });

  return {
    port,
    async close() {
      await Promise.all(servers.map((s) => new Promise((resolve) => s.close(() => resolve()))));
      await closeSqlPools();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startStackServer();
  console.log(`[localstack] blob store and SQL endpoint on http://127.0.0.1:${port} (files under ${blobDir()})`);
}
