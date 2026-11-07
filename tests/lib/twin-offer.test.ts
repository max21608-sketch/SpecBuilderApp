// Pure tier — what one act offers a record's twins (T1: ticked by default,
// except where ticking would replace or flatten something).
import { describe, expect, it } from "vitest";
import { twinOffer, twinOfferSentence, type TwinAttribute, type TwinWithAttributes } from "@/lib/twin-offer";

const row = (over: Partial<TwinAttribute>): TwinAttribute => ({
  id: "row",
  version: 1,
  attrGroup: "dimension",
  label: "Width",
  value: "540",
  unit: "mm",
  qualifier: null,
  state: "confirmed",
  dimensionSlot: "W",
  specFieldId: null,
  ...over,
});

const twin = (attributes: TwinAttribute[]): TwinWithAttributes => ({
  twinId: "link",
  version: 1,
  reason: "one stool",
  createdBy: "qa",
  createdAt: "2026-11-07",
  recordId: "pl",
  label: "P1-061",
  itemDescription: "Stool",
  boqCodes: ["PL-FUR-13"],
  runId: "run",
  runName: "Main",
  area: "Ambassador Suite",
  qty: 2,
  qtyRaw: null,
  attributes,
});

describe("twinOffer", () => {
  const add = { act: "add" as const, attrGroup: "dimension" as const, label: "Width", dimensionSlot: "W" as const, specFieldId: null };

  it("ticks a free slot, and offers a held one UNTICKED with its value", () => {
    expect(twinOffer(add, [twin([])])[0]).toMatchObject({ status: "free", offered: true, ticked: true });
    const held = twinOffer(add, [twin([row({ id: "w" })])])[0]!;
    expect(held).toMatchObject({ status: "held", offered: true, ticked: false, row: { id: "w" } });
    expect(twinOfferSentence(held)).toBe("PL-FUR-13 holds W 540mm. Tick to replace it there too.");
  });

  it("never calls a note held", () => {
    const note = { act: "add" as const, attrGroup: "note" as const, label: "Arm height", dimensionSlot: null, specFieldId: null };
    expect(twinOffer(note, [twin([row({ attrGroup: "note", label: "Arm height", dimensionSlot: null })])])[0]?.status).toBe("free");
  });

  it("matches a BWS field by field, whatever its label", () => {
    const com = { act: "add" as const, attrGroup: "material" as const, label: "SEAT", dimensionSlot: null, specFieldId: "com1" };
    const held = twinOffer(com, [twin([row({ attrGroup: "material", label: "Fabric", dimensionSlot: null, specFieldId: "com1", unit: null })])]);
    expect(held[0]?.status).toBe("held");
  });

  it("offers a correction only where the twin's row said the same", () => {
    const mine = row({ id: "mine" });
    expect(twinOffer({ act: "correct", row: mine }, [twin([row({ id: "theirs" })])])[0]).toMatchObject({
      status: "same",
      ticked: true,
      row: { id: "theirs" },
    });
    const differs = twinOffer({ act: "correct", row: mine }, [twin([row({ id: "theirs", value: "560" })])])[0]!;
    expect(differs).toMatchObject({ status: "differs", offered: false, ticked: false });
    expect(twinOfferSentence(differs)).toBe("PL-FUR-13 reads W 560mm: left alone.");
    // A TBC is a different statement from a confirmed one with the same words.
    expect(twinOffer({ act: "retire", row: mine }, [twin([row({ state: "tbc" })])])[0]?.status).toBe("differs");
    expect(twinOffer({ act: "retire", row: mine }, [twin([])])[0]).toMatchObject({ status: "missing", offered: false });
  });

  it("does not choose between two rows under one label", () => {
    const note = row({ attrGroup: "note", label: "Remark", dimensionSlot: null, unit: null, value: "x" });
    expect(twinOffer({ act: "correct", row: note }, [twin([note, { ...note, id: "second" }])])[0]?.status).toBe("differs");
  });
});
