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
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import {
  ANSWER_STATES,
  ANSWER_STATE_LABELS,
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  type AnswerState,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
  ITEM_LEVELS,
  ITEM_LEVEL_LABELS,
  normaliseItemLevel,
} from "@/lib/spec-vocab";
import { composeDimensionCell } from "@/lib/dimensions";
import { questionTierOrNull, TIER_LABELS, NO_LEVEL_EXPLANATION } from "@/lib/tgq";
import SpecValue from "@/components/records/SpecValue";
import { unallocatedQty, variantName } from "@/lib/record-variants";
import RecordHistory from "@/components/history/RecordHistory";
import ReasonPrompt, { type PendingReason } from "@/components/history/ReasonPrompt";
import type { UploadedEvidence } from "@/components/history/EvidenceUpload";
import Button from "@/components/ui/Button";
import GatePanel from "@/components/records/GatePanel";
import RecordDetails from "@/components/records/RecordDetails";
import AddSpec from "@/components/records/AddSpec";
import type { Gate, GateStatus } from "@/lib/gates";

type Answer = {
  requirement_id: string; kind: string; prompt: string; help_text: string | null; section: string | null;
  tgq_levels: string[] | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  answer_id: string | null; value: string | null; qualifier: string | null; state: AnswerState; version: number;
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
  bws_project_number: string; project_name: string; project_id: string;
  run_id: string; run_name: string;
  category_name: string | null; category_family: string | null;
  /** A fabric split (0024). Both null on an ordinary record. */
  parent_id: string | null; variant_label: string | null;
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

type Payload = {
  record: SpecRecord;
  refs: { ref_system: string; ref_value: string }[];
  attributes: Attribute[];
  retiredAttributes: RetiredAttribute[];
  answers: Answer[];
  categories: Category[];
  specFields: { id: string; name: string; json_id: number }[];
  family: FamilyMember[];
  /** Null where this record's category is not on Matthew's matrix. */
  gates: Record<Gate, GateStatus> | null;
};

const STATE_CLASS: Record<AnswerState, string> = {
  confirmed: "text-green-700 border-green-300 bg-green-50",
  tbc: "text-amber-800 border-amber-300 bg-amber-50",
  missing: "text-red-700 border-red-300 bg-red-50",
  na: "text-neutral-600 border-neutral-300 bg-neutral-50",
};

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  // Optimistic: the image is requested, and the 404 for a record that has none
  // turns it off. Asking first would be a second round trip on every record to
  // learn something the image request itself reports.
  const [hasImage, setHasImage] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
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
  // component, so a sticky `false` would hide every image after the first miss.
  useEffect(() => { setHasImage(true); }, [id]);

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

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading record" />;

  const { record, refs, answers, attributes, categories } = data;

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

  // One implementation of the tier, shared with the drafts screen, the export
  // counts and the email. A record with no level gets null here and no badge —
  // the app does not decide what kind of item this is.
  const recordLevel = normaliseItemLevel(record.level);
  const tierOf = (answer: Answer) =>
    questionTierOrNull({ tgqLevels: answer.tgq_levels ?? [] }, recordLevel);
  // Older responses have no `retiredAttributes`; a screen that assumed the key
  // exists would crash on the first record loaded from a cached payload.
  const retiredAttributes = data.retiredAttributes ?? [];
  const dimensionCell = composeDimensionCell(
    attributes
      .filter((attribute) => attribute.attr_group === "dimension" && attribute.dimension_slot)
      .map((attribute) => ({
        slot: attribute.dimension_slot as DimensionSlot,
        value: attribute.value,
        unit: (attribute.unit ?? null) as AttributeUnit | null,
        state: attribute.state,
        sortOrder: attribute.sort_order,
      })),
  );
  const byGroup = ATTRIBUTE_GROUPS.map((group) => ({
    group,
    rows: attributes.filter((attribute) => attribute.attr_group === group),
  })).filter((entry) => entry.rows.length > 0);
  const sections = answers.reduce<Map<string, Answer[]>>((map, answer) => {
    const key = answer.section ?? "Other";
    map.set(key, [...(map.get(key) ?? []), answer]);
    return map;
  }, new Map());

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back to the run this record is ON, not to the project's first one. A
          record's number is project-wide, so the same code appears on the
          mock-up run and the main run, and landing on the wrong tab means
          hunting for the row you just left. */}
      <Link
        href={`/dashboard/projects/${record.project_id}?tab=${record.run_id}`}
        className="text-sm text-neutral-600 underline"
      >
        ← {record.bws_project_number} · {record.run_name}
      </Link>

      <h1 className="mt-2 text-xl font-semibold text-neutral-900">
        {record.bws_project_number}-{String(record.record_no).padStart(3, "0")}
        {/* THE NAME A PERSON USES. A configuration's own record number is the
            next free one in the project and says nothing about what it belongs
            to; `S-201 A` is how it gets said out loud. */}
        {record.variant_label && (
          <span className="ml-2 rounded border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-sm font-medium text-neutral-700">
            {variantName(parentRefs, record.variant_label, "")}
          </span>
        )}{" "}
        · {record.item_description}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        {refs.length > 0 ? refs.map((ref) => ref.ref_value).join(", ") : "No client ref"}
        {" · "}{record.run_name}
        {record.area && <> · {record.area}</>}
        {record.qty !== null && <> · qty {record.qty}</>}
        {record.source_line_no && <> · BOQ row {record.source_line_no}</>}
      </p>

      {/* ======================================================================
          THE FAMILY, IN WHICHEVER DIRECTION THIS RECORD SITS IN IT.
          A bill line drawn in two fabrics is a HEADING: its configurations are
          what the export ships, so the row has to say so or it reads as an item
          nobody has specced. A configuration has to name the bill line it came
          from, because its record number does not.
          ====================================================================== */}
      {(variants.length > 0 || record.parent_id) && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white px-4 py-3">
          {record.parent_id ? (
            <p className="text-sm text-neutral-700">
              Configuration {record.variant_label} of{" "}
              <Link href={`/dashboard/records/${record.parent_id}`} className="underline hover:text-neutral-900">
                {parentRefs || "the bill line"}
              </Link>
              , which the bill lists once
              {billQty !== null && <> at {billQty} off</>}. This configuration is what BWS receives.
            </p>
          ) : (
            <p className="text-sm text-neutral-700">
              The bill lists this once{record.qty !== null && <> at {record.qty} off</>}, and the drawings show it in{" "}
              {variants.length} configurations. <strong className="font-medium">They are what the export carries</strong>
              , not this line.
            </p>
          )}
          <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
            {variants.map((member) => (
              <li key={member.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
                <span className="w-24 shrink-0 font-medium text-neutral-900">
                  {variantName(parentRefs, member.variant_label, `#${member.record_no}`)}
                </span>
                <span className="flex-1 min-w-[8rem] text-neutral-600">
                  {Number(member.attribute_count) > 0
                    ? `${member.attribute_count} specs captured`
                    : "nothing captured yet"}
                </span>
                <span className="text-neutral-700 tabular-nums">
                  {member.qty === null ? <span className="text-amber-800">qty not set</span> : `qty ${member.qty}`}
                </span>
                {member.id === record.id ? (
                  <span className="text-xs text-neutral-400">you are here</span>
                ) : (
                  <Link href={`/dashboard/records/${member.id}`} className="text-xs underline hover:text-neutral-900">
                    open
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {/* The bill's quantity is not apportioned by anything: splitting it
              has a price attached. So the gap is stated, never divided. */}
          {unallocated !== null && unallocated !== 0 && (
            <p className="mt-2 text-xs text-amber-800">
              {unallocated} of the bill&rsquo;s {billQty} is not allocated to a configuration. Set a quantity on each
              before anybody quotes it.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      {pendingReason && (
        <ReasonPrompt
          pending={pendingReason}
          projectId={record.project_id}
          onCancel={() => setPendingReason(null)}
          onSubmit={saveWithReason}
        />
      )}

      {/* The picture, first, because it is what a person recognises. A record
          was a description and a quantity, and nobody could look at one and
          tell which item it was. Rendered from a crop somebody confirmed off
          the drawings; `hasImage` goes false on a 404 so a record without one
          says so in words instead of showing a broken image. */}
      {hasImage && (
        <div className="mt-6 float-right ml-4 mb-2 w-44 border border-neutral-200 rounded-lg bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element --
              an authenticated same-origin route that streams from private blob
              storage; next/image cannot fetch it with the session cookie. */}
          <img
            src={`/api/records/${record.id}/image`}
            alt={`${record.item_description}`}
            onError={() => setHasImage(false)}
            className="w-full h-auto rounded"
          />
          <p className="mt-1 text-center text-xs text-neutral-500">From the drawings</p>
        </div>
      )}

      {/* What the documents actually said. */}
      {/* THE BILL'S OWN WORDS, AND THE TWO FREE-TEXT COLUMNS (0028). The
          description was not editable at all until now, so a typo in a bill
          line was permanent, and there was nowhere to write down what the
          structured fields cannot hold — which is what Matthew asked for. */}
      <RecordDetails recordId={record.id} record={record} onSaved={load} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Specs captured</h2>
        {/* The counterpart to confirming a drawing card. `record_attributes` is
            requirement-free on purpose; this is the only way to record a
            statement no document made. */}
        <AddSpec recordId={record.id} specFields={data.specFields ?? []} onAdded={load} />
      </div>

      {/* What BWS field 3 will receive, composed by the same function the
          export calls. The rows below keep each figure's ORIGINAL value and
          unit, which is what makes a converted W1900 checkable against a page
          that says 190. */}
      {dimensionCell.text && (
        <div className="mt-3 border border-neutral-200 rounded-lg bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Dimensions, as BWS will receive them</p>
          <p className="font-mono text-sm text-neutral-900">{dimensionCell.text}</p>
          {dimensionCell.problems.map((problem, index) => (
            <p key={index} className="mt-0.5 text-xs text-amber-700">
              {problem.message}
            </p>
          ))}
        </div>
      )}
      {attributes.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">
          Nothing captured for this item yet. Upload the shop drawings for this pack and review them — a drawing
          confirmed against this code writes here.
        </p>
      ) : (
        byGroup.map(({ group, rows }) => (
          <section key={group} className="mt-3">
            <h3 className="text-xs font-medium text-neutral-500">{ATTRIBUTE_GROUP_LABELS[group]}</h3>
            <ul className="mt-1 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
              {rows.map((attribute) => (
                <li key={attribute.id} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="text-neutral-500 w-40 shrink-0">{attribute.label}</span>
                  <span className="text-neutral-900 flex-1 min-w-[10rem]">
                    {attribute.state === "tbc" && !attribute.value ? (
                      <span className="text-amber-800">TBC</span>
                    ) : (
                      <>
                        {/* A note is routinely a page of general conditions in
                            one row: clamped, and read back out of the
                            drawing's capitals. Both are display only — see
                            src/lib/shout.ts. */}
                        {attribute.value && <SpecValue text={attribute.value} />}
                        {attribute.unit && <span className="text-neutral-500">{attribute.unit}</span>}
                        {attribute.state === "tbc" && <span className="ml-1 text-amber-800">TBC</span>}
                      </>
                    )}
                    {/* THE RETURN LINE (0029). Shown on its own line and in
                        its own colour, because the whole point of holding it
                        apart is that a reader can tell the spec from where it
                        goes — which the exported cell, joined with a hyphen,
                        cannot. */}
                    {attribute.qualifier && (
                      <span className="block text-xs text-neutral-500">{attribute.qualifier}</span>
                    )}
                    {/* A LINKED finish is a link to the library, because the
                        library is what the export renders and what a
                        correction has to be made in. An unlinked code is still
                        just what the page said. */}
                    {attribute.finish_id ? (
                      <Link
                        href={`/dashboard/projects/${record.project_id}?tab=finishes`}
                        className="ml-2 text-xs text-neutral-500 underline hover:text-neutral-900"
                        title={
                          attribute.finish_description
                            ? `The library says: ${attribute.finish_description}`
                            : "In the finishes library, with nothing recorded about it yet"
                        }
                      >
                        {attribute.finish_code ?? attribute.material_code}
                        {attribute.finish_state === "tbc" && <span className="text-amber-800"> TBC</span>}
                      </Link>
                    ) : (
                      attribute.material_code && (
                        <span className="ml-2 text-xs text-neutral-500">code {attribute.material_code}</span>
                      )
                    )}
                  </span>
                  {attribute.field_name && (
                    <span className="text-xs text-neutral-500 w-44 shrink-0">BWS: {attribute.field_name.trim()}</span>
                  )}
                  {attribute.source_run_id && (
                    <a
                      href={`/api/imports/${attribute.source_run_id}/source${attribute.source_page ? `#page=${attribute.source_page}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-neutral-500 underline hover:text-neutral-900"
                    >
                      {attribute.source_filename ?? "source"}
                      {attribute.source_page ? ` p${attribute.source_page}` : ""}
                    </a>
                  )}
                  {/* Kept, never deleted — the row stays as evidence that a
                      document said this, with who took it off and why. */}
                  <button
                    type="button"
                    onClick={() => {
                      setRetiring(attribute);
                      setRetireReason("");
                    }}
                    className="text-xs text-neutral-400 hover:text-red-700"
                    title="Take this spec off the item"
                  >
                    retire
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {retiring && (
        <div className="mt-3 border border-red-300 bg-red-50 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-red-900">
            Take “{retiring.label}{retiring.value ? `: ${retiring.value}` : ""}” off this item?
          </p>
          <p className="mt-0.5 text-xs text-red-800">
            It is kept as a record that the document said it, and stops counting towards the checklist and the export.
            Any checklist answer it filled is recomposed from what is left, or put back to missing.
          </p>
          <input
            value={retireReason}
            autoFocus
            onChange={(event) => setRetireReason(event.target.value)}
            placeholder="Superseded by the Rev B drawing issued 14 Sep"
            className="mt-2 w-full border border-red-300 rounded px-2 py-1 text-sm bg-white"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void retire()}
              disabled={!retireReason.trim() || retireBusy}
              className="border border-red-400 bg-white rounded px-3 py-1 text-sm hover:bg-red-100 disabled:opacity-50"
            >
              {retireBusy ? "Retiring…" : "Retire it"}
            </button>
            <button type="button" onClick={() => setRetiring(null)} className="text-sm text-red-800 hover:text-red-950">
              Keep it
            </button>
          </div>
        </div>
      )}

      {/* Kept, never deleted, and never silently. A retired spec that could
          not be seen would make "retire" a delete with extra steps. */}
      {retiredAttributes.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRetired((value) => !value)}
            className="text-xs text-neutral-500 hover:text-neutral-900"
          >
            {showRetired ? "▾" : "▸"} {retiredAttributes.length} retired spec
            {retiredAttributes.length === 1 ? "" : "s"}
          </button>
          {showRetired && (
            <ul className="mt-1 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-neutral-50">
              {retiredAttributes.map((attribute) => (
                <li key={attribute.id} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="text-neutral-400 w-40 shrink-0 line-through">{attribute.label}</span>
                  <span className="text-neutral-400 flex-1 min-w-[10rem] line-through">
                    {attribute.value}
                    {attribute.unit}
                  </span>
                  <span className="text-xs text-neutral-400">
                    retired{attribute.retired_by ? ` by ${attribute.retired_by}` : ""}
                    {attribute.retired_at ? ` on ${new Date(attribute.retired_at).toLocaleDateString()}` : ""}
                  </span>
                  {attribute.superseded_by_id ? (
                    // Replaced by a later drawing. Putting it back would leave
                    // the item holding both, with nothing to say which is
                    // current — so the button is not offered at all.
                    <span className="text-xs text-neutral-500">replaced by a later drawing</span>
                  ) : (
                    <Button
                      size="xs"
                      disabled={retireBusy}
                      onClick={() => void restore(attribute)}
                    >
                      Put back
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The checklist. A record with no category has none yet, which is not
          the same as having none outstanding. */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-500 uppercase tracking-wide">Checklist</h2>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-600">
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
        {/* The LEVEL decides which of those questions hold up a quote. This app
            GUESSES one at intake and shows it here pre-selected, but the guess
            is never the answer: until somebody picks, no question on this
            record carries a tier and a chase for it is blocked. Choosing the
            suggested value is what accepts it. */}
        <label className="text-sm text-neutral-600">
          Level
          <select
            // NOT pre-filled with the suggestion. A select showing "Simple"
            // fires no change event when somebody picks Simple, so the one
            // action a reader would take to agree would do nothing at all.
            // Agreeing has its own button below.
            value={record.level ?? ""}
            disabled={savingLevel}
            onChange={(event) => void setLevel(event.target.value)}
            className="ml-2 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">— not set —</option>
            {ITEM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {ITEM_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </label>
        {!record.category_id && (
          <span className="text-xs text-neutral-500">
            No checklist yet — choosing a category adds its questions. This is a later stage than intake.
          </span>
        )}
        {record.category_id && !record.level && (
          <span className="text-xs text-amber-800">
            {record.level_suggested ? (
              <>
                Suggested: {normaliseItemLevel(record.level_suggested)
                  ? ITEM_LEVEL_LABELS[normaliseItemLevel(record.level_suggested)!]
                  : record.level_suggested}
                {record.level_suggested_reason && <> — {record.level_suggested_reason}</>}. Nothing on this record is
                tiered until you agree.{" "}
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={savingLevel}
                  onClick={() => void setLevel(record.level_suggested ?? "")}
                >
                  Accept it
                </Button>
              </>
            ) : (
              NO_LEVEL_EXPLANATION
            )}
          </span>
        )}
      </div>

      {/* WHAT EACH GATE STILL WANTS, above the 43-question checklist. The
          checklist is the full cheat sheet and always was; this is the part
          somebody has to act on before the next milestone. */}
      <GatePanel gates={data.gates} />

      {answers.length > 0 && (
        <button
          type="button"
          onClick={() => setShowChecklist((value) => !value)}
          className="mt-3 text-sm text-neutral-600 hover:text-neutral-900"
        >
          {showChecklist ? "▾" : "▸"} {answers.length} question{answers.length === 1 ? "" : "s"}
        </button>
      )}

      {showChecklist && [...sections.entries()].map(([section, rows]) => (
        <section key={section} className="mt-6">
          <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">{section}</h2>
          <ul className="mt-2 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
            {rows.map((answer) => (
              <li key={answer.requirement_id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-900">{answer.prompt}</p>
                    {answer.field_name && (
                      <p className="text-xs text-neutral-500">
                        BWS: {answer.field_name.trim()} ({answer.json_id})
                      </p>
                    )}
                    {answer.help_text && <p className="text-xs text-neutral-400 mt-0.5">{answer.help_text}</p>}
                    {tierOf(answer) === "to_quote" && (
                      <p className="mt-1 inline-block text-xs px-2 py-0.5 rounded border text-red-700 border-red-300 bg-red-50">
                        {TIER_LABELS.to_quote}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded border ${STATE_CLASS[answer.state]}`}>
                    {ANSWER_STATE_LABELS[answer.state]}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    /* Re-keyed on every reload, so the box always shows what
                       the SERVER holds. Uncontrolled inputs keep whatever was
                       typed across a re-render, so a refused edit used to
                       leave the rejected text sitting on screen looking
                       saved — which is the worst of both readings. */
                    key={`${answer.answer_id}:${answer.version}:${historyKey}`}
                    defaultValue={answer.value ?? ""}
                    placeholder="Value"
                    disabled={savingId === answer.answer_id}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next === (answer.value ?? "")) return;
                      void save(answer, next, next ? "confirmed" : "missing");
                    }}
                    className="flex-1 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
                  />
                  <select
                    value={answer.state}
                    disabled={savingId === answer.answer_id}
                    onChange={(e) => void save(answer, answer.value ?? "", e.target.value as AnswerState)}
                    className="border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
                  >
                    {ANSWER_STATES.map((state) => (
                      <option key={state} value={state}>{ANSWER_STATE_LABELS[state]}</option>
                    ))}
                  </select>
                </div>
                {answer.confirmed_by && (
                  <p className="mt-1 text-xs text-neutral-400">
                    Confirmed by {answer.confirmed_by}
                    {answer.confirmed_at ? ` on ${new Date(answer.confirmed_at).toLocaleDateString()}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Every version of this item, and what changed at each. Collapsed by
          default: the question it answers is asked occasionally, and the specs
          above are what the screen is for. */}
      <h2 className="mt-8 text-sm font-semibold text-neutral-500 uppercase tracking-wide">History</h2>
      <button
        type="button"
        onClick={() => setShowHistory((value) => !value)}
        className="mt-1 text-sm text-neutral-600 hover:text-neutral-900"
      >
        {showHistory ? "▾ Hide versions" : "▸ Show versions and what changed"}
      </button>
      {showHistory && <RecordHistory recordId={record.id} reloadKey={historyKey} />}
    </div>
  );
}
