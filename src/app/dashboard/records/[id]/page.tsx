"use client";

// One spec record. Every question its category asks, answered or not.
//
// A question with no answer row still appears, as `missing` — the screen is
// driven by the requirement list, not by the answers that happen to exist.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { ANSWER_STATES, ANSWER_STATE_LABELS, type AnswerState } from "@/lib/spec-vocab";

type Answer = {
  requirement_id: string; kind: string; prompt: string; help_text: string | null; section: string | null;
  field_name: string | null; json_id: number | null; field_category: string | null;
  answer_id: string | null; value: string | null; state: AnswerState; version: number;
  confirmed_by: string | null; confirmed_at: string | null;
};
type SpecRecord = {
  id: string; record_no: number; item_description: string; product_reference: string | null;
  qty: number | null; designer: string | null; area: string | null; source_line_no: number | null;
  bws_project_number: string; project_name: string; project_id: string;
  category_name: string | null; category_family: string | null;
};

const STATE_CLASS: Record<AnswerState, string> = {
  confirmed: "text-green-700 border-green-300 bg-green-50",
  tbc: "text-amber-800 border-amber-300 bg-amber-50",
  missing: "text-red-700 border-red-300 bg-red-50",
  na: "text-neutral-600 border-neutral-300 bg-neutral-50",
};

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ record: SpecRecord; refs: { ref_system: string; ref_value: string }[]; answers: Answer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ record: SpecRecord; refs: { ref_system: string; ref_value: string }[]; answers: Answer[] }>(`/api/records/${id}`);
    if (!res.ok) { setError(res.error); return; }
    setData(res.data);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function save(answer: Answer, value: string, state: AnswerState) {
    if (!answer.answer_id) { setError("This question has no answer row yet — re-import the record."); return; }
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

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading record" />;

  const { record, refs, answers } = data;
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
        {record.category_name && <> · {record.category_name}</>}
        {record.qty !== null && <> · qty {record.qty}</>}
        {record.source_line_no && <> · BOQ row {record.source_line_no}</>}
      </p>

      {error && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

      {[...sections.entries()].map(([section, rows]) => (
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
