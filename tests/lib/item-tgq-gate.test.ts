// `itemTgq`: an item's TGQ, the number and the rows behind it, from ONE
// function (Max, 2026-10-13: "with the TGQ question it should show the 7").
// On Matthew's matrix it is the TGQ gate's rows still to answer, project-wide
// apart and `nowhere` out; elsewhere the checklist's own questions.
import { describe, expect, it } from "vitest";
import { itemTgq, type ItemTgqGateRow, type ItemTgqOutstanding, type ItemTgqQuestion } from "@/lib/item-tgq";
import { gatesForRecord, itemTgqForRecord, type GateContext } from "@/lib/gate-load";
import type { GateField } from "@/lib/gates";

const PW = "Project / commercial";
const gate = (
  outcome: ItemTgqGateRow["outcome"],
  fieldName: string,
  field: Partial<ItemTgqGateRow["field"]> = {},
): ItemTgqGateRow => ({
  outcome,
  field: { fieldName, specFieldJsonId: null, localKey: null, dimensionSlot: null, ...field },
  state: "missing",
});
const question = (over: Partial<ItemTgqQuestion> & { requirement_id: string }): ItemTgqQuestion => ({
  json_id: null,
  local_key: null,
  kind: "spec_field",
  section: "Build details",
  prompt: "A question",
  field_label: null,
  ...over,
});
const open = (over: Partial<ItemTgqOutstanding> & { requirementId: string }): ItemTgqOutstanding => ({
  requirementKind: "spec_field",
  tier: "to_quote",
  section: "Build details",
  prompt: "A question",
  fieldLabel: null,
  state: "missing",
  ...over,
});

describe("itemTgq on Matthew's matrix: the stool, v3-001", () => {
  // Its TGQ gate on the local copy of P18181 v3: Environment and Swivel open,
  // W and SH slots open (the composed cell D460 x H450mm answers the ONE
  // Dimensions question and says nothing about them), Designer reference and
  // Spec notes empty on the record, Access open on the project, Product code
  // with nowhere to record it, and the rest settled.
  const rows = [
    gate("blocking", "Indoor/Outdoor", { specFieldJsonId: 130 }),
    gate("blocking", "Swivel", { specFieldJsonId: 232 }),
    gate("blocking", "Width - W", { specFieldJsonId: 3, dimensionSlot: "W" }),
    gate("satisfied", "Depth - D", { specFieldJsonId: 3, dimensionSlot: "D" }),
    gate("blocking", "Seat height - SH", { specFieldJsonId: 3, dimensionSlot: "SH" }),
    gate("blocking", "Designer reference", { localKey: "designer_reference" }),
    gate("blocking", "Spec notes", { localKey: "spec_notes" }),
    gate("blocking", "Access", { specFieldJsonId: 6 }),
    gate("satisfied", "Assembly guide", { specFieldJsonId: 191 }),
    gate("unanswerable", "Product code", { localKey: "product_code" }),
  ];
  const questions = [
    question({ requirement_id: "env", json_id: 130, prompt: "Indoor/ Outdoor / Humid environment", field_label: "Outdoor" }),
    question({ requirement_id: "swv", json_id: 232, prompt: "Swivel?", field_label: "Swivel Mechs" }),
    question({ requirement_id: "dim", json_id: 3, prompt: "Dimensions" }),
    question({ requirement_id: "acc", json_id: 6, prompt: "Is access ok?", section: PW }),
    question({ requirement_id: "asm", json_id: 191, prompt: "Assembly guide", section: PW }),
  ];
  const outstanding = [
    open({ requirementId: "env", prompt: "Indoor/ Outdoor / Humid environment", fieldLabel: "Outdoor" }),
    open({ requirementId: "swv", prompt: "Swivel?", fieldLabel: "Swivel Mechs" }),
    open({ requirementId: "acc", prompt: "Is access ok?", section: PW }),
  ];

  it("reads 6 + 1 project-wide — 'the 7', split the way every screen splits it", () => {
    const result = itemTgq({ tgqGateRows: rows, questions, outstanding });
    expect(result.model).toBe("matrix");
    expect(result.count).toBe(6);
    expect(result.projectWide).toBe(1);
  });

  it("lists exactly the six, each saying where it is answered", () => {
    const result = itemTgq({ tgqGateRows: rows, questions, outstanding });
    expect(result.rows.map((row) => [row.label, row.kind, row.where])).toEqual([
      ["Outdoor", "question", "checklist"],
      ["Swivel Mechs", "question", "checklist"],
      ["Width - W", "slot", "specs"],
      ["Seat height - SH", "slot", "specs"],
      ["Designer reference", "details", "details"],
      ["Spec notes", "details", "details"],
    ]);
    expect(result.rows.length).toBe(result.count);
  });

  it("never counts Product code, which has nowhere to be recorded", () => {
    const result = itemTgq({ tgqGateRows: rows, questions, outstanding });
    expect(result.rows.some((row) => row.label === "Product code")).toBe(false);
  });
});

describe("itemTgq on the placeholder: unchanged", () => {
  it("counts the checklist's own TGQ questions of any kind, project-wide apart", () => {
    const result = itemTgq({
      tgqGateRows: null,
      questions: [],
      outstanding: [
        open({ requirementId: "a" }),
        open({ requirementId: "b", requirementKind: "readiness" }),
        open({ requirementId: "c", section: PW }),
        open({ requirementId: "d", tier: "later" }),
      ],
    });
    expect(result).toMatchObject({ model: "placeholder", count: 2, projectWide: 1 });
    expect(result.rows.map((row) => row.requirementId)).toEqual(["a", "b"]);
  });

  it("is null, never zero, where a question is untiered", () => {
    const result = itemTgq({ tgqGateRows: null, questions: [], outstanding: [open({ requirementId: "a", tier: null })] });
    expect(result.count).toBeNull();
    expect(result.rows).toEqual([]);
  });
});

describe("an item's TGQ by its ACCEPTED type (decision B)", () => {
  // The armchairs sheet maps S, A and B. Row 12, Swivel, reaches A and B (the
  // union widening onto benches); Width reaches all three. A sofa somebody
  // TYPED S is no longer asked Swivel; untyped it is, exactly as before 0061.
  const gateField = (matrixRow: number, fieldName: string, specFieldJsonId: number, appliesTo: string[]): GateField => ({
    matrixRow,
    gate: "TGQ",
    capture: "question",
    fieldName,
    specFieldJsonId,
    localKey: null,
    dimensionSlot: null,
    valueType: "free_text",
    paletteKey: null,
    paletteRaw: null,
    conditionalOnKey: null,
    conditionalOnValue: null,
    notes: null,
    appliesTo,
  });
  const context: GateContext = {
    fieldsByCategory: new Map([
      ["armchairs", [gateField(9, "Outdoor", 130, ["A", "B", "S"]), gateField(12, "Swivel Mechs", 232, ["A", "B"])]],
    ]),
    typesByCategory: new Map([
      [
        "armchairs",
        [
          { code: "S", name: "Sofas", provisionalNote: null, suggestWords: ["sofa"], suggestDefault: false },
          { code: "A", name: "Armchairs", provisionalNote: null, suggestWords: [], suggestDefault: true },
          { code: "B", name: "Benches", provisionalNote: null, suggestWords: ["bench"], suggestDefault: false },
        ],
      ],
    ]),
    askedByCategory: new Map([["armchairs", new Set([130, 232])]]),
    askedLocalKeysByCategory: new Map(),
    answersByRecord: new Map(),
    slotsByRecord: new Map(),
    localsByRecord: new Map(),
    questionsByCategory: new Map([
      [
        "armchairs",
        [
          question({ requirement_id: "env", json_id: 130, prompt: "Indoor/ Outdoor / Humid environment" }),
          question({ requirement_id: "swv", json_id: 232, prompt: "Swivel?" }),
        ],
      ],
    ]),
  };
  const labels = (matrixType: string | null) =>
    itemTgqForRecord(context, { id: "sofa", categoryId: "armchairs", matrixType }, []).rows.map((row) => row.label);

  it("typed S loses Swivel; untyped keeps it", () => {
    expect(labels("S")).toEqual(["Indoor/ Outdoor / Humid environment"]);
    expect(labels(null)).toEqual(["Indoor/ Outdoor / Humid environment", "Swivel?"]);
  });

  it("an accepted type the sheet does not map keeps the union, never an empty gate", () => {
    expect(labels("D")).toEqual(["Indoor/ Outdoor / Humid environment", "Swivel?"]);
    const gates = gatesForRecord(context, { id: "sofa", categoryId: "armchairs", matrixType: "S" });
    expect(gates?.TGQ.fields.map((f) => f.field.matrixRow)).toEqual([9]);
  });
});
