// Database tier — every controlled vocabulary, against its own CHECK.
//
// ============================================================================
// THE GUARD THAT WOULD HAVE CAUGHT 0028 IN ONE SECOND.
//
// A CHECK constraint cannot be extended, so adding a value means dropping and
// recreating it with the WHOLE list — and the whole list gets copied from
// whichever migration most recently re-listed it. 0028 copied 0019's copy,
// which predated 0021, and so silently deleted `email_confirm`. Every email
// confirm then failed with a constraint violation reaching the reviewer as
// "Nothing was written", and the cause was a value nobody had typed.
//
// There are twelve of these vocabularies. Each is a TypeScript constant AND a
// CHECK, and the `external-vocabulary-sync` skill's rule is that the two must
// change together. Nothing asserted it until now.
//
// A value in the DATABASE that the constant does not know is reported too, and
// is not always a bug: `spec_answers.source_kind` has allowed 'email' since
// 0002 and nothing wrote it for months. So the assertion is directional —
// EVERY CONSTANT VALUE MUST BE ALLOWED — plus a report of the other direction.
//
// Skips silently without DATABASE_URL. Creates nothing.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb } from "./db-tier";
import pg from "pg";
import {
  ANSWER_SOURCES,
  ANSWER_STATES,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  DOCUMENT_KINDS,
  ITEM_LEVELS,
  REF_SYSTEMS,
  REQUIREMENT_KINDS,
  SPLIT_REASONS,
} from "@/lib/spec-vocab";
import { CHANGE_SET_KINDS } from "@/lib/change-sets";
import { FINISH_KINDS } from "@/lib/finishes";

const databaseUrl = process.env.DATABASE_URL;

/** Constant, and the CHECK that has to allow every one of its values. */
const VOCABULARIES: {
  name: string;
  constraint: string;
  values: readonly string[];
  /**
   * Literals in the same CHECK that belong to a DIFFERENT column.
   *
   * `intake_runs_document_kind_check` is a CASE over `source_kind`, so its
   * text carries 'spec_document' and 'boq_xlsx' as well as the document kinds.
   * Naming them is better than skipping the constraint: the drift report keeps
   * working for every value that IS a document kind.
   */
  otherColumns?: readonly string[];
}[] = [
  { name: "CHANGE_SET_KINDS", constraint: "change_sets_kind_check", values: CHANGE_SET_KINDS },
  { name: "ANSWER_STATES", constraint: "spec_answers_state_check", values: ANSWER_STATES },
  { name: "ANSWER_SOURCES", constraint: "spec_answers_source_kind_check", values: ANSWER_SOURCES },
  { name: "ATTRIBUTE_GROUPS", constraint: "record_attributes_group_check", values: ATTRIBUTE_GROUPS },
  { name: "ATTRIBUTE_UNITS", constraint: "record_attributes_unit_check", values: ATTRIBUTE_UNITS },
  { name: "DIMENSION_SLOTS", constraint: "record_attributes_dimension_slot_check", values: DIMENSION_SLOTS },
  { name: "REF_SYSTEMS", constraint: "spec_record_refs_system_check", values: REF_SYSTEMS },
  { name: "ITEM_LEVELS", constraint: "spec_records_level_check", values: ITEM_LEVELS },
  {
    name: "DOCUMENT_KINDS",
    constraint: "intake_runs_document_kind_check",
    values: DOCUMENT_KINDS,
    otherColumns: ["spec_document", "boq_xlsx"],
  },
  { name: "SPLIT_REASONS", constraint: "spec_records_split_reason_check", values: SPLIT_REASONS },
  { name: "REQUIREMENT_KINDS", constraint: "requirements_kind_check", values: REQUIREMENT_KINDS },
  { name: "FINISH_KINDS", constraint: "project_finishes_kind_check", values: FINISH_KINDS },
];

/** Every single-quoted literal in a constraint definition. */
function allowedValues(definition: string): string[] {
  return [...definition.matchAll(/'((?:[^']|'')*)'/g)].map((match) => (match[1] ?? "").replace(/''/g, "'"));
}

describeIfDb("every controlled vocabulary matches its CHECK", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const definitions = new Map<string, string>();

  beforeAll(async () => {
    await client.connect();
    const rows = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conname = any($1::text[])`,
      [VOCABULARIES.map((entry) => entry.constraint)],
    );
    for (const row of rows.rows) definitions.set(String(row.conname), String(row.def));
  });

  afterAll(async () => {
    await client.end();
  });

  it("finds every constraint it claims to check, so a rename cannot hide one", () => {
    // A vocabulary whose constraint was renamed would otherwise pass this file
    // by being skipped, which is the failure mode a guard must not have.
    const missing = VOCABULARIES.filter((entry) => !definitions.has(entry.constraint)).map((entry) => entry.constraint);
    expect(missing).toEqual([]);
  });

  for (const vocabulary of VOCABULARIES) {
    it(`${vocabulary.name}: the database allows every value the constant holds`, () => {
      const definition = definitions.get(vocabulary.constraint);
      expect(definition, `${vocabulary.constraint} not found`).toBeTruthy();
      const allowed = new Set(allowedValues(definition ?? ""));
      const rejected = vocabulary.values.filter((value) => !allowed.has(value));
      // This is the assertion that would have caught 0028 deleting
      // 'email_confirm' by copying a stale list.
      expect(rejected, `${vocabulary.constraint} rejects: ${rejected.join(", ")}`).toEqual([]);
    });
  }

  it("reports any value the DATABASE allows and the constants do not", () => {
    // Not a failure on its own. `spec_answers.source_kind` allowed 'email'
    // from 0002 and nothing wrote it for months, which was deliberate. This
    // exists so the drift is visible rather than discovered by a 500.
    const drift: string[] = [];
    for (const vocabulary of VOCABULARIES) {
      const definition = definitions.get(vocabulary.constraint);
      if (!definition) continue;
      const known = new Set<string>([...vocabulary.values, ...(vocabulary.otherColumns ?? [])]);
      for (const value of allowedValues(definition)) {
        if (!known.has(value)) drift.push(`${vocabulary.name} does not know '${value}'`);
      }
    }
    // Today there is none. If this fails, read the list: a new value in the
    // database that no constant knows is either a vocabulary change nobody
    // mirrored, or a deliberate reservation that belongs in a comment.
    expect(drift).toEqual([]);
  });
});
