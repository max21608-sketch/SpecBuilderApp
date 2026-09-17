// Where an email's `.eml` has to live before the project can read it.
//
// THE DEFECT THIS EXISTS TO CLOSE. Mail arrives before anybody knows whose it
// is, so it is stored under `mailbox/`. Every read in blob-source.ts is scoped
// to `projects/<id>/`. Assignment attached the arrival path verbatim, so the
// run it started failed with "That file does not belong to this project" —
// found on the first message ever assigned from the mailbox side, and it would
// have been the first real Graph message.
//
// The decision is pure so it can be proved without a store; the copy itself is
// the caller's, made outside the transaction.
import { describe, expect, it } from "vitest";
import { planMimeLocation } from "@/lib/email-registration";
import { assertMailboxScopedPathname, UntrustedBlobError } from "@/lib/blob-source";

const PROJECT = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const MESSAGE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const MAILBOX_PATH = "mailbox/specs-benwhistler-com/2026/09/AAMkAGI2.eml";

describe("planMimeLocation", () => {
  it("copies a message that arrived in the mailbox under the project claiming it", () => {
    expect(planMimeLocation(MAILBOX_PATH, PROJECT, MESSAGE)).toEqual({
      kind: "copy",
      from: MAILBOX_PATH,
      to: `projects/${PROJECT}/emails/${MESSAGE}.eml`,
    });
  });

  it("leaves an uploaded .eml alone: the browser already put it under the project", () => {
    const uploaded = `projects/${PROJECT}/uploads/reply.eml`;
    expect(planMimeLocation(uploaded, PROJECT, MESSAGE)).toEqual({ kind: "already", pathname: uploaded });
  });

  it("has nothing to do when the message was recorded without its file", () => {
    expect(planMimeLocation(null, PROJECT, MESSAGE)).toEqual({ kind: "none" });
  });

  it("REFUSES to copy out of another project's prefix", () => {
    // The source is read off our own row, and it is still checked: a stored
    // path pointing at another project is not something to copy, whatever
    // wrote it.
    expect(() => planMimeLocation(`projects/${OTHER}/uploads/theirs.eml`, PROJECT, MESSAGE)).toThrow(
      UntrustedBlobError,
    );
  });

  it("refuses a path outside both prefixes", () => {
    expect(() => planMimeLocation("secrets/keys.txt", PROJECT, MESSAGE)).toThrow(UntrustedBlobError);
  });

  it("recovers the pathname from a stored full URL, as the attachment reader does", () => {
    const plan = planMimeLocation(
      `https://abc123.public.blob.vercel-storage.com/${MAILBOX_PATH}`,
      PROJECT,
      MESSAGE,
    );
    expect(plan).toEqual({
      kind: "copy",
      from: MAILBOX_PATH,
      to: `projects/${PROJECT}/emails/${MESSAGE}.eml`,
    });
  });

  it("names the target by MESSAGE id, so a second attempt overwrites its own copy", () => {
    const target = { kind: "copy", to: `projects/${PROJECT}/emails/${MESSAGE}.eml` };
    expect(planMimeLocation(MAILBOX_PATH, PROJECT, MESSAGE)).toMatchObject(target);
    expect(
      planMimeLocation("mailbox/specs-benwhistler-com/2026/09/other-arrival.eml", PROJECT, MESSAGE),
    ).toMatchObject(target);
  });
});

describe("assertMailboxScopedPathname", () => {
  it("accepts a mailbox path", () => {
    expect(assertMailboxScopedPathname(MAILBOX_PATH)).toBe(MAILBOX_PATH);
  });

  it("tolerates a leading slash", () => {
    expect(assertMailboxScopedPathname(`/${MAILBOX_PATH}`)).toBe(MAILBOX_PATH);
  });

  it("refuses traversal", () => {
    expect(() => assertMailboxScopedPathname("mailbox/../projects/x/secret.pdf")).toThrow(UntrustedBlobError);
  });

  it("refuses anything outside the prefix", () => {
    expect(() => assertMailboxScopedPathname("mailboxes/elsewhere.eml")).toThrow(UntrustedBlobError);
  });
});
