// Turning what a model read out of a document into proposals a human can judge.
//
// Pure. No database, no network, no clock. The registers are loaded before the
// call and passed in, so every rule here is unit-testable against a fixture and
// none of it depends on what happens to be in the sandbox today.
//
// ============================================================================
// THE RULES THAT ARE NOT NEGOTIABLE
//
// 1. NEVER a `Map<ref, record>`. `SX11A` appears TWICE in the pilot BOQ, with
//    different quantities, by design. A map keyed on the ref silently drops one
//    of them and every proposal for that ref lands on whichever happened to be
//    last. Two matches is AMBIGUOUS — even when both strings match exactly and
//    the match is in no way fuzzy.
//
// 2. Every observation is kept, including two that contradict each other about
//    one target. The document said both; hiding one is editorialising. What the
//    reviewer gets is a blocker telling them to resolve it, not a silent pick.
//
// 3. A literal "TBC" never becomes a settled answer. `tbc` is a real state
//    meaning a human has actively said "not yet decided" — it BLOCKS a gate.
//    Turning the document's "TBC" into `confirmed` would report a record ready
//    for a gate it is not ready for. See CLAUDE.md, "Gate rules read state".
//
// 4. Blockers are COMPUTED, never stored. Overwrite acknowledgement is cleared
//    by a retarget, and a duplicate-target clash appears and disappears as other
//    proposals are retargeted or ignored. A blocker frozen into the staged JSON
//    at extraction time would be stale by the first edit, and the confirm route
//    and the screen would disagree about whether a card can commit.
// ============================================================================
import { matchName, normaliseName, type MatchCandidate } from "@/lib/matching";
import {
  containsPhrase,
  deferredToSomebody,
  TBC_TOKENS,
  type AnswerState,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
// Re-exported so every existing caller (drawing-document, the tests) is
// untouched by the move that broke the spec-dimensions import cycle.
export { TBC_TOKENS, containsPhrase };
import type { RawProposal } from "@/lib/extraction-schema";
import { findRecordsByRef, normaliseRef, type RecordEntry } from "@/lib/record-refs";
// Re-exported so every existing caller is untouched by the move that broke the
// drawing-document import cycle.
export { findRecordsByRef, normaliseRef };
export { deferredToSomebody };
export type { RecordEntry };
import { readDimension, type DimensionReading } from "@/lib/spec-dimensions";
import { readFinish, type FinishReading } from "@/lib/spec-finishes";
import { suggestSpecField, type SpecFieldEntry } from "@/lib/drawing-document";

export const PROPOSAL_SCHEMA_VERSION = 1;

// ---- the registers ---------------------------------------------------------


export type RequirementEntry = {
  id: string;
  categoryId: string;
  prompt: string;
  kind: "spec_field" | "readiness";
  section: string | null;
  specFieldName: string | null;
  aliases: string[];
};

export type AnswerEntry = {
  id: string;
  recordId: string;
  requirementId: string;
  version: number;
  state: AnswerState;
  value: string | null;
};

/**
 * An ACTIVE dimension attribute already on a record.
 *
 * Loaded so a dimension proposal can see what it would replace. 0016's partial
 * unique index is `where status = 'active'`, so an insert over an occupied slot
 * cannot commit until the old row is retired — and retiring something a
 * document said is a decision, never an automatic consequence.
 */
export type AttributeEntry = {
  id: string;
  recordId: string;
  attrGroup: AttributeGroup;
  /** Dimensions only. */
  slot: DimensionSlot | null;
  /** Non-dimensions only: which BWS field this row already occupies. */
  specFieldId: string | null;
  label: string;
  value: string | null;
  unit: AttributeUnit | null;
  state: AttributeState;
  version: number;
};

export type Registers = {
  records: RecordEntry[];
  requirements: RequirementEntry[];
  answers: AnswerEntry[];
  /** Optional: only the attribute path reads it, and older callers pass none. */
  attributes?: AttributeEntry[];
  /** The 56 BWS spec fields, for placing a finish. Optional for the same reason. */
  specFields?: SpecFieldEntry[];
};

// ---- the staged shape ------------------------------------------------------

export type Candidate = { id: string; label: string };

/**
 * What the target looked like when this proposal was resolved or retargeted.
 *
 * `answerExists: false` is an EXPLICIT ABSENCE, not version 0. Confirm inserts
 * only while that absence still holds; inventing a version would make an insert
 * look like an update of something that was never there.
 */
export type TargetSnapshot = {
  recordId: string;
  recordLabel: string;
  recordVersion: number;
  requirementId: string;
  requirementPrompt: string;
  requirementKind: "spec_field" | "readiness";
  answerExists: boolean;
  answerId: string | null;
  answerVersion: number | null;
  answerState: AnswerState | null;
  answerValue: string | null;
};

export type Proposal = {
  id: string;
  /**
   * Which observation in the document this came from.
   *
   * NO LONGER UNIQUE, and that is the point: one observation about `S-201`
   * fans out to one proposal per RUN, and they all carry the ordinal of the
   * observation they share. It is the key the review screen groups a row by,
   * so the reviewer sees "seat height" once with the runs beside it rather
   * than three times.
   */
  sourceOrdinal: number;
  /**
   * The run this fan-out member writes to, for display. Null on a proposal
   * that resolved to no run at all.
   *
   * OPTIONAL on the stored shape: staged JSON written before the fan-out
   * existed has neither field, and a review screen that threw on it would make
   * every already-read document unreviewable.
   */
  runId?: string | null;
  runName?: string | null;
  /**
   * The configuration letter the observation's own label names — the `A` in
   * "Fabric (A configuration)". Read from the wording, so it is a SUGGESTION
   * and the screen badges it; nothing is written from it. Null when the label
   * names no configuration, which is almost every observation.
   */
  configurationLabel?: string | null;
  /**
   * The dimension this proposal writes, when the observation states one.
   *
   * A dimension does NOT reach its field through a requirement: it carries a
   * SLOT, and all five slots compose into BWS field 3 by `composeDimensionCell`.
   * So a dimension proposal has `requirementId: null` and `target: null` by
   * construction, and the confirm writes a `record_attributes` row and lets
   * `promote-answers.ts` fill the checklist — the same path a drawing takes.
   *
   * ONE PART PER PROPOSAL. "Overall — W660 x D685 x H680mm" is three slots and
   * therefore three proposals, sharing a `sourceOrdinal` so the screen still
   * shows one row. Two slots in one proposal would mean two writes behind one
   * version and one acknowledgement.
   */
  dimension?: {
    slot: DimensionSlot;
    figure: string | null;
    unit: AttributeUnit | null;
    unitSource: "stated" | "reviewer" | null;
    slotSuggested: boolean;
    qualifier: string | null;
    tbc: boolean;
  } | null;
  /**
   * What an email says a FINISH is — a fabric, timber, metal or hardware.
   *
   * Like a dimension, it writes an ATTRIBUTE rather than an answer: a finish
   * carries a BWS FIELD (COM 1, Main timber finish), and which slot it takes
   * depends on what the record already holds — so it cannot be reached by
   * matching a question, and an alias naming one slot up front would be a
   * mapping nobody has agreed. `readFinish` only fires on the document's own
   * code, so prose cannot land a build instruction in COM 1.
   */
  finish?: {
    group: AttributeGroup;
    specFieldId: string | null;
    specFieldName: string | null;
    codeRaw: string | null;
    value: string | null;
    tbc: boolean;
    reason: string | null;
  } | null;
  /**
   * The ACTIVE attribute a dimension or finish would replace, as it was when
   * resolved.
   * Null where the slot is free. Its version is re-checked at confirm, so a
   * value that moved since is refused rather than quietly retired.
   */
  /** The record's label, for a dimension proposal, which carries no target. */
  recordLabel?: string | null;
  attributeTarget?: {
    attributeId: string;
    attributeVersion: number;
    label: string;
    value: string | null;
    unit: AttributeUnit | null;
  } | null;
  version: number;
  raw: RawProposal;
  recordCandidates: Candidate[];
  requirementCandidates: Candidate[];
  recordId: string | null;
  requirementId: string | null;
  target: TargetSnapshot | null;
  proposedValue: string | null;
  proposedState: AnswerState | null;
  /** Why no state was suggested, when none was. Shown beside the field. */
  stateReason: string | null;
  overwriteAcknowledged: boolean;
  reviewStatus: "pending" | "ignored" | "applied";
  reviewedAt: string | null;
  reviewedBy: string | null;
  /**
   * What the confirm actually wrote. A dimension writes an ATTRIBUTE, not an
   * answer — the checklist answer it contributes to is composed from every
   * slot the record holds and belongs to no single proposal — so the answer
   * fields are null on one and `attributeId` carries the row instead.
   */
  applied:
    | {
        answerId: string | null;
        answerVersion: number | null;
        attributeId?: string | null;
        value: string | null;
        state: AnswerState;
      }
    | null;
};

export type StagedSpecDocument = {
  schemaVersion: number;
  lines: Proposal[];
  documentNotes: string | null;
  filename: string | null;
};


// ---- state suggestion ------------------------------------------------------




// Wording that means "this question does not apply". Tighter still. "None" is
// NOT here: "None" for a piping fabric is a real answer, and reading it as
// "question does not apply" would erase a decision somebody made.
const NA_TOKENS = ["n/a", "n a", "na", "not applicable", "does not apply"];

// Verified in CLAUDE.md as an ACCEPTABLE dimension answer at TG0, where TBC is
// not. It is a decision ("the designer will propose"), so it settles — but it is
// close enough to a deferral that the reviewer is told what they are settling.
const DEFERRAL_BUT_REAL = ["design to suggest", "designer to suggest", "as per sample", "as existing"];

export type StateSuggestion = { state: AnswerState | null; value: string | null; reason: string | null };

/**
 * Deterministic, and it refuses to guess. A blank or self-contradicting value
 * produces NO state and a reason — which becomes a blocker, so the card cannot
 * commit until a human says what the document actually meant.
 */
export function suggestState(valueRaw: string | null): StateSuggestion {
  const value = (valueRaw ?? "").trim();
  if (value === "") {
    return { state: null, value: null, reason: "The document gives no value here. Say what it should be, or ignore this." };
  }

  const norm = normaliseName(value);
  if (TBC_TOKENS.includes(norm)) {
    // A REAL answer, and it blocks a gate. Preserved as the document wrote it.
    return { state: "tbc", value, reason: null };
  }
  if (NA_TOKENS.includes(norm)) {
    // `na` carries no value: spec_answers_confirmed_needs_actor and the confirm
    // route both expect a null value for it.
    return { state: "na", value: null, reason: null };
  }

  // "Antique brass, finish TBC" says two things. Neither this code nor the
  // model gets to decide which one won.
  //
  // Matched on WHOLE WORDS, not as a substring. A bare `includes` was safe
  // while every token was a distinctive abbreviation, and stopped being safe
  // the moment "pending" joined them: "depending on the finish" is a
  // specification, not a deferral.
  const contradicts =
    TBC_TOKENS.some((token) => containsPhrase(norm, token)) || NA_TOKENS.some((token) => containsPhrase(norm, token));
  if (contradicts) {
    return {
      state: null,
      value,
      reason: "The document gives a value and also says it is not settled. Choose which this is.",
    };
  }

  // "Argenta to confirm" names who decides. That is worth keeping, and it is
  // not an answer — so the reviewer is asked rather than either half guessed.
  if (deferredToSomebody(norm)) {
    return {
      state: null,
      value,
      reason: "The document says somebody else will confirm this. Record it as TBC, or give the value if you have it.",
    };
  }

  if (DEFERRAL_BUT_REAL.includes(norm)) {
    return {
      state: "confirmed",
      value,
      reason: "This is an answer, not a deferral — it settles the question. Change it to TBC if that is wrong.",
    };
  }

  return { state: "confirmed", value, reason: null };
}

// ---- resolution ------------------------------------------------------------

function requirementCandidates(requirements: RequirementEntry[], categoryId: string): MatchCandidate[] {
  const scoped = requirements.filter((requirement) => requirement.categoryId === categoryId);
  const candidates: MatchCandidate[] = [];
  for (const requirement of scoped) {
    candidates.push({ id: requirement.id, name: requirement.prompt });
    if (requirement.specFieldName) candidates.push({ id: requirement.id, name: requirement.specFieldName });
    for (const alias of requirement.aliases) candidates.push({ id: requirement.id, name: alias });
  }
  return candidates;
}

export function buildTargetSnapshot(
  record: RecordEntry,
  requirement: RequirementEntry,
  answers: AnswerEntry[],
): TargetSnapshot {
  const answer = answers.find((row) => row.recordId === record.id && row.requirementId === requirement.id) ?? null;
  return {
    recordId: record.id,
    recordLabel: record.label,
    recordVersion: record.version,
    requirementId: requirement.id,
    requirementPrompt: requirement.prompt,
    requirementKind: requirement.kind,
    answerExists: Boolean(answer),
    answerId: answer?.id ?? null,
    answerVersion: answer?.version ?? null,
    answerState: answer?.state ?? null,
    answerValue: answer?.value ?? null,
  };
}

/**
 * `newId` is injected rather than called for, so a test gets stable ids and the
 * caller decides where randomness comes from.
 */
/**
 * The state a proposal is suggested at.
 *
 * `suggestState` reads the VALUE, which is right for every document and for
 * almost every email. The exception is the one thing an email can do that a
 * schedule cannot: withdraw a settled value back to undecided. "Please put the
 * fabric back to TBC, the client is rethinking it" carries no TBC token in the
 * value being withdrawn, so nothing in the wording alone could produce a `tbc`
 * proposal — and silently recording it as a confirmed value would be the exact
 * opposite of what the email asked for.
 *
 * Every other intent is inert here. The model reads; the code decides.
 */
function emailAwareState(observation: RawProposal): StateSuggestion {
  const suggestion = suggestState(observation.valueRaw);
  if (observation.changeIntent !== "withdraws_to_tbc") return suggestion;
  if (suggestion.state === "tbc") return suggestion;
  return {
    state: "tbc",
    // The value the email is withdrawing is kept, so the reviewer can see WHAT
    // is going back to undecided rather than just that something is.
    value: suggestion.value ?? observation.valueRaw ?? null,
    reason:
      "This email reads as withdrawing a value that was settled. Confirm it is going back to TBC rather than being recorded.",
  };
}

/**
 * The configuration letter an attribute label names, or null.
 *
 * "Fabric (A configuration)", "Fabric - configuration B", "COM 1 (config C)".
 * Deliberately narrow: the letter must be a single character sitting beside
 * the WORD, so "Fabric A" alone matches nothing — plenty of specifications
 * name a fabric "A" meaning a grade, and reading that as a configuration would
 * send the value to a record the email never mentioned.
 *
 * This is a reading of wording, so nothing is written from it. It exists to
 * let the screen SAY that a value is about one configuration of a split item,
 * which is the difference between a reviewer noticing and not.
 */
export function detectConfiguration(attributeRaw: string | null): string | null {
  if (!attributeRaw) return null;
  const match = /\b(?:config|configuration|variant|option)\b\W{0,3}([A-Z])\b/i.exec(attributeRaw)
    ?? /\b([A-Z])\W{0,3}\b(?:config|configuration|variant|option)\b/i.exec(attributeRaw);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Matched records grouped by the run they are on, in the order the runs were
 * loaded. The whole of the fan-out rule lives in this shape.
 */
function groupRecordsByRun(matched: RecordEntry[]): { runId: string; runName: string; records: RecordEntry[] }[] {
  const byRun = new Map<string, { runId: string; runName: string; records: RecordEntry[] }>();
  for (const record of matched) {
    const existing = byRun.get(record.runId);
    if (existing) existing.records.push(record);
    else byRun.set(record.runId, { runId: record.runId, runName: record.runName, records: [record] });
  }
  return [...byRun.values()].sort((a, b) => a.runName.localeCompare(b.runName));
}

/**
 * Which BWS field slots are spoken for on each record — the ones it already
 * holds, plus the ones earlier observations in this same document claimed.
 *
 * SHARED ACROSS A WHOLE DOCUMENT, which is why it is a parameter rather than a
 * local. `rematchProposals` re-resolves one observation at a time, so a fresh
 * map per call gave every fabric COM 1: the real pilot email states three and
 * all three claimed the same slot, which the confirm would then have refused on
 * 0007's unique index. Seeded once by the caller, passed in, mutated in order.
 */
export function seedTakenFields(registers: Registers): Map<string, Set<string>> {
  const taken = new Map<string, Set<string>>();
  for (const attribute of registers.attributes ?? []) {
    if (!attribute.specFieldId) continue;
    const set = taken.get(attribute.recordId) ?? new Set<string>();
    set.add(attribute.specFieldId);
    taken.set(attribute.recordId, set);
  }
  return taken;
}

export function resolveProposals(
  raw: RawProposal[],
  registers: Registers,
  newId: () => string,
  taken: Map<string, Set<string>> = seedTakenFields(registers),
): Proposal[] {
  return raw.flatMap((observation, index) => {
    const matchedRecords = findRecordsByRef(observation.refRaw, registers.records);

    // ------------------------------------------------------------------
    // THE FAN-OUT. `S-201` is on the mock-up run, the main run and the VE
    // run, with different quantities, and there is ONE email about it. A
    // matcher that counts matches without looking at which run they are on
    // sees three and gives up — which is what this did, and why a reviewer
    // was asked to place seven values by hand against three identical
    // candidates.
    //
    // So: one record per run is a FAN-OUT, one proposal each, and unticking
    // a run is how a spec that genuinely differs there (a VE run's fabric)
    // is excluded. TWO records in ONE run is the `SX11A` case and stays
    // AMBIGUOUS — two lines of one bill carrying one code are two different
    // items and choosing between them is a person's decision.
    //
    // This is `resolveDrawingTargets`' rule, which has been right since 0007.
    // The two pipelines matching a code differently was the defect.
    // ------------------------------------------------------------------
    const runs = groupRecordsByRun(matchedRecords);
    if (runs.length === 0) {
      return [buildProposal(observation, index, null, [], registers, newId, null)];
    }

    return runs.flatMap((run) => {
      const candidates: Candidate[] = run.records.map((record) => ({
        id: record.id,
        label: `${record.label} · ${record.refs.join(", ")} · ${record.itemDescription}`,
      }));
      // One record on this run, and it has a category. Anything else stays
      // unchosen: a record with no category has no checklist to match an
      // attribute against, so picking it would only produce a second
      // unanswerable question.
      const record = run.records.length === 1 ? run.records[0] ?? null : null;

      // A DIMENSION does not go through requirement matching at all. It
      // carries a slot, and one observation can state three of them.
      const reading = readDimension(observation.attributeRaw, observation.valueRaw);
      if (reading && record) {
        return reading.parts.map((part) =>
          buildDimensionProposal(observation, index, record, candidates, newId, run, reading, part, registers),
        );
      }

      // A FINISH does not either. It carries a BWS field, and which slot it
      // takes depends on what the record already holds.
      const finish = record ? readFinish(observation.attributeRaw, observation.valueRaw) : null;
      if (finish && record) {
        return [buildFinishProposal(observation, index, record, candidates, newId, run, finish, registers, taken)];
      }

      return [buildProposal(observation, index, record, candidates, registers, newId, run)];
    });
  });
}

/**
 * One slot of one observation, aimed at one record.
 *
 * It carries no requirement and no target by construction: those describe a
 * checklist answer, and this writes an attribute. The checklist answer follows
 * at confirm time, composed from every slot the record holds.
 */
function buildDimensionProposal(
  observation: RawProposal,
  index: number,
  record: RecordEntry,
  recordCandidates: Candidate[],
  newId: () => string,
  run: { runId: string; runName: string } | null,
  reading: DimensionReading,
  part: DimensionReading["parts"][number],
  registers: Registers,
): Proposal {
  const occupied =
    (registers.attributes ?? []).find(
      (attribute) => attribute.recordId === record.id && attribute.slot === part.slot,
    ) ?? null;

  return {
    id: newId(),
    sourceOrdinal: index,
    runId: run ? run.runId : null,
    runName: run ? run.runName : null,
    configurationLabel: detectConfiguration(observation.attributeRaw),
    dimension: {
      slot: part.slot,
      figure: part.figure,
      unit: reading.unit,
      unitSource: reading.unitSource,
      slotSuggested: part.slotSuggested,
      qualifier: reading.qualifier,
      tbc: reading.tbc,
    },
    attributeTarget: occupied
      ? {
          attributeId: occupied.id,
          attributeVersion: occupied.version,
          label: occupied.label,
          value: occupied.value,
          unit: occupied.unit,
        }
      : null,
    recordLabel: record.label,
    version: 1,
    raw: observation,
    recordCandidates,
    requirementCandidates: [],
    recordId: record.id,
    requirementId: null,
    target: null,
    // The figure is what gets written; the wording it came from stays on the
    // proposal so the reviewer reads what "445" actually measures.
    proposedValue: part.figure,
    proposedState: reading.tbc ? "tbc" : "confirmed",
    stateReason: null,
    overwriteAcknowledged: false,
    reviewStatus: "pending" as const,
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
  };
}

/**
 * One finish, aimed at one record, carrying the BWS field it will occupy.
 *
 * The field is claimed here and recorded in `taken`, so the next fabric in the
 * same email gets COM 2 rather than colliding on COM 1 at confirm time. Where
 * every slot of its kind is full `suggestSpecField` returns null, and the row
 * is still recorded — an observation with no BWS home is worth keeping against
 * the item, which is what 0007 says the column is nullable for.
 */
function buildFinishProposal(
  observation: RawProposal,
  index: number,
  record: RecordEntry,
  recordCandidates: Candidate[],
  newId: () => string,
  run: { runId: string; runName: string } | null,
  finish: FinishReading,
  registers: Registers,
  taken: Map<string, Set<string>>,
): Proposal {
  const claimed = taken.get(record.id) ?? new Set<string>();
  const specFieldId = suggestSpecField(
    {
      attrGroup: finish.group,
      labelRaw: observation.attributeRaw,
      valueRaw: observation.valueRaw,
      materialCodeRaw: finish.codeRaw,
    },
    registers.specFields ?? [],
    claimed,
  );
  if (specFieldId) {
    claimed.add(specFieldId);
    taken.set(record.id, claimed);
  }

  const occupied =
    specFieldId
      ? (registers.attributes ?? []).find(
          (attribute) => attribute.recordId === record.id && attribute.specFieldId === specFieldId,
        ) ?? null
      : null;

  const specFieldName = (registers.specFields ?? []).find((field) => field.id === specFieldId)?.name ?? null;

  return {
    id: newId(),
    sourceOrdinal: index,
    runId: run ? run.runId : null,
    runName: run ? run.runName : null,
    configurationLabel: detectConfiguration(observation.attributeRaw),
    finish: {
      group: finish.group,
      specFieldId,
      specFieldName,
      codeRaw: finish.codeRaw,
      value: observation.valueRaw,
      tbc: finish.tbc,
      reason: finish.reason,
    },
    attributeTarget: occupied
      ? {
          attributeId: occupied.id,
          attributeVersion: occupied.version,
          label: occupied.label,
          value: occupied.value,
          unit: occupied.unit,
        }
      : null,
    recordLabel: record.label,
    version: 1,
    raw: observation,
    recordCandidates,
    requirementCandidates: [],
    recordId: record.id,
    requirementId: null,
    target: null,
    proposedValue: observation.valueRaw,
    proposedState: finish.tbc ? "tbc" : "confirmed",
    stateReason: null,
    overwriteAcknowledged: false,
    reviewStatus: "pending" as const,
    reviewedAt: null,
    reviewedBy: null,
    applied: null,
  };
}

function buildProposal(
  observation: RawProposal,
  index: number,
  record: RecordEntry | null,
  recordCandidates: Candidate[],
  registers: Registers,
  newId: () => string,
  run: { runId: string; runName: string } | null,
): Proposal {
  {
    const recordId = record && record.categoryId ? record.id : null;

    let requirementCandidatesOut: Candidate[] = [];
    let requirementId: string | null = null;

    if (record && record.categoryId) {
      // Attributes are matched ONLY within the chosen record's category. A
      // global match would offer an Upholstery question for a Cabinetry item,
      // which is not a near miss — it is a question that item does not have.
      const candidates = requirementCandidates(registers.requirements, record.categoryId);
      const match = matchName(observation.attributeRaw, candidates);
      if (match.status === "confident") {
        requirementId = match.id;
        requirementCandidatesOut = [{ id: match.id, label: promptFor(registers, match.id) }];
      } else if (match.status === "ambiguous") {
        // Several TERMS pointing at one requirement is agreement, not ambiguity
        // — the same rule the BOQ category match already uses.
        const ids = [...new Set(match.candidates.map((candidate) => candidate.id))];
        if (ids.length === 1 && ids[0]) {
          requirementId = ids[0];
          requirementCandidatesOut = [{ id: ids[0], label: promptFor(registers, ids[0]) }];
        } else {
          requirementCandidatesOut = ids.map((id) => ({ id, label: promptFor(registers, id) }));
        }
      }
    }

    const requirement = requirementId
      ? registers.requirements.find((row) => row.id === requirementId) ?? null
      : null;

    const target = record && requirement ? buildTargetSnapshot(record, requirement, registers.answers) : null;
    const suggestion = emailAwareState(observation);

    return {
      id: newId(),
      sourceOrdinal: index,
      runId: run ? run.runId : null,
      runName: run ? run.runName : null,
      configurationLabel: detectConfiguration(observation.attributeRaw),
      version: 1,
      raw: observation,
      recordCandidates,
      requirementCandidates: requirementCandidatesOut,
      recordId: recordId,
      requirementId: requirement ? requirement.id : null,
      target,
      proposedValue: suggestion.value,
      proposedState: suggestion.state,
      stateReason: suggestion.reason,
      overwriteAcknowledged: false,
      reviewStatus: "pending" as const,
      reviewedAt: null,
      reviewedBy: null,
      applied: null,
    };
  }
}

/**
 * Resolving an ALREADY-STAGED document again, against today's registers and
 * today's rules. No model call, nothing charged.
 *
 * A spec document resolves in the WORKER, not at read time, because a proposal
 * needs a target SNAPSHOT the confirm can check for edits underneath the
 * reviewer — so unlike `upgradeCalloutGuesses` and `applyViewGuesses`, a
 * corrected rule is NOT retro-active here and an already-read document keeps
 * the resolution it was given. That is the right default and a bad dead end:
 * the fan-out above would otherwise reach the Panther email only by re-reading
 * it, which is a billed call to fix an app defect.
 *
 * Every proposal carries its own `raw` observation, so the whole input is
 * already on record and re-resolving is free. Two other cases it serves, both
 * ordinary orders of work rather than errors: an email read before its BOQ was
 * confirmed, and a bill revised after the email was read.
 *
 * WHAT IT REFUSES TO TOUCH is the load-bearing part. Only a proposal that is
 * still `pending`, still at `version === 1` (nobody has patched it) and still
 * unresolved is re-resolved. A reviewer's retarget, edit, ignore or confirm is
 * a decision, and a re-match that overwrote one would be a guess wearing their
 * authority — the rule `upgradeCalloutGuesses` already follows.
 *
 * It is also ID-STABLE where nothing changes: a proposal that re-resolves to a
 * single still-unresolved proposal is returned untouched rather than replaced
 * with an identical copy under a new id, so running it twice is a no-op and a
 * reviewer's open dropdown does not jump.
 */
export function rematchProposals(
  staged: StagedSpecDocument,
  registers: Registers,
  newId: () => string,
): { lines: Proposal[]; rematched: number; added: number } {
  // PER OBSERVATION, never per proposal. One observation is already several
  // proposals once it has fanned out across runs, and re-resolving each of
  // those would fan each one out again — three runs becoming nine, then
  // twenty-seven. `sourceOrdinal` is what a fan-out shares, so it is the unit
  // that can be re-resolved without multiplying.
  const groups = new Map<number, Proposal[]>();
  const order: number[] = [];
  for (const line of staged.lines) {
    const existing = groups.get(line.sourceOrdinal);
    if (existing) existing.push(line);
    else {
      groups.set(line.sourceOrdinal, [line]);
      order.push(line.sourceOrdinal);
    }
  }

  // One accumulator for the whole document. Seeded from the record's existing
  // attributes AND from every proposal this pass will NOT re-resolve, so a
  // frozen row's COM 1 is not handed out again to a row that is re-resolving.
  const taken = seedTakenFields(registers);
  for (const line of staged.lines) {
    const frozen = line.reviewStatus !== "pending" || line.version !== 1;
    if (!frozen || !line.recordId || !line.finish?.specFieldId) continue;
    const set = taken.get(line.recordId) ?? new Set<string>();
    set.add(line.finish.specFieldId);
    taken.set(line.recordId, set);
  }

  let rematched = 0;
  let added = 0;
  const lines: Proposal[] = [];

  for (const ordinal of order) {
    const group = groups.get(ordinal) ?? [];
    const first = group[0];
    if (!first) continue;

    // A DECISION is never second-guessed. One reviewed, edited, ignored or
    // applied member freezes the whole observation: re-resolving the rest
    // would leave a row half decided by a person and half by a rule.
    const untouched = group.every((line) => line.reviewStatus === "pending" && line.version === 1);
    if (!untouched) {
      lines.push(...group);
      continue;
    }

    const resolved = resolveProposals([first.raw], registers, newId, taken).map((next) => ({
      ...next,
      sourceOrdinal: ordinal,
    }));

    // Nothing moved: hand back the ORIGINALS, so ids and versions hold and
    // running this twice is a genuine no-op.
    if (signature(resolved) === signature(group)) {
      lines.push(...group);
      continue;
    }

    rematched += 1;
    added += resolved.length - group.length;
    // Keep an id wherever the same target survives, so a row the reviewer is
    // looking at stays the row they were looking at.
    const byTarget = new Map(group.map((line) => [targetKey(line), line.id]));
    lines.push(
      ...resolved.map((next, index) => ({
        ...next,
        id: byTarget.get(targetKey(next)) ?? (index === 0 && group.length === 1 ? first.id : next.id),
      })),
    );
  }

  return { lines, rematched, added };
}

/**
 * What a proposal is aimed at: record, question, dimension slot, BWS field.
 *
 * ALL FOUR, or a re-match cannot see its own effect. Without the finish field
 * an observation that used to be a checklist answer and now reads as a fabric
 * keyed the same both ways — recordId with two nulls — so `rematchProposals`
 * concluded nothing had moved and handed back the originals. Found against the
 * real pilot email: four of its five finishes silently refused to re-match.
 */
function targetKey(proposal: Proposal): string {
  return [
    proposal.recordId ?? "-",
    proposal.requirementId ?? "-",
    proposal.dimension?.slot ?? "-",
    proposal.finish ? (proposal.finish.specFieldId ?? "field?") : "-",
  ].join("|");
}

function signature(proposals: Proposal[]): string {
  return [...proposals.map(targetKey)].sort().join(",");
}

function promptFor(registers: Registers, requirementId: string): string {
  const requirement = registers.requirements.find((row) => row.id === requirementId);
  if (!requirement) return requirementId;
  return requirement.section ? `${requirement.section} · ${requirement.prompt}` : requirement.prompt;
}

// ---- blockers and sections -------------------------------------------------

export type Blocker = { code: string; message: string };

/**
 * Everything standing between one proposal and being committed. Computed from
 * the CURRENT set, every time, because half of these depend on what the other
 * proposals are currently pointing at.
 */
export function proposalBlockers(proposal: Proposal, all: Proposal[]): Blocker[] {
  const blockers: Blocker[] = [];
  if (proposal.reviewStatus !== "pending") return blockers;

  // A DIMENSION writes an attribute, not an answer, so none of the answer
  // rules below apply to it: it has no requirement, no target snapshot and no
  // state to choose. Its own three rules are the slot being free, the slot
  // being claimed once, and `Dia.` not sitting beside a `W` or `D`.
  if (proposal.dimension || proposal.finish) {
    if (!proposal.recordId) {
      blockers.push({ code: "unassigned", message: "Choose which record this belongs to." });
      return blockers;
    }

    // A FINISH claims a BWS field. Two in one document claiming one field is
    // the same clash a dimension slot has, and the confirm would refuse the
    // second on 0007's unique index anyway — named here so a reviewer reads it
    // beside the row rather than as a failure at the end.
    if (proposal.finish) {
      const field = proposal.finish.specFieldId;
      if (field) {
        const clash = all.some(
          (other) =>
            other.id !== proposal.id &&
            other.reviewStatus === "pending" &&
            other.recordId === proposal.recordId &&
            other.finish?.specFieldId === field,
        );
        if (clash) {
          blockers.push({
            code: "duplicate_target",
            message: `This document fills ${proposal.finish.specFieldName ?? "the same BWS field"} for this item more than once. Ignore the ones that are wrong.`,
          });
        }
      }
      if (proposal.attributeTarget && !proposal.overwriteAcknowledged) {
        blockers.push({
          code: "replace",
          message: `This item already records ${proposal.finish.specFieldName ?? "this field"} as “${proposal.attributeTarget.value ?? "—"}”. Confirm you mean to replace it.`,
        });
      }
      return blockers;
    }

    // Past the finish branch, so this is a dimension.
    const dimension = proposal.dimension;
    if (!dimension) return blockers;

    const siblings = all.filter(
      (other) =>
        other.id !== proposal.id &&
        other.reviewStatus === "pending" &&
        other.recordId === proposal.recordId &&
        other.dimension,
    );

    if (siblings.some((other) => other.dimension?.slot === dimension.slot)) {
      blockers.push({
        code: "duplicate_target",
        message: `This document states ${dimension.slot} for this item more than once. Ignore the ones that are wrong.`,
      });
    }

    // Cross-row, which is why no check constraint can hold it: a round item is
    // a diameter OR a width and depth, never both, and a trigger would fire
    // mid-fan-out naming a row the reviewer never saw.
    const slots = new Set<string>([dimension.slot, ...siblings.map((other) => other.dimension?.slot ?? "")]);
    if (slots.has("DIA") && (slots.has("W") || slots.has("D"))) {
      blockers.push({
        code: "dia_conflict",
        message: "This states a diameter as well as a width or depth. A round item has one or the other.",
      });
    }

    // Retiring what a document said is a decision. 0016's partial unique index
    // is `where status = 'active'`, so the insert cannot commit until the old
    // row is retired — and that must never happen because nobody looked.
    if (proposal.attributeTarget && !proposal.overwriteAcknowledged) {
      const held = [proposal.attributeTarget.value, proposal.attributeTarget.unit].filter(Boolean).join("");
      blockers.push({
        code: "replace",
        message: `This item already records ${dimension.slot} as “${held || "—"}”. Confirm you mean to replace it.`,
      });
    }

    return blockers;
  }

  if (!proposal.recordId || !proposal.requirementId || !proposal.target) {
    // Name the half that is missing. Once the run fan-out resolves the item,
    // "choose which record and question" sends a reviewer looking for a record
    // that is already chosen, and the question — the thing they actually have
    // to pick — reads as one of two equal problems.
    blockers.push(
      proposal.recordId
        ? { code: "unassigned", message: "Choose which question this answers." }
        : { code: "unassigned", message: "Choose which record and question this belongs to." },
    );
    return blockers;
  }

  if (proposal.proposedState === null) {
    blockers.push({
      code: "no_state",
      message: proposal.stateReason ?? "Say whether this is confirmed, TBC or not applicable.",
    });
  }

  if (proposal.proposedState === "confirmed" && !(proposal.proposedValue ?? "").trim()) {
    blockers.push({ code: "empty_value", message: "A confirmed answer needs a value." });
  }

  if (proposal.proposedState === "na" && (proposal.proposedValue ?? "").trim()) {
    blockers.push({ code: "na_with_value", message: "“Not applicable” cannot carry a value." });
  }

  // Overwriting somebody's settled answer is a decision, and it is tied to the
  // VERSION that was shown. If the answer moved after the acknowledgement, the
  // acknowledgement was about a different value.
  if (
    proposal.target.answerExists &&
    (proposal.target.answerState === "confirmed" || proposal.target.answerState === "na") &&
    !proposal.overwriteAcknowledged
  ) {
    blockers.push({
      code: "overwrite",
      message: `This question is already answered “${proposal.target.answerValue ?? "N/A"}”. Confirm you mean to replace it.`,
    });
  }

  // Two proposals for one target. The document said both things; a human picks.
  const clashes = all.filter(
    (other) =>
      other.id !== proposal.id &&
      other.reviewStatus === "pending" &&
      other.recordId === proposal.recordId &&
      other.requirementId === proposal.requirementId,
  );
  if (clashes.length > 0) {
    blockers.push({
      code: "duplicate_target",
      message: `The document answers this question ${clashes.length + 1} times. Ignore the ones that are wrong.`,
    });
  }

  return blockers;
}

export type ProposalSection = "pending" | "unassigned" | "ambiguous" | "ignored" | "applied" | "unclassified";

/**
 * Every proposal belongs to exactly ONE visible section. The `unclassified`
 * fallback exists so a proposal can never be held in the run yet appear nowhere
 * — an invisible row is one nobody can ignore, restore, or fix.
 */
export function classifyProposal(proposal: Proposal): ProposalSection {
  if (proposal.reviewStatus === "applied") return "applied";
  if (proposal.reviewStatus === "ignored") return "ignored";
  if (proposal.reviewStatus === "pending") {
    // A dimension is committable with a record alone: it has no question to
    // match, by construction.
    if (proposal.dimension || proposal.finish) return proposal.recordId ? "pending" : "unassigned";
    if (proposal.recordId && proposal.requirementId) return "pending";
    if (proposal.recordCandidates.length > 1 || proposal.requirementCandidates.length > 1) return "ambiguous";
    return "unassigned";
  }
  return "unclassified";
}

/** The per-record cards the review screen commits one at a time. */
export function groupByRecord(proposals: Proposal[]): { recordId: string; recordLabel: string; proposals: Proposal[] }[] {
  const groups = new Map<string, { recordId: string; recordLabel: string; proposals: Proposal[] }>();
  for (const proposal of proposals) {
    if (!proposal.recordId || !proposal.target) continue;
    const existing = groups.get(proposal.recordId);
    if (existing) existing.proposals.push(proposal);
    else
      groups.set(proposal.recordId, {
        recordId: proposal.recordId,
        recordLabel: proposal.target.recordLabel,
        proposals: [proposal],
      });
  }
  return [...groups.values()].sort((a, b) => a.recordLabel.localeCompare(b.recordLabel));
}

/** A run is complete when nothing is still pending — applied or explicitly ignored. */
export function hasPendingProposals(proposals: Proposal[]): boolean {
  return proposals.some((proposal) => proposal.reviewStatus === "pending");
}
