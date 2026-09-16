// The Capsule client. Pure except for a stubbed fetch — no network, no token.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as capsule from "@/lib/capsule";
import { CapsuleNotConfiguredError, isCapsuleConfigured, searchParties, getParty } from "@/lib/capsule";

const originalFetch = globalThis.fetch;
const originalToken = process.env.CAPSULE_API_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.CAPSULE_API_TOKEN;
  else process.env.CAPSULE_API_TOKEN = originalToken;
  vi.restoreAllMocks();
});

function stub(body: unknown, status = 200) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const person = {
  id: 42,
  type: "person",
  firstName: "Jane",
  lastName: "Doe",
  jobTitle: "Senior designer",
  organisation: { id: 7, name: "LCS Design" },
  emailAddresses: [{ type: "Work", address: "Jane@Designers.test" }],
  updatedAt: "2026-09-01T10:00:00Z",
};

describe("the module surface", () => {
  // Company systems are read-only for this app. "We only ever call GET" is a
  // habit that erodes; an absent function is a fact that does not. This test
  // is the thing that makes adding a write verb fail rather than pass review.
  it("exports no way to create, update or delete anything in Capsule", () => {
    const writeish = Object.keys(capsule).filter((name) =>
      /^(create|update|delete|post|put|patch|remove|save|write|sync|push)/i.test(name),
    );
    expect(writeish).toEqual([]);
  });

  it("exports only the read surface it is documented to have", () => {
    expect(Object.keys(capsule).sort()).toEqual(
      ["CapsuleNotConfiguredError", "CapsuleUpstreamError", "getParty", "isCapsuleConfigured", "searchParties"].sort(),
    );
  });
});

describe("with no token", () => {
  it("reports itself unconfigured", () => {
    delete process.env.CAPSULE_API_TOKEN;
    expect(isCapsuleConfigured()).toBe(false);
  });

  it("throws BEFORE reaching the network, so an outage and a missing key never look alike", async () => {
    delete process.env.CAPSULE_API_TOKEN;
    const spy = stub({});
    await expect(searchParties("jane")).rejects.toBeInstanceOf(CapsuleNotConfiguredError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("searchParties", () => {
  it("sends a GET with the bearer token and the search term encoded", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    const spy = stub({ parties: [person] });
    await searchParties("jane doe");

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.capsulecrm.com/api/v2/parties/search?q=jane%20doe&perPage=20");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer __qa-token");
  });

  it("normalises a person into the shape the contacts form fills from", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    stub({ parties: [person] });
    const [party] = await searchParties("jane");
    expect(party).toEqual({
      id: 42,
      type: "person",
      name: "Jane Doe",
      jobTitle: "Senior designer",
      organisation: { id: 7, name: "LCS Design" },
      // Folded, because an address is matched case-insensitively everywhere else.
      emails: ["jane@designers.test"],
      updatedAt: "2026-09-01T10:00:00Z",
    });
  });

  it("keeps an organisation party, which is a legitimate contact", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    stub({ parties: [{ id: 9, type: "organisation", name: "LCS Design", emailAddresses: [] }] });
    const [party] = await searchParties("lcs");
    expect(party?.type).toBe("organisation");
    expect(party?.name).toBe("LCS Design");
    expect(party?.emails).toEqual([]);
  });

  it("returns nothing rather than throwing when Capsule has no match", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    stub({ parties: [] });
    expect(await searchParties("nobody")).toEqual([]);
  });

  it("refuses a response whose shape it does not recognise, rather than half-reading it", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    stub({ parties: [{ id: "not a number" }] });
    await expect(searchParties("jane")).rejects.toMatchObject({ name: "CapsuleUpstreamError" });
  });

  it("does not forward an upstream error body to the caller", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    stub({ message: "account suspended, invoice 4471 unpaid" }, 403);
    await expect(searchParties("jane")).rejects.toThrow(/Capsule answered 403/);
    await expect(searchParties("jane")).rejects.not.toThrow(/invoice/);
  });
});

describe("getParty", () => {
  it("returns null for a party that no longer exists", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    stub({}, 404);
    expect(await getParty(42)).toBeNull();
  });

  it("reads one party by id", async () => {
    process.env.CAPSULE_API_TOKEN = "__qa-token";
    const spy = stub({ party: person });
    const party = await getParty(42);
    expect(party?.name).toBe("Jane Doe");
    expect((spy.mock.calls[0] as unknown as [string])[0]).toContain("/parties/42");
  });
});
