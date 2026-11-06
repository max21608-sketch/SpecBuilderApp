// Every response carries the headers that stop the app being framed or
// sniffed, and the full policy is reported before it is enforced (audit A9).
//
// The test reads `next.config.ts` itself, so a config that forgets to wire
// `securityHeaders` in fails here rather than on a deployment.
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { fullContentSecurityPolicy } from "@/lib/security-headers";

async function headersFor(source: string) {
  const rules = (await nextConfig.headers?.()) ?? [];
  const rule = rules.find((entry) => entry.source === source);
  return new Map((rule?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));
}

describe("next.config headers", () => {
  it("applies to every path, and forbids framing, sniffing and leaking a path in the Referer", async () => {
    const headers = await headersFor("/:path*");
    expect(headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("permissions-policy")).toContain("camera=()");
  });

  it("reports the full policy without enforcing it", async () => {
    const headers = await headersFor("/:path*");
    const reported = headers.get("content-security-policy-report-only") ?? "";
    expect(reported).toContain("default-src 'self'");
    expect(reported).toContain("worker-src 'self' blob:");
    expect(headers.get("content-security-policy")).not.toContain("default-src");
  });
});

describe("fullContentSecurityPolicy", () => {
  it("lets the browser-direct upload reach the Blob API, the local stack's included", () => {
    const policy = fullContentSecurityPolicy({ NEXT_PUBLIC_VERCEL_BLOB_API_URL: "http://localhost:3199/api/blob" });
    expect(policy).toMatch(/connect-src 'self' https:\/\/vercel\.com https:\/\/\*\.blob\.vercel-storage\.com http:\/\/localhost:3199/);
  });

  it("allows eval only in development", () => {
    expect(fullContentSecurityPolicy({ NODE_ENV: "development" })).toContain("'unsafe-eval'");
    expect(fullContentSecurityPolicy({ NODE_ENV: "production" })).not.toContain("'unsafe-eval'");
  });
});
