// Pure unit tests for the trust boundary around the private blob store.
//
// This is the module that exists because M1 fetched a client-supplied `url`
// with `Bearer BLOB_READ_WRITE_TOKEN`. These tests are the standing proof that
// nothing can talk this app into pointing a store credential somewhere it did
// not write — so they live in the tier that always runs, not the one that
// skips without a database.
import { describe, expect, it } from "vitest";
import {
  assertProjectScopedPathname,
  blobPathname,
  projectUploadPrefix,
  UntrustedBlobError,
} from "@/lib/blob-source";

const PROJECT = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";

describe("projectUploadPrefix", () => {
  it("namespaces uploads under their project", () => {
    expect(projectUploadPrefix(PROJECT)).toBe(`projects/${PROJECT}/`);
  });
});

describe("assertProjectScopedPathname", () => {
  it("accepts a pathname inside this project", () => {
    expect(assertProjectScopedPathname(`projects/${PROJECT}/schedule.pdf`, PROJECT)).toBe(
      `projects/${PROJECT}/schedule.pdf`,
    );
  });

  it("tolerates a leading slash", () => {
    expect(assertProjectScopedPathname(`/projects/${PROJECT}/a.pdf`, PROJECT)).toBe(
      `projects/${PROJECT}/a.pdf`,
    );
  });

  it("refuses ANOTHER project's file", () => {
    expect(() => assertProjectScopedPathname(`projects/${OTHER}/secret.pdf`, PROJECT)).toThrow(
      UntrustedBlobError,
    );
  });

  it("refuses a path outside the prefix entirely", () => {
    expect(() => assertProjectScopedPathname("secrets/keys.txt", PROJECT)).toThrow(UntrustedBlobError);
  });

  it("refuses traversal and backslashes", () => {
    for (const attempt of [
      `projects/${PROJECT}/../${OTHER}/secret.pdf`,
      `projects/${PROJECT}/..`,
      `projects\\${PROJECT}\\a.pdf`,
    ]) {
      expect(() => assertProjectScopedPathname(attempt, PROJECT)).toThrow(UntrustedBlobError);
    }
  });

  // A prefix check by `startsWith` alone would accept a project id that merely
  // begins with this one's. The trailing slash is what stops it.
  it("refuses a project id that is a prefix of another", () => {
    expect(() => assertProjectScopedPathname(`projects/${PROJECT}-evil/a.pdf`, PROJECT)).toThrow(
      UntrustedBlobError,
    );
  });
});

describe("blobPathname", () => {
  it("passes a pathname through", () => {
    expect(blobPathname(`projects/${PROJECT}/a.pdf`)).toBe(`projects/${PROJECT}/a.pdf`);
  });

  // M1 stored full URLs. Recovering the pathname from one is allowed; being
  // sent to the host in it is not.
  it("recovers the pathname from a stored Vercel Blob URL", () => {
    expect(blobPathname(`https://abc123.blob.vercel-storage.com/projects/${PROJECT}/a.pdf`)).toBe(
      `projects/${PROJECT}/a.pdf`,
    );
  });

  it("decodes an encoded pathname", () => {
    expect(blobPathname("https://abc.blob.vercel-storage.com/projects/x/a%20b.pdf")).toBe(
      "projects/x/a b.pdf",
    );
  });

  it("REFUSES any other host", () => {
    for (const url of [
      "https://evil.example.com/projects/x/a.pdf",
      "http://169.254.169.254/latest/meta-data/",
      "https://blob.vercel-storage.com.evil.example.com/a.pdf",
      "https://evil.example.com/?x=.blob.vercel-storage.com",
    ]) {
      expect(() => blobPathname(url)).toThrow(UntrustedBlobError);
    }
  });

  it("refuses something that is not a URL at all but claims to be", () => {
    expect(() => blobPathname("https://")).toThrow(UntrustedBlobError);
  });

  // The whole point: a recovered pathname still has to pass the scope check,
  // so a URL belonging to a real blob in ANOTHER project is refused anyway.
  it("does not let a real store URL escape its project scope", () => {
    const foreign = blobPathname(`https://abc.blob.vercel-storage.com/projects/${OTHER}/a.pdf`);
    expect(() => assertProjectScopedPathname(foreign, PROJECT)).toThrow(UntrustedBlobError);
  });
});
