"use client";

// One spec record: what documents have said about it, and what its category's
// checklist still asks.
//
// THE SPECS COME FIRST, because they are the intake stage's product: statements
// a client document made about this item, each with the page it came from. The
// checklist below them measures a later stage, and a record may not even have
// been given a category yet — intake no longer waits for that decision, so this
// screen is where one is chosen.
//
// A question with no answer row still appears, as `missing` — that half of the
// screen is driven by the requirement list, not by the answers that exist.
//
// ============================================================================
// THE IDENTITY IS THE HEADER AND THE PICTURE, AND NEITHER IS IN A TAB.
//
// CLAUDE.md's rule for this screen is that what tells you WHICH item you are
// looking at stays above the tab content. In this layout the description is
// the `h1` and the picture heads the Specs tab's own sticky column, which is
// where a reader looks while checking a value against a page — and which also
// closes the alignment finding of 2026-09-18: the picture used to be a grid
// track beside `RecordDetails`, whose own heading began lower than the box did,
// so `items-start` aligned two things that did not start in the same place.
// Now both columns begin with a box at the same top edge.
// ============================================================================
import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOT_LABELS,
  type AnswerState,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
  ITEM_LEVELS,
  ITEM_LEVEL_LABELS,
  normaliseItemLevel,
} from "@/lib/spec-vocab";
import { isFinishGroup } from "@/lib/finishes";
import { composeDimensionCell } from "@/lib/dimensions";
import { NO_LEVEL_EXPLANATION } from "@/lib/tgq";
import SpecValue from "@/components/records/SpecValue";
import { unallocatedQty, variantName } from "@/lib/record-variants";
import RecordHistory from "@/components/history/RecordHistory";
import ReasonPrompt, { type PendingReason } from "@/components/history/ReasonPrompt";
import type { UploadedEvidence } from "@/components/history/EvidenceUpload";
import Button, { buttonClass } from "@/components/ui/Button";
import GatePanel, { type MatrixFieldRow } from "@/components/records/GatePanel";
import RecordDetails from "@/components/records/RecordDetails";
import AddSpec from "@/components/records/AddSpec";
import RecordChecklist from "@/components/records/RecordChecklist";
import { dimensionProvenance } from "@/components/records/dimension-provenance";
import type { Palette } from "@/lib/palettes";
import { GATES, type Gate, type GateStatus } from "@/lib/gates";
import { describeChaseCounts, summariseGateRows } from "@/lib/chase-counts";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Tip from "@/components/ui/Tip";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr, GroupRow } from "@/components/ui/Table";
import { TONE } from "@/components/ui/tone";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/lib/use-url-tab";

export type Answer = {
  requirement_id: string; kind: string; prompt: string; help_text: string | null; section: string | null;
  tgq_levels: string[] | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  answer_id: string | null; value: string | null; qualifier: string | null; state: AnswerState; version: number;
  /** Ties a readiness question to a row of Matthew's matrix that has no BWS field. */
  local_key: string | null;
  confirmed_by: string | null; confirmed_at: string | null;
};
type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  qty: number | null; designer: string | null; area: string | null; boq_category: string | null;
  source_line_no: number | null; version: number; category_id: string | null; level: string | null;
  /** A level this app guessed. Advisory until somebody accepts it. */
  level_suggested: string | null; level_suggested_reason: string | null;
  /** 0028's two free-text columns. `spec_description` is quote-facing;
   *  `internal_notes` never leaves this app. */
  spec_description: string | null; internal_notes: string | null;
  /** 0034: the one sentence a person typed about the dimension cell. */
  dimension_note: string | null;
  bws_project_number: string; project_name: string; project_id: string;
  run_id: string; run_name: string;
  category_name: string | null; category_family: string | null;
  /** A fabric split (0024). Both null on an ordinary record. */
  parent_id: string | null; variant_label: string | null;
  /** Whether a crop was confirmed off the drawings, so the screen can decide
   *  without asking `/image` and being refused. */
  has_image: boolean;
};

/** This record's bill line and every live configuration under it, parent first. */
type FamilyMember = {
  id: string; record_no: number; variant_label: string | null; qty: number | null;
  item_description: string; attribute_count: string; refs: string | null;
};

type Attribute = {
  id: string; attr_group: AttributeGroup; label: string; value: string | null; unit: string | null;
  /** Where on the item it goes (0029): "Main body & self pipe". */
  qualifier: string | null;
  finish_id: string | null; finish_code: string | null; finish_description: string | null;
  finish_state: string | null;
  /** `internal` = a code this app minted (0036). It never reaches the export. */
  finish_code_origin: string | null;
  dimension_slot: DimensionSlot | null;
  material_code: string | null; state: AttributeState; sort_order: number; version: number;
  source_page: number | null; source_run_id: string | null; created_by: string | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  source_filename: string | null; source_document_kind: string | null;
};

type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };

type RetiredAttribute = Attribute & {
  retired_at: string | null;
  retired_by: string | null;
  superseded_by_id: string | null;
};

/** Who owes us the unanswered questions, resolved from the BOQ's designer code. */
export type DesignerContact = { id: string; name: string; email: string | null; role: string | null; designer_code: string };

/** The four jobs this screen does, one tab each. */
const RECORD_TABS = ["specs", "checklist", "gates", "versions"] as const;
type RecordTab = (typeof RECORD_TABS)[number];

export type Payload = {
  record: SpecRecord;
  refs: { ref_system: string; ref_value: string }[];
  attributes: Attribute[];
  retiredAttributes: RetiredAttribute[];
  answers: Answer[];
  categories: Category[];
  specFields: { id: string; name: string; json_id: number }[];
  /** The project's finishes library, for the Attach control on the Specs tab. */
  finishes: {
    id: string; code: string; code_origin: string; kind: string | null;
    description: string | null; state: string;
  }[];
  /** Every palette, options included. A BWS-owned one arrives with none. */
  palettes: (Omit<Palette, "options"> & { allows_free_text: boolean; source_note: string | null; synced_at: string | null; options: Palette["options"] })[];
  /** Which palette a question offers, by BWS field id or by local key. */
  paletteByQuestion: { json_id: number | null; local_key: string | null; palette_key: string }[];
  family: FamilyMember[];
  /** Null where this record's category is not on Matthew's matrix. */
  gates: Record<Gate, GateStatus> | null;
  /**
   * Which model decides this record's TGQ, as data rather than as a verdict.
   *
   * Null where his matrix does not cover the category, which means the 0019
   * placeholder applies — NOT that nothing blocks a quote. Arrays because a
   * Set does not survive JSON; the screen rebuilds them.
   */
  tgqMatrix: { fields: number[]; localKeys: string[] } | null;
  /**
   * Which questions have already been ASKED and not answered, keyed by
   * `questionKey(recordId, requirementId, 0)` — derived, never stored.
   */
  waiting: Record<string, { draftId: string; sentAt: string | null; contactName: string }>;
  designerContact: DesignerContact | null;
  designerContactAmbiguous: boolean;
  /** `toQuote`/`alsoOutstanding`/`toChase` are NULL where the record has no level. A dash, never a zero. */
  quoteReadiness: {
    toQuote: number | null;
    /** Of `toQuote`, the ones a chase would ask — readiness rows are ours to record. */
    toChase: number | null;
    alsoOutstanding: number | null;
    outstanding: number;
    settled: number;
    notApplicable: number;
    noLevel: boolean;
  };
  /** Matthew's matrix rows for this category. Null where his matrix does not reach it. */
  matrixFields: MatrixFieldRow[] | null;
};

/**
 * Half a sentence on a group of captured specs, where the group carries a rule.
 *
 * On the heading rather than in a doc: "why is Dimension 5 a note and not a
 * height?" is a question somebody asks while looking at the row, and the
 * answer is the rule `normaliseDimensionSlot` follows.
 */
const GROUP_RULE: Partial<Record<AttributeGroup, string>> = {
  dimension: "— the ones that compose the cell above",
  note: "— kept with their own label, never folded into a slot",
};

function RecordView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);
  /**
   * WHICH TAB. The record was one page of four stacked sections — the specs,
   * the checklist, the gates and the history — and the checklist alone is 43
   * questions, so the history sat below about four screens of scrolling and
   * was collapsed behind a toggle to stop it being five.
   *
   * Collapsing was the wrong fix: a thing you have to expand every time is a
   * thing people stop opening. They are four different jobs done at four
   * different moments, and a tab each is how you get to the one you came for.
   */
  const [tab, setTab] = useUrlTab<RecordTab>({
    fallback: "specs",
    resolve: (raw) => (RECORD_TABS.includes(raw as RecordTab) ? (raw as RecordTab) : null),
  });
  // THE PAYLOAD SAYS WHETHER THERE IS A PICTURE.
  //
  // This used to be optimistic — render the `<img>`, let the 404 turn it off —
  // on the argument that asking first would cost a second round trip. It does
  // not: `/api/records/[id]` is loaded anyway and now carries `has_image`, so
  // the flag is free and the console stops collecting an EXPECTED 404 on every
  // record with no crop (found-in-use 2026-09-20). `onError` stays, for a crop
  // whose blob has gone: the row says there is a picture and the fetch is what
  // finds out there is not.
  const [imageFailed, setImageFailed] = useState(false);
  // Bumped after every successful write, so the history list below reloads
  // under the edit that caused it instead of going stale until a page reload.
  const [historyKey, setHistoryKey] = useState(0);
  // Set when the server refuses an edit for want of a reason. Holds everything
  // needed to replay the same edit once the reviewer has said why.
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(null);
  // The spec a reviewer has asked to take off this item, waiting for a reason.
  // Retiring destroys a statement a document made, so the reason is required
  // here rather than only on an override.
  const [retiring, setRetiring] = useState<Attribute | null>(null);
  const [retireReason, setRetireReason] = useState("");
  const [retireBusy, setRetireBusy] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  /**
   * THE SPEC BEING CORRECTED, and the boxes it opened pre-filled.
   *
   * PRE-FILLING IS RIGHT HERE and the level picker's trap does not apply: that
   * rule is about a control whose ACTION is the selection, where a select
   * already reading "Simple" fires no change event when somebody picks Simple.
   * The action here is the Save, which fires whatever the boxes say.
   *
   * A correction is a SUPERSESSION, not an edit in place — see
   * `src/lib/attribute-correct.ts`. The old row stays under "show retired",
   * marked as superseded, with who corrected it and why.
   */
  const [correcting, setCorrecting] = useState<Attribute | null>(null);
  const [correctValue, setCorrectValue] = useState("");
  const [correctUnit, setCorrectUnit] = useState<AttributeUnit | "">("");
  const [correctState, setCorrectState] = useState<AttributeState>("confirmed");
  const [correctReason, setCorrectReason] = useState("");
  const [correctBusy, setCorrectBusy] = useState(false);
  /** The spec whose finishes-library link is being changed, and what to. */
  const [attaching, setAttaching] = useState<Attribute | null>(null);
  const [attachTo, setAttachTo] = useState("");
  const [attachReason, setAttachReason] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  // The header's "Add a spec by hand" opens the form beside the specs it adds
  // to. One action, one button: the page-level action lives in the band.
  const [addingSpec, setAddingSpec] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/records/${id}`);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setData(res.data);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Reload first, report afterwards.
   *
   * `load()` clears the banner on a successful fetch, so `setError(...)`
   * followed by `await load()` showed a refusal for a few milliseconds and
   * then nothing at all — the click simply looked as though it had not
   * registered. The reload itself is still required: a refused request means
   * this screen is out of date. Same rule as both drawings screens.
   */
  async function reloadThen(message: string | null) {
    await load();
    if (message) setError(message);
    setHistoryKey((key) => key + 1);
  }
  // Moving from a record with no picture to one with a picture reuses this
  // component, so a sticky `true` would hide every image after the first miss.
  useEffect(() => { setImageFailed(false); }, [id]);

  async function save(
    answer: Answer,
    value: string,
    state: AnswerState,
    reason?: string,
    evidence?: UploadedEvidence | null,
  ) {
    // Reachable only if a requirement was added to the category after this
    // record was given one. Choosing the category again creates the missing
    // rows; re-importing is no longer the only way out.
    if (!answer.answer_id) {
      setError("This question has no answer row yet. Set the category again to add the newer questions.");
      return;
    }
    setSavingId(answer.answer_id);
    setError(null);
    try {
      const res = await apiFetch(`/api/answers/${answer.answer_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value, state, version: answer.version, reason, evidence }),
      });
      if (!res.ok) {
        // The server asks for a reason only when the edit OVERRIDES a settled
        // answer. It is asked for here rather than on every keystroke, and it
        // carries the original edit so nothing has to be retyped.
        if (res.data?.code === "reason_required") {
          setPendingReason({ prompt: answer.prompt, answerId: answer.answer_id, value, state, version: answer.version });
          await reloadThen(null);
          return;
        }
        await reloadThen(res.error);
        return;
      }
      await reloadThen(null);
    } finally {
      setSavingId(null);
    }
  }

  /**
   * One dimension, recorded as an ATTRIBUTE off the Checklist tab.
   *
   * NOT an answer. The composed Dimensions cell is a projection of these rows
   * — see `src/components/records/DimensionAnswer.tsx` — so a value written
   * straight into the answer carries no slots behind it, and is marked
   * `manual`, which puts the cell out of reach of every later recomposition.
   * `createAttribute` joins the actor's open change, as everywhere else.
   */
  async function recordDimension(input: {
    slot: DimensionSlot;
    value: string;
    unit: AttributeUnit;
  }): Promise<boolean> {
    setError(null);
    const res = await apiFetch("/api/attributes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recordId: id,
        attrGroup: "dimension",
        // The slot's own name, so the row reads as what it is on the Specs tab
        // and in the long-form sheet.
        label: DIMENSION_SLOT_LABELS[input.slot],
        value: input.value,
        unit: input.unit,
        dimensionSlot: input.slot,
        state: "confirmed",
      }),
    });
    // Reload first, report afterwards — a refusal (an occupied slot, a stale
    // screen) means this screen is out of date, and `load()` would otherwise
    // clear the sentence that explains it.
    await reloadThen(res.ok ? null : res.error);
    return res.ok;
  }

  async function setLevel(next: string) {
    if (!data) return;
    setSavingLevel(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/records/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: next === "" ? null : next, version: data.record.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      // Always reset: an HTML error page must not leave the select disabled.
      setSavingLevel(false);
    }
  }

  async function setCategory(categoryId: string) {
    if (!data || !categoryId) return;
    setSavingCategory(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/records/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, version: data.record.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      // Always reset: an HTML error page must not leave the select disabled.
      setSavingCategory(false);
    }
  }

  /** Replays the edit the server refused, now that there is a reason for it. */
  async function saveWithReason(reason: string, evidence: UploadedEvidence | null) {
    if (!data || !pendingReason) return;
    const answer = data.answers.find((row) => row.answer_id === pendingReason.answerId);
    // The answer moved under the prompt — a stale screen, so say so rather
    // than writing to whatever is at that id now.
    if (!answer) {
      setPendingReason(null);
      await reloadThen("That question changed while the reason box was open. Nothing was saved — check it and try again.");
      return;
    }
    await save(answer, pendingReason.value, pendingReason.state, reason, evidence);
    setPendingReason(null);
  }

  async function retire() {
    if (!retiring || !retireReason.trim()) return;
    setRetireBusy(true);
    try {
      const res = await apiFetch(`/api/attributes/${retiring.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "retired", version: retiring.version, reason: retireReason.trim() }),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) {
        setRetiring(null);
        setRetireReason("");
      }
    } finally {
      // Always reset: a non-JSON error must not leave the dialog stuck.
      setRetireBusy(false);
    }
  }

  /** Open the editor on one spec, filled in with what it currently says. */
  function beginCorrection(attribute: Attribute) {
    setCorrecting(attribute);
    setCorrectValue(attribute.value ?? "");
    setCorrectUnit((attribute.unit as AttributeUnit | null) ?? "");
    setCorrectState(attribute.state);
    // NOT pre-filled: the reason is the one thing nobody can guess, and a
    // default would be twenty rows in the trail reading the same sentence.
    setCorrectReason("");
  }

  async function correct() {
    if (!correcting || !correctReason.trim()) return;
    setCorrectBusy(true);
    try {
      const res = await apiFetch<{ finishUnlinked?: boolean }>(
        `/api/attributes/${encodeURIComponent(correcting.id)}/correct`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value: correctState === "tbc" && !correctValue.trim() ? null : correctValue,
            unit: correctUnit === "" ? null : correctUnit,
            state: correctState,
            version: correcting.version,
            reason: correctReason.trim(),
          }),
        },
      );
      // RELOAD FIRST, REPORT AFTER. This screen clears its banner on a
      // successful load, so setting the message first shows a 409 for a few
      // milliseconds and then nothing at all — the click looks as though it
      // never registered.
      await reloadThen(
        res.ok
          ? res.data?.finishUnlinked
            ? "Corrected. The finishes library says something else about that code, so this item is no longer linked to it — the library row is untouched."
            : null
          : res.error,
      );
      if (res.ok) setCorrecting(null);
    } finally {
      // Always, so an HTML error page cannot leave the Save button dead.
      setCorrectBusy(false);
    }
  }

  /**
   * LINKING ONE SPEC TO THE FINISHES LIBRARY, or letting it stand on its own
   * words.
   *
   * ==========================================================================
   * `PATCH /api/attributes/[id]/finish` has been built since 0018 — version-
   * checked, reason-bearing, with its own `finish_link` / `finish_unlink`
   * change kinds — and no screen called it. Found while tracing why the S-203
   * fabric never reached the library (found-in-use.md, 2026-09-22): half of
   * that entry was a keying decision and half was a route with no button.
   *
   * LINKING CHANGES WHAT THE FILE SAYS. `composeFinishCell` renders the
   * LIBRARY wherever an attribute is linked, so the BWS cell, the checklist
   * answer and this screen all move from the page's own words to the
   * library's. That is edit-once working as designed, and it is exactly why
   * this is a person's act with a sentence beside it rather than something a
   * confirm does on a resemblance.
   * ==========================================================================
   */
  async function attach() {
    if (!attaching) return;
    const unlinking = attachTo === "";
    if (unlinking && !attachReason.trim()) return;
    setAttachBusy(true);
    try {
      const res = await apiFetch(`/api/attributes/${encodeURIComponent(attaching.id)}/finish`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          finishId: unlinking ? null : attachTo,
          version: attaching.version,
          ...(attachReason.trim() ? { reason: attachReason.trim() } : {}),
        }),
      });
      // Reload first, report after — this screen clears its banner on a
      // successful load, so a 409 set beforehand flashes and vanishes.
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) {
        setAttaching(null);
        setAttachTo("");
        setAttachReason("");
      }
    } finally {
      // Always, so an HTML error page cannot leave the button dead.
      setAttachBusy(false);
    }
  }

  async function restore(attribute: RetiredAttribute) {
    setRetireBusy(true);
    try {
      const res = await apiFetch(`/api/attributes/${attribute.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          version: attribute.version,
          reason: `Put back on the item after being retired${attribute.retired_by ? ` by ${attribute.retired_by}` : ""}.`,
        }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      setRetireBusy(false);
    }
  }

  if (error && !data) return <PageBody><Note tone="danger">{error}</Note></PageBody>;
  if (!data) return <PageBody><Spinner label="Loading record" /></PageBody>;

  const { record, refs, answers, attributes, categories } = data;

  // The payload says whether a crop exists; `imageFailed` covers the one case
  // it cannot — a row that names a blob the store no longer holds.
  const hasImage = record.has_image && !imageFailed;

  // ---- the fabric split, from whichever end this record is ------------------
  //
  // `family` comes back parent-first, so the head of it is the bill line
  // whether this record IS that line or hangs off it. The client ref is read
  // from the parent because a configuration deliberately carries none of its
  // own — see `ensureVariant`.
  const family = data.family ?? [];
  const billLine = family.find((member) => member.variant_label === null) ?? null;
  const variants = family.filter((member) => member.variant_label !== null);
  const parentRefs = billLine?.refs ?? refs.map((ref) => ref.ref_value).join(", ");
  const billQty = billLine?.qty ?? null;
  const unallocated = unallocatedQty(billQty, variants.map((member) => member.qty));

  const recordLabel = `${record.bws_project_number}-${String(record.record_no).padStart(3, "0")}`;
  const runHref = `/dashboard/projects/${record.project_id}?tab=${record.run_id}`;
  const level = normaliseItemLevel(record.level);
  const readiness = data.quoteReadiness ?? {
    toQuote: null, toChase: null, alsoOutstanding: null, outstanding: 0, settled: 0, notApplicable: 0, noLevel: true,
  };

  /**
   * The counts the tabs carry.
   *
   * Outstanding is missing OR TBC, which are two different things and both
   * unsettled — the invariant the whole gate model rests on. Settled is
   * confirmed or N/A.
   *
   * The gate label is "n of 3" over the three gates, and NULL where Matthew's
   * matrix does not cover this category. A gates tab reading "0 of 3" there
   * would say the record fails three gates; it has none, and the panel inside
   * says so in words.
   */
  const outstandingCount = answers.filter(
    (answer) => answer.state === "missing" || answer.state === "tbc",
  ).length;
  // WHY THE NUMBERS ON THIS SCREEN DIFFER, DERIVED FROM THE ROWS BELOW THEM.
  //
  // Not from a remembered cause: driven on the sandbox, the gap on one sofa
  // was Spec notes and Designer reference — rows read off this record's own
  // columns, with no checklist question and nowhere to chase — and on another
  // record it is a dimension slot or a readiness question. `summariseGateRows`
  // buckets the TGQ rows the panel is about to list, so the line can only ever
  // describe what is on the screen. Null where Matthew's matrix does not reach
  // the category: there is no second measure there to explain.
  const tgqBuckets = data.gates ? summariseGateRows(data.gates.TGQ.fields, answers) : null;
  const chaseCounts = describeChaseCounts({ buckets: tgqBuckets, toChase: readiness.toChase });

  const gateSummaryLabel = data.gates
    ? `${GATES.filter((gate) => data.gates![gate].satisfied).length} of ${GATES.length}`
    : null;
  const gateTone: "warn" | "good" | "plain" = !data.gates
    ? "plain"
    : GATES.every((gate) => data.gates![gate].satisfied)
      ? "good"
      : "warn";

  // Older responses have no `retiredAttributes`; a screen that assumed the key
  // exists would crash on the first record loaded from a cached payload.
  const retiredAttributes = data.retiredAttributes ?? [];
  const slotted = attributes.filter(
    (attribute) => attribute.attr_group === "dimension" && attribute.dimension_slot,
  );
  const dimensionCell = composeDimensionCell(
    slotted.map((attribute) => ({
      slot: attribute.dimension_slot as DimensionSlot,
      value: attribute.value,
      unit: (attribute.unit ?? null) as AttributeUnit | null,
      state: attribute.state,
      sortOrder: attribute.sort_order,
    })),
    // The note IS part of the cell, not a caption beside it (0034). Rendering
    // it separately here would show a reviewer something the file does not
    // say, which is the whole reason there is one composer.
    record.dimension_note,
  );
  const provenance = dimensionProvenance(
    slotted.map((attribute) => ({
      unit: attribute.unit,
      sourceFilename: attribute.source_filename,
      sourcePage: attribute.source_page,
    })),
  );
  const byGroup = ATTRIBUTE_GROUPS.map((group) => ({
    group,
    rows: attributes.filter((attribute) => attribute.attr_group === group),
  })).filter((entry) => entry.rows.length > 0);
  // How many distinct pages the captured specs came off, for the card heading.
  const pageCount = new Set(
    attributes
      .filter((attribute) => attribute.source_run_id)
      .map((attribute) => `${attribute.source_run_id}:${attribute.source_page ?? ""}`),
  ).size;
  /** The drawing set this item's specs came off — where its crop is chosen. */
  const drawingRunId =
    attributes.find((attribute) => attribute.source_document_kind === "shop_drawings" && attribute.source_run_id)
      ?.source_run_id ?? null;

  const specSource = (attribute: { source_run_id: string | null; source_page: number | null; source_filename: string | null }) =>
    attribute.source_run_id ? (
      // NO PAGE MEANS NO LINK TO A PAGE. A hand-typed spec carries neither,
      // deliberately, and a link opening a document at page 1 to stand in
      // would be a false provenance rather than a missing one.
      <a
        href={`/api/imports/${attribute.source_run_id}/source${attribute.source_page ? `#page=${attribute.source_page}` : ""}`}
        target="_blank"
        rel="noreferrer"
        title={`${attribute.source_filename ?? "source"}${attribute.source_page ? ` — page ${attribute.source_page}` : ""}`}
        // TRUNCATED, NOT WRAPPED. A real filename is `Ashcombe House - Shop
        // Drawings - Issue A.pdf`, and wrapping it made every row in the table
        // six lines tall — the value the reader came for pushed apart by the
        // name of the file it came from. The full name is on hover and in the
        // document it opens.
        className="block max-w-[9rem] truncate underline hover:text-neutral-900"
      >
        {attribute.source_filename ?? "source"}
        {attribute.source_page ? ` p${attribute.source_page}` : ""}
      </a>
    ) : (
      <span className="text-neutral-400">typed by hand</span>
    );

  // ---- the header's subtitle, which is a row of places to go ---------------
  //
  // Everything in it either is a link or is a chip saying what is not set.
  // A client ref, a run, a category and a level are all things somebody wants
  // to jump from rather than read, and a figure that makes you go and find the
  // screen it belongs to is the thing the design language exists to stop.
  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <Link href={runHref} className="font-mono text-neutral-700 underline hover:text-neutral-900">
        {parentRefs || "no client ref"}
      </Link>
      <span aria-hidden>·</span>
      <Link href={runHref} className="underline hover:text-neutral-900">{record.run_name}</Link>
      {record.area && <><span aria-hidden>·</span><span>{record.area}</span></>}
      <span aria-hidden>·</span>
      {record.qty !== null ? (
        <span>qty {record.qty}</span>
      ) : record.parent_id ? (
        // 0024: a configuration carries no quantity, because the bill says 45
        // and never says how many are fabric A. Stated, never divided.
        <Chip tone="warn">qty not set</Chip>
      ) : (
        <span className="text-neutral-400">no qty</span>
      )}
      {record.source_line_no && <><span aria-hidden>·</span><span>BOQ row {record.source_line_no}</span></>}
      <span aria-hidden>·</span>
      {record.category_name ? (
        <Link href={runHref} className="underline hover:text-neutral-900">{record.category_name}</Link>
      ) : (
        <Chip tone="warn">no category</Chip>
      )}
      <span aria-hidden>·</span>
      {level ? (
        <Chip>{ITEM_LEVEL_LABELS[level]}</Chip>
      ) : record.level_suggested ? (
        <SuggestButton
          value={
            normaliseItemLevel(record.level_suggested)
              ? ITEM_LEVEL_LABELS[normaliseItemLevel(record.level_suggested)!]
              : record.level_suggested
          }
          evidence={record.level_suggested_reason ?? "guessed at intake"}
          busy={savingLevel}
          onAccept={() => void setLevel(record.level_suggested ?? "")}
        />
      ) : (
        <Chip tone="warn">no level</Chip>
      )}
      {data.designerContact && (
        <>
          <span aria-hidden>·</span>
          <span>
            designer{" "}
            <Link
              href={`/dashboard/projects/${record.project_id}?tab=overview`}
              className="underline hover:text-neutral-900"
            >
              {data.designerContact.designer_code} — {data.designerContact.name}
            </Link>
          </span>
        </>
      )}
      {!data.designerContact && record.designer && (
        <><span aria-hidden>·</span><span>designer {record.designer}</span></>
      )}
    </span>
  );

  /** The category and level selects, shown inside `RecordDetails`' Edit state. */
  const classification = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs text-neutral-600">
        Category
        <select
          value={record.category_id ?? ""}
          disabled={savingCategory}
          onChange={(event) => void setCategory(event.target.value)}
          className="ml-2 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">— not chosen —</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.family === "upholstery" ? "Uph" : "Cab"} · {category.name}
            </option>
          ))}
        </select>
      </label>
      {/* NOT PRE-FILLED WITH THE SUGGESTION. A select showing "Simple" fires no
          change event when somebody picks Simple, so the one action a reader
          would take to agree would do nothing at all. Agreeing is the dashed
          blue button in the header, which carries its evidence. */}
      <label className="text-xs text-neutral-600">
        Level
        <select
          value={record.level ?? ""}
          disabled={savingLevel}
          onChange={(event) => void setLevel(event.target.value)}
          className="ml-2 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">— not set —</option>
          {ITEM_LEVELS.map((value) => (
            <option key={value} value={value}>
              {ITEM_LEVEL_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {!record.category_id && (
        <span className="text-xs text-neutral-500">
          No checklist yet — choosing a category adds its questions.
        </span>
      )}
      {record.category_id && !record.level && !record.level_suggested && (
        <span className="text-xs text-amber-800">{NO_LEVEL_EXPLANATION}</span>
      )}
    </div>
  );

  const chaseHref = `/dashboard/drafts?projectId=${record.project_id}`;

  return (
    <>
      <PageHeader
        // Back to the run this record is ON, not to the project's first one. A
        // record's number is project-wide, so the same code appears on the
        // mock-up run and the main run, and landing on the wrong tab means
        // hunting for the row you just left.
        crumbs={[{ label: `${record.bws_project_number} · ${record.run_name}`, href: runHref }]}
        title={`${recordLabel} · ${record.item_description}`}
        titleAside={
          // THE NAME A PERSON USES. A configuration's own record number is the
          // next free one in the project and says nothing about what it belongs
          // to; `S-201 A` is how it gets said out loud.
          record.variant_label ? <Chip mono>{variantName(parentRefs, record.variant_label, "")}</Chip> : undefined
        }
        subtitle={subtitle}
        actions={
          <>
            <Button
              onClick={() => {
                setTab("specs");
                setAddingSpec(true);
              }}
            >
              Add a spec by hand
            </Button>
            {/* THE BUTTON COUNTS WHAT IT WILL ASK. `toQuote` includes the
                readiness rows we answer ourselves; the chase screen never
                selects those, so a button naming that figure lands on a screen
                ticking fewer. The muted line under it says which is which. */}
            {readiness.toChase !== null && readiness.toChase > 0 && (
              <Link href={chaseHref} className={buttonClass("primary", "sm")}>
                Chase the {readiness.toChase}
              </Link>
            )}
            {chaseCounts && (
              <span className="basis-full text-right text-xs text-neutral-500">{chaseCounts}</span>
            )}
          </>
        }
        tabs={
          <Tabs
            label="What to do with this record"
            value={tab}
            onChange={setTab}
            items={[
              // A count is null where a number would be a LIE, not merely
              // absent. Versions is not loaded until its tab is opened, so a
              // figure there would either be wrong or force a query nobody
              // asked for; and the Gates count is null where Matthew's matrix
              // does not reach the category, because `0 of 3` there says the
              // record fails three gates it does not have.
              { id: "specs", label: "Specs captured", count: attributes.length === 0 ? null : attributes.length },
              {
                id: "checklist",
                label: "Checklist",
                count: answers.length === 0 ? null : `${outstandingCount} / ${answers.length}`,
                tone: outstandingCount > 0 ? "warn" : "good",
              },
              { id: "gates", label: "Gates", count: gateSummaryLabel, tone: gateTone },
              { id: "versions", label: "Versions", count: null },
            ]}
          />
        }
      />
      <PageBody>
        {error && <Note tone="danger">{error}</Note>}

        {pendingReason && (
          <ReasonPrompt
            pending={pendingReason}
            projectId={record.project_id}
            onCancel={() => setPendingReason(null)}
            onSubmit={saveWithReason}
          />
        )}

        {tab === "specs" && (
          <div className="grid items-start gap-4 min-[820px]:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              {addingSpec && (
                <div className="mb-4">
                  <AddSpec
                    recordId={record.id}
                    specFields={data.specFields ?? []}
                    onAdded={load}
                    open
                    onOpenChange={setAddingSpec}
                  />
                </div>
              )}

              {/* What BWS field 3 will receive, composed by the same function
                  the export calls. The rows below keep each figure's ORIGINAL
                  value and unit, which is what makes a converted W1900
                  checkable against a page that says 190. */}
              {dimensionCell.text && (
                <Card title="Dimensions, as BWS will receive them" className="mt-0">
                  <p className="font-mono text-base leading-6 tracking-[0.01em] text-neutral-900">
                    {dimensionCell.text}
                  </p>
                  {provenance && <p className="mt-1.5 text-xs text-neutral-500">{provenance}</p>}
                  {dimensionCell.problems.map((problem, index) => (
                    <Note key={index} tone="warn">
                      {problem.message}
                    </Note>
                  ))}
                </Card>
              )}

              {attributes.length === 0 ? (
                <Card title="Specs captured" className={dimensionCell.text ? "" : "mt-0"}>
                  <p className="text-sm text-neutral-600">
                    Nothing captured for this item yet. Upload the shop drawings for this pack and review them — a
                    drawing confirmed against this code writes here.
                  </p>
                </Card>
              ) : (
                <Card
                  title="Specs captured"
                  className={dimensionCell.text ? "" : "mt-0"}
                  actions={
                    <CardHeadingNote>
                      {attributes.length} row{attributes.length === 1 ? "" : "s"} ·{" "}
                      {pageCount === 0
                        ? "none off a document"
                        : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
                    </CardHeadingNote>
                  }
                  flush
                >
                  <Table>
                    <thead>
                      <tr>
                        <Th className="w-[24%]">Label</Th>
                        <Th className="w-[28%]">Value</Th>
                        <Th className="w-[22%]">BWS field</Th>
                        <Th className="w-[16%]">Source</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {byGroup.map(({ group, rows }) => (
                        <Fragment key={group}>
                          <GroupRow span={5} aside={GROUP_RULE[group]}>
                            {ATTRIBUTE_GROUP_LABELS[group]}
                          </GroupRow>
                          {rows.map((attribute) => (
                            <Fragment key={attribute.id}>
                            <Tr>
                              <Td>{attribute.label}</Td>
                              <Td>
                                {attribute.state === "tbc" && !attribute.value ? (
                                  <Chip tone="warn">TBC</Chip>
                                ) : (
                                  <span className="text-neutral-900">
                                    {/* A note is routinely a page of general
                                        conditions in one row: clamped, and read
                                        back out of the drawing's capitals. Both
                                        are display only — see src/lib/shout.ts. */}
                                    {attribute.value && <SpecValue text={attribute.value} />}
                                    {attribute.unit && <span className="text-neutral-500">{attribute.unit}</span>}
                                    {attribute.state === "tbc" && (
                                      <span className="ml-1.5 align-middle"><Chip tone="warn">TBC</Chip></span>
                                    )}
                                  </span>
                                )}
                                {/* THE RETURN LINE (0029). Its own line, in its
                                    own colour, because the whole point of
                                    holding it apart is that a reader can tell
                                    the spec from where it goes — which the
                                    exported cell, joined with a hyphen, cannot. */}
                                {attribute.qualifier && (
                                  <span className="mt-0.5 block text-xs text-neutral-500">{attribute.qualifier}</span>
                                )}
                                {/* A LINKED finish is a link to the library,
                                    because the library is what the export
                                    renders and what a correction has to be made
                                    in. An unlinked code is still just what the
                                    page said. */}
                                {attribute.finish_id ? (
                                  <Link
                                    href={`/dashboard/projects/${record.project_id}?tab=finishes`}
                                    className="ml-1.5 inline-block align-middle"
                                    title={
                                      attribute.finish_description
                                        ? `The library says: ${attribute.finish_description}`
                                        : "In the finishes library, with nothing recorded about it yet"
                                    }
                                  >
                                    <Chip mono tone={attribute.finish_state === "tbc" ? "warn" : "plain"}>
                                      {attribute.finish_code ?? attribute.material_code}
                                      {/* WHOSE CODE IT IS (0036). `BW-F-001`
                                          is ours, minted because the client
                                          gave none, and it never reaches the
                                          BWS file — so a reader has to be able
                                          to tell it from a code they could go
                                          and look up on the client's own
                                          schedule. */}
                                      {attribute.finish_code_origin === "internal" ? " · ours" : ""}
                                      {attribute.finish_state === "tbc" ? " TBC" : ""}
                                    </Chip>
                                  </Link>
                                ) : (
                                  attribute.material_code && (
                                    <span className="ml-1.5 inline-block align-middle">
                                      <Chip mono>{attribute.material_code}</Chip>
                                    </span>
                                  )
                                )}
                                {/* A FINISH ON NO LIBRARY ROW follows no
                                    correction: editing the code later reaches
                                    every item carrying it and not this one.
                                    Said in words, because the row otherwise
                                    looks exactly like a linked one. */}
                                {!attribute.finish_id && isFinishGroup(attribute.attr_group) && (
                                  <span className="mt-0.5 block text-xs text-neutral-500">Not in the finishes library</span>
                                )}
                              </Td>
                              <Td muted>
                                {/* THE BWS ID IS OURS, AND IT IS NOT A LABEL.
                                    `1 · COM 1` and a bare `3 ·` cost Matthew
                                    ninety seconds and a wrong guess on
                                    2026-09-18. The NAME stays, because that is
                                    the word BWS shows him; the number moves
                                    onto the title, where an editor debugging an
                                    export cell can still reach it. This table
                                    was the one screen item 1.3 missed.

                                    A DIMENSION REACHES FIELD 3 BY ITS SLOT and
                                    carries no `spec_field_id` of its own, so it
                                    names the cell it composes into and takes
                                    the same title. A row with neither prints a
                                    dash — never "BWS null". */}
                                {attribute.field_name ? (
                                  <span
                                    title={
                                      attribute.json_id !== null ? `BWS field ${attribute.json_id}` : undefined
                                    }
                                  >
                                    {attribute.field_name.trim()}
                                    {attribute.dimension_slot ? ` (${attribute.dimension_slot})` : ""}
                                  </span>
                                ) : attribute.dimension_slot ? (
                                  <span title="BWS field 3">Dimensions ({attribute.dimension_slot})</span>
                                ) : (
                                  "—"
                                )}
                              </Td>
                              <Td muted>{specSource(attribute)}</Td>
                              <Td className="text-right">
                                <span className="inline-flex items-center gap-1">
                                  {/* A CONTROL LIVES BESIDE THE THING IT ACTS
                                      ON. Matthew went looking for
                                      confirm-or-update on a confirmed record
                                      and there was no such verb: a value could
                                      be retired, or a new one typed with no
                                      page. Correcting keeps the page. */}
                                  <Button
                                    size="xs"
                                    title="Correct this value, keeping the page it was read from"
                                    onClick={() => beginCorrection(attribute)}
                                  >
                                    Correct
                                  </Button>
                                  {/* Kept, never deleted — the row stays as
                                      evidence that a document said this, with who
                                      took it off and why. */}
                                  {/* THE LINK ROUTE HAS EXISTED SINCE 0018 AND
                                      HAD NO BUTTON. This is it, and it is also
                                      the recovery path for anything the
                                      drawings card's automatic matching got
                                      wrong. */}
                                  {isFinishGroup(attribute.attr_group) && (
                                    <Button
                                      variant="quiet"
                                      size="xs"
                                      title="Link this spec to the project's finishes library, or let it stand on its own words"
                                      onClick={() => {
                                        setAttaching(attribute);
                                        setAttachTo(attribute.finish_id ?? "");
                                        setAttachReason("");
                                      }}
                                    >
                                      {attribute.finish_id ? "Change the finish…" : "Attach to a finish…"}
                                    </Button>
                                  )}
                                  {/* Kept, never deleted — the row stays as
                                      evidence that a document said this, with who
                                      took it off and why. */}
                                  <Button
                                    variant="quiet"
                                    size="xs"
                                    title="Take this spec off the item"
                                    onClick={() => {
                                      setRetiring(attribute);
                                      setRetireReason("");
                                    }}
                                  >
                                    Retire
                                  </Button>
                                </span>
                              </Td>
                            </Tr>
                            {/* A SPANNING PANEL IS ITS OWN `tr`, never an extra
                                `td colSpan` beside the data cells — that makes
                                the row ten column slots wide and the browser
                                squeezes the editor into a ribbon beside the
                                value it is editing. */}
                            {attaching?.id === attribute.id && (
                              <tr className="bg-blue-50/50">
                                <td colSpan={5} className="border-b border-blue-200 px-4 py-3">
                                  <p className="text-sm font-medium text-neutral-900">
                                    Which finish is “{attribute.label}”?
                                  </p>
                                  <p className="mt-0.5 text-xs text-neutral-600">
                                    A linked spec reads as the LIBRARY says it is — on this screen, in the checklist
                                    answer and in the BWS file — so correcting the finish once corrects every item
                                    carrying it. Unlinking leaves this item standing on its own words, and a later
                                    correction will not reach it.
                                  </p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3">
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                      Finish
                                      <select
                                        value={attachTo}
                                        onChange={(event) => setAttachTo(event.target.value)}
                                        className="min-w-[20rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      >
                                        <option value="">Not in the library — stand on this page&rsquo;s words</option>
                                        {data.finishes.map((finish) => (
                                          <option key={finish.id} value={finish.id}>
                                            {finish.code}
                                            {finish.code_origin === "internal" ? " (ours)" : ""}
                                            {finish.description ? ` — ${finish.description}` : ""}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                                      {/* REQUIRED TO UNLINK and optional to link, which is the
                                          route's own rule: unlinking is the one direction that
                                          takes an item out of reach of a later correction. */}
                                      Why{attachTo === "" ? "" : " (optional)"}
                                      <input
                                        value={attachReason}
                                        onChange={(event) => setAttachReason(event.target.value)}
                                        placeholder={
                                          attachTo === ""
                                            ? "This item's fabric is not the one the code names"
                                            : "Same fabric as S-203, filed under one code"
                                        }
                                        className="w-full min-w-[16rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      />
                                    </label>
                                  </div>
                                  {data.finishes.length === 0 && (
                                    <p className="mt-2 text-xs text-neutral-600">
                                      This project&rsquo;s finishes library is empty. A finish is filed when a drawings
                                      card is confirmed, or by hand on the project&rsquo;s Finishes tab.
                                    </p>
                                  )}
                                  <div className="mt-2 flex items-center gap-2">
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      disabled={attachBusy || (attachTo === "" && !attachReason.trim())}
                                      onClick={() => void attach()}
                                    >
                                      {attachBusy ? "Saving…" : attachTo === "" ? "Unlink it" : "Link it"}
                                    </Button>
                                    <Button variant="quiet" size="sm" onClick={() => setAttaching(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {correcting?.id === attribute.id && (
                              <tr className="bg-amber-50/60">
                                <td colSpan={5} className="border-b border-amber-200 px-4 py-3">
                                  <p className="text-sm font-medium text-neutral-900">
                                    Correct “{attribute.label}”
                                  </p>
                                  <p className="mt-0.5 text-xs text-neutral-600">
                                    The old value is kept and marked as superseded, and the new one KEEPS the page it
                                    was read from — {specSource(attribute)} — because that is still where to check it.
                                    Any checklist answer it fills is recomposed.
                                  </p>
                                  <div className="mt-2 flex flex-wrap items-end gap-2">
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                      Value
                                      <input
                                        value={correctValue}
                                        autoFocus
                                        onChange={(event) => setCorrectValue(event.target.value)}
                                        className="w-64 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      />
                                    </label>
                                    {/* Dimensions only: 0007 refuses a unit on
                                        anything else, and an empty select
                                        beside a fabric reads as a question. */}
                                    {attribute.attr_group === "dimension" && (
                                      <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                        Unit
                                        <select
                                          value={correctUnit}
                                          onChange={(event) =>
                                            setCorrectUnit(event.target.value as AttributeUnit | "")
                                          }
                                          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                        >
                                          <option value="">not stated</option>
                                          {ATTRIBUTE_UNITS.map((unit) => (
                                            <option key={unit} value={unit}>
                                              {unit}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    )}
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                      State
                                      <select
                                        value={correctState}
                                        onChange={(event) =>
                                          setCorrectState(event.target.value as AttributeState)
                                        }
                                        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      >
                                        <option value="confirmed">Confirmed</option>
                                        <option value="tbc">TBC</option>
                                      </select>
                                    </label>
                                    <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                                      Why
                                      <input
                                        value={correctReason}
                                        onChange={(event) => setCorrectReason(event.target.value)}
                                        placeholder="Misread off page 4 — the drawing says 1090"
                                        className="w-full min-w-[16rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      />
                                    </label>
                                  </div>
                                  <div className="mt-2 flex items-center gap-2">
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      disabled={!correctReason.trim() || correctBusy}
                                      onClick={() => void correct()}
                                    >
                                      {correctBusy ? "Saving…" : "Save the correction"}
                                    </Button>
                                    <Button variant="quiet" size="sm" onClick={() => setCorrecting(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}

              {retiring && (
                <Note
                  tone="danger"
                  title={`Take “${retiring.label}${retiring.value ? `: ${retiring.value}` : ""}” off this item?`}
                >
                  <span className="block">
                    It is kept as a record that the document said it, and stops counting towards the checklist and
                    the export. Any checklist answer it filled is recomposed from what is left, or put back to
                    missing.
                  </span>
                  <input
                    value={retireReason}
                    autoFocus
                    onChange={(event) => setRetireReason(event.target.value)}
                    placeholder="Superseded by the Rev B drawing issued 14 Sep"
                    className="mt-2 w-full rounded border border-red-300 bg-white px-2 py-1 text-sm"
                  />
                  <span className="mt-2 flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={!retireReason.trim() || retireBusy}
                      onClick={() => void retire()}
                    >
                      {retireBusy ? "Retiring…" : "Retire it"}
                    </Button>
                    <Button variant="quiet" size="sm" onClick={() => setRetiring(null)}>
                      Keep it
                    </Button>
                  </span>
                </Note>
              )}

              {/* Kept, never deleted, and never silently. A retired spec that
                  could not be seen would make "retire" a delete with extra
                  steps. */}
              {retiredAttributes.length > 0 && (
                <div className="mt-3">
                  <Button variant="quiet" size="xs" onClick={() => setShowRetired((value) => !value)}>
                    {showRetired ? "▾" : "▸"} {retiredAttributes.length} retired spec
                    {retiredAttributes.length === 1 ? "" : "s"}
                  </Button>
                  {showRetired && (
                    <ul className="mt-1 divide-y divide-neutral-200 rounded-[10px] border border-neutral-200 bg-neutral-50">
                      {retiredAttributes.map((attribute) => (
                        <li key={attribute.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
                          <span className="w-40 shrink-0 text-neutral-400 line-through">{attribute.label}</span>
                          <span className="min-w-[10rem] flex-1 text-neutral-400 line-through">
                            {attribute.value}
                            {attribute.unit}
                          </span>
                          <span className="text-xs text-neutral-400">
                            retired{attribute.retired_by ? ` by ${attribute.retired_by}` : ""}
                          </span>
                          {attribute.superseded_by_id ? (
                            // SUPERSEDED, and by WHAT. Putting it back would
                            // leave the item holding both with nothing to say
                            // which is current, so the button is not offered —
                            // and the row names the value that took over,
                            // looked up among the live specs above rather than
                            // asserted to be "a later drawing", which since
                            // 0033 it may not be.
                            (() => {
                              const replacement = attributes.find(
                                (live) => live.id === attribute.superseded_by_id,
                              );
                              return (
                                <span className="text-xs text-neutral-500">
                                  {replacement
                                    ? `superseded by “${replacement.value ?? "TBC"}${replacement.unit ?? ""}”`
                                    : "superseded by a later spec"}
                                  {/* THE WHY LIVES ON THE CHANGE, not on this
                                      row: a reason belongs to the act, and the
                                      Versions tab is where the act is read. */}
                                  {" · "}
                                  <button
                                    type="button"
                                    onClick={() => setTab("versions")}
                                    className="text-blue-700 hover:underline"
                                  >
                                    why
                                  </button>
                                </span>
                              );
                            })()
                          ) : (
                            <Button size="xs" disabled={retireBusy} onClick={() => void restore(attribute)}>
                              Put back
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* THE BILL'S OWN WORDS, AND THE TWO FREE-TEXT COLUMNS (0028).
                  Last, because the specs are what you came to read and this is
                  filled in once. */}
              <RecordDetails
                recordId={record.id}
                record={record}
                onSaved={load}
                classification={classification}
              />
            </div>

            {/* THE STICKY SIDEBAR. Recognising the item is the reason the
                picture is there at all, so it stays beside you while the spec
                table scrolls. It heads its own column, which is what makes the
                two columns start on the same line. */}
            <div className="min-[820px]:sticky min-[820px]:top-4">
              {hasImage && (
                <div className="rounded-[10px] border border-neutral-200 bg-white p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element --
                      an authenticated same-origin route that streams from
                      private blob storage; next/image cannot fetch it with the
                      session cookie. */}
                  <img
                    src={`/api/records/${record.id}/image`}
                    alt={record.item_description}
                    onError={() => setImageFailed(true)}
                    className="h-auto w-full rounded"
                  />
                  <p className="mt-1.5 text-center text-[11.5px] text-neutral-500">
                    Cropped off the drawings
                  </p>
                  {drawingRunId && (
                    <Link
                      href={`/dashboard/imports/${drawingRunId}`}
                      title="Opens the drawing set this item's specs came off, where the crop is chosen"
                      className={buttonClass("quiet", "xs", "mt-1.5 w-full")}
                    >
                      Change crop
                    </Link>
                  )}
                </div>
              )}

              <Card title="Quote readiness" className={hasImage ? "" : "mt-0"}>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-semibold tabular-nums ${
                      readiness.toQuote === null ? TONE.plain.text : TONE.danger.text
                    }`}
                  >
                    {readiness.toQuote ?? "—"}
                  </span>
                  <span className="text-neutral-500">
                    TGQ
                    {readiness.noLevel && (
                      <Tip>
                        This item has no level, and the fallback model needs one to say which questions block a
                        quote. A guess here would make the record look urgent or quotable, and only a person can
                        decide which.
                      </Tip>
                    )}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={`text-[17px] font-semibold tabular-nums ${TONE.warn.text}`}>
                    {readiness.alsoOutstanding ?? readiness.outstanding}
                  </span>
                  <span className="text-neutral-500">
                    {readiness.alsoOutstanding === null ? "outstanding, untiered" : "also outstanding"}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={`text-[17px] font-semibold tabular-nums ${TONE.good.text}`}>
                    {readiness.settled}
                  </span>
                  <span className="text-neutral-500">settled</span>
                </div>
                {/* The same button, so it carries the same number. */}
                {readiness.toChase !== null && readiness.toChase > 0 && (
                  <Link href={chaseHref} className={buttonClass("secondary", "sm", "mt-3 w-full")}>
                    Chase the {readiness.toChase}
                  </Link>
                )}
              </Card>

              {/* ==========================================================
                  THE FAMILY, IN WHICHEVER DIRECTION THIS RECORD SITS IN IT.
                  A bill line drawn in two fabrics is a HEADING: its
                  configurations are what the export ships, so the card has to
                  say so or the line reads as an item nobody has specced. A
                  configuration has to name the bill line it came from, because
                  its record number does not.
                  ========================================================== */}
              <Card title="Configurations">
                {record.parent_id ? (
                  <p className="text-[12.5px] text-neutral-700">
                    Configuration {record.variant_label} of{" "}
                    <Link href={`/dashboard/records/${record.parent_id}`} className="underline hover:text-neutral-900">
                      {parentRefs || "the bill line"}
                    </Link>
                    , which the bill lists once
                    {billQty !== null && <> at {billQty} off</>}. This configuration is what BWS receives.
                  </p>
                ) : variants.length > 0 ? (
                  <>
                    <p className="text-[12.5px] text-neutral-700">
                      The bill lists this once{record.qty !== null && <> at {record.qty} off</>}, and the drawings
                      show it in {variants.length} configurations.{" "}
                      <strong className="font-medium">They are what the export carries</strong>, not this line.
                    </p>
                    <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
                      {variants.map((member) => (
                        <li key={member.id} className="py-1.5 text-[12.5px]">
                          <span className="font-medium text-neutral-900">
                            {variantName(parentRefs, member.variant_label, `#${member.record_no}`)}
                          </span>
                          {member.id === record.id ? (
                            <span className="ml-2 text-neutral-400">you are here</span>
                          ) : (
                            <Link
                              href={`/dashboard/records/${member.id}`}
                              className="ml-2 underline hover:text-neutral-900"
                            >
                              open
                            </Link>
                          )}
                          <span className="mt-0.5 block text-neutral-500">
                            {Number(member.attribute_count) > 0
                              ? `${member.attribute_count} specs captured`
                              : "nothing captured yet"}
                            {" · "}
                            {member.qty === null ? (
                              <span className={TONE.warn.text}>quantity not allocated</span>
                            ) : (
                              `qty ${member.qty}`
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {/* The bill's quantity is not apportioned by anything:
                        splitting it has a price attached. So the gap is stated,
                        never divided. */}
                    {unallocated !== null && unallocated !== 0 && (
                      <p className={`mt-2 text-xs ${TONE.warn.text}`}>
                        {unallocated} of the bill&rsquo;s {billQty} is not allocated to a configuration.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[12.5px] text-neutral-500">
                    This bill line is not split.
                    {record.qty !== null && <> Its {record.qty} are one item.</>}
                  </p>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === "checklist" && (
          <RecordChecklist
            recordId={record.id}
            projectId={record.project_id}
            answers={answers}
            level={level}
            tgqMatrix={data.tgqMatrix}
            matrixFields={data.matrixFields}
            palettes={data.palettes ?? []}
            paletteByQuestion={data.paletteByQuestion ?? []}
            waiting={data.waiting ?? {}}
            designerContact={data.designerContact}
            attributes={attributes}
            readiness={readiness}
            savingId={savingId}
            reloadKey={historyKey}
            dimensionNote={record.dimension_note}
            onSave={(answer, value, state) => void save(answer as Answer, value, state)}
            onRecordDimension={recordDimension}
          />
        )}

        {/* MATTHEW'S MATRIX, and what each gate still wants. Its own tab rather
            than a panel above the 43-question checklist: the checklist is the
            full cheat sheet and always was, and this is the part somebody has
            to act on before the next milestone. */}
        {tab === "gates" && (
          <GatePanel
            gates={data.gates}
            matrixFields={data.matrixFields}
            answers={answers}
            palettes={data.palettes ?? []}
            categoryName={record.category_name}
            chaseHref={chaseHref}
          />
        )}

        {/* NOT COLLAPSED ANY MORE. It was behind a toggle because it sat under
            four screens of checklist; on its own tab it can simply be the page. */}
        {tab === "versions" && (
          <RecordHistory recordId={record.id} projectId={record.project_id} reloadKey={historyKey} />
        )}
      </PageBody>
    </>
  );
}

// `useUrlTab` reads `useSearchParams`, which Next requires to sit under a
// Suspense boundary.
export default function RecordPage() {
  return (
    <Suspense fallback={<PageBody><Spinner label="Loading the record" /></PageBody>}>
      <RecordView />
    </Suspense>
  );
}
