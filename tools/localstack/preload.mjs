// Loaded into every Node process of the local stack with
// `NODE_OPTIONS=--import=./tools/localstack/preload.mjs` — next dev, its
// workers, and the vitest forks — so the app runs against local services with
// NO CHANGE TO APP CODE. Two SDKs hard-code an https host that no local
// service can answer, and this reroutes exactly those two:
//
//   https://localhost/sql
//       neon() 0.10 POSTs every query here when DATABASE_URL's host is
//       `localhost` (it prefixes `api.` only to a host with a dot).
//       → http://127.0.0.1:<LOCAL_STACK_PORT>/sql
//   https://<localstack store>.private.blob.vercel-storage.com/<pathname>
//       @vercel/blob's get() builds the store host from the token's store id
//       and ignores VERCEL_BLOB_API_URL, which covers every other call.
//       → http://127.0.0.1:<LOCAL_STACK_PORT>/store/<pathname>
//
// And it REFUSES, rather than forwards, anything bound for a company system a
// local run has no business touching: a neon.tech database, any other blob
// store, the Vercel queue and API, Microsoft Graph, Capsule. A local stack that
// quietly reached the sandbox would be the one failure it exists to prevent.
// Anthropic is allowed: a model read is the point of running a pack locally.
//
// How: both SDKs end in undici, and undici — Node's built-in fetch and the
// userland copy @vercel/blob imports alike — sends through the dispatcher at
// globalThis[Symbol.for("undici.globalDispatcher.1")]. Node installs its own
// Agent there on the first fetch (a `data:` one, which touches no network);
// this wraps that Agent's dispatch(). The slot is writable and NOT configurable
// once Node has set it, so it is assigned, never redefined.
import { assertLocalStack, localStoreId, stackPort } from "./guard.mjs";

assertLocalStack("the local-stack preload");

const port = stackPort();
const storeHost = `${localStoreId()}.private.blob.vercel-storage.com`;
const LOCAL_ORIGIN = `http://127.0.0.1:${port}`;

const REFUSED = [
  /\.neon\.tech$/i,
  /\.blob\.vercel-storage\.com$/i,
  /(^|\.)vercel\.com$/i,
  /(^|\.)vercel-queue\.com$/i,
  /(^|\.)vercel\.app$/i,
  /(^|\.)graph\.microsoft\.com$/i,
  /(^|\.)login\.microsoftonline\.com$/i,
  /(^|\.)capsulecrm\.com$/i,
  /(^|\.)whistlercloud\.com$/i,
];

await fetch("data:,"); // make Node install its global Agent
const KEY = Symbol.for("undici.globalDispatcher.1");
const inner = globalThis[KEY];
if (!inner || typeof inner.dispatch !== "function") {
  throw new Error("local-stack preload: no global undici dispatcher to wrap.");
}

function reroute(opts) {
  const origin = new URL(String(opts.origin));
  const host = origin.host.toLowerCase();
  if (origin.protocol === "https:" && (host === "localhost" || host === "localhost:443") && String(opts.path).startsWith("/sql")) {
    return { ...opts, origin: LOCAL_ORIGIN };
  }
  if (origin.protocol === "https:" && origin.hostname.toLowerCase() === storeHost) {
    return { ...opts, origin: LOCAL_ORIGIN, path: `/store${opts.path}`, headers: opts.headers };
  }
  if (REFUSED.some((re) => re.test(origin.hostname))) {
    throw new Error(`local stack: refusing a request to ${origin.hostname} — company systems are not reachable from the local stack.`);
  }
  return opts;
}

const wrapped = new Proxy(inner, {
  get(target, prop) {
    if (prop === "dispatch") {
      return (opts, handler) => target.dispatch(reroute(opts), handler);
    }
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

globalThis[KEY] = wrapped;
