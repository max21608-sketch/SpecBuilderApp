// Loading what the resolver matches against.
//
// Split out from spec-document.ts so that file stays pure and unit-testable
// with a fixture: the rules are the part that must never silently change, and a
// module that talks to a database cannot be tested without one.
//
// Loaded ONCE, before the model call, and passed in whole. Not queried per
// proposal: a 400-observation document would otherwise issue 400 round trips
// mid-run, and the register could change underneath the resolution — half the
// proposals matched against one set of records and half against another.
import { sql } from "@/lib/db";
import {
  isDimensionSlot,
  normaliseUnit,
  type AnswerState,
  type AttributeGroup,
  type AttributeState,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import type { SpecFieldEntry } from "@/lib/drawing-document";
import type { AnswerEntry, AttributeEntry, RecordEntry, Registers, RequirementEntry } from "@/lib/spec-document";
// The same label the chase emails use. Two spellings of one record number would
// make a proposal and a chase about the same item look like different items.
import { recordLabel } from "@/lib/chase-drafts";

export async function loadExtractionRegisters(projectId: string): Promise<Registers> {
  // Active records only. A retired record is not a thing a new observation
  // should land on, and a draft one has not been confirmed into existence.
  const recordRows = await sql`
    select r.id, r.record_no, r.item_description, r.category_id, r.version,
           c.name as category_name,
           p.bws_project_number,
           r.run_id, run.name as run_name,
           r.parent_id, r.variant_label,
           coalesce(
             (select array_agg(x.ref_value order by x.ref_value)
                from spec_record_refs x where x.record_id = r.id),
             '{}'
           ) as refs,
           coalesce(
             (select array_agg(x.ref_value order by x.ref_value)
                from spec_record_refs x where x.record_id = r.id and x.ref_system = 'boq_code'),
             '{}'
           ) as boq_codes
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    where r.project_id = ${projectId} and r.status = 'active'
    order by run.sort_order, r.record_no
  `;

  const records: RecordEntry[] = recordRows.map((row) => ({
    id: String(row.id),
    recordNo: Number(row.record_no),
    label: recordLabel(String(row.bws_project_number), Number(row.record_no)),
    itemDescription: String(row.item_description),
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: row.category_name ? String(row.category_name) : null,
    refs: (row.refs as string[] | null)?.map(String) ?? [],
    boqCodes: (row.boq_codes as string[] | null)?.map(String) ?? [],
    runId: String(row.run_id),
    runName: String(row.run_name),
    // A CONFIGURATION carries no client ref of its own (variant-create.ts keeps
    // `S-201` on the parent, deliberately, or every card would resolve as
    // ambiguous). So it can never be reached by `findRecordsByRef`, and without
    // these two columns it arrived in the manual record dropdown looking
    // exactly like its own parent — same description, no letter, distinguished
    // only by a record number nobody reads. They are what lets a screen say
    // "S-201 A" and what lets the resolver see that a configuration exists.
    parentId: row.parent_id ? String(row.parent_id) : null,
    variantLabel: row.variant_label ? String(row.variant_label) : null,
    version: Number(row.version),
  }));

  // Only the categories this project actually uses. The full register is 728
  // requirements across 17 categories; a project using three of them has no use
  // for the other fourteen, and matching is scoped per record's category anyway.
  const categoryIds = [...new Set(records.map((record) => record.categoryId).filter((id): id is string => Boolean(id)))];

  const requirementRows = categoryIds.length
    ? await sql`
        select q.id, q.category_id, q.kind, q.prompt, q.section, f.name as spec_field_name,
               coalesce(
                 (select array_agg(a.term order by a.term)
                    from requirement_aliases a where a.requirement_id = q.id),
                 '{}'
               ) as aliases
        from requirements q
        left join spec_fields f on f.id = q.spec_field_id
        where q.category_id = any(${categoryIds}::uuid[])
        order by q.sort_order
      `
    : [];

  const requirements: RequirementEntry[] = requirementRows.map((row) => ({
    id: String(row.id),
    categoryId: String(row.category_id),
    prompt: String(row.prompt),
    kind: String(row.kind) as RequirementEntry["kind"],
    section: row.section ? String(row.section) : null,
    specFieldName: row.spec_field_name ? String(row.spec_field_name) : null,
    aliases: (row.aliases as string[] | null)?.map(String) ?? [],
  }));

  // revision_no = 0 is the live revision. VE rounds (M6) add others; a snapshot
  // taken against the wrong revision would compare a proposal to a superseded
  // answer.
  const answerRows = records.length
    ? await sql`
        select a.id, a.record_id, a.requirement_id, a.version, a.state, a.value
        from spec_answers a
        join spec_records r on r.id = a.record_id
        where r.project_id = ${projectId} and a.revision_no = 0
      `
    : [];

  const answers: AnswerEntry[] = answerRows.map((row) => ({
    id: String(row.id),
    recordId: String(row.record_id),
    requirementId: String(row.requirement_id),
    version: Number(row.version),
    state: String(row.state) as AnswerState,
    value: row.value === null || row.value === undefined ? null : String(row.value),
  }));

  // The ACTIVE dimension attributes, so a dimension proposal can see the slot
  // it would replace. Active only: 0016's partial unique index is
  // `where status = 'active'`, so a retired row is not in the way and offering
  // it as something to replace would be offering to retire it twice.
  const attributeRows = records.length
    ? await sql`
        select a.id, a.record_id, a.attr_group, a.dimension_slot, a.spec_field_id,
               a.label, a.value, a.unit, a.state, a.version
        from record_attributes a
        join spec_records r on r.id = a.record_id
        where r.project_id = ${projectId} and a.status = 'active'
      `
    : [];

  const attributes: AttributeEntry[] = attributeRows.map((row) => ({
      id: String(row.id),
      recordId: String(row.record_id),
      attrGroup: String(row.attr_group) as AttributeGroup,
      slot: isDimensionSlot(row.dimension_slot) ? (String(row.dimension_slot) as DimensionSlot) : null,
      specFieldId: row.spec_field_id ? String(row.spec_field_id) : null,
      label: String(row.label),
      value: row.value === null || row.value === undefined ? null : String(row.value),
      unit: normaliseUnit(row.unit),
      state: String(row.state) as AttributeState,
      version: Number(row.version),
  }));

  // The BWS register, for placing a finish in the first free slot of its kind.
  const fieldRows = await sql`select id, json_id, name from spec_fields order by json_id`;
  const specFields: SpecFieldEntry[] = fieldRows.map((row) => ({
    id: String(row.id),
    jsonId: Number(row.json_id),
    name: String(row.name),
  }));

  return { records, requirements, answers, attributes, specFields };
}
