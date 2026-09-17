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
import type { AnswerState } from "@/lib/spec-vocab";
import type { RawProposal } from "@/lib/extraction-schema";

export const PROPOSAL_SCHEMA_VERSION = 1;

// ---- the registers ---------------------------------------------------------

export type RecordEntry = {
  id: string;
  recordNo: number;
  label: string; // 'P17231-014'
  itemDescription: string;
  categoryId: string | null;
  categoryName: string | null;
  refs: string[];
  /**
   * The `boq_code` refs alone. A drawing's item code is a BOQ code, and
   * matching it against every ref system would let a COS code or a job number
   * that happens to read the same claim the drawing.
   */
  boqCodes: string[];
  /** Which run (BOQ tab) this record belongs to. Drawings fan out across runs. */
  runId: string;
  runName: string;
  /**
   * The bill line a CONFIGURATION hangs off, and its letter (0024).
   *
   * Both null on an ordinary record. A configuration carries no client ref of
   * its own, so `findRecordsByRef` never returns one — it is only ever reached
   * through its parent, which is why the resolver has to look for it by
   * `parentId` rather than by matching.
   */
  parentId: string | null;
  variantLabel: string | null;
  version: number;
};

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

export type Registers = {
  records: RecordEntry[];
  requirements: RequirementEntry[];
  answers: AnswerEntry[];
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
  applied: { answerId: string; answerVersion: number; value: string | null; state: AnswerState } | null;
};

export type StagedSpecDocument = {
  schemaVersion: number;
  lines: Proposal[];
  documentNotes: string | null;
  filename: string | null;
};

// ---- refs ------------------------------------------------------------------

/**
 * The fallback pass for a ref the document writes differently: `FU-209-15` vs
 * `FU 209 15`. Aggressive on purpose — a collision it creates produces AMBIGUITY
 * (two candidates, no choice made), never a wrong pick, so the cost of being
 * too loose here is a question, and the cost of being too strict is a miss.
 */
export function normaliseRef(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Records whose refs match. Exact first, then normalised, and ALWAYS a list.
 * Two records legitimately carry the same ref; returning both is the point.
 */
export function findRecordsByRef(refRaw: string | null, records: RecordEntry[]): RecordEntry[] {
  if (!refRaw || !refRaw.trim()) return [];
  const wanted = refRaw.trim();
  const exact = records.filter((record) => record.refs.some((ref) => ref.trim() === wanted));
  if (exact.length > 0) return exact;

  const normalised = normaliseRef(wanted);
  if (!normalised) return [];
  const byRef = records.filter((record) => record.refs.some((ref) => normaliseRef(ref) === normalised));
  if (byRef.length > 0) return byRef;

  // The app's OWN identifier, `P17726-014`. A client document never uses it,
  // but an email does: it is what our chase tables print, so a reply quoting
  // the question quotes the label back. Checked last, because a client ref is
  // always the better answer where there is one.
  return records.filter((record) => normaliseRef(record.label) === normalised);
}

// ---- state suggestion ------------------------------------------------------

// Wording that means "not decided yet". Deliberately tight: each of these is a
// phrase that carries no specification content at all.
//
// `pending` and `to bid` were added from the Panther specification sheets,
// which write "TIMBER  PENDING" and "SUPPLIER  TO BID" where the AP364 drawings
// write "TBC". Same meaning, and the export must carry all three through as TBC
// rather than as a stated value — a blank supplier reads as "no supplier", and
// a supplier of "TO BID" reads as a company.
export const TBC_TOKENS = [
  "tbc",
  "t b c",
  "to be confirmed",
  "to be advised",
  "tba",
  "to follow",
  "to be issued",
  "pending",
  "to bid",
];

/**
 * "Argenta to confirm", "designer to confirm" — somebody else will decide.
 *
 * NOT added to TBC_TOKENS, because the phrase names WHO, and that is content
 * worth keeping rather than collapsing to "TBC". It is also not a settled
 * value. So it takes the third outcome this module already has: no state, the
 * wording preserved, and a reviewer told what they are being asked. A rule that
 * guessed either way would be wrong on one of the two readings every time.
 *
 * Anchored at the end so "confirmed by the client on 4 June" — a settled fact
 * written in the past tense — does not match.
 */
const DEFERRED_TO_SOMEBODY = /\bto confirm$/;

/** Shared with `suggestAttributeState`, so the two pipelines read it alike. */
export function deferredToSomebody(normalised: string): boolean {
  return DEFERRED_TO_SOMEBODY.test(normalised);
}

/**
 * Whether a normalised string contains a token as whole words.
 *
 * `normaliseName` has already lowercased, turned punctuation into spaces and
 * collapsed runs of whitespace, so padding both sides and testing for the
 * padded token is enough — and it works for the multi-word tokens ("to be
 * confirmed") that a word-set intersection would not.
 */
export function containsPhrase(normalised: string, token: string): boolean {
  return ` ${normalised} `.includes(` ${token} `);
}

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

export function resolveProposals(
  raw: RawProposal[],
  registers: Registers,
  newId: () => string,
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

    return runs.map((run) => {
      const candidates: Candidate[] = run.records.map((record) => ({
        id: record.id,
        label: `${record.label} · ${record.refs.join(", ")} · ${record.itemDescription}`,
      }));
      // One record on this run, and it has a category. Anything else stays
      // unchosen: a record with no category has no checklist to match an
      // attribute against, so picking it would only produce a second
      // unanswerable question.
      const record = run.records.length === 1 ? run.records[0] ?? null : null;
      return buildProposal(observation, index, record, candidates, registers, newId, run);
    });
  });
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
  let rematched = 0;
  let added = 0;

  const lines = staged.lines.flatMap((proposal): Proposal[] => {
    const untouched = proposal.reviewStatus === "pending" && proposal.version === 1 && !proposal.recordId;
    if (!untouched) return [proposal];

    const resolved = resolveProposals([proposal.raw], registers, newId);
    // Still nothing to say. Hand back the ORIGINAL, so ids and versions hold.
    if (resolved.length === 1 && !resolved[0]?.recordId) return [proposal];

    rematched += 1;
    added += resolved.length - 1;
    return resolved.map((next, index) => ({
      ...next,
      // The first member keeps the original's identity: the row the reviewer
      // is looking at stays the row they were looking at.
      id: index === 0 ? proposal.id : next.id,
      sourceOrdinal: proposal.sourceOrdinal,
    }));
  });

  return { lines, rematched, added };
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
