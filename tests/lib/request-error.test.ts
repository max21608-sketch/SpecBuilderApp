// One structured log line per uncaught server error, and never the material
// the error was thrown over (production hardening H4b, 2026-11-20).
import { describe, expect, it, vi } from "vitest";
import { formatRequestError, REQUEST_ERROR_PREFIX, shortReference } from "@/lib/request-error";

const APP_ROUTE = { routePath: "/api/projects/[id]/export", routeType: "route", routerKind: "App Router" };
const REQUEST = { path: "/api/projects/0f0e0d0c-0000-4000-8000-000000000001/export?runId=abc&secret=x", method: "post" };

// What a real failure over client material looks like: a driver error that
// echoes the value that broke a constraint, and a stack naming a file.
function clientMaterialError(): Error {
  const err = new Error('duplicate key value violates unique constraint "x" — Key (name)=(Maybourne SX11A walnut sofa)');
  err.name = "NeonDbError";
  err.stack = "NeonDbError: Maybourne SX11A walnut sofa\n    at confirm (/var/task/src/lib/confirm-boq.ts:1:1)";
  return err;
}

describe("formatRequestError", () => {
  it("is one line with the fixed prefix, the route pattern, method, type and Next's digest", () => {
    const err = Object.assign(clientMaterialError(), { digest: "2817364519" });
    const line = formatRequestError(err, REQUEST, APP_ROUTE, () => "deadbeef");
    expect(line).toBe(
      `${REQUEST_ERROR_PREFIX} ref=2817364519 method=POST route=/api/projects/[id]/export type=route router=app error=NeonDbError`,
    );
    expect(line).not.toContain("\n");
  });

  it("never carries the message, the stack, the concrete path or the query", () => {
    const line = formatRequestError(clientMaterialError(), REQUEST, APP_ROUTE, () => "deadbeef");
    for (const leaked of ["Maybourne", "SX11A", "duplicate key", "confirm-boq", "0f0e0d0c", "runId", "secret"]) {
      expect(line, leaked).not.toContain(leaked);
    }
  });

  it("gives a short reference when Next gives no digest", () => {
    const line = formatRequestError(clientMaterialError(), REQUEST, APP_ROUTE, () => "deadbeef");
    expect(line).toContain("ref=deadbeef");
  });

  it("cannot be made to carry a sentence through the fields it does print", () => {
    const hostile = Object.assign(new Error("x"), {
      name: "Error: client says SX11A walnut\n[request-error] forged",
      digest: "abc def\nforged line",
    });
    const line = formatRequestError(
      hostile,
      { path: "/x", method: "POST\nforged" },
      { routePath: "/api/x?name=Maybourne sofa\nforged", routeType: "route\nx", routerKind: "App Router" },
      () => "deadbeef",
    );
    expect(line).toBe(`${REQUEST_ERROR_PREFIX} ref=deadbeef method=UNKNOWN route=/api/x type=unknown router=app error=unnamed`);
    for (const leaked of ["SX11A", "walnut", "Maybourne", "forged", "\n"]) {
      expect(line, JSON.stringify(leaked)).not.toContain(leaked);
    }
  });

  it("survives a thrown value that is not an Error", () => {
    const line = formatRequestError("a string with SX11A in it", REQUEST, { ...APP_ROUTE, routeType: "render" }, () => "deadbeef");
    expect(line).toMatch(/ref=deadbeef .*type=render router=app error=string$/);
    expect(line).not.toContain("SX11A");
  });

  it("names a render error on a page by its pattern", () => {
    const line = formatRequestError(
      Object.assign(new TypeError("Cannot read properties of undefined (reading 'qty')"), { digest: "991" }),
      { path: "/dashboard/projects/123", method: "GET" },
      { routePath: "/dashboard/projects/[id]", routeType: "render", routerKind: "App Router" },
    );
    expect(line).toBe(`${REQUEST_ERROR_PREFIX} ref=991 method=GET route=/dashboard/projects/[id] type=render router=app error=TypeError`);
  });
});

describe("shortReference", () => {
  it("is eight hex characters from Web Crypto", () => {
    expect(shortReference()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("src/instrumentation.ts", () => {
  it("logs exactly one formatted line per error through console.error", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      const { onRequestError } = await import("@/instrumentation");
      await onRequestError(clientMaterialError(), { ...REQUEST, headers: { cookie: "sb_session=abc" } }, {
        ...APP_ROUTE,
        revalidateReason: undefined,
        routerKind: "App Router",
        routeType: "route",
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[request-error\] ref=[0-9a-f]{8} method=POST route=\/api\/projects\/\[id\]\/export type=route router=app error=NeonDbError$/);
      expect(lines[0]).not.toContain("sb_session");
    } finally {
      spy.mockRestore();
    }
  });
});
