// Evidence on a change is what the STORE holds (audit A15, 2026-11-06).
//
// `attachEvidence` scope-checked the pathname and never asked the store, so a
// change could carry "evidence" pointing at nothing, filed under the size and
// the type the browser made up. `verifyEvidence` now HEADs it before the
// transaction, and `attachEvidence` takes only what that returned (a branded
// type, so a route that skips the HEAD does not compile).
//
// What is proved: the attachment row carries the store's size and type; a file
// the store never received is refused and nothing is inserted; and a pathname
// in ANOTHER project reads "not one of this project's uploads" whether or not
// the store has it, so the refusal is no existence oracle.
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

const store = vi.hoisted(() => new Map<string, { size: number; contentType: string }>());

vi.mock("@/lib/blob-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-source")>();
  return {
    ...actual,
    headTrustedBlob: async (pathname: string, projectId: string) => {
      const scoped = actual.assertProjectScopedPathname(pathname, projectId);
      const meta = store.get(scoped);
      if (!meta) throw new actual.UntrustedBlobError("That upload could not be found in the document store.");
      return { pathname: scoped, ...meta };
    },
  };
});

const { attachEvidence, verifyEvidence } = await import("@/lib/change-sets");
const { DomainConflictError } = await import("@/lib/db-transaction");

let inserts: unknown[][] = [];
const txn = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  if (strings.join("?").includes("insert into attachments")) {
    inserts.push(values);
    return [{ id: "att-1" }];
  }
  return [];
}) as unknown as Parameters<typeof attachEvidence>[0];

beforeEach(() => {
  store.clear();
  inserts = [];
});

const attach = async (pathname: string, extra: Record<string, unknown> = {}) => {
  const evidence = await verifyEvidence({ pathname, filename: "Hayley.eml", ...extra });
  return attachEvidence(txn, { projectId: PROJECT, changeSetId: "cs-1", evidence: evidence!, actor: "qa" });
};

describe("verifyEvidence + attachEvidence", () => {
  it("files the STORE's size and type, never the request's", async () => {
    const pathname = `projects/${PROJECT}/evidence/1730900000000-Hayley.eml`;
    store.set(pathname, { size: 2048, contentType: "message/rfc822" });
    await attach(pathname, { contentType: "text/html", size: 1 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("message/rfc822");
    expect(inserts[0]).toContain(2048);
    expect(inserts[0]).not.toContain("text/html");
  });

  it("refuses evidence the store never received, and inserts nothing", async () => {
    const error = await attach(`projects/${PROJECT}/evidence/never-uploaded.eml`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainConflictError);
    expect((error as InstanceType<typeof DomainConflictError>).code).toBe("evidence_missing");
    expect(inserts).toHaveLength(0);
  });

  it("refuses another project's file in the same words whether or not it exists", async () => {
    const real = `projects/${OTHER}/evidence/real.eml`;
    store.set(real, { size: 10, contentType: "message/rfc822" });
    for (const pathname of [real, `projects/${OTHER}/evidence/absent.eml`]) {
      const error = await attach(pathname).catch((e: unknown) => e);
      expect((error as InstanceType<typeof DomainConflictError>).code, pathname).toBe("evidence_not_this_project");
    }
    expect(inserts).toHaveLength(0);
  });

  it("returns null for no evidence at all", async () => {
    expect(await verifyEvidence(null)).toBeNull();
    expect(await verifyEvidence(undefined)).toBeNull();
  });
});
