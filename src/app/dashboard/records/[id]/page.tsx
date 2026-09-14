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
} from "@/lib/spec-vocab";

type Answer = {
  requirement_id: string; kind: string; prompt: string; help_text: string | null; section: string | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  answer_id: string | null; value: string | null; state: AnswerState; version: number;
  confirmed_by: string | null; confirmed_at: string | null;
};
type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  qty: number | null; designer: string | null; area: string | null; boq_category: string | null;
  source_line_no: number | null; version: number; category_id: string | null;
  bws_project_number: string; project_name: string; project_id: string;
  run_id: string; run_name: string;
  category_name: string | null; category_family: string | null;
};

type Attribute = {
  id: string; attr_group: AttributeGroup; label: string; value: string | null; unit: string | null;
  material_code: string | null; state: AttributeState; sort_order: number; version: number;
  source_page: number | null; source_run_id: string | null; created_by: string | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  source_filename: string | null; source_document_kind: string | null;
};

type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };

type Payload = {
  record: SpecRecord;
  refs: { ref_system: string; ref_value: string }[];
  attributes: Attribute[];
  answers: Answer[];
  categories: Category[];
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
  const [showChecklist, setShowChecklist] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/records/${id}`);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setData(res.data);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function save(answer: Answer, value: string, state: AnswerState) {
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
        body: JSON.stringify({ value, state, version: answer.version }),
      });
      if (!res.ok) { setError(res.error); }
      await load();
    } finally {
      setSavingId(null);
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
      if (!res.ok) setError(res.error);
      await load();
    } finally {
      // Always reset: an HTML error page must not leave the select disabled.
      setSavingCategory(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading record" />;

  const { record, refs, answers, attributes, categories } = data;
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
      <Link href={`/dashboard/records?projectId=${record.project_id}`} className="text-sm text-neutral-600 underline">
        ← {record.bws_project_number} spec table
      </Link>

      <h1 className="mt-2 text-xl font-semibold text-neutral-900">
        {record.bws_project_number}-{String(record.record_no).padStart(3, "0")} · {record.item_description}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        {refs.length > 0 ? refs.map((ref) => ref.ref_value).join(", ") : "No client ref"}
        {" · "}{record.run_name}
        {record.area && <> · {record.area}</>}
        {record.qty !== null && <> · qty {record.qty}</>}
        {record.source_line_no && <> · BOQ row {record.source_line_no}</>}
      </p>

      {error && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      {/* What the documents actually said. */}
      <h2 className="mt-6 text-sm font-semibold text-neutral-500 uppercase tracking-wide">Specs captured</h2>
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
                        {attribute.value}
                        {attribute.unit && <span className="text-neutral-500">{attribute.unit}</span>}
                        {attribute.state === "tbc" && <span className="ml-1 text-amber-800">TBC</span>}
                      </>
                    )}
                    {attribute.material_code && (
                      <span className="ml-2 text-xs text-neutral-500">code {attribute.material_code}</span>
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
                </li>
              ))}
            </ul>
          </section>
        ))
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
        {!record.category_id && (
          <span className="text-xs text-neutral-500">
            No checklist yet — choosing a category adds its questions. This is a later stage than intake.
          </span>
        )}
      </div>

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
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded border ${STATE_CLASS[answer.state]}`}>
                    {ANSWER_STATE_LABELS[answer.state]}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
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
    </div>
  );
}
