"use client";

// Fill in what we already know — the screen for a meeting.
//
// ============================================================================
// WHY IT IS A SECOND SCREEN AND NOT A MODE ON THE CHASE SCREEN
//
// Matthew's handover picture (§3.24): the PM loads the pack and reviews it,
// takes the outstanding summary to the CAM, who fills in what they remember,
// and only what is LEFT goes to the client. The app had the last step and not
// the middle one — a value somebody already knew could only be recorded by
// opening each record in turn.
//
// Decided in the plan (§5.3): two screens sharing one loader and one grouping.
// The chase screen selects questions to ASK; this one ANSWERS them, and a tick
// box beside an edit box on one row is a screen that does not know what it is
// for. They share `loadOutstanding` and `groupIntoLines`, so they can never
// disagree about what is outstanding.
//
// ---- A CHANGE IS OFFERED, NEVER REQUIRED ---------------------------------
//
// `OpenChangeBar` sits in the header: name the meeting once and every value
// recorded after it belongs to that change, so the history reads "12 values
// recorded on the handover call" rather than twelve rows saying "update". The
// FIRST edit works without one. A screen that demands ceremony before the
// first edit is a screen people stop opening (§0.2).
//
// ---- AND NOTHING HERE SENDS ANYTHING -------------------------------------
//
// It is internal. The primary action is the next step in the work — when the
// meeting is over, the chase screen still lists what is left, and that is the
// client email.
// ============================================================================
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { buttonClass } from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";
import Spinner from "@/components/ui/Spinner";
import Tabs from "@/components/ui/Tabs";
import OpenChangeBar from "@/components/history/OpenChangeBar";
import InfillTable, { NO_FILTERS, type Filters } from "@/components/infill/InfillTable";
import UncategorisedBlock, { type UncategorisedRecord } from "@/components/infill/UncategorisedBlock";
import type { SaveOutcome } from "@/components/infill/InfillRow";
import { useUrlTab } from "@/lib/use-url-tab";
import type { InfillLineSummary, InfillQuestion } from "@/lib/infill";
import { DIMENSION_SLOT_LABELS, type DimensionSlot } from "@/lib/spec-vocab";
import type { Palette, PaletteOption } from "@/lib/palettes";

type Category = { id: string; slug: string; family: string; name: string; requirements_authored: boolean };

type Summary = {
  project: { id: string; bws_project_number: string; name: string };
  lines: InfillLineSummary[];
  phases: { id: string; name: string }[];
  totals: { questions: number; toQuote: number; later: number; noLevel: number; waiting: number };
  uncategorised: UncategorisedRecord[];
  categories: Category[];
  palettes: (Omit<Palette, "options" | "allowsFreeText" | "syncedAt" | "sourceNote"> & {
    allows_free_text: boolean;
    source_note: string | null;
    synced_at: string | null;
    options: PaletteOption[];
  })[];
  paletteByQuestion: { json_id: number | null; local_key: string | null; palette_key: string }[];
};

const TABS = ["by-item"] as const;
type TabId = (typeof TABS)[number];

function InfillView() {
  const params = useParams<{ id: string }>();
  const projectId = String(params.id);

  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [questionsByLine, setQuestionsByLine] = useState<Record<string, InfillQuestion[]>>({});
  const [lineError, setLineError] = useState<Record<string, string>>({});
  const [loadingLine, setLoadingLine] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Record<string, number>>({});

  /**
   * ONE SAVE AT A TIME, AND IT IS NOT A PERFORMANCE MEASURE.
   *
   * Every write ends in `snapshotRecords`, which reads `max(snapshot_no)` for
   * the record and inserts the next one. Two writes to two DIFFERENT questions
   * on the SAME item overlap happily — `editAnswer` locks the answer row, not
   * the record — and both then claim the same version number; the second dies
   * on `record_snapshots_record_no_key` and reaches the row as a 500 saying
   * "nothing was written". Seen on the sandbox on 2026-09-20, by selecting a
   * palette and tabbing out of the next box a moment later, which is exactly
   * what this screen is for.
   *
   * The underlying race is in `snapshotRecords` and is every write path's, not
   * this screen's — it is recorded as a finding. Serialising here costs nothing
   * (a person answers one question at a time) and means a meeting never sees
   * it.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work);
    // Swallowed on the CHAIN only: the caller still gets the rejection, and a
    // failed save must not stop the ones after it.
    queue.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  const [tab, setTab] = useUrlTab<TabId>({
    fallback: "by-item",
    resolve: (raw) => (TABS as readonly string[]).includes(raw ?? "") ? (raw as TabId) : null,
  });

  const load = useCallback(async () => {
    const res = await apiFetch<Summary>(`/api/projects/${encodeURIComponent(projectId)}/infill`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** One line's questions, through the same loader, scoped to that line. */
  const loadLine = useCallback(
    async (lineId: string) => {
      setLoadingLine(lineId);
      try {
        const res = await apiFetch<{ questions: InfillQuestion[] }>(
          `/api/projects/${encodeURIComponent(projectId)}/infill?line=${encodeURIComponent(lineId)}`,
        );
        if (!res.ok) {
          setLineError((prev) => ({ ...prev, [lineId]: res.error }));
          return;
        }
        setLineError((prev) => {
          const next = { ...prev };
          delete next[lineId];
          return next;
        });
        setQuestionsByLine((prev) => ({ ...prev, [lineId]: res.data.questions }));
      } finally {
        // Always, so a non-JSON response cannot leave a line saying it is
        // still reading.
        setLoadingLine(null);
      }
    },
    [projectId],
  );

  /** Which line a question belongs to — its own, or its finish option's parent. */
  const lineOf = useCallback(
    (question: InfillQuestion): string => {
      for (const [lineId, questions] of Object.entries(questionsByLine)) {
        if (questions.some((row) => row.recordId === question.recordId && row.requirementId === question.requirementId)) {
          return lineId;
        }
      }
      return question.recordId;
    },
    [questionsByLine],
  );

  /**
   * Record one answer.
   *
   * `PATCH /api/answers/[id]` writes `source_kind = 'manual'`, which takes the
   * answer out of `applyAnswerFills`' reach for good — a value a person typed
   * is never overwritten by a later document. The optimistic lock is the
   * version the row was rendered with.
   */
  const saveAnswer = useCallback(
    async (
      question: InfillQuestion,
      input: { value: string | null; state: "confirmed" | "tbc" | "missing" | "na"; reason: string | null },
    ): Promise<SaveOutcome> => {
      if (!question.answerId || question.answerVersion === null) {
        return { ok: false, error: "There is no checklist row to write to yet.", code: "no_answer_row" };
      }
      const res = await enqueue(() =>
        apiFetch<{ answer: { version: number; value: string | null; state: string } }>(
          `/api/answers/${encodeURIComponent(question.answerId!)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              value: input.value,
              state: input.state,
              version: question.answerVersion,
              ...(input.reason ? { reason: input.reason } : {}),
            }),
          },
        ),
      );
      if (!res.ok) {
        return { ok: false, error: res.error, code: typeof res.data?.code === "string" ? res.data.code : null };
      }

      // THE ROW STAYS, WITH THE VERSION IT NOW HAS. Reloading the list here
      // would make the row somebody just answered vanish — a filled gap leaves
      // `loadOutstanding` — which reads as the save having failed.
      const lineId = lineOf(question);
      setQuestionsByLine((prev) => {
        const list = prev[lineId];
        if (!list) return prev;
        return {
          ...prev,
          [lineId]: list.map((row) =>
            row.recordId === question.recordId && row.requirementId === question.requirementId
              ? {
                  ...row,
                  state: res.data.answer.state,
                  currentValue: res.data.answer.value,
                  answerVersion: res.data.answer.version,
                }
              : row,
          ),
        };
      });
      setAnswered((prev) => ({ ...prev, [lineId]: (prev[lineId] ?? 0) + 1 }));
      return {
        ok: true,
        message:
          input.state === "tbc"
            ? "Recorded as TBC — still outstanding, but nobody has to guess it."
            : "Recorded.",
      };
    },
    [lineOf, enqueue],
  );

  /**
   * Record one dimension.
   *
   * NOT the answer. The composed Dimensions cell is a projection of the
   * record's dimension attributes, so this writes an ATTRIBUTE with its slot
   * and `recomposeAnswers` fills the cell — see `src/lib/manual-capture.ts`.
   */
  const saveDimension = useCallback(
    async (
      question: InfillQuestion,
      input: { slot: DimensionSlot; value: string; unit: "mm" | "cm" | "m" | "in" },
    ): Promise<SaveOutcome> => {
      const res = await enqueue(() =>
        apiFetch(`/api/attributes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recordId: question.recordId,
            attrGroup: "dimension",
            // The slot's own name, so the row reads as what it is on the record
            // screen and in the long-form sheet.
            label: DIMENSION_SLOT_LABELS[input.slot],
            value: input.value,
            unit: input.unit,
            dimensionSlot: input.slot,
            state: "confirmed",
          }),
        }),
      );
      if (!res.ok) {
        return { ok: false, error: res.error, code: typeof res.data?.code === "string" ? res.data.code : null };
      }
      const lineId = lineOf(question);
      setAnswered((prev) => ({ ...prev, [lineId]: (prev[lineId] ?? 0) + 1 }));
      return { ok: true, message: `Recorded as a ${DIMENSION_SLOT_LABELS[input.slot].toLowerCase()} dimension.` };
    },
    [lineOf, enqueue],
  );

  // ---- which palette a question offers, exactly as the record screen decides
  const palettesByKey = useMemo(() => {
    const out = new Map<string, Palette>();
    for (const row of data?.palettes ?? []) {
      out.set(row.key, {
        key: row.key,
        name: row.name,
        owner: row.owner,
        allowsFreeText: row.allows_free_text,
        sourceNote: row.source_note,
        syncedAt: row.synced_at,
        options: row.options ?? [],
      });
    }
    return out;
  }, [data?.palettes]);

  const paletteKeys = useMemo(() => {
    const byField = new Map<number, string>();
    const byLocal = new Map<string, string>();
    for (const row of data?.paletteByQuestion ?? []) {
      if (row.json_id !== null && row.json_id !== undefined) byField.set(Number(row.json_id), row.palette_key);
      if (row.local_key) byLocal.set(row.local_key, row.palette_key);
    }
    return { byField, byLocal };
  }, [data?.paletteByQuestion]);

  const paletteFor = useCallback(
    (question: InfillQuestion): Palette | null => {
      const key =
        (question.localKey ? paletteKeys.byLocal.get(question.localKey) : undefined) ??
        (question.jsonId !== null ? paletteKeys.byField.get(question.jsonId) : undefined);
      return key ? (palettesByKey.get(key) ?? null) : null;
    },
    [paletteKeys, palettesByKey],
  );

  if (error && !data) {
    return (
      <PageBody width="wide">
        <Note tone="danger" title="This screen could not be loaded.">
          {error}
        </Note>
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody width="wide">
        <Spinner label="Loading" />
      </PageBody>
    );
  }

  const { project, totals } = data;
  const recorded = Object.values(answered).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <PageHeader
        crumbs={[
          {
            label: `${project.bws_project_number} — ${project.name}`,
            href: `/dashboard/projects/${encodeURIComponent(project.id)}`,
          },
        ]}
        title="Fill in what we know"
        subtitle="Internal. Nothing here is sent — when you are done, the chase screen still lists what is left."
        actions={
          <>
            <OpenChangeBar projectId={project.id} />
            {/* THE NEXT STEP IN THE WORK, and the only primary: fill in what we
                know, then ask the client for the rest. */}
            <Link
              href={`/dashboard/drafts?projectId=${encodeURIComponent(project.id)}`}
              className={buttonClass("primary", "sm", "no-underline")}
            >
              Chase what is left
            </Link>
          </>
        }
        tabs={
          <Tabs
            label="How to work through it"
            value={tab}
            onChange={setTab}
            items={[{ id: "by-item", label: "By item", count: data.lines.length }]}
          />
        }
      />

      <PageBody width="wide">
        {error && (
          <Note tone="danger" title="The last action did not complete.">
            {error}
          </Note>
        )}

        <p className="text-sm text-neutral-600">
          <b className="font-semibold text-neutral-900">{totals.toQuote.toLocaleString()}</b> needed to quote ·{" "}
          {totals.later.toLocaleString()} also outstanding
          {totals.noLevel > 0 && <> · {totals.noLevel.toLocaleString()} on items with no level</>}
          {totals.waiting > 0 && <> · {totals.waiting.toLocaleString()} already chased</>}
          {recorded > 0 && (
            <span className="text-green-700"> · {recorded} recorded in this sitting</span>
          )}
        </p>

        {/* A RECORD WITH NO CATEGORY HAS NO QUESTIONS, so it would simply not
            appear — and an item nobody has classified is exactly the one a
            meeting should catch. Listed first, with the picker beside it. */}
        {data.uncategorised.length > 0 && (
          <UncategorisedBlock
            records={data.uncategorised}
            categories={data.categories}
            onChanged={() => void load()}
          />
        )}

        <InfillTable
          lines={data.lines}
          phases={data.phases}
          filters={filters}
          onFilters={setFilters}
          questionsByLine={questionsByLine}
          loadingLine={loadingLine}
          lineError={lineError}
          onOpenLine={(lineId) => void loadLine(lineId)}
          onReloadLine={loadLine}
          paletteFor={paletteFor}
          onSaveAnswer={saveAnswer}
          onSaveDimension={saveDimension}
          answered={answered}
        />
      </PageBody>
    </>
  );
}

export default function InfillPage() {
  return (
    <Suspense
      fallback={
        <PageBody width="wide">
          <Spinner label="Loading" />
        </PageBody>
      }
    >
      <InfillView />
    </Suspense>
  );
}
