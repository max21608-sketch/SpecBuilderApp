// A finishes schedule read as a list of finishes (brief C, 2026-10-04).
//
// Every code, name and supplier here is INVENTED in the real shape: three
// stacked boxes read as `AB TIM 01`, sub-codes like `AB TIM 02.1`, a furniture
// section the schedule also carries. No client document content is in this
// repo.
import { describe, expect, it } from "vitest";
import {
  FinishesScheduleOutput,
  FINISHES_SCHEDULE_TOOL,
  RawFinishEntry,
  TOOLS,
} from "@/lib/extraction-schema";
import { PROMPTS } from "@/lib/anthropic";
import { isRegisterFreeKind } from "@/lib/spec-vocab";
import {
  assertStagedFinishSchedule,
  composeScheduleFinish,
  isStagedFinishSchedule,
  reviewFinishSchedule,
  scheduleCode,
  stageFinishSchedule,
  suggestEntryKind,
  verdictIsSkipped,
  type LibraryFinish,
  type StagedFinishSchedule,
} from "@/lib/finish-schedule";
import { normaliseFinishCode } from "@/lib/finishes";

/** One entry as the model returns it, every field null unless said. */
function raw(over: Partial<RawFinishEntry> = {}): RawFinishEntry {
  return RawFinishEntry.parse({
    codeRaw: null,
    kindRaw: null,
    nameRaw: null,
    descriptionRaw: null,
    substrateRaw: null,
    finishRaw: null,
    colourRaw: null,
    sheenRaw: null,
    supplierRaw: null,
    referenceRaw: null,
    appliesToRaw: null,
    statusRaw: null,
    page: null,
    otherRaw: [],
    ...over,
  });
}

let counter = 0;
const ids = () => `entry-${(counter += 1)}`;

function stage(entries: RawFinishEntry[]): StagedFinishSchedule {
  counter = 0;
  return stageFinishSchedule(entries, "__QA schedule.pdf", null, ids);
}

function held(code: string, over: Partial<LibraryFinish> = {}): LibraryFinish {
  return {
    id: `finish-${code}`,
    code,
    codeNorm: normaliseFinishCode(code),
    codeOrigin: "client",
    kind: null,
    description: null,
    supplierRaw: null,
    reference: null,
    colour: null,
    notes: null,
    state: "tbc",
    version: 1,
    ...over,
  };
}

describe("the finishes schedule's tool and schema", () => {
  it("is its own shape, read at review time, under its own prompt", () => {
    expect(TOOLS.finishes_schedule.outputKind).toBe("finish_entries");
    expect(TOOLS.finishes_schedule.tool).toBe(FINISHES_SCHEDULE_TOOL);
    expect(isRegisterFreeKind("finishes_schedule")).toBe(true);
    // The other schedules are untouched.
    expect(TOOLS.fabric_schedule.outputKind).toBe("observations");
  });

  it("asks for a code on every entry, and for every field verbatim or null", () => {
    const item = FINISHES_SCHEDULE_TOOL.input_schema.properties.entries.items;
    expect(item.required).toEqual(
      expect.arrayContaining([
        "codeRaw",
        "kindRaw",
        "nameRaw",
        "descriptionRaw",
        "substrateRaw",
        "finishRaw",
        "colourRaw",
        "sheenRaw",
        "supplierRaw",
        "referenceRaw",
        "appliesToRaw",
        "statusRaw",
        "page",
        "otherRaw",
      ]),
    );
    expect(item.properties.codeRaw.description).toMatch(/EXACTLY as printed, spacing included/);
  });

  it("tells the model to read every entry, keep the code as printed, and never infer a kind", () => {
    expect(PROMPTS.finishes_schedule).toMatch(/Record EVERY finish entry/);
    expect(PROMPTS.finishes_schedule).toMatch(/exactly as printed, spacing included/);
    expect(PROMPTS.finishes_schedule).toMatch(/Never describe a code in your own words/);
    expect(PROMPTS.finishes_schedule).toMatch(/NEVER INFER A KIND/);
    // A tracker's furniture is not a finish.
    expect(PROMPTS.finishes_schedule).toMatch(/is an item,\s+not a finish/);
  });

  it("reads a bare string as ONE entry with no code, and a bare string line as an unlabelled one", () => {
    const parsed = FinishesScheduleOutput.parse({ entries: "Natural oak, matt lacquer", documentNotes: null });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ codeRaw: null, descriptionRaw: "Natural oak, matt lacquer", otherRaw: [] });

    const entry = FinishesScheduleOutput.parse({
      entries: [{ codeRaw: "AB TIM 01", otherRaw: "Edges: eased" }, null],
      documentNotes: null,
    }).entries;
    expect(entry).toHaveLength(1);
    expect(entry[0]!.otherRaw).toEqual([{ labelRaw: null, valueRaw: "Edges: eased" }]);
  });

  it("degrades a malformed optional field to null and never fails a paid read over a line", () => {
    const parsed = FinishesScheduleOutput.parse({
      entries: [{ codeRaw: 7, nameRaw: { what: "?" }, page: "two", otherRaw: [{ labelRaw: "Edges", valueRaw: "Eased" }, 4, null] }],
      documentNotes: 12,
    });
    expect(parsed.entries[0]).toMatchObject({ codeRaw: null, nameRaw: null, page: null });
    expect(parsed.entries[0]!.otherRaw).toEqual([
      { labelRaw: "Edges", valueRaw: "Eased" },
      { labelRaw: null, valueRaw: "4" },
    ]);
    expect(parsed.documentNotes).toBeNull();
  });

  it("still refuses an absent list, which is a failure to answer rather than an empty schedule", () => {
    expect(FinishesScheduleOutput.safeParse({ documentNotes: null }).success).toBe(false);
  });
});

describe("staging", () => {
  it("stages version 2, every field kept, nothing filed and no kind", () => {
    const staged = stage([raw({ codeRaw: "AB TIM 01", kindRaw: "TIMBER", page: 4 })]);
    expect(staged).toMatchObject({ schemaVersion: 2, kind: "finishes_schedule", filename: "__QA schedule.pdf" });
    expect(staged.entries[0]).toMatchObject({
      id: "entry-1",
      version: 1,
      codeRaw: "AB TIM 01",
      kindRaw: "TIMBER",
      page: 4,
      kind: null,
      reviewStatus: "pending",
      applied: null,
    });
    expect(isStagedFinishSchedule(staged)).toBe(true);
  });

  it("tells a version 1 proposals document apart, so it keeps its own screen", () => {
    const v1 = { schemaVersion: 1, lines: [], documentNotes: null, filename: "x.pdf" };
    expect(isStagedFinishSchedule(v1)).toBe(false);
    expect(() => assertStagedFinishSchedule(v1)).toThrow(/not staged as a finishes schedule/);
  });
});

describe("the code the library files it under", () => {
  it("writes three stacked boxes hyphenated, the way the bill and the drawings do", () => {
    expect(scheduleCode("AB TIM 01")).toBe("AB-TIM-01");
    expect(scheduleCode("ab  mtl   03")).toBe("AB-MTL-03");
    // The schedule's own sub-codes, which its prose writes hyphenated.
    expect(scheduleCode("AB TIM 02.1")).toBe("AB-TIM-02.1");
    expect(scheduleCode("AB FUR 03A")).toBe("AB-FUR-03A");
  });

  it("files anything else exactly as printed, with only its whitespace tidied", () => {
    expect(scheduleCode("CH-01.1")).toBe("CH-01.1");
    expect(scheduleCode(" WD-05 ")).toBe("WD-05");
    expect(scheduleCode("AB TIM 01 walnut")).toBe("AB TIM 01 walnut");
    expect(scheduleCode("TIM 01")).toBe("TIM 01");
    expect(scheduleCode(null)).toBeNull();
    expect(scheduleCode("   ")).toBeNull();
  });
});

describe("what the library row would say", () => {
  it("keeps substrate, finish, colour and sheen apart, labelled, on ONE line", () => {
    const composed = composeScheduleFinish(
      {
        ...stage([
          raw({
            nameRaw: "NATURAL OAK",
            descriptionRaw: "Crown cut",
            substrateRaw: "MDF",
            finishRaw: "Stained",
            colourRaw: "Mid brown",
            sheenRaw: "10% gloss",
          }),
        ]).entries[0]!,
      },
      null,
    );
    expect(composed.description).toBe(
      "NATURAL OAK, Crown cut; Substrate: MDF; Finish: Stained; Colour: Mid brown; Sheen: 10% gloss",
    );
    // A newline would reach a BWS cell through `composeFinishCell`.
    expect(composed.description).not.toMatch(/\n/);
  });

  it("puts provenance and every other labelled line in the notes, never the description", () => {
    const entry = stage([
      raw({
        nameRaw: "BRUSHED BRASS",
        supplierRaw: "Example Metalworks",
        referenceRaw: "QX-1234",
        appliesToRaw: "Joinery",
        statusRaw: "APPROVED",
        page: 3,
        otherRaw: [
          { labelRaw: "Surface", valueRaw: "Linear brushed" },
          { labelRaw: null, valueRaw: "Sample held" },
          { labelRaw: "Sealer", valueRaw: null },
        ],
      }),
    ]).entries[0]!;
    const composed = composeScheduleFinish(entry, "__QA schedule.pdf");
    expect(composed).toEqual({
      description: "BRUSHED BRASS",
      supplierRaw: "Example Metalworks",
      reference: "QX-1234",
      notes: "From __QA schedule.pdf, page 3; Used for: Joinery; Status: APPROVED; Surface: Linear brushed; Sample held",
    });
  });

  it("says nothing it was not given", () => {
    const composed = composeScheduleFinish(stage([raw({ codeRaw: "AB TIM 09" })]).entries[0]!, null);
    expect(composed).toEqual({ description: null, supplierRaw: null, reference: null, notes: null });
  });
});

describe("the kind, suggested and never filed", () => {
  it("reads the schedule's own section word first, and says so", () => {
    expect(suggestEntryKind({ kindRaw: "TIMBER", nameRaw: "Water based lacquer", descriptionRaw: null }, "AB-TIM-01")).toEqual({
      kind: "timber",
      reason: "the schedule files it under “TIMBER”",
    });
    expect(suggestEntryKind({ kindRaw: "STONE", nameRaw: null, descriptionRaw: null }, "AB-STN-01")?.kind).toBe("stone");
    expect(suggestEntryKind({ kindRaw: "METAL", nameRaw: null, descriptionRaw: null }, "AB-MTL-01")?.kind).toBe("metal");
  });

  it("falls back to the entry's own material words, and to nothing where none says", () => {
    expect(suggestEntryKind({ kindRaw: null, nameRaw: "White marble", descriptionRaw: null }, "AB-XX-01")?.kind).toBe("stone");
    expect(suggestEntryKind({ kindRaw: "GENERAL", nameRaw: "Sample 4", descriptionRaw: null }, "CH-01")).toBeNull();
  });

  it("is never written by staging", () => {
    const staged = stage([raw({ codeRaw: "AB TIM 01", kindRaw: "TIMBER" })]);
    expect(staged.entries[0]!.kind).toBeNull();
    const [row] = reviewFinishSchedule(staged, []);
    expect(row!.suggestion?.kind).toBe("timber");
  });
});

describe("the verdict per entry, against the library", () => {
  const schedule = stage([
    raw({ codeRaw: "AB TIM 01", nameRaw: "NATURAL OAK", supplierRaw: "Example Joinery", page: 1 }), // new
    raw({ codeRaw: "AB TIM 02", nameRaw: "SMOKED OAK" }), // held, nothing described: fills
    raw({ codeRaw: "AB MTL 01", nameRaw: "BRUSHED BRASS" }), // held, agreeing
    raw({ codeRaw: "AB STN 01", nameRaw: "WHITE MARBLE" }), // held, DIFFERENT
    raw({ codeRaw: "AB TIM 01", nameRaw: "NATURAL OAK" }), // repeated
    raw({ codeRaw: null, nameRaw: "Uncoded sample" }), // no code
  ]);
  const library = [
    held("AB-TIM-02", { kind: null }),
    held("AB-MTL-01", { description: "brushed brass", kind: "metal" }),
    held("AB-STN-01", { description: "Grey limestone" }),
  ];
  const rows = reviewFinishSchedule(schedule, library);

  it("is new where the library does not hold the code", () => {
    expect(rows[0]!.verdict).toEqual({ status: "new", code: "AB-TIM-01", codeNorm: "AB-TIM-01" });
  });

  it("FILLS a held code nobody has described, naming only the empty fields", () => {
    expect(rows[1]!.verdict).toMatchObject({ status: "fills", code: "AB-TIM-02", fills: ["description", "notes"] });
  });

  it("agrees where the library already says this, case apart", () => {
    expect(rows[2]!.verdict).toMatchObject({ status: "agrees", code: "AB-MTL-01" });
  });

  it("is a CONFLICT where the library has committed to something else, and that writes nothing", () => {
    expect(rows[3]!.verdict).toMatchObject({ status: "conflict", saysInstead: "WHITE MARBLE" });
    expect(verdictIsSkipped(rows[3]!.verdict!)).toBe(true);
  });

  it("files only the first entry carrying a code; the repeat is listed", () => {
    expect(rows[4]!.verdict).toEqual({ status: "repeated", code: "AB-TIM-01", firstEntryId: schedule.entries[0]!.id });
    expect(verdictIsSkipped(rows[4]!.verdict!)).toBe(true);
  });

  it("files nothing for an entry with no code", () => {
    expect(rows[5]!.verdict).toEqual({ status: "no_code" });
  });

  it("reads an applied or ignored entry as reviewed, and lets a later repeat take its place", () => {
    const ignoredFirst: StagedFinishSchedule = {
      ...schedule,
      entries: schedule.entries.map((entry, index) => (index === 0 ? { ...entry, reviewStatus: "ignored" } : entry)),
    };
    const again = reviewFinishSchedule(ignoredFirst, library);
    expect(again[0]!.verdict).toBeNull();
    expect(again[4]!.verdict).toMatchObject({ status: "new", code: "AB-TIM-01" });
  });

  it("puts a person's kind on a held code with none, and leaves a held kind alone", () => {
    const withKind: StagedFinishSchedule = {
      ...schedule,
      entries: schedule.entries.map((entry, index) => (index === 1 ? { ...entry, kind: "timber" as const } : entry)),
    };
    expect(reviewFinishSchedule(withKind, library)[1]!.verdict).toMatchObject({
      status: "fills",
      fills: ["description", "notes", "kind"],
    });
  });
});
