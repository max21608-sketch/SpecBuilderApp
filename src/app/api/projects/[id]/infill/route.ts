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
//   ?requirements=  the same, for every record still owing ONE question. The
//                   by-question view's unit, and 401 rows under "Dimensions"
//                   on the 300-line project — so it is read on demand too.
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
import {
  summariseLines,
  infillTotals,
  type InfillDimension,
  type InfillLineSummary,
  type InfillQuestion,
  type InfillSister,
} from "@/lib/infill";
import { groupByQuestion } from "@/lib/chase-grouping";
import { loadMatrixItemTgq, type MatrixItemTgq } from "@/lib/item-tgq-load";
import { numberingFromRow, recordLabel } from "@/lib/record-label";
import { areaOptions } from "@/lib/area-filter";
import { normaliseFinishCode } from "@/lib/finishes";
import { loadPalettes } from "@/lib/palette-load";

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
  const requirements = (params.get("requirements") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (lineId) return detail(projectId, { lineIds: [lineId] });
  // The ids come from a heading this route itself sent. They are a FILTER and
  // never a target — the scope is still this project, so an id from elsewhere
  // returns nothing rather than anything it should not.
  if (requirements.length > 0) return detail(projectId, { requirementIds: requirements });

  // ---- the summary ---------------------------------------------------------
  const [outstanding, uncategorised, coverage, matrix] = await Promise.all([
    loadOutstanding(projectId),
    loadUncategorisedRecords(projectId),
    loadSentCoverage(projectId),
    // THE MATRIX HALF OF EACH ITEM'S TGQ (`itemTgq`, 2026-10-13): the TGQ
    // gate's rows — slots and record columns included — which no list of
    // questions can count. The overview adds the same half.
    loadMatrixItemTgq([projectId]),
  ]);
  const waiting = waitingByQuestion(outstanding, coverage);
  const withWaiting = outstanding.map((question) => ({
    ...question,
    waiting: waiting.get(questionKey(question.recordId, question.requirementId, 0)) ?? null,
  }));

  const lines = summariseLines(withWaiting, matrix);
  // AN ITEM ON THE MATRIX WITH NO QUESTION OUTSTANDING CAN STILL OWE ITS TGQ:
  // every checklist question answered, and a dimension slot or the designer
  // reference still empty. It has no question to group, so it would have no
  // line, and the overview's total would count what this screen never lists.
  // It gets a line of its own whose rows are all "record it on the item".
  const listed = new Set(lines.flatMap((line) => [line.lineId, ...line.options.map((option) => option.recordId)]));
  const gateOnly = [...matrix.values()].filter((item) => (item.count ?? 0) > 0 && !listed.has(item.recordId));
  if (gateOnly.length > 0) lines.push(...(await gateOnlyLines(gateOnly)));

  // THE SECOND VIEW, off the same load. "Show me all the jobs with dimensions
  // missing" — one heading per question with its count, and its rows read when
  // it is opened, for the reason the lines are: 19,582 rows is 19,582 rows
  // whichever way they are grouped.
  const questions = groupByQuestion(withWaiting).map((group) => ({
    key: group.key,
    requirementIds: group.requirementIds,
    heading: group.heading,
    fieldLabel: group.fieldLabel,
    toQuote: group.toQuote,
    projectWide: group.projectWide,
    rows: group.rows.length,
    // How many ITEMS owe it, which is the number the question is about.
    records: new Set(group.rows.map((row) => row.recordId)).size,
    // The areas it is outstanding in, so the filter can narrow a heading
    // without opening it.
    areas: [...new Set(group.rows.map((row) => row.area?.trim() || null))],
  }));

  // The facets. Phases and areas come off the questions rather than off their
  // own query, so a phase with nothing outstanding cannot appear in a filter
  // that would then empty the screen.
  const phases = new Map<string, string>();
  for (const line of lines) phases.set(line.runId, line.runName);

  // THE AREAS, COUNTED IN ROWS. The by-item tab builds its own from the lines,
  // because there the count is what that list goes back to; the by-question
  // tab lists headings and the useful number under an area is how many ITEMS
  // are in it, which only the rows can give.
  const questionAreas = areaOptions(withWaiting);

  // The 17 cheat sheets, so an uncategorised item can be categorised where it
  // is listed rather than on a screen somebody has to know exists.
  const categories = await sql`
    select id, slug, family, name, requirements_authored from item_categories order by family, sort_order
  `;

  // ---- which palette a question offers -------------------------------------
  //
  // The record screen's loader, shared since 2026-09-22 rather than copied.
  // This route's own copy of those two statements had fallen a column behind:
  // it never gained 0035's `spec_palette_options.code`, so a value quoting a
  // BWS option code and nothing else resolved on the record screen and not
  // here. Nothing on either screen said so.
  const { palettes, paletteByQuestion } = await loadPalettes(sql);

  return json({
    ok: true,
    project: {
      id: String(project.id),
      bws_project_number: String(project.bws_project_number),
      name: String(project.name),
    },
    lines,
    questions,
    questionAreas,
    phases: [...phases.entries()].map(([value, label]) => ({ id: value, name: label })),
    // THE HEADER IS THE SUM OF THE LINES, by construction: each line's TGQ is
    // `itemTgq`'s, so the header's must be theirs added up, never a second
    // count over the questions.
    totals: {
      ...infillTotals(outstanding, new Set(waiting.keys())),
      toQuote: lines.reduce((sum, line) => sum + line.counts.toQuote, 0),
    },
    uncategorised,
    categories,
    palettes,
    paletteByQuestion,
  });
}

/** Everything one furniture line's — or one question's — edit rows need. */
async function detail(
  projectId: string,
  scope: { lineIds?: string[]; requirementIds?: string[] },
): Promise<Response> {
  const [questions, coverage] = await Promise.all([
    loadOutstanding(projectId, scope),
    loadSentCoverage(projectId),
  ]);
  const waiting = waitingByQuestion(questions, coverage);

  const recordIds = [...new Set(questions.map((question) => question.recordId))];
  // SISTERS ONLY WHERE THERE ARE ANY. A sister value is a FINISH OPTION's
  // reference — what A settled on, beside B's empty box — so only a line that
  // has been split can produce one. In the by-question view that is a handful
  // of the 401 lines under "Dimensions", and asking for all of them would load
  // every confirmed answer on the project to print nothing.
  const splitLines = [
    ...new Set(questions.filter((question) => question.parentId).map((question) => question.parentId!)),
  ];
  const [sisters, dimensions, finishes] = await Promise.all([
    splitLines.length > 0 ? loadSisters(projectId, splitLines) : Promise.resolve([] as SisterRow[]),
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
 * A line for each record whose TGQ is all gate rows (`itemTgq` on the matrix)
 * and which has no outstanding question to group into one. Its rows are listed
 * as "record it on the item": nothing on it is a box to fill here.
 */
async function gateOnlyLines(items: MatrixItemTgq[]): Promise<InfillLineSummary[]> {
  const rows = await sql`
    select r.id, r.record_no, r.variant_ordinal, r.item_description, r.qty, r.level, r.area, r.run_id,
           (select p2.record_no from spec_records p2 where p2.id = r.parent_id) as parent_record_no,
           run.name as run_name, p.bws_project_number,
           coalesce((select string_agg(x.ref_value, ', ' order by x.ref_value)
                       from spec_record_refs x where x.record_id = coalesce(r.parent_id, r.id)), '') as refs
      from spec_records r
      join spec_runs run on run.id = r.run_id
      join projects p on p.id = r.project_id
     where r.id = any(${items.map((item) => item.recordId)}::uuid[])
  `;
  const byId = new Map(items.map((item) => [item.recordId, item]));
  return rows.map((row) => {
    const item = byId.get(String(row.id))!;
    return {
      lineId: String(row.id),
      recordLabel: recordLabel(String(row.bws_project_number), numberingFromRow(row)),
      code: String(row.refs ?? ""),
      itemDescription: String(row.item_description ?? ""),
      qty: row.qty === null || row.qty === undefined ? null : Number(row.qty),
      runId: String(row.run_id),
      runName: String(row.run_name ?? ""),
      level: row.level === null || row.level === undefined ? null : String(row.level),
      area: row.area === null || row.area === undefined ? null : String(row.area),
      counts: { toQuote: item.count ?? 0, projectWide: item.projectWide, later: 0, waiting: 0 },
      states: { missing: 0, tbc: 0 },
      itemRows: item.rows.map((tgqRow) => ({
        recordId: item.recordId,
        label: tgqRow.label,
        kind: tgqRow.kind,
        where: tgqRow.where,
      })),
      optionCount: 0,
      options: [],
    };
  });
}
