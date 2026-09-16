// The Graph client's guards. Pure — no token, no network.
import { describe, expect, it } from "vitest";
import { assertGraphId, graphUrl, mailIngestionEnabled } from "@/lib/graph-client";
import { clientStateHash, clientStateMatches } from "@/lib/graph-subscriptions";

describe("assertGraphId", () => {
  it("accepts the shape Graph actually uses", () => {
    expect(assertGraphId("AAMkAGI2THVSAAA=")).toBe("AAMkAGI2THVSAAA=");
    expect(assertGraphId("  AAMkAGI2-THVS_AAA  ")).toBe("AAMkAGI2-THVS_AAA");
  });

  // The id is the ONE value taken from a webhook body. Everything else about a
  // message is fetched by it, so this is the boundary that matters.
  it("refuses anything that could change the URL it lands in", () => {
    for (const bad of ["../subscriptions", "a/b", "a?b=c", "a#b", "a b", "https://evil.test", "", "'"]) {
      expect(() => assertGraphId(bad)).toThrow();
    }
  });

  it("refuses a non-string and an over-long id", () => {
    expect(() => assertGraphId(null)).toThrow();
    expect(() => assertGraphId(42)).toThrow();
    expect(() => assertGraphId("A".repeat(513))).toThrow();
  });
});

describe("graphUrl", () => {
  it("builds a relative path against Graph", () => {
    expect(graphUrl("/users/a@b.test/messages")).toBe("https://graph.microsoft.com/v1.0/users/a@b.test/messages");
  });

  it("accepts Graph's own paging links", () => {
    const link = "https://graph.microsoft.com/v1.0/users/a/messages/delta?$skiptoken=X";
    expect(graphUrl(link)).toBe(link);
  });

  // A nextLink arrives inside a JSON payload. Following one to another host
  // would send the bearer token there.
  it("refuses an absolute link to any other host", () => {
    expect(() => graphUrl("https://evil.test/v1.0/users")).toThrow();
    expect(() => graphUrl("https://graph.microsoft.com.evil.test/x")).toThrow();
  });
});

describe("mailIngestionEnabled", () => {
  // Fails closed, and deleting the secret is the documented emergency stop.
  it("is false unless the mode is enabled AND every credential is present", () => {
    const saved = { ...process.env };
    try {
      process.env.MAIL_INGESTION_MODE = "enabled";
      delete process.env.GRAPH_CLIENT_SECRET;
      process.env.GRAPH_TENANT_ID = "t";
      process.env.GRAPH_CLIENT_ID = "c";
      process.env.GRAPH_MAILBOX = "m@x.test";
      expect(mailIngestionEnabled()).toBe(false);

      process.env.GRAPH_CLIENT_SECRET = "s";
      expect(mailIngestionEnabled()).toBe(true);

      process.env.MAIL_INGESTION_MODE = "disabled";
      expect(mailIngestionEnabled()).toBe(false);
    } finally {
      process.env = saved;
    }
  });
});

describe("clientStateMatches", () => {
  it("matches the secret against its stored hash", () => {
    const hash = clientStateHash("__qa-shared-secret");
    expect(clientStateMatches("__qa-shared-secret", hash)).toBe(true);
    expect(clientStateMatches("__qa-shared-secre", hash)).toBe(false);
    expect(clientStateMatches("", hash)).toBe(false);
    expect(clientStateMatches(undefined, hash)).toBe(false);
    expect(clientStateMatches(42, hash)).toBe(false);
  });

  // The stored value is a hash, not the secret: a database dump must not hand
  // somebody the ability to post convincing notifications.
  it("stores a hash rather than the secret", () => {
    expect(clientStateHash("__qa-shared-secret")).not.toContain("__qa");
    expect(clientStateHash("__qa-shared-secret")).toMatch(/^[0-9a-f]{64}$/);
  });
});
