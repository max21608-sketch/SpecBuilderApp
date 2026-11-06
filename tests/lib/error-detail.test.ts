// A failure's raw text reaches a browser only on a developer's own machine
// (audit A12, 2026-11-06).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explainFailure, peopleMessage } from "@/lib/error-detail";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.APP_ENV;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  if (saved === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = saved;
  vi.restoreAllMocks();
});

function driverError() {
  return Object.assign(new Error('duplicate key value violates unique constraint "users_email_key" (secret@example.test)'), {
    name: "DatabaseError",
    code: "23505",
  });
}

describe("peopleMessage", () => {
  it("passes through a sentence this app wrote", () => {
    expect(peopleMessage(new Error("That file is not a spreadsheet. Upload an .xlsx, .csv or .tsv file."))).toMatch(
      /not a spreadsheet/,
    );
  });

  it("withholds a driver error, a library TypeError and anything that is not an Error", () => {
    expect(peopleMessage(driverError())).toBeNull();
    expect(peopleMessage(Object.assign(new Error("relation x does not exist"), { code: "42P01" }))).toBeNull();
    expect(peopleMessage(new TypeError("Cannot read properties of undefined"))).toBeNull();
    expect(peopleMessage("a string")).toBeNull();
  });
});

describe("explainFailure", () => {
  it.each(["staging", "pilot", "production", undefined])(
    "on %s, says the sentence and a reference, never the driver's text",
    (appEnv) => {
      if (appEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = appEnv;
      const said = explainFailure("Signing in could not reach the database.", driverError(), "login");
      expect(said).toMatch(/^Signing in could not reach the database\. Reference [0-9a-f]{8}\.$/);
      expect(said).not.toContain("users_email_key");
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[login\] failure [0-9a-f]{8}/), expect.anything());
    },
  );

  it("adds the cause's text on a developer's own deployment", () => {
    process.env.APP_ENV = "development";
    expect(explainFailure("It failed.", driverError(), "x")).toContain("users_email_key");
  });
});
