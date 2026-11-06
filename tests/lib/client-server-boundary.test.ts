// No client component reaches the database driver or the blob store's server
// SDK (audit G5, 2026-11-06). Pure: reads the source tree, runs nothing.
//
// The projects list and the project page imported VALUES from
// `project-summary.ts` and `project-completion.ts`, which import `@/lib/db`
// and through it `@neondatabase/serverless`; seven upload components imported
// `projectUploadPrefix` from `blob-source.ts`, which imports `@vercel/blob`.
// Lazy initialisation was all that kept the browser from crashing.
//
// Neither `db.ts` nor `blob-source.ts` carries `import "server-only"`: the
// package resolves only inside Next's bundler, and tsx scripts under db/ and
// tools/ import both (the backfills Max runs against pilot among them) —
// blob-source carried it for one evening and four backfills failed with
// ERR_MODULE_NOT_FOUND. This walk is the guard for both, and it runs in the
// pure tier on every push rather than only when somebody builds.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

/** Modules a browser bundle must never contain. */
const SERVER_FILES = new Set(["src/lib/db.ts", "src/lib/blob-source.ts"].map((file) => path.join(ROOT, file)));
const SERVER_PACKAGES = new Set(["@neondatabase/serverless", "pg", "@vercel/blob", "server-only"]);

function walk(dir: string, into: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, into);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) into.push(full);
  }
  return into;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * The specifiers a file imports AT RUNTIME. A type-only import is erased by
 * the compiler and puts nothing in a bundle, so it is not followed.
 */
function runtimeImports(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const bare = match[3] ?? match[4];
    if (bare) {
      found.push(bare);
      continue;
    }
    const clause = match[1]!.trim();
    if (clause.startsWith("type ")) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause);
    if (named && named[1]!.split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "))) {
      continue;
    }
    found.push(match[2]!);
  }
  return found;
}

/** The import chain from `file` to a server-only module, or null. */
function chainToServer(file: string, seen = new Map<string, string[] | null>(), visiting = new Set<string>()): string[] | null {
  if (SERVER_FILES.has(file)) return [file];
  if (seen.has(file)) return seen.get(file)!;
  if (visiting.has(file)) return null;
  visiting.add(file);
  let chain: string[] | null = null;
  for (const spec of runtimeImports(file)) {
    if (SERVER_PACKAGES.has(spec)) {
      chain = [file, spec];
      break;
    }
    const next = resolveLocal(file, spec);
    const rest = next ? chainToServer(next, seen, visiting) : null;
    if (rest) {
      chain = [file, ...rest];
      break;
    }
  }
  visiting.delete(file);
  seen.set(file, chain);
  return chain;
}

describe("the client/server boundary", () => {
  const clientFiles = walk(SRC).filter((file) => /^\s*["']use client["']/.test(fs.readFileSync(file, "utf8")));

  it("finds the client components it is meant to check", () => {
    // A walk that found none would pass by checking nothing.
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it("no client component imports the database driver or the blob store's server SDK", () => {
    const seen = new Map<string, string[] | null>();
    const leaks = clientFiles
      .map((file) => chainToServer(file, seen))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map((step) => (path.isAbsolute(step) ? path.relative(ROOT, step) : step)).join(" -> "));
    expect(leaks).toEqual([]);
  });

  it("would see a leak: the walk, pointed at a module that imports db.ts, names the chain", () => {
    expect(chainToServer(path.join(SRC, "lib/project-summary.ts"))).toEqual([
      path.join(SRC, "lib/project-summary.ts"),
      path.join(SRC, "lib/db.ts"),
    ]);
  });
});
