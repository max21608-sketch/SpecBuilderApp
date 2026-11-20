// Why a finish code is unlinked (prod-ready F4, 2026-11-20): absent from the
// library, held with different words, or held and only not attached.
import { describe, expect, it } from "vitest";
import { classifyUnlinkedFinishCodes } from "@/lib/finish-unlinked";
import { unlinkedFinishWords } from "@/lib/finish-unlinked-words";
import type { Finish } from "@/lib/finishes";

const finish = (code: string, description: string | null): Finish => ({
  id: `f-${code}`,
  code,
  codeNorm: code,
  codeOrigin: "client",
  kind: "timber",
  description,
  supplierRaw: null,
  reference: null,
  colour: null,
  state: description ? "confirmed" : "tbc",
  zonesOnItems: [],
});

describe("classifyUnlinkedFinishCodes", () => {
  const library = [finish("WD-01", "Oak natural"), finish("MTL-02", "Bronze")];
  it("tells absent, differing and unattached codes apart, by the confirm's own rules", () => {
    const rows = classifyUnlinkedFinishCodes(
      [
        { code: "WD-01", materialCode: "WD-01", value: "WD-01 Walnut", recordId: "r2" },
        { code: "WD-01", materialCode: "WD-01", value: "WD-01 Oak natural", recordId: "r1" },
        { code: "MTL-02", materialCode: "MTL-02", value: "MTL-02", recordId: "r3" },
        { code: "FAB-09", materialCode: "FAB-09", value: "FAB-09 Velvet", recordId: "r4" },
      ],
      library,
    );
    expect(rows).toEqual([
      { code: "FAB-09", records: 1, firstRecordId: "r4", reason: "absent", held: null },
      { code: "MTL-02", records: 1, firstRecordId: "r3", reason: "unattached", held: { finishId: "f-MTL-02", code: "MTL-02", description: "Bronze" } },
      { code: "WD-01", records: 2, firstRecordId: "r1", reason: "differs", held: { finishId: "f-WD-01", code: "WD-01", description: "Oak natural" } },
    ]);
  });

  it("words the Finishes tile by reason, and says “not in the library” only of what is not", () => {
    expect(unlinkedFinishWords([{ reason: "absent" }, { reason: "absent" }])).toBe("2 codes not in the library");
    expect(unlinkedFinishWords([{ reason: "differs" }, { reason: "unattached" }])).toBe("1 differs from the library · 1 to attach");
    expect(unlinkedFinishWords([{ reason: "absent" }, { reason: "differs" }, { reason: "differs" }])).toBe(
      "1 code not in the library · 2 differ from the library",
    );
  });
});
