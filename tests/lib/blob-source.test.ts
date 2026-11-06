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
import { pathnameSafeName } from "@/lib/upload-paths";

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

  // AUDIT A7. The SDK builds `https://<store>/<pathname>` by concatenation and
  // fetches it, and a URL parser resolves `%2e%2e` as a dot-dot segment. So an
  // encoded traversal never reached the literal-`..` check and still left the
  // project. These are the shapes that would.
  it("refuses an ENCODED traversal, which a URL parser would resolve", () => {
    for (const attempt of [
      `projects/${PROJECT}/%2e%2e/${OTHER}/secret.pdf`,
      `projects/${PROJECT}/%2E%2E/${OTHER}/secret.pdf`,
      `projects/${PROJECT}/.%2e/${OTHER}/secret.pdf`,
      `projects/${PROJECT}/%2e./${OTHER}/secret.pdf`,
      `projects/${PROJECT}/a%2fb.pdf`,
      `projects/${PROJECT}/a%5cb.pdf`,
    ]) {
      expect(() => assertProjectScopedPathname(attempt, PROJECT), attempt).toThrow(UntrustedBlobError);
    }
  });

  it("refuses a segment that is empty, a dot, or a query or fragment that would cut the URL", () => {
    for (const attempt of [
      `projects/${PROJECT}//a.pdf`,
      `projects/${PROJECT}/./a.pdf`,
      `projects/${PROJECT}/a.pdf?x=1`,
      `projects/${PROJECT}/a.pdf#page=2`,
      `projects/${PROJECT}/a\u0000.pdf`,
      `projects/${PROJECT}/a\nb.pdf`,
      `projects/${PROJECT}/`,
    ]) {
      expect(() => assertProjectScopedPathname(attempt, PROJECT), JSON.stringify(attempt)).toThrow(
        UntrustedBlobError,
      );
    }
  });

  // What the app REALLY writes, every writer's shape. A real document keeps
  // the name its client gave it (`IntakeBatchUpload` uploads `file.name`), so
  // an ASCII allowlist would have locked every curly apostrophe and en dash
  // out of its own project. These must all stay readable.
  it("accepts every shape the app's own writers produce", () => {
    for (const written of [
      `projects/${PROJECT}/AP364 - Apx 2.xlsx`,
      `projects/${PROJECT}/Ronnie Scott\u2019s \u2013 Drawings.pdf`,
      `projects/${PROJECT}/R\u00e9sum\u00e9 (rev B) & notes, 50% final [v2].pdf`,
      `projects/${PROJECT}/AP364 - Apx 2-AbCd1234EfGh5678IjKl9012MnOp34.xlsx`,
      `projects/${PROJECT}/evidence/1730900000000-Hayley_email.eml`,
      `projects/${PROJECT}/finish-swatches/1730900000000-swatch.png`,
      `projects/${PROJECT}/finish-swatches/obs-1-1730900000000.png`,
      `projects/${PROJECT}/item-images/item-2-1730900000000.png`,
      `projects/${PROJECT}/bill-images/${OTHER}/bill row 12.png`,
      `projects/${PROJECT}/bill-images/${OTHER}/crop-0-12-1730900000000.png`,
      `projects/${PROJECT}/emails/AAMkAGI2THVSAAA=.eml`,
      `projects/${PROJECT}/swatch-page-3.png`,
    ]) {
      expect(assertProjectScopedPathname(written, PROJECT)).toBe(written);
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

// The two upload screens that keep a client's own filename build the pathname
// through `pathnameSafeName`, so a name the shape check would refuse is made
// safe BEFORE the token is asked for, rather than refused after the person has
// chosen the file.
describe("pathnameSafeName", () => {
  it("makes every awkward real name pass the shape check, and leaves a plain one alone", () => {
    for (const name of [
      "Ronnie Scott’s – Drawings.pdf",
      "Schedule #3 (rev?).pdf",
      "a\\b/c.pdf",
      "50%2e%2e off.pdf",
      "line\nbreak.eml",
      "..",
      "",
    ]) {
      const pathname = `${projectUploadPrefix(PROJECT)}${pathnameSafeName(name)}`;
      expect(assertProjectScopedPathname(pathname, PROJECT), JSON.stringify(name)).toBe(pathname);
    }
    expect(pathnameSafeName("AP364 - Apx 2.xlsx")).toBe("AP364 - Apx 2.xlsx");
    expect(pathnameSafeName("Ronnie Scott’s – Drawings.pdf")).toBe("Ronnie Scott’s – Drawings.pdf");
  });
});
