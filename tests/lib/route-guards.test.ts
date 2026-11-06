// The write boundary is the authorisation boundary (audit A16, 2026-11-06).
//
// `WRITER_ROLES` was enforced by the middleware's matcher alone, and no route
// handler asked for a role. These tests read EVERY route file under
// src/app/api and fail on:
//   - a write handler (POST / PATCH / PUT / DELETE) that does not call
//     `requireWriter`, unless the route is one of the deliberate public or
//     session-free exceptions named below;
//   - a dynamic route whose path id reaches the handler without `requireUuid`.
// so the next route cannot forget either. And the two helpers themselves.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isUuid, requireUuid, requireWriter } from "@/lib/route-guards";

const API = join(process.cwd(), "src/app/api");

function routeFiles(dir = API): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

/**
 * Write handlers that must NOT ask for a writer, each for a stated reason.
 * Adding to this list is a decision to let a request write without a writer's
 * session, and it should read like one.
 */
const NOT_A_WRITER_ROUTE: Record<string, string> = {
  "auth/login/route.ts": "the way in: there is no session yet",
  "auth/logout/route.ts": "a view-only account must still be able to sign out",
  "queues/[topic]/route.ts": "a queue consumer, authenticated by the queue's own signed protocol",
  "graph/notifications/route.ts": "Microsoft Graph, authenticated by clientState and a known subscription",
};

/** The body of each exported write handler: from its `export` to the next top-level `export`. */
function writeHandlers(source: string): { method: string; body: string }[] {
  const pattern = /^export (?:async )?function (POST|PATCH|PUT|DELETE)\b/gm;
  const starts = [...source.matchAll(pattern)];
  return starts.map((match) => {
    const from = match.index ?? 0;
    const next = source.slice(from + 1).search(/^export /m);
    return { method: match[1]!, body: next === -1 ? source.slice(from) : source.slice(from, from + 1 + next) };
  });
}

const files = routeFiles();

describe("every write handler asks for a writer", () => {
  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  const writers = files.flatMap((file) => {
    const name = relative(API, file);
    return writeHandlers(readFileSync(file, "utf8")).map((handler) => ({ name, ...handler }));
  });

  it("finds the write handlers (58 when this was written)", () => {
    expect(writers.length).toBeGreaterThanOrEqual(58);
  });

  it.each(writers.filter((handler) => !(handler.name in NOT_A_WRITER_ROUTE)))(
    "$name $method calls requireWriter",
    ({ body }) => {
      expect(body).toMatch(/\brequireWriter\(user\)/);
    },
  );

  it("names only exceptions that exist", () => {
    for (const name of Object.keys(NOT_A_WRITER_ROUTE)) {
      expect(files.map((file) => relative(API, file))).toContain(name);
    }
  });
});

describe("every path id is checked before it reaches SQL", () => {
  /** Path segments that are not ids: an index into a list, a queue topic. */
  const NOT_AN_ID = new Set(["index", "topic"]);

  const dynamic = files
    .map((file) => ({ name: relative(API, file), source: readFileSync(file, "utf8") }))
    .flatMap(({ name, source }) =>
      [...source.matchAll(/const \{ ([^}]+) \} = await context\.params;\n([^\n]*)\n([^\n]*)/g)].map((match) => ({
        name,
        locals: match[1]!
          .split(",")
          .map((part) => part.trim().split(":"))
          .filter(([key]) => !NOT_AN_ID.has(key!.trim()))
          .map((pair) => (pair[1] ?? pair[0])!.trim()),
        after: `${match[2]}\n${match[3]}`,
      })),
    );

  it("finds the dynamic handlers", () => {
    expect(dynamic.length).toBeGreaterThan(60);
  });

  it.each(dynamic)("$name checks $locals", ({ locals, after }) => {
    expect(after).toContain(`requireUuid(${locals.join(", ")})`);
  });

  it("finds every params destructure the check above reads", () => {
    // A handler that reads its params some other way would escape the table.
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const reads = (source.match(/context\.params/g) ?? []).length;
      const destructures = (source.match(/const \{ [^}]+ \} = await context\.params;/g) ?? []).length;
      expect(reads, relative(API, file)).toBe(destructures);
    }
  });
});

describe("requireWriter", () => {
  it("lets an editor and an admin through", () => {
    expect(requireWriter({ role: "editor" })).toBeNull();
    expect(requireWriter({ role: "admin" })).toBeNull();
  });

  it("refuses a viewer, a mis-cased or unknown role, and no session at all", async () => {
    for (const role of ["viewer", "Viewer", "Editor", "", "owner"]) {
      const response = requireWriter({ role });
      expect(response?.status, role).toBe(403);
      expect(((await response!.json()) as { error: string }).error).toMatch(/view-only/);
    }
    expect(requireWriter(null)?.status).toBe(401);
  });
});

describe("requireUuid", () => {
  it("accepts ids and refuses anything else in words", async () => {
    expect(requireUuid("11111111-2222-4333-8444-555555555555")).toBeNull();
    expect(isUuid("11111111-2222-4333-8444-555555555555")).toBe(true);
    for (const bad of ["abc", "", "11111111-2222-4333-8444-55555555555", "1' or '1'='1"]) {
      const response = requireUuid("11111111-2222-4333-8444-555555555555", bad);
      expect(response?.status, bad).toBe(400);
      expect(((await response!.json()) as { error: string }).error).toMatch(/does not point at anything/);
    }
  });
});
