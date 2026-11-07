"use client";

// The record's Checklist tab, and the answer save it shares with the Specs
// tab's "What makes this configuration different": the save, the reason
// replay, the per-answer refusal count, and a dimension typed off the
// checklist. Moved out of src/app/dashboard/records/[id]/page.tsx on
// 2026-11-07 (audit 5.3, cut C).
//
// THE SAVE IS A HOOK THE PAGE CALLS, NOT THIS TAB'S STATE. The reason box
// (`ReasonPrompt`) renders above every tab, and a configuration's own fields
// on the Specs tab save through the same function, so the pending reason and
// the refusals have to outlive a tab change.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  DIMENSION_SLOT_LABELS,
  type AnswerState,
  type AttributeUnit,
  type DimensionSlot,
  type ItemLevel,
} from "@/lib/spec-vocab";
import type { PendingReason } from "@/components/history/ReasonPrompt";
import type { UploadedEvidence } from "@/components/history/EvidenceUpload";
import CommonChecklist from "@/components/records/CommonChecklist";
import RecordChecklist from "@/components/records/RecordChecklist";
import type { ConfigurationFamily } from "@/lib/configuration-family";
import type { Answer, Attribute, Payload, SpecRecord } from "@/components/records/record-payload";

export function useChecklistSave({
  recordId,
  answers,
  reloadThen,
  setError,
}: {
  recordId: string;
  /** The loaded answers, null until the record has loaded. */
  answers: Answer[] | null;
  reloadThen: (message: string | null) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  /**
   * WHICH ANSWER BOXES MUST SHOW THE SERVER AGAIN, per answer (audit G2).
   *
   * The checklist's inputs were keyed on `historyKey`, so every save remounted
   * every box: type in A, tab to B, type, and A's reload replaced B's typing
   * with the server's value before any blur could save it. CLAUDE.md records
   * the same trap for the details panel. A box now remounts only when its own
   * answer's version moves, or when its own save was REFUSED, which is the one
   * case where the version stays put and the typed words must still give way
   * to what the server holds.
   */
  const [refusals, setRefusals] = useState<Record<string, number>>({});
  const refused = (answerId: string) =>
    setRefusals((current) => ({ ...current, [answerId]: (current[answerId] ?? 0) + 1 }));
  // Set when the server refuses an edit for want of a reason. Holds everything
  // needed to replay the same edit once the reviewer has said why.
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(null);

  async function save(
    answer: Answer,
    value: string,
    state: AnswerState,
    reason?: string,
    evidence?: UploadedEvidence | null,
    /** Absent keeps the qualifier the answer holds; the route reads it that way. */
    qualifier?: string | null,
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
        body: JSON.stringify({ value, state, version: answer.version, reason, evidence, qualifier }),
      });
      if (!res.ok) {
        // The server asks for a reason only when the edit OVERRIDES a settled
        // answer. It is asked for here rather than on every keystroke, and it
        // carries the original edit so nothing has to be retyped.
        if (res.data?.code === "reason_required") {
          // THE QUALIFIER TRAVELS WITH IT (audit G3). It was left out, so a
          // qualifier-only edit was replayed without the qualifier, the route
          // kept the old one, and the box closed as though it had saved.
          setPendingReason({
            prompt: answer.prompt,
            answerId: answer.answer_id,
            value,
            state,
            version: answer.version,
            ...(qualifier !== undefined ? { qualifier } : {}),
          });
          await reloadThen(null);
          return;
        }
        await reloadThen(res.error);
        refused(answer.answer_id);
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
        recordId,
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

  /** Replays the edit the server refused, now that there is a reason for it. */
  async function saveWithReason(reason: string, evidence: UploadedEvidence | null) {
    if (!answers || !pendingReason) return;
    const answer = answers.find((row) => row.answer_id === pendingReason.answerId);
    // The answer moved under the prompt — a stale screen, so say so rather
    // than writing to whatever is at that id now.
    if (!answer) {
      setPendingReason(null);
      await reloadThen("That question changed while the reason box was open. Nothing was saved — check it and try again.");
      return;
    }
    await save(answer, pendingReason.value, pendingReason.state, reason, evidence, pendingReason.qualifier);
    setPendingReason(null);
  }

  return { savingId, refusals, refused, pendingReason, setPendingReason, save, recordDimension, saveWithReason };
}

export type ChecklistSave = ReturnType<typeof useChecklistSave>;

export default function ChecklistTab({
  record,
  payload: data,
  answers,
  attributes,
  level,
  readiness,
  commonFamily,
  checklist,
  reloadThen,
}: {
  record: SpecRecord;
  payload: Pick<Payload, "palettes" | "paletteByQuestion" | "tgqMatrix" | "matrixFields" | "waiting" | "designerContact">;
  answers: Answer[];
  attributes: Attribute[];
  level: ItemLevel | null;
  readiness: Payload["quoteReadiness"];
  /** A split bill line's configurations, for what they share; null on anything else. */
  commonFamily: ConfigurationFamily | null;
  checklist: ChecklistSave;
  reloadThen: (message: string | null) => Promise<void>;
}) {
  const { savingId, refusals, save, recordDimension } = checklist;
  return (
    <>
      {commonFamily && (
        <div className="mb-4">
          <CommonChecklist
            lineId={record.id}
            family={commonFamily}
            palettes={data.palettes ?? []}
            paletteByQuestion={data.paletteByQuestion ?? []}
            onDone={reloadThen}
          />
          <p className="mt-3 text-xs text-neutral-500">
            Below: the bill line&rsquo;s OWN checklist, which is not exported while it has configurations.
          </p>
        </div>
      )}
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
        refusals={refusals}
        dimensionNote={record.dimension_note}
        onSave={(answer, value, state) => void save(answer as Answer, value, state)}
        onRecordDimension={recordDimension}
      />
    </>
  );
}
