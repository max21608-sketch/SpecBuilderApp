// One spec record: what documents have said about it, and what its category's
// checklist still asks.
//
// The ATTRIBUTES come first in the payload and on the screen, because they are
// the intake stage's product: statements a client document made about this
// item, each traceable to a page. The cheat-sheet answers are a later stage's
// measure and may not even be assigned yet.
import { z } from "zod";
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import {
  setRecordCategory,
  setRecordLevel,
  type SetCategoryResult,
  type SetLevelResult,
} from "@/lib/record-category";
import { ITEM_LEVELS } from "@/lib/spec-vocab";
import { editRecordDetails, type EditRecordDetailsResult } from "@/lib/manual-capture";
import { gatesForRecord, loadGateContext, loadTgqMatrices } from "@/lib/gate-load";
import {
  designerKey,
  loadOutstanding,
  loadSentCoverage,
  waitingByQuestion,
} from "@/lib/chase-drafts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  const rows = await sql`
    select r.id, r.record_no, r.item_description, r.product_reference, r.qty, r.designer, r.area,
           r.spec_description, r.internal_notes,
           r.boq_category, r.status, r.version, r.source_line_no, r.category_id, r.level,
           r.level_suggested, r.level_suggested_reason,
           r.parent_id, r.variant_label,
           p.bws_project_number, p.name as project_name, p.id as project_id,
           run.id as run_id, run.name as run_name,
           c.name as category_name, c.family as category_family, c.requirements_authored
    from spec_records r
    join projects p on p.id = r.project_id
    join spec_runs run on run.id = r.run_id
    left join item_categories c on c.id = r.category_id
    where r.id = ${id}
  `;
  const record = rows[0];
  if (!record) return json({ ok: false, error: "No such record." }, 404);

  const refs = await sql`
    select ref_system, ref_value, source from spec_record_refs where record_id = ${id} order by ref_system, ref_value
  `;

  // The document's own words, with the page they came from. `source_filename`
  // and `source_page` are what make a value re-checkable: a value whose source
  // cannot be named is a value nobody can question.
  const attributes = await sql`
    select a.id, a.attr_group, a.label, a.value, a.qualifier, a.unit, a.dimension_slot, a.material_code, a.state, a.status,
           a.sort_order, a.version, a.source_page, a.source_run_id, a.created_at, a.created_by,
           f.name as field_name, f.json_id, f.field_category,
           a.finish_id, fin.code as finish_code, fin.description as finish_description, fin.state as finish_state,
           src.filename as source_filename, src.document_kind as source_document_kind
    from record_attributes a
    left join spec_fields f on f.id = a.spec_field_id
    left join project_finishes fin on fin.id = a.finish_id
    left join (
      select r.id, r.document_kind, at.filename
      from intake_runs r left join attachments at on at.id = r.attachment_id
    ) src on src.id = a.source_run_id
    where a.record_id = ${id} and a.status = 'active'
    order by a.attr_group, a.sort_order, a.created_at
  `;

  // Retired specs, separately. They are kept as evidence that a document said
  // something, and every dismissal in this app is reversible — so they have to
  // be visible somewhere, or "retire" is a delete with extra steps.
  const retired = await sql`
    select a.id, a.attr_group, a.label, a.value, a.unit, a.dimension_slot, a.material_code, a.state,
           a.sort_order, a.version, a.source_page, a.source_run_id, a.retired_at, a.retired_by,
           a.superseded_by_id,
           f.name as field_name, f.json_id,
           src.filename as source_filename
    from record_attributes a
    left join spec_fields f on f.id = a.spec_field_id
    left join (
      select r.id, r.document_kind, at.filename
      from intake_runs r left join attachments at on at.id = r.attachment_id
    ) src on src.id = a.source_run_id
    where a.record_id = ${id} and a.status = 'retired'
    order by a.retired_at desc nulls last
  `;

  // LEFT JOIN from requirements: a question with no answer row must still be
  // asked, as `missing`. An uncategorised record has no questions at all —
  // which is NOT the same as having none outstanding, and the screen says so.
  const answers = await sql`
    select q.id as requirement_id, q.kind, q.prompt, q.help_text, q.section, q.sort_order,
           q.tgq_levels, q.local_key,
           f.name as field_name, f.json_id, f.field_category,
           a.id as answer_id, a.value, a.qualifier, a.state, a.version, a.confirmed_by, a.confirmed_at
    from requirements q
    left join spec_fields f on f.id = q.spec_field_id
    left join spec_answers a on a.requirement_id = q.id and a.record_id = ${id} and a.revision_no = 0
    where q.category_id = (select category_id from spec_records where id = ${id})
    order by q.sort_order
  `;

  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  // The whole register, for the add-a-spec form. All 56, not the 36 in
  // Matthew's grid: the grid is a screen layout and never a filter, and a
  // field nobody can select is a spec value nobody can record.
  const specFields = await sql`
    select id, name, json_id from spec_fields order by sort_order
  `;

  // ---- the palettes a question may offer ----------------------------------
  //
  // The link is the GATE OVERLAY: Matthew's matrix is what says "Stitching
  // spec is one of these three", so the palette a question offers is looked up
  // by the BWS field it points at, or by its local key. A palette owned by BWS
  // comes back with no options, deliberately, and the screen says so in words
  // rather than showing an empty dropdown.
  const palettes = await sql`
    select p.key, p.name, p.owner, p.allows_free_text, p.source_note, p.synced_at,
           coalesce(
             (select json_agg(json_build_object(
                       'value', o.value, 'label', o.label,
                       'sortOrder', o.sort_order, 'isDefault', o.is_default)
                      order by o.sort_order)
                from spec_palette_options o where o.palette_key = p.key and o.active),
             '[]'::json) as options
      from spec_palettes p
     order by p.key
  `;

  // Which palette each question is answered from, if any. Keyed the two ways a
  // gate row can be addressed.
  const paletteByQuestion = await sql`
    select f.json_id, g.local_key, g.palette_key
      from spec_field_gates g
      left join spec_fields f on f.id = g.spec_field_id
     where g.palette_key is not null
  `;

  // ---- the gates -----------------------------------------------------------
  //
  // Matthew's decision matrix of 2026-09-17, as a seeded overlay (0026). NULL
  // where this record's category is not one of the nine seating categories it
  // covers — the screen says so in words, because an empty gate would compute
  // as "nothing outstanding" and report a cabinetry item TG0-ready over rules
  // nobody has written yet.
  //
  // Computed on every read and stored nowhere: a stored gate status would bump
  // the version every extraction snapshot and chase coverage row is taken
  // against, which is the `chased_at` trap.
  const gateContext = await loadGateContext(sql, [id]);
  const gates = gatesForRecord(gateContext, {
    id: String(record.id),
    categoryId: record.category_id ? String(record.category_id) : null,
  });

  // WHICH MODEL DECIDES THIS RECORD'S TGQ, sent as data rather than as a
  // verdict, so the screen runs the same `questionTier` the chase inventory
  // and the spec table run. Null means Matthew's matrix does not cover this
  // category and the 0019 placeholder applies — the fallback, never "nothing
  // blocks a quote". Serialised as arrays because a Set is not JSON.
  const tgqMatrix = record.category_id
    ? ((await loadTgqMatrices(sql)).get(String(record.category_id)) ?? null)
    : null;

  // ---- the fabric split, in both directions -------------------------------
  //
  // A bill line needs its configurations listed, because they are what the
  // export ships and this row is a heading. A configuration needs its bill
  // line named, because its own record number is just the next free one in the
  // project and says nothing about what it belongs to.
  //
  // One query serves both: every live record in this record's family. Ordered
  // with the parent first so a screen can take it off the front.
  const familyId = record.parent_id ? String(record.parent_id) : String(record.id);
  const family = await sql`
    select r.id, r.record_no, r.variant_label, r.qty, r.status, r.item_description,
           (select count(*) from record_attributes ra where ra.record_id = r.id and ra.status = 'active')
             as attribute_count,
           (select string_agg(x.ref_value, ', ' order by x.ref_value)
              from spec_record_refs x where x.record_id = r.id) as refs
      from spec_records r
     where (r.id = ${familyId} or r.parent_id = ${familyId})
       and r.status = 'active'
     order by r.parent_id nulls first, r.variant_label
  `;

  // ---- what has already been ASKED about this record ----------------------
  //
  // Waiting is DERIVED, never stored (0005): a `chased_at` column fires
  // bump_version and invalidates every extraction snapshot taken against the
  // answer, for a reason that has nothing to do with the answer. So a question
  // is waiting when it is still outstanding AND some sent draft item still
  // matches it, which `isCoverageFresh` decides by comparing a context
  // snapshot no SQL expression can reproduce.
  //
  // THE COST IS A WHOLE-PROJECT LOAD FOR ONE RECORD. `loadOutstanding` and
  // `loadSentCoverage` both take a project, and the chase screen's numbers are
  // computed from them — so this route calls them for the project and filters
  // to this record. Re-expressing the rule in SQL for one record would be a
  // second implementation of Waiting, which is how two screens come to disagree
  // about whether somebody has already been asked. Two queries, bounded by the
  // project's own size.
  const projectId = String(record.project_id);
  const [projectOutstanding, sentCoverage] = await Promise.all([
    loadOutstanding(projectId),
    loadSentCoverage(projectId),
  ]);
  const outstanding = projectOutstanding.filter((question) => question.recordId === id);
  // Filtered FIRST: a coverage row for another record then matches no live
  // question and drops out on its own, which is the same answer the unfiltered
  // call gives for this record's keys.
  const waitingMap = waitingByQuestion(outstanding, sentCoverage);
  const waiting: Record<string, { draftId: string; sentAt: string | null; contactName: string }> = {};
  for (const [key, info] of waitingMap) waiting[key] = info;

  // ---- who to ask ----------------------------------------------------------
  //
  // `spec_records.designer` is free text off the BOQ and `project_contacts`
  // stores the code already normalised, so `designerKey` is the one place the
  // two have to agree — the same function `groupByContact` matches on, so the
  // "Ask Hayley" link on this screen and the chase screen's grouping can never
  // name different people.
  //
  // A code held by two contacts resolves to NOBODY. The partial unique index on
  // (project_id, designer_code) makes that unreachable today; the flag is what
  // would make its loss visible rather than letting this route quietly pick one.
  const contactRows = await sql`
    select id, name, email, role, designer_code
      from project_contacts where project_id = ${projectId} and designer_code is not null
  `;
  const wanted = designerKey(record.designer as string | null);
  const matches = wanted ? contactRows.filter((row) => String(row.designer_code) === wanted) : [];
  const designerContact = matches.length === 1 ? matches[0] : null;

  // ---- can this item be priced --------------------------------------------
  //
  // The tier is read off the rows `loadOutstanding` already tiered, never
  // recomputed here: `questionTier` is one implementation with six callers, and
  // a seventh reading is how the record screen and the spec table start
  // reporting different figures under one name.
  //
  // A NULL TIER IS A DASH, NEVER A ZERO. It means the fallback model with no
  // level — `questionTierOrNull` refuses to pick a reading, because "needed at
  // any level" makes the record look urgent and "needed at none" makes it look
  // quotable. Both counts go null together: reporting `alsoOutstanding: 0`
  // beside 48 untiered questions would be a number that is simply false.
  const untiered = outstanding.some((question) => question.tier === null);
  const settled = answers.filter((row) => String(row.state ?? "") === "confirmed").length;
  const notApplicable = answers.filter((row) => String(row.state ?? "") === "na").length;
  const quoteReadiness = {
    toQuote: untiered ? null : outstanding.filter((question) => question.tier === "to_quote").length,
    // ---- AND HOW MANY OF THOSE A CHASE WOULD ACTUALLY ASK ------------------
    //
    // A READINESS QUESTION IS OURS TO RECORD AND IS NEVER CHASED (decision
    // 19). `groupByContact` has excluded them from its own to-quote figure
    // since it was written, and the chase screen preselects `spec_field` rows
    // only — so a button reading "Chase the 5" that lands on a screen ticking
    // four is the same defect one screen later. That pair was read out loud on
    // 2026-09-18 and nobody in the room could say why the numbers differed.
    //
    // `toQuote` keeps its meaning exactly — it is what the Quote readiness
    // tile counts and what the spec table's TGQ column counts — and the button
    // gets its own number rather than one of them being quietly redefined.
    // Two names for two counts, because they answer two questions.
    //
    // `waiting` is deliberately NOT excluded here: whether to re-ask something
    // already chased is a decision the chase screen offers a control for, and
    // a header that silently dropped those would understate the work.
    toChase: untiered
      ? null
      : outstanding.filter((question) => question.tier === "to_quote" && question.requirementKind === "spec_field")
          .length,
    alsoOutstanding: untiered ? null : outstanding.filter((question) => question.tier === "later").length,
    /** Missing plus TBC, whatever the tier. Always a number, so a dash above it still has a size beside it. */
    outstanding: outstanding.length,
    settled,
    notApplicable,
    noLevel: untiered,
  };

  // ---- why these questions -------------------------------------------------
  //
  // Matthew's matrix rows for this category, as DATA. Null where his matrix
  // does not cover the category — the `gatesForRecord` rule, and for its
  // reason: an empty list computes as "nothing outstanding" and would report a
  // cabinetry item ready against rules nobody has written.
  const matrixFieldRows = record.category_id
    ? (gateContext.fieldsByCategory.get(String(record.category_id)) ?? null)
    : null;
  const matrixFields =
    matrixFieldRows && matrixFieldRows.length > 0
      ? matrixFieldRows.map((field) => ({
          matrixRow: field.matrixRow,
          gate: field.gate,
          capture: field.capture,
          fieldName: field.fieldName,
          jsonId: field.specFieldJsonId,
          localKey: field.localKey,
          dimensionSlot: field.dimensionSlot,
          valueType: field.valueType,
          paletteKey: field.paletteKey,
          paletteRaw: field.paletteRaw,
          conditionalOnKey: field.conditionalOnKey,
          conditionalOnValue: field.conditionalOnValue,
          notes: field.notes,
        }))
      : null;

  return json({
    ok: true,
    record,
    refs,
    attributes,
    retiredAttributes: retired,
    answers,
    categories,
    specFields,
    palettes,
    paletteByQuestion,
    family,
    gates,
    tgqMatrix: tgqMatrix
      ? { fields: [...tgqMatrix.fields], localKeys: [...tgqMatrix.localKeys] }
      : null,
    // Keyed by `questionKey(recordId, requirementId, 0)`, so a checklist row
    // looks its own chase up without the screen matching on anything.
    waiting,
    designerContact,
    designerContactAmbiguous: matches.length > 1,
    quoteReadiness,
    matrixFields,
  });
}

/**
 * Exactly one of `categoryId` or `level` per request.
 *
 * A union rather than two optional fields: each is its own decision, recorded
 * under its own change-set kind, and a body carrying both would have to pick
 * one kind for two changes. `level` accepts null — "I do not know yet" is a
 * real answer and must be reversible.
 */
const Patch = z.union([
  z.object({ categoryId: z.string().uuid(), version: z.number().int().nonnegative() }).strict(),
  z
    .object({
      level: z.enum(ITEM_LEVELS).nullable(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
  // THE THIRD SHAPE, from 0028: the bill's own words, and the two free-text
  // columns. A typo in an item description used to be permanent, and there was
  // nowhere at all to write down what the structured fields cannot hold.
  //
  // Several fields at once, unlike the two above, because they are one act --
  // somebody correcting a row -- rather than two decisions. `changed` comes
  // back so the screen can say what moved, and a no-op records nothing.
  z
    .object({
      details: z
        .object({
          itemDescription: z.string().min(1).max(2000).optional(),
          area: z.string().max(300).nullable().optional(),
          qty: z.number().int().nonnegative().nullable().optional(),
          designer: z.string().max(200).nullable().optional(),
          specDescription: z.string().max(20000).nullable().optional(),
          internalNotes: z.string().max(20000).nullable().optional(),
        })
        .strict(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
]);

/**
 * Sets the record's category (and creates the answer rows that go with it), or
 * its item level.
 *
 * The category exists because intake no longer blocks on one: without it, a
 * record imported without a category could never acquire one. Creating the
 * answers in the same transaction matters — a category with no answers scores
 * 0/0 and reads as complete, the same class of error as an empty programme
 * rendering as a healthy one.
 *
 * The LEVEL decides which of those questions hold up a quote (0019). Nothing
 * infers it, so until a person sets one the record has no tier at all.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) {
    // A union's own message is "Invalid input" with an empty path, which tells
    // a reader nothing. Say which of the two shapes was meant and what is
    // wrong with it.
    const body = raw as Record<string, unknown> | null;
    if (body && "level" in body) {
      return json(
        {
          ok: false,
          error: `A level is one of ${ITEM_LEVELS.join(", ")}, or null to clear it.`,
          field: "level",
        },
        400,
      );
    }
    const issue = parsed.error.issues[0];
    return json(
      {
        ok: false,
        error: issue?.message ?? "Send either a category or a level, with the version you were looking at.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  try {
    const body = parsed.data;
    const result = await withTransaction<SetCategoryResult | SetLevelResult | EditRecordDetailsResult>((txn) =>
      "details" in body
        ? editRecordDetails(txn, {
            recordId: id,
            patch: body.details,
            expectedVersion: body.version,
            actor: user.email,
          })
        : "categoryId" in body
        ? setRecordCategory(txn, {
            recordId: id,
            categoryId: body.categoryId,
            expectedVersion: body.version,
            actor: user.email,
          })
        : setRecordLevel(txn, {
            recordId: id,
            level: body.level,
            expectedVersion: body.version,
            actor: user.email,
          }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
