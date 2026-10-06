// Items added to a mock-up phase, without taking them off the phase they are on.
//
// ============================================================================
// WHY THIS EXISTS (Max, 2026-10-04)
//
// "If everything's loaded in and it's not obvious, someone needs to be able to
// just assign certain items to the mockup ... without taking them away from the
// main run, but assign them also to a mock-up run."
//
// The Aman bill has no mock-up room lines, and every MUR drawing's code matches
// a Guest Suites line AND a Presidential Suites line. A mock-up drawing may
// also be a DIFFERENT DESIGN from both (the mock-up dresser stool has a handle
// the PL one does not). So the mock-up item is the bill line's identity on a
// phase of its own, and nothing more.
//
// ---- WHAT IS COPIED, AND WHAT IS NOT --------------------------------------
//
// Copied: the description, the category, the level (a decision as a decision,
// a suggestion as a suggestion -- 0025's rule, the configuration rule again),
// product reference, designer, area, the bill's category word, and the refs.
//
// NOT copied, each deliberately:
//
//   the quantity   the bill never said how many are in the mock-up room. Null,
//                  and every screen says "quantity not given", never 1.
//                  THE ONE EXCEPTION IS A BILL THAT DOES SAY (2026-10-06): a
//                  `Prototype Quantity` column beside the rollout quantity is
//                  the bill stating how many go in the mock-up, so the BOQ
//                  confirm passes that figure (`quantities`) and it is written
//                  -- where it is a number. Where the cell is words
//                  (`PARTIAL`) the quantity stays null and the record's
//                  internal note quotes the cell. Never 1, never apportioned
//                  (`readMockupQty`, src/lib/bill-sheet-notices.ts).
//   the specs      a mock-up item takes its own from the mock-up drawings,
//                  which may differ. Copying the main line's would put a design
//                  on the mock-up record that its own drawing contradicts, and
//                  the first MUR confirm would then read as REPLACING a value
//                  nobody ever read off a mock-up page.
//   a bws_job ref  a BWS job number belongs to the job that earned it (the
//                  variant rule, CLAUDE.md). The mock-up item will be its own
//                  job; copying the main line's number would make this tool --
//                  the one place client ref <-> job number is held -- say the
//                  mock-up IS that job.
//   the notes      `dimension_note`, `spec_description`, `internal_notes` are
//                  statements a person made about the main item, not identity.
//   the bill row   `source_import_id` / `source_line_no`: the mock-up record did
//                  not come off a bill row, and "BOQ row 12" on it would be a
//                  false provenance.
//
// ---- ONE ACT, ONE CHANGE, UNDER THE PROJECT LOCK -------------------------
//
// The project row is locked first: it serialises the mock-up phase's creation
// (the partial unique index in 0043 is the floor under that) and `record_no`
// allocation (the boq-concurrency defect). One `mockup_add` change set covers
// the phase AND the records, and every new record gets its version 1 under it.
//
// INSIDE ANOTHER ACT (`within`): the BOQ confirm already holds the project
// lock and has its own change set open, so it passes that change set and this
// takes neither -- the bill's confirm and the mock-up items it implies are ONE
// change, and a second `for update` on a row this transaction holds would be
// a lock nobody needed. The caller's promise is that it holds the lock.
//
// IDEMPOTENT: a source already represented on the mock-up phase -- an active
// record there whose `mockup_of` is the source -- is reported, not duplicated.
// One RETIRED there is reported too, and nothing is made in its place: somebody
// retired it with a reason, and silently making another would undo that.
// ============================================================================
import { DomainConflictError, type TxnSql } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { snapshotRecords } from "@/lib/record-snapshot";
import { normaliseRef } from "@/lib/record-refs";

/** What the phase is called when this action has to make it. */
export const MOCKUP_PHASE_NAME = "Mock-up";

/** Said on the screen beside every result: the specs are deliberately not carried. */
export const MOCKUP_NO_SPECS_SENTENCE =
  "No specs were copied: each mock-up item takes its own from the mock-up drawings, which may differ.";

export type MockupSkip = {
  recordId: string;
  reason: "configuration" | "retired" | "on_mockup" | "retired_there";
};

export type AddToMockupResult = {
  runId: string | null;
  runName: string | null;
  /** True when this act made the mock-up phase. */
  phaseCreated: boolean;
  added: { sourceId: string; recordId: string; recordNo: number }[];
  /** Sources already on the mock-up phase, and the record that holds each. */
  already: { sourceId: string; recordId: string }[];
  skipped: MockupSkip[];
  /** Codes two live records on the mock-up phase now share. A mock-up drawing of one will ask which. */
  sharedCodes: string[];
  changeSetId: string | null;
  /** The whole result in words, for the selection bar. */
  message: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence the selection bar prints. Pure, so the component tier can hold
 * the wording without a database.
 */
export function describeMockupResult(
  result: Pick<AddToMockupResult, "runName" | "phaseCreated" | "added" | "already" | "skipped" | "sharedCodes">,
): string {
  const name = result.runName ?? MOCKUP_PHASE_NAME;
  const parts: string[] = [];
  if (result.added.length > 0) {
    parts.push(`Added ${plural(result.added.length, "item")} to ${name}`);
  } else {
    parts.push(`Nothing was added to ${name}`);
  }
  if (result.already.length > 0) {
    parts.push(`${result.already.length} ${result.already.length === 1 ? "was" : "were"} already there`);
  }
  const count = (reason: MockupSkip["reason"]) => result.skipped.filter((skip) => skip.reason === reason).length;
  const retiredThere = count("retired_there");
  if (retiredThere > 0) {
    parts.push(
      `${retiredThere} ${retiredThere === 1 ? "was" : "were"} retired there — put ${retiredThere === 1 ? "it" : "them"} back on the record rather than adding again`,
    );
  }
  const configurations = count("configuration");
  if (configurations > 0) {
    parts.push(
      `${plural(configurations, "configuration")} left out — add ${configurations === 1 ? "its" : "their"} bill line instead`,
    );
  }
  const retired = count("retired");
  if (retired > 0) parts.push(`${plural(retired, "retired item")} left out`);
  const onMockup = count("on_mockup");
  if (onMockup > 0) parts.push(`${onMockup} ${onMockup === 1 ? "is" : "are"} already a mock-up item`);

  let sentence = `${parts.join("; ")}.`;
  if (result.phaseCreated) sentence += ` The ${name} phase was created.`;
  if (result.added.length > 0) sentence += ` ${MOCKUP_NO_SPECS_SENTENCE}`;
  if (result.sharedCodes.length > 0) {
    sentence += ` ${result.sharedCodes.join(", ")} ${
      result.sharedCodes.length === 1 ? "is" : "are"
    } now on more than one ${name} item, so a mock-up drawing of ${result.sharedCodes.length === 1 ? "it" : "them"} will ask which.`;
  }
  return sentence;
}

/**
 * Put the selected records on the project's mock-up phase, making the phase if
 * it is not there. See the header for what is copied and what is not.
 */
export async function addToMockupPhase(
  txn: TxnSql,
  {
    projectId,
    recordIds,
    actor,
    within,
    quantities,
  }: {
    projectId: string;
    recordIds: string[];
    actor: string;
    /**
     * The caller already holds the project row lock and has this change set
     * open (the BOQ confirm): neither is taken again, and the records are
     * versioned under it.
     */
    within?: { changeSetId: string };
    /**
     * Per SOURCE record: the mock-up record's quantity and internal note, where
     * a bill said how many are in the mock-up. Absent: null and null, as ever.
     */
    quantities?: ReadonlyMap<string, { qty: number | null; internalNote: string | null }>;
  },
): Promise<AddToMockupResult> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) {
    throw new DomainConflictError("nothing_selected", "Select at least one item to add to the mock-up phase.", {
      status: 400,
    });
  }

  // THE PROJECT LOCK, FIRST. Everything below -- finding or making the phase,
  // reading max(record_no) -- is a read-then-write that two presses at once
  // would otherwise both win. Inside another act, the caller holds it.
  if (!within) {
    const projects = await txn`select id from projects where id = ${projectId} for update`;
    if (!projects[0]) throw new DomainConflictError("not_found", "No such project.", { status: 404 });
  }

  const sources = await txn`
    select r.id, r.project_id, r.status, r.parent_id, run.is_mockup, run.status as run_status
      from spec_records r
      join spec_runs run on run.id = r.run_id
     where r.id = any(${ids}::uuid[])
  `;
  if (sources.length !== ids.length || sources.some((row) => String(row.project_id) !== projectId)) {
    throw new DomainConflictError(
      "unknown_record",
      "One of the selected items is not on this project. Reload and select again.",
      { status: 400 },
    );
  }

  const skipped: MockupSkip[] = [];
  const eligible: string[] = [];
  for (const id of ids) {
    const row = sources.find((source) => String(source.id) === id)!;
    if (row.is_mockup === true) skipped.push({ recordId: id, reason: "on_mockup" });
    else if (String(row.status) !== "active" || String(row.run_status) !== "active") {
      skipped.push({ recordId: id, reason: "retired" });
    }
    // A CONFIGURATION is not a bill line. Its identity is its bill line's plus
    // a letter, and it carries no client ref of its own -- so a mock-up copy of
    // it would be an item with no code that no mock-up drawing could ever
    // match. The sentence says to add the bill line instead.
    else if (row.parent_id) skipped.push({ recordId: id, reason: "configuration" });
    else eligible.push(id);
  }

  const phases = await txn`
    select id, name from spec_runs
     where project_id = ${projectId} and is_mockup and status = 'active'
  `;
  let runId: string | null = phases[0] ? String(phases[0].id) : null;
  let runName: string | null = phases[0] ? String(phases[0].name) : null;

  const already: { sourceId: string; recordId: string }[] = [];
  const toAdd: string[] = [];
  if (runId) {
    const held = await txn`
      select id, mockup_of, status from spec_records
       where run_id = ${runId} and mockup_of = any(${eligible}::uuid[])
       order by status, created_at
    `;
    for (const sourceId of eligible) {
      const live = held.find((row) => String(row.mockup_of) === sourceId && String(row.status) === "active");
      if (live) {
        already.push({ sourceId, recordId: String(live.id) });
        continue;
      }
      if (held.some((row) => String(row.mockup_of) === sourceId)) {
        skipped.push({ recordId: sourceId, reason: "retired_there" });
        continue;
      }
      toAdd.push(sourceId);
    }
  } else {
    toAdd.push(...eligible);
  }

  // NOTHING TO DO WRITES NOTHING: no change set, and no empty phase made for an
  // act that added no item to it.
  if (toAdd.length === 0) {
    const result = { runId, runName, phaseCreated: false, added: [], already, skipped, sharedCodes: [], changeSetId: null };
    return { ...result, message: describeMockupResult(result) };
  }

  const changeSetId =
    within?.changeSetId ??
    (await openChangeSet(txn, {
      projectId,
      kind: "mockup_add",
      actor,
      reason: `${plural(toAdd.length, "item")} added to ${runName ?? MOCKUP_PHASE_NAME}`,
    }));

  let phaseCreated = false;
  if (!runId) {
    // LAST in the tab order, like any phase added by hand (`createRun`).
    const order = await txn`
      select coalesce(max(sort_order), 0) as last from spec_runs where project_id = ${projectId}
    `;
    const made = await txn`
      insert into spec_runs (project_id, name, sort_order, status, is_mockup, created_by, updated_by)
      values (${projectId}, ${MOCKUP_PHASE_NAME}, ${Number(order[0]?.last ?? 0) + 1}, 'active', true, ${actor}, ${actor})
      returning id, name
    `;
    runId = String(made[0]!.id);
    runName = String(made[0]!.name);
    phaseCreated = true;
  }

  const maxNo = await txn`
    select coalesce(max(record_no), 0) as max_no from spec_records where project_id = ${projectId}
  `;
  let nextNo = Number(maxNo[0]?.max_no ?? 0);

  const added: AddToMockupResult["added"] = [];
  // In the order the sources sit on their own phase, so the mock-up phase
  // reads in bill order rather than in the order somebody ticked them.
  const ordered = await txn`
    select r.id from spec_records r join spec_runs run on run.id = r.run_id
     where r.id = any(${toAdd}::uuid[])
     order by run.sort_order, r.record_no
  `;
  for (const row of ordered) {
    const sourceId = String(row.id);
    nextNo += 1;
    // Null and null unless a bill said how many (see the header).
    const said = quantities?.get(sourceId);
    const inserted = await txn`
      insert into spec_records
        (project_id, run_id, record_no, status, category_id, item_description, product_reference,
         qty, designer, area, boq_category, level, level_suggested, level_suggested_reason,
         internal_notes, mockup_of, created_by, updated_by)
      select project_id, ${runId}, ${nextNo}, 'active', category_id, item_description, product_reference,
             ${said?.qty ?? null}, designer, area, boq_category, level, level_suggested, level_suggested_reason,
             ${said?.internalNote ?? null}, id, ${actor}, ${actor}
        from spec_records where id = ${sourceId}
      returning id
    `;
    const recordId = String(inserted[0]?.id ?? "");
    if (!recordId) throw new Error(`mock-up copy of ${sourceId} was not inserted`);

    // Every ref but a BWS job number. See the header.
    await txn`
      insert into spec_record_refs (record_id, project_id, ref_system, ref_value, ref_value_norm, source, created_by)
      select ${recordId}, project_id, ref_system, ref_value, ref_value_norm,
             coalesce(source, 'Copied for the mock-up'), ${actor}
        from spec_record_refs
       where record_id = ${sourceId} and ref_system <> 'bws_job'
    `;

    // The checklist, as for any new record -- the statement createRecord and
    // insertVariant run. Nothing for an uncategorised source.
    await txn`
      insert into spec_answers (record_id, requirement_id, spec_field_id, state, source_kind, created_by, updated_by)
      select ${recordId}, q.id, q.spec_field_id, 'missing', 'manual', ${actor}, ${actor}
        from requirements q
        join spec_records r on r.category_id = q.category_id
       where r.id = ${recordId}
    `;
    added.push({ sourceId, recordId, recordNo: nextNo });
  }

  await snapshotRecords(
    txn,
    added.map((entry) => entry.recordId),
    changeSetId,
  );

  // TWO LINES, ONE CODE. Selecting the GR and the PL line of one item puts two
  // records carrying related codes on the mock-up phase; where they carry the
  // SAME code, a mock-up drawing of it is the SX11A case and will ask which.
  // Said now, while the person who caused it is looking.
  const codes = await txn`
    select x.ref_value from spec_record_refs x
      join spec_records r on r.id = x.record_id
     where r.run_id = ${runId} and r.status = 'active' and x.ref_system = 'boq_code'
  `;
  const byFold = new Map<string, { code: string; n: number }>();
  for (const code of codes) {
    const value = String(code.ref_value);
    const fold = normaliseRef(value);
    const entry = byFold.get(fold) ?? { code: value, n: 0 };
    entry.n += 1;
    byFold.set(fold, entry);
  }
  const sharedCodes = [...byFold.values()]
    .filter((entry) => entry.n > 1)
    .map((entry) => entry.code)
    .sort((a, b) => a.localeCompare(b));

  const result = { runId, runName, phaseCreated, added, already, skipped, sharedCodes, changeSetId };
  return { ...result, message: describeMockupResult(result) };
}
