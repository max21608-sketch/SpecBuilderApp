// What this project still owes, arranged so a person can answer it.
//
// ============================================================================
// THE SAME LOADER AS THE CHASE SCREEN, AND A DIFFERENT PAYLOAD
//
// `GET /api/drafts` returns every outstanding question on the project, because
// the chase screen groups them in the browser and a tick box needs the whole
// list. Measured on the sandbox 300-line project (`npm run measure:outstanding`,
// 2026-09-20) that is 19,582 questions and 18,976 KB of JSON — a page that
// never finishes loading on the only project that looks like a real one.
//
// So this route answers in two shapes over ONE loader:
//
//   no scope        the lines, collapsed: identity and two counts each, plus
//                   the facets the filters need. 407 lines, not 19,582 rows.
//   ?line=<id>      the questions on ONE furniture line, with everything the
//                   edit rows need — what is already known, what the library
//                   calls a finish code, what the record already measures.
//
// The scope is a WHERE clause on `loadOutstanding`, never a second query: the
// predicates it carries (active record, active phase, a split bill line being
// a heading) are the ones two screens have already disagreed over once.
//
// NOTHING HERE WRITES. The edit rows post to `PATCH /api/answers/[id]` and
// `POST /api/attributes`, which is where the optimistic lock, the change set
// and the reason rule already live.
// ============================================================================
import { sql, json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  loadOutstanding,
  loadSentCoverage,
  loadUncategorisedRecords,
  questionKey,
  waitingByQuestion,
  type OutstandingQuestion,
} from "@/lib/chase-drafts";
import { summariseLines, infillTotals, type InfillDimension, type InfillQuestion, type InfillSister } from "@/lib/infill";
import { normaliseFinishCode } from "@/lib/finishes";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id: projectId } = await context.params;

  const projects = await sql`
    select id, bws_project_number, name, client from projects where id = ${projectId}
  `;
  const project = projects[0];
  if (!project) return json({ ok: false, error: "No such project." }, 404);

  const params = new URL(request.url).searchParams;
  const lineId = params.get("line");

  if (lineId) return detail(projectId, [lineId]);

  // ---- the summary ---------------------------------------------------------
  const [outstanding, uncategorised, coverage] = await Promise.all([
    loadOutstanding(projectId),
    loadUncategorisedRecords(projectId),
    loadSentCoverage(projectId),
  ]);
  const waiting = waitingByQuestion(outstanding, coverage);
  const withWaiting = outstanding.map((question) => ({
    ...question,
    waiting: waiting.get(questionKey(question.recordId, question.requirementId, 0)) ?? null,
  }));

  const lines = summariseLines(withWaiting);

  // The facets. Phases and areas come off the questions rather than off their
  // own query, so a phase with nothing outstanding cannot appear in a filter
  // that would then empty the screen.
  const phases = new Map<string, string>();
  for (const line of lines) phases.set(line.runId, line.runName);

  // The 17 cheat sheets, so an uncategorised item can be categorised where it
  // is listed rather than on a screen somebody has to know exists.
  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  const { palettes, paletteByQuestion } = await loadPalettes();

  return json({
    ok: true,
    project: {
      id: String(project.id),
      bws_project_number: String(project.bws_project_number),
      name: String(project.name),
    },
    lines,
    phases: [...phases.entries()].map(([value, label]) => ({ id: value, name: label })),
    totals: infillTotals(outstanding, new Set(waiting.keys())),
    uncategorised,
    categories,
    palettes,
    paletteByQuestion,
  });
}

/** Everything one furniture line's edit rows need. */
async function detail(projectId: string, lineIds: string[]): Promise<Response> {
  const [questions, coverage] = await Promise.all([
    loadOutstanding(projectId, { lineIds }),
    loadSentCoverage(projectId),
  ]);
  const waiting = waitingByQuestion(questions, coverage);

  const recordIds = [...new Set(questions.map((question) => question.recordId))];
  const [sisters, dimensions, finishes] = await Promise.all([
    loadSisters(projectId, lineIds),
    loadDimensions(recordIds),
    loadFinishes(projectId),
  ]);

  return json({ ok: true, questions: questions.map((question) => toRow(question, { waiting, sisters, dimensions, finishes })) });
}

type SisterRow = { requirementId: string; recordId: string; name: string; value: string };

function toRow(
  question: OutstandingQuestion,
  context: {
    waiting: Map<string, { draftId: string; sentAt: string | null; contactName: string }>;
    sisters: SisterRow[];
    dimensions: Map<string, InfillDimension[]>;
    finishes: Map<string, string>;
  },
): InfillQuestion {
  const sisters: InfillSister[] = context.sisters
    .filter((row) => row.requirementId === question.requirementId && row.recordId !== question.recordId)
    .map((row) => ({ name: row.name, value: row.value }));

  // WHAT THE LIBRARY CALLS THE CODE THIS ANSWER CARRIES. A finish is
  // project-scoped and edit-once, so the description is the truth and the
  // typed code is the evidence — printing it beside a TBC fabric is what lets
  // somebody say "yes, that one" without opening the finishes tab.
  const code = question.currentValue?.trim() ? normaliseFinishCode(question.currentValue.trim()) : null;
  const finishNote = code ? (context.finishes.get(code) ?? null) : null;

  const dimensions = question.jsonId === 3 ? (context.dimensions.get(question.recordId) ?? []) : null;

  return {
    recordId: question.recordId,
    requirementId: question.requirementId,
    recordLabel: question.recordLabel,
    itemDescription: question.itemDescription,
    variantLabel: question.variantLabel,
    area: question.area,
    prompt: question.prompt,
    fieldLabel: question.fieldLabel,
    section: question.section,
    jsonId: question.jsonId,
    localKey: question.localKey,
    requirementKind: question.requirementKind,
    tier: question.tier,
    state: question.state,
    currentValue: question.currentValue,
    answerId: question.answerId,
    answerVersion: question.answerVersion,
    waiting: context.waiting.get(questionKey(question.recordId, question.requirementId, 0)) ?? null,
    sisters,
    finishNote,
    dimensions,
    // The composed cell is not recomposed here: it is what the record's
    // Dimensions ANSWER already holds, which is the projection the export
    // ships. Recomposing it in a route would be a second composer.
    composed: question.jsonId === 3 ? question.currentValue : null,
  };
}

/**
 * The settled answers the sister configurations hold for the same questions.
 *
 * Reference only. `S-201 A` and `S-201 B` differ in the fabric and in nothing
 * else, so what A settled on is the single most useful thing to have beside
 * B's empty box — and filling B in from it is the one thing M8 says never to
 * do, which is why this comes back as text with no control attached.
 */
async function loadSisters(projectId: string, lineIds: string[]): Promise<SisterRow[]> {
  const rows = await sql`
    select a.requirement_id, a.record_id, a.value, r.variant_label,
           coalesce((select string_agg(x.ref_value, ', ' order by x.ref_value)
                       from spec_record_refs x where x.record_id = r.parent_id), '') as parent_refs
      from spec_answers a
      join spec_records r on r.id = a.record_id
     where r.project_id = ${projectId}
       and r.status = 'active'
       and coalesce(r.parent_id, r.id) = any(${lineIds}::uuid[])
       and a.revision_no = 0
       and a.state = 'confirmed'
       and a.value is not null
  `;
  return rows.map((row) => ({
    requirementId: String(row.requirement_id),
    recordId: String(row.record_id),
    name: row.variant_label ? `${String(row.parent_refs || "").trim()} ${String(row.variant_label)}`.trim() : "the bill line",
    value: String(row.value),
  }));
}

/** What each record already measures, so a dimension row can show the gap. */
async function loadDimensions(recordIds: string[]): Promise<Map<string, InfillDimension[]>> {
  if (recordIds.length === 0) return new Map();
  const rows = await sql`
    select record_id, dimension_slot, value, unit, state
      from record_attributes
     where record_id = any(${recordIds}::uuid[])
       and attr_group = 'dimension'
       and status = 'active'
     order by sort_order
  `;
  const out = new Map<string, InfillDimension[]>();
  for (const row of rows) {
    const key = String(row.record_id);
    const list = out.get(key) ?? [];
    list.push({
      slot: String(row.dimension_slot ?? ""),
      value: row.value === null || row.value === undefined ? null : String(row.value),
      unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
      state: String(row.state),
    });
    out.set(key, list);
  }
  return out;
}

/** The project's finishes library, keyed by the normalised code. */
async function loadFinishes(projectId: string): Promise<Map<string, string>> {
  const rows = await sql`
    select code_norm, code, description from project_finishes where project_id = ${projectId}
  `;
  const out = new Map<string, string>();
  for (const row of rows) {
    const description = row.description === null || row.description === undefined ? "" : String(row.description).trim();
    if (description) out.set(String(row.code_norm), description);
  }
  return out;
}

/**
 * The palettes, exactly as the record screen loads them.
 *
 * Two statements rather than a join, because the second is the LINK — which
 * palette a question offers, by BWS field or by the local key a readiness row
 * carries instead — and it is Matthew's gate overlay that says so.
 */
async function loadPalettes() {
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
  const paletteByQuestion = await sql`
    select f.json_id, g.local_key, g.palette_key
      from spec_field_gates g
      left join spec_fields f on f.id = g.spec_field_id
     where g.palette_key is not null
  `;
  return { palettes, paletteByQuestion };
}
