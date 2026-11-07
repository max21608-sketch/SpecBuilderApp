// Both agreements (an item's BW standard and a library finish's) read ONE rule
// for which evidence is the client's yes (audit 5.4 A6). The rule itself is
// held in the database tier (bw-standard.test.ts); this holds that the finish
// path cannot drift back to reading the open change's evidence.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the agreement's evidence", () => {
  for (const file of ["src/lib/attribute-standard.ts", "src/lib/finish-standard.ts"]) {
    it(`${file} takes it from agreementEvidenceId, never straight off the change set`, () => {
      const source = readFileSync(file, "utf8");
      const agree = source.slice(source.indexOf("export async function agree"));
      const body = agree.slice(0, agree.indexOf("\nexport ") === -1 ? undefined : agree.indexOf("\nexport "));
      expect(body).toContain("agreementEvidenceId(txn, changeSetId, attached)");
      expect(body).not.toMatch(/select evidence_attachment_id from change_sets/);
    });
  }
});
