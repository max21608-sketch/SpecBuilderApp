"use client";
// Matthew's gate matrix for one record: what each gate still wants.
//
// ============================================================================
// THE PANEL'S JOB IS TO SAY WHOSE PROBLEM EACH ROW IS.
//
// A flat "12 outstanding" is the number the checklist already gives, and it is
// the number that made the checklist unusable: 43 questions with no sense of
// which matter when. The five outcomes are here because three of them are not
// a reviewer's fault and must not read as one --
//
//   blocking       somebody has to answer it. RED.
//   unknown        a conditional whose controller is unanswered. AMBER: we
//                  cannot tell whether it even applies.
//   unanswerable   the app has nowhere to put the answer. SLATE and dashed,
//                  deliberately not red: the fix is a seed or a migration, and
//                  putting it in the red list teaches somebody to ignore red.
//
// ---- AND THE GATES BUILD ON EACH OTHER -------------------------------------
//
// This panel printed `TGQ 2 outstanding` · `TG0 5 outstanding` · `TG1 ✓`,
// which cannot be true: a record cannot be at production lock over a price
// nobody could quote. `chainGates` is the fix and this is where it shows. A
// gate whose predecessor is unmet is SLATE — never red, never green — and its
// own count still shows, because hiding it would say less than the screen used
// to.
//
// ---- THE PILL NO LONGER FOLDS TWO NUMBERS INTO ONE -------------------------
//
// Found in use, 2026-09-18: the pill read `TGQ 2 outstanding` over a list in
// which exactly ONE row was work anybody could do — the other was Product
// code, `unanswerable`, which no reviewer can clear. The panel already broke
// that split out in words, but only for a PREDECESSOR gate; the gate whose
// turn it actually was got the folded number.
//
// So a gate in play now shows up to two chips: `n to answer` in red, and
// `n nowhere to record` in dashed slate. They are never added together, and
// the footer's Chase button counts only the first — which is the whole point,
// since chasing somebody about a field this app cannot store is asking them to
// fix our migration.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import {
  CAPTURE_LABELS,
  GATES,
  GATE_LABELS,
  GATE_SHORT_LABELS,
  NO_MATRIX_CATEGORY_EXPLANATION,
  NO_MATRIX_CATEGORY_LABEL,
  type Gate,
  type GateField,
  type GateFieldStatus,
  type GateOutcome,
  type GateStatus,
} from "@/lib/gates";
import type { AnswerState } from "@/lib/spec-vocab";
import type { Palette } from "@/lib/palettes";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Button, { buttonClass } from "@/components/ui/Button";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import type { Tone } from "@/components/ui/tone";

const OUTCOME_TONE: Record<GateOutcome, Tone> = {
  satisfied: "good",
  blocking: "danger",
  unknown: "warn",
  unanswerable: "blocked",
  not_applicable: "plain",
};

const OUTCOME_LABEL: Record<GateOutcome, string> = {
  satisfied: "Settled",
  blocking: "Outstanding",
  unknown: "Cannot tell",
  unanswerable: "Nowhere to record it",
  not_applicable: "N/A",
};

/** What the gate's own header band is tinted by. Slate is never red, and never green. */
const BAND: Record<"settled" | "in_play" | "not_reached", string> = {
  settled: "border-green-200 bg-green-50",
  in_play: "border-red-200 bg-red-50",
  not_reached: "border-slate-200 bg-slate-50",
};

/** Somebody can answer it today. `unanswerable` is deliberately not in here. */
function answerable(status: GateStatus): number {
  return status.counts.blocking + status.counts.unknown;
}

/** One row of Matthew's matrix as the record route sends it. */
export type MatrixFieldRow = {
  matrixRow: number;
  gate: Gate;
  capture: GateField["capture"];
  fieldName: string;
  jsonId: number | null;
  localKey: string | null;
  dimensionSlot: GateField["dimensionSlot"];
  valueType: GateField["valueType"];
  paletteKey: string | null;
  paletteRaw: string | null;
  conditionalOnKey: string | null;
  conditionalOnValue: string | null;
  notes: string | null;
};

/** Only the parts of a checklist answer this panel needs to link to one. */
export type GateAnswer = {
  requirement_id: string;
  prompt: string;
  json_id: number | null;
  local_key: string | null;
  state: AnswerState;
};

export default function GatePanel({
  gates,
  matrixFields = null,
  answers = [],
  palettes = [],
  categoryName = null,
  chaseHref = null,
}: {
  gates: Record<Gate, GateStatus> | null;
  matrixFields?: MatrixFieldRow[] | null;
  answers?: GateAnswer[];
  palettes?: (Omit<Palette, "options"> & { options: Palette["options"] })[];
  categoryName?: string | null;
  /** Where "Chase the n" goes. Null renders no button rather than a dead one. */
  chaseHref?: string | null;
}) {
  const [showAll, setShowAll] = useState<Partial<Record<Gate, boolean>>>({});
  const [why, setWhy] = useState(false);

  if (!gates) {
    // AN UNMAPPED CATEGORY GETS NO BOARDS, not three empty ones. An empty gate
    // computes as "nothing outstanding" and would report a cabinetry item
    // TG0-ready over rules nobody has written yet.
    return (
      <Note tone="blocked" title={NO_MATRIX_CATEGORY_LABEL}>
        {NO_MATRIX_CATEGORY_EXPLANATION}
      </Note>
    );
  }

  /** The checklist question a matrix field is answered through, where there is one. */
  const questionFor = (field: GateField | MatrixFieldRow): GateAnswer | null => {
    const jsonId = "jsonId" in field ? field.jsonId : field.specFieldJsonId;
    return (
      answers.find(
        (answer) =>
          (field.localKey !== null && answer.local_key === field.localKey) ||
          (jsonId !== null && answer.json_id === jsonId),
      ) ?? null
    );
  };
  const questionByKey = (key: string): GateAnswer | null =>
    answers.find((answer) => answer.local_key === key) ?? null;

  /** A field's name, as a link into the checklist where it can be answered. */
  const FieldName = ({ field }: { field: GateField }) => {
    const question = questionFor(field);
    if (!question) return <span className="text-neutral-800">{field.fieldName}</span>;
    return (
      <Link href={`?tab=checklist#q-${question.requirement_id}`} className="underline hover:text-neutral-900">
        {field.fieldName}
      </Link>
    );
  };

  /** The second line under a row: whose problem it is, in words. */
  const Why = ({ row }: { row: GateFieldStatus }) => {
    if (row.outcome === "unknown" && row.field.conditionalOnKey) {
      const controller = questionByKey(row.field.conditionalOnKey);
      return (
        <p className="mt-0.5 text-[11px] text-neutral-500">
          Applies only if{" "}
          {controller ? (
            <Link href={`?tab=checklist#q-${controller.requirement_id}`} className="underline">
              {controller.prompt}
            </Link>
          ) : (
            row.field.conditionalOnKey
          )}{" "}
          is {row.field.conditionalOnValue ?? "set"}, and nobody has answered that.
        </p>
      );
    }
    if (row.outcome === "unanswerable") {
      return (
        <p className="mt-0.5 text-[11px] text-neutral-500">
          The matrix wants it and this category&rsquo;s checklist cannot ask it. A seed, not a question for you.
        </p>
      );
    }
    if (row.outcome === "not_applicable") {
      return <p className="mt-0.5 text-[11px] text-neutral-500">{row.reason}</p>;
    }
    return null;
  };

  // ---- the same field at two gates ----------------------------------------
  //
  // His matrix deliberately puts one field at two gates — Dimensions at TGQ as
  // four slots and at TG1 as the whole cell re-checked — so a later gate is
  // largely a RE-CHECK. Computed from the rows rather than named in a
  // sentence, because the sentence would go stale on the next workbook.
  const twoGaters = (() => {
    const byKey = new Map<string, { name: string; gates: Set<Gate> }>();
    for (const field of matrixFields ?? []) {
      const key = field.jsonId !== null ? `f${field.jsonId}` : `l${field.localKey ?? field.fieldName}`;
      const seen = byKey.get(key) ?? { name: field.fieldName, gates: new Set<Gate>() };
      seen.gates.add(field.gate);
      byKey.set(key, seen);
    }
    return [...byKey.values()].filter((entry) => entry.gates.size > 1).slice(0, 2);
  })();

  const palettesByKey = new Map((palettes ?? []).map((row) => [row.key, row]));

  return (
    <>
      <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
        {GATES.map((gate) => {
          const status = gates[gate];
          const first = status.blockedBy[0] ?? null;
          const toAnswer = answerable(status);
          const nowhere = status.counts.unanswerable;
          const band = status.satisfied ? "settled" : first ? "not_reached" : "in_play";
          const open = showAll[gate] ?? false;
          const rows = open ? status.fields : status.fields.filter((row) => row.outcome !== "satisfied");
          const [label, sub] = GATE_LABELS[gate].split(" — ");

          return (
            <section key={gate} className="overflow-hidden rounded-[10px] border border-neutral-200 bg-white">
              <div className={`flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5 ${BAND[band]}`}>
                <b className="text-sm text-neutral-900">{label}</b>
                <span className="text-[12px] text-neutral-500">{sub}</span>
                <span className="flex-1" />
                {status.satisfied ? (
                  <Chip tone="good">Settled</Chip>
                ) : first ? (
                  // NOT REACHED. Slate, and it names the gate to do FIRST —
                  // the later ones in `blockedBy` follow from that one.
                  <Chip tone="blocked">{GATE_SHORT_LABELS[first]} first</Chip>
                ) : (
                  <>
                    {toAnswer > 0 && <Chip tone="danger">{toAnswer} to answer</Chip>}
                    {/* NEVER ADDED TO THE ONE BESIDE IT. A reviewer looking for
                        two questions to answer must not find one. */}
                    {nowhere > 0 && <Chip tone="blocked">{nowhere} nowhere to record</Chip>}
                    {toAnswer === 0 && nowhere === 0 && <Chip tone="warn">nothing checked</Chip>}
                  </>
                )}
              </div>

              {/* A blocked gate's OWN count still shows, because hiding it
                  would lose what the screen used to say. It is simply not
                  today's work. */}
              {first && (
                <p className="border-b border-neutral-100 px-3.5 py-2 text-[11.5px] text-slate-600">
                  The gates build on each other. {GATE_SHORT_LABELS[gate]} cannot be met until{" "}
                  {status.blockedBy.map((g) => GATE_SHORT_LABELS[g]).join(" and ")}{" "}
                  {status.blockedBy.length === 1 ? "is" : "are"}.{" "}
                  {status.ownSatisfied
                    ? `Everything ${GATE_SHORT_LABELS[gate]} asks for is settled — that is all this gate can tell you today.`
                    : `Its own ${toAnswer > 0 ? `${toAnswer} to answer` : ""}${
                        toAnswer > 0 && nowhere > 0 ? " and " : ""
                      }${nowhere > 0 ? `${nowhere} with nowhere to record` : ""} are below.`}
                </p>
              )}

              <ul className="divide-y divide-neutral-100">
                {rows.map((row) => (
                  <li key={row.field.matrixRow} className="flex items-start gap-2 px-3.5 py-2">
                    <Chip tone={OUTCOME_TONE[row.outcome]} className="mt-px shrink-0">
                      {OUTCOME_LABEL[row.outcome]}
                    </Chip>
                    <div className="min-w-0">
                      <FieldName field={row.field} />
                      {row.field.dimensionSlot && (
                        <span className="ml-1 text-[11px] text-neutral-400">({row.field.dimensionSlot})</span>
                      )}
                      <Why row={row} />
                      {row.value && (
                        <p className="mt-0.5 break-words font-mono text-[11px] text-neutral-600">{row.value}</p>
                      )}
                    </div>
                  </li>
                ))}
                {rows.length === 0 && (
                  <li className="px-3.5 py-2 text-[12px] text-neutral-500">
                    Nothing outstanding at this gate.
                  </li>
                )}
              </ul>

              <div className="flex items-center gap-2 border-t border-neutral-200 px-3.5 py-2.5">
                {/* ONLY WHAT A PERSON CAN ANSWER. Chasing somebody about a
                    field this app has nowhere to store is asking them to fix
                    our migration. */}
                {toAnswer > 0 && chaseHref && (
                  // SECONDARY ON A GATE NOBODY HAS REACHED. Its rows are real
                  // and chasing them early is not wrong, but a black button on
                  // three boards at once says all three are the thing to do —
                  // and only one of them is. Same argument as the slate band.
                  <Link href={chaseHref} className={buttonClass(first ? "secondary" : "primary", "xs", "flex-1")}>
                    Chase the {toAnswer}
                  </Link>
                )}
                <Button
                  variant="quiet"
                  size="xs"
                  className={toAnswer > 0 && chaseHref ? "" : "flex-1"}
                  onClick={() => setShowAll((current) => ({ ...current, [gate]: !open }))}
                >
                  {open ? "Hide the settled" : `Show all ${status.fields.length}`}
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      {twoGaters.length > 0 && (
        <Note tone="info">
          The same field legitimately sits at two gates —{" "}
          {twoGaters.map((entry, index) => (
            <span key={entry.name}>
              {index > 0 ? ", and " : ""}
              <b className="font-semibold">{entry.name}</b> is at {[...entry.gates].join(" and ")}
            </span>
          ))}
          . Answering it once satisfies both.
        </Note>
      )}

      {/* REFERENCE, NOT WORK, so it is collapsed — but one click away, with
          the standing-in-for-Matthew warning attached to it rather than
          hidden in a doc. */}
      <Card
        title={
          <Button variant="quiet" size="xs" onClick={() => setWhy((open) => !open)}>
            {why ? "▾" : "▸"} Why these questions
          </Button>
        }
        actions={
          <CardHeadingNote>
            Matthew&rsquo;s matrix, 17 Sept{categoryName ? ` · ${categoryName}` : ""} ·{" "}
            {matrixFields?.length ?? 0} fields{why ? "" : " · collapsed by default"}
          </CardHeadingNote>
        }
        flush
      >
        {why && (
          <Table scroll>
            <thead>
              <tr>
                <Th>Field</Th>
                <Th>BWS id</Th>
                <Th>Gates</Th>
                <Th>How it arrives</Th>
                <Th>Palette</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {(matrixFields ?? []).map((field) => {
                const status = GATES.flatMap((gate) => gates[gate].fields).find(
                  (row) => row.field.matrixRow === field.matrixRow,
                );
                const question = questionFor(field);
                const palette = field.paletteKey ? palettesByKey.get(field.paletteKey) : undefined;
                return (
                  <Tr key={field.matrixRow}>
                    <Td>
                      {question ? (
                        <Link href={`?tab=checklist#q-${question.requirement_id}`} className="underline">
                          {field.fieldName}
                        </Link>
                      ) : (
                        field.fieldName
                      )}
                      {field.dimensionSlot && (
                        <span className="ml-1 text-[11px] text-neutral-400">({field.dimensionSlot})</span>
                      )}
                    </Td>
                    <Td mono muted>
                      {field.jsonId ?? "—"}
                    </Td>
                    <Td>
                      <Chip tone={field.gate === "TGQ" ? "danger" : "plain"}>{field.gate}</Chip>
                    </Td>
                    <Td muted>{CAPTURE_LABELS[field.capture]}</Td>
                    <Td>
                      {/* A PALETTE THIS APP DOES NOT HOLD SAYS SO. Five of his
                          eleven are BWS-owned and seeded with zero options;
                          the honest answer is the question, not an empty
                          dropdown. */}
                      {palette && palette.options.length > 0 ? (
                        <span className="text-neutral-600">
                          {palette.options.map((option) => option.label).join(" · ")}
                        </span>
                      ) : field.paletteRaw ? (
                        <Chip tone="warn">{field.paletteRaw}</Chip>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </Td>
                    <Td>
                      {status ? (
                        <Chip tone={OUTCOME_TONE[status.outcome]}>
                          {status.outcome === "unanswerable" && field.jsonId === null
                            ? "No home"
                            : OUTCOME_LABEL[status.outcome]}
                        </Chip>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Note tone="warn" title="These answers are Max standing in for Matthew.">
        The category mapping and the TGQ set were settled on 17 Sept so the work could start, and every one is still
        to be confirmed with him — <span className="font-mono">docs/plans/matrix-assumptions.md</span>. TG2 is not
        modelled and the cabinetry half of the matrix is not written.
      </Note>
    </>
  );
}
