// db/script-env.mjs: the password a libpq tool needs never goes on its command
// line (audit B9), where `ps` shows it to every user on the machine for as
// long as a dump runs.
import { describe, expect, it } from "vitest";
import { pgToolConnection } from "../../db/script-env.mjs";

describe("pgToolConnection", () => {
  it("takes the password out of the URL and puts it in PGPASSWORD", () => {
    const { url, env } = pgToolConnection(
      "postgres://owner:s3cr%40t%2Fpw@ep-invented.eu-west-2.aws.neon.tech/neondb?sslmode=require",
      { PATH: "/bin" },
    );
    expect(url).toBe("postgres://owner@ep-invented.eu-west-2.aws.neon.tech/neondb?sslmode=require");
    expect(url).not.toContain("s3cr");
    expect(env).toEqual({ PATH: "/bin", PGPASSWORD: "s3cr@t/pw" });
  });

  it("leaves a URL with no password alone and sets no PGPASSWORD", () => {
    const { url, env } = pgToolConnection("postgresql://local@localhost:5433/invented", { PATH: "/bin" });
    expect(url).toBe("postgresql://local@localhost:5433/invented");
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("does not let an inherited PGPASSWORD stand in for the URL's own", () => {
    const { env } = pgToolConnection("postgres://a:right@h/d", { PGPASSWORD: "wrong" });
    expect(env.PGPASSWORD).toBe("right");
  });
});
