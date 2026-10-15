"use client";
// The project's project-wide questions, answered once for every item.
//
// ============================================================================
// Max, 2026-10-12: the Project / commercial section stops counting in each
// item's TGQ, still flags at project level, and is answered ONCE per project.
// This card is that "once". Each row is one QUESTION (keyed by what it asks,
// so "Access" is one row however many cheat sheets ask it), with its tier,
// how many items ask it, and what they already hold.
//
// Saving writes the value to every item that asks it, through
// `POST /api/projects/[id]/project-wide` — one change, one version per item.
// Three things the card has to say BEFORE the press, because the route
// refuses rather than guesses:
//
//  - which items already hold a DIFFERENT settled answer. They are listed
//    unticked; replacing one takes a tick and a reason. An item may be the
//    exception, and nobody should lose it to a batch they did not read.
//  - how many items the press will write to.
//  - that the set is the one on screen: an item added since is refused whole,
//    and the card says so and reloads.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { fieldDisplayName } from "@/lib/spec-field-label";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { ANSWER_STATE_LABELS, type AnswerState } from "@/lib/spec-vocab";
import type { Palette } from "@/lib/palettes";
import { TIER_LABELS, type QuestionTier } from "@/lib/tgq";
import AnswerValue from "@/components/records/AnswerValue";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Button from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import Spinner from "@/components/ui/Spinner";
import { Table, Th, Td, Tr } from "@/components/ui/Table";

type Row = {
  recordId: string;
  recordLabel: string;
  itemDescription: string;
  requirementId: string;
  answerId: string | null;
  answerVersion: number | null;
  state: AnswerState;
  value: string | null;
  tier: QuestionTier | null;
};

type Question = {
  key: string;
  heading: string;
  fieldLabel: string | null;
  rows: Row[];
  items: number;
  settled: number;
  outstanding: number;
  toQuoteOutstanding: number;
  tier: QuestionTier;
  values: { value: string | null; state: AnswerState; items: number }[];
  palette: Palette | null;
};

const COLUMNS = 5;
const isSettled = (state: string) => state === "confirmed" || state === "na";

export default function ProjectWideCard({
  projectId,
  onChanged,
}: {
  projectId: string;
  /** The overview's own numbers move when this writes; it reloads them. */
  onChanged?: () => void;
}) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ questions: Question[] }>(`/api/projects/${projectId}/project-wide`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setQuestions(res.data.questions);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ARRIVING ON THE ANCHOR. The record screen, the phase table and the fill-in
  // screen all link here as `#project-wide`; the card renders after its data,
  // so the browser's own jump has already happened by then.
  useEffect(() => {
    if (!questions || typeof window === "undefined" || window.location.hash !== "#project-wide") return;
    document.getElementById("project-wide")?.scrollIntoView?.({ block: "start" });
  }, [questions]);

  const blocking = (questions ?? []).filter((question) => question.toQuoteOutstanding > 0).length;
  const listed = (questions ?? []).filter((question) => showSettled || question.outstanding > 0);
  const hidden = (questions ?? []).length - listed.length;

  return (
    <div id="project-wide" className="scroll-mt-6">
      <Card
        flush
        title={
          <>
            Project-wide — answered once for every item
            <CardHeadingNote>
              {questions === null
                ? ""
                : blocking > 0
                  ? `${blocking} blocking a quote`
                  : "none blocking a quote"}
            </CardHeadingNote>
          </>
        }
        actions={
          hidden > 0 || showSettled ? (
            <Button variant="quiet" size="xs" onClick={() => setShowSettled((on) => !on)}>
              {showSettled ? "hide settled" : `show ${hidden} settled`}
            </Button>
          ) : undefined
        }
      >
        <p className="px-4 pt-3 text-[12.5px] text-neutral-600">
          The same questions are asked of every item — TOE, access, assembly guide and the rest. They do not count in
          an item&rsquo;s own TGQ; they block every quote until they are answered here, once. An answer is written to
          every item that asks it, and an item that already holds a different answer is left alone unless you tick it.
        </p>
        {error && <Note tone="danger" className="mx-4">{error}</Note>}
        {notice && <Note tone="good" className="mx-4">{notice}</Note>}
        {questions === null && !error ? (
          <div className="px-4 py-3">
            <Spinner label="Reading the project-wide questions" />
          </div>
        ) : questions && questions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-neutral-600">
            No item in the export&rsquo;s scope asks a project-wide question yet — they come with an item&rsquo;s
            category.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Question</Th>
                <Th className="w-[110px]">Tier</Th>
                <Th num className="w-[90px]">Items</Th>
                <Th className="w-[34%]">Answered</Th>
                <Th className="w-[90px]" />
              </tr>
            </thead>
            <tbody>
              {listed.map((question) => (
                <QuestionRows
                  key={question.key}
                  projectId={projectId}
                  question={question}
                  open={open === question.key}
                  onToggle={() => setOpen(open === question.key ? null : question.key)}
                  onSaved={async (message) => {
                    setOpen(null);
                    await load();
                    setNotice(message);
                    onChanged?.();
                  }}
                  onRefused={async (message) => {
                    // RELOAD FIRST, then say what happened — the other order
                    // clears the message with the reload.
                    await load();
                    setError(message);
                  }}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function QuestionRows({
  projectId,
  question,
  open,
  onToggle,
  onSaved,
  onRefused,
}: {
  projectId: string;
  question: Question;
  open: boolean;
  onToggle: () => void;
  onSaved: (message: string) => Promise<void>;
  onRefused: (message: string) => Promise<void>;
}) {
  const differing = question.values.length > 1;
  return (
    <>
      <Tr className="cursor-pointer" onClick={onToggle}>
        <Td>
          <span className="mr-1.5 text-neutral-500">{open ? "▾" : "▸"}</span>
          <span className="text-neutral-900">{fieldDisplayName(question.heading)}</span>
          {question.fieldLabel && fieldDisplayName(question.fieldLabel) !== fieldDisplayName(question.heading) && (
            <span className="block pl-4 text-[11px] text-neutral-500">BWS: {fieldDisplayName(question.fieldLabel)}</span>
          )}
        </Td>
        <Td>
          {question.toQuoteOutstanding > 0 ? (
            <Chip tone="danger">{TIER_LABELS.to_quote}</Chip>
          ) : question.outstanding > 0 ? (
            <Chip tone="warn">{question.tier === "to_quote" ? TIER_LABELS.to_quote : "Later"}</Chip>
          ) : (
            <Chip tone="good">Settled</Chip>
          )}
        </Td>
        <Td num className="text-neutral-700">
          {question.items}
        </Td>
        <Td className="text-[12.5px] text-neutral-700">
          {question.settled === 0 ? (
            <span className="text-neutral-500">on none yet</span>
          ) : (
            <>
              answered on {question.settled} of {question.rows.length}
              {/* WHERE THEY DIFFER, THE VALUES — the decision a person takes
                  here is which of them is the project's answer. */}
              {question.values.map((entry) => (
                <span
                  key={`${entry.state}:${entry.value ?? ""}`}
                  className={`block text-[11.5px] ${differing ? "text-amber-800" : "text-neutral-500"}`}
                >
                  “{entry.state === "na" ? ANSWER_STATE_LABELS.na : (entry.value ?? "")}” on {entry.items}
                </span>
              ))}
            </>
          )}
        </Td>
        <Td className="text-right">
          <span className="text-xs text-blue-700">{open ? "Close" : "Answer"}</span>
        </Td>
      </Tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS} className="border-b border-neutral-100 bg-[#fcfcfc] px-4 py-3">
            <AnswerForm projectId={projectId} question={question} onSaved={onSaved} onRefused={onRefused} />
          </td>
        </tr>
      )}
    </>
  );
}

function AnswerForm({
  projectId,
  question,
  onSaved,
  onRefused,
}: {
  projectId: string;
  question: Question;
  onSaved: (message: string) => Promise<void>;
  onRefused: (message: string) => Promise<void>;
}) {
  // Seeded with the answer most items already hold, if any — a person agreeing
  // with it presses Save; changing it is typing. Nothing is written until then.
  const common = question.values.find((entry) => entry.state === "confirmed")?.value ?? null;
  const [value, setValue] = useState<string | null>(common);
  const [state, setState] = useState<"confirmed" | "tbc">("confirmed");
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = (value ?? "").trim();
  // TBC carries no value: it says the answer is not decided.
  const sending = state === "tbc" ? "" : target;
  // THE SAME DECISION THE ROUTE MAKES (`planProjectWide`), shown before it.
  const plan = useMemo(() => {
    const write: Row[] = [];
    const differ: Row[] = [];
    let same = 0;
    for (const row of question.rows) {
      const already = row.state === state && (row.value ?? "").trim() === sending;
      if (already) same += 1;
      else if (!isSettled(row.state)) write.push(row);
      else differ.push(row);
    }
    return { write, differ, same };
  }, [question.rows, state, sending]);

  const ticked = plan.differ.filter((row) => row.answerId && overrides.has(row.answerId));
  const count = plan.write.length + ticked.length;

  async function save() {
    if (state === "confirmed" && !target) {
      setError("Confirmed needs a value. Use TBC if it is not decided yet.");
      return;
    }
    if (ticked.length > 0 && !reason.trim()) {
      setError("Say why the ticked answers are changing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ written: number; overridden: number; records: number }>(
        `/api/projects/${projectId}/project-wide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: question.key,
            value: sending || null,
            state,
            seen: question.rows.map((row) => ({
              recordId: row.recordId,
              requirementId: row.requirementId,
              answerId: row.answerId,
              version: row.answerVersion,
            })),
            overrides: ticked.map((row) => row.answerId!),
            reason: reason.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        if (res.data?.code === "reason_required") {
          setError(res.error);
          return;
        }
        await onRefused(res.error);
        return;
      }
      await onSaved(
        `“${question.heading}” recorded on ${res.data.records} item${res.data.records === 1 ? "" : "s"}` +
          (res.data.overridden > 0 ? `, replacing ${res.data.overridden} that said something else.` : "."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[260px] flex-1">
          <AnswerValue
            palette={question.palette}
            value={value}
            disabled={busy || state === "tbc"}
            inputKey={`${question.key}:${state}`}
            onCommit={(next) => setValue(next.trim() === "" ? null : next)}
          />
        </div>
        <select
          value={state}
          aria-label="State"
          disabled={busy}
          onChange={(event) => setState(event.target.value === "tbc" ? "tbc" : "confirmed")}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="confirmed">{ANSWER_STATE_LABELS.confirmed}</option>
          <option value="tbc">{ANSWER_STATE_LABELS.tbc}</option>
        </select>
        <Button variant="primary" size="sm" disabled={busy || count === 0} onClick={() => void save()}>
          {busy ? "Saving…" : `Save on ${count} item${count === 1 ? "" : "s"}`}
        </Button>
      </div>

      <p className="mt-2 text-xs text-neutral-600">
        Writes to the {plan.write.length} item{plan.write.length === 1 ? "" : "s"} not yet answered
        {ticked.length > 0 && <> and the {ticked.length} ticked below</>}
        {plan.same > 0 && <> · {plan.same} already say this</>}. One change, one version per item.
      </p>

      {plan.differ.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-amber-800">
            {plan.differ.length} item{plan.differ.length === 1 ? " holds" : "s hold"} a different settled answer, and{" "}
            {plan.differ.length === 1 ? "is" : "are"} left alone unless ticked:
          </p>
          <ul className="mt-1 space-y-0.5">
            {plan.differ.map((row) => (
              <li key={row.recordId} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={busy || !row.answerId}
                  checked={Boolean(row.answerId && overrides.has(row.answerId))}
                  aria-label={`Replace the answer on ${row.recordLabel}`}
                  onChange={() =>
                    setOverrides((current) => {
                      const next = new Set(current);
                      if (row.answerId && next.has(row.answerId)) next.delete(row.answerId);
                      else if (row.answerId) next.add(row.answerId);
                      return next;
                    })
                  }
                />
                <Link
                  href={`/dashboard/records/${row.recordId}?tab=checklist`}
                  className="font-mono text-blue-700 no-underline hover:underline"
                >
                  {row.recordLabel}
                </Link>
                <span className="text-neutral-700">{row.itemDescription}</span>
                <span className="text-neutral-500">
                  — “{row.state === "na" ? ANSWER_STATE_LABELS.na : (row.value ?? "")}”
                </span>
              </li>
            ))}
          </ul>
          {ticked.length > 0 && (
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why the ticked answers are changing"
              className="mt-2 w-full max-w-[520px] rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
