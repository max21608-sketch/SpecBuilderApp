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

// ============================================================================
// THE HOST AGAINST THE DECLARATION (audit 5.4 A7). `DATABASE_ENVIRONMENT` is a
// declaration and the printed host is how a person catches a wrong one; `neon
// link` rewriting DATABASE_URL under a file that still says sandbox is the
// accident `.env.example` warns about. A host the table knows refuses a
// declaration that does not own it.
// ============================================================================
import { hostRefusal } from "../../db/script-env.mjs";

describe("hostRefusal", () => {
  const known = {
    sandbox: ["ep-invented-sandbox.eu-west-2.aws.neon.tech"],
    pilot: ["ep-invented-pilot.eu-west-2.aws.neon.tech"],
    production: [],
  };

  it("passes a host its declaration owns, pooled or direct, any port", () => {
    expect(hostRefusal("sandbox", "ep-invented-sandbox.eu-west-2.aws.neon.tech", known)).toBeNull();
    expect(hostRefusal("sandbox", "ep-invented-sandbox-pooler.eu-west-2.aws.neon.tech:5432", known)).toBeNull();
    expect(hostRefusal("pilot", "EP-INVENTED-PILOT.eu-west-2.aws.neon.tech", known)).toBeNull();
  });

  it("refuses a host another environment owns, naming both", () => {
    expect(hostRefusal("sandbox", "ep-invented-pilot.eu-west-2.aws.neon.tech", known)).toMatch(/declares sandbox.*pilot/);
    expect(hostRefusal("pilot", "ep-invented-sandbox-pooler.eu-west-2.aws.neon.tech", known)).toMatch(/declares pilot.*sandbox/);
  });

  it("refuses a host its declaration does not list, where it lists any", () => {
    expect(hostRefusal("pilot", "ep-somewhere-else.eu-west-2.aws.neon.tech", known)).toMatch(/not one of pilot's known hosts/);
  });

  it("takes this machine as sandbox only (the local stack), never pilot or production", () => {
    expect(hostRefusal("sandbox", "localhost:5433", known)).toBeNull();
    expect(hostRefusal("pilot", "localhost:5433", known)).toMatch(/this machine/);
    expect(hostRefusal("production", "127.0.0.1", known)).toMatch(/this machine/);
  });

  it("leaves an environment with no host recorded unchecked rather than refusing everything", () => {
    expect(hostRefusal("production", "ep-anything.neon.tech", known)).toBeNull();
  });
});
