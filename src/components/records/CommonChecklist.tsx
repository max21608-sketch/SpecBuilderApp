"use client";

// A split bill line's Checklist tab: the questions its configurations answer
// identically, answerable ONCE for all of them, and the ones they do not.
//
// ============================================================================
// THE SAME RULE AS THE SPECS TAB, ON ANSWERS.
//
// A question answered the same way — value, qualifier and state — on every
// configuration is COMMON, including a question nobody has answered on any of
// them: Access is the same on every chair on the floor, and answering it five
// times is the chore this saves. One answer here is written to every
// configuration as one change with one version each (`POST
// /api/records/[id]/common`, op `answer`, which calls `editAnswer` for each
// with the change handed in — the machinery `answers/apply` uses).
//
// A question answered DIFFERENTLY anywhere is listed with each value and is
// not editable here, because a common answer would overwrite a configuration
// somebody deliberately answered otherwise.
//
// Dimensions are never answered here: the Dimensions answer is a projection of
// the slots, and a typed one would be wiped by the next drawing confirm. The
// Specs tab's common W, D, H and SH are where they are corrected.
// ============================================================================
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import AnswerValue from "@/components/records/AnswerValue";
import type { Palette } from "@/lib/palettes";
import { readCommonAnswers, type CommonAnswerGroup } from "@/lib/configuration-common";
import type { ConfigurationFamily } from "@/lib/configuration-family";

type PaletteRow = Omit<Palette, "options"> & {
  allows_free_text: boolean;
  source_note: string | null;
  synced_at: string | null;
  options: Palette["options"];
};

type Draft = { requirementId: string; value: string; state: "confirmed" | "tbc" | "na"; reason: string };

const STATE_LABEL: Record<string, string> = { confirmed: "Confirmed", tbc: "TBC", na: "N/A", missing: "Missing" };

function stateTone(state: string): "good" | "warn" | "plain" {
  if (state === "confirmed" || state === "na") return "good";
  if (state === "tbc") return "warn";
  return "plain";
}

function Answered({ value, state }: { value: string | null; state: string }) {
  if (state === "missing") return <span className="text-neutral-400">not answered</span>;
  return (
    <span>
      {value && <span className="text-neutral-900">{value} </span>}
      <Chip tone={stateTone(state)}>{STATE_LABEL[state] ?? state}</Chip>
    </span>
  );
}

export default function CommonChecklist({
  lineId,
  family,
  palettes,
  paletteByQuestion,
  onDone,
}: {
  lineId: string;
  family: ConfigurationFamily;
  palettes: PaletteRow[];
  paletteByQuestion: { json_id: number | null; local_key: string | null; palette_key: string }[];
  /** The page's `reloadThen`: reload first, then show the message. */
  onDone: (message: string | null) => Promise<void> | void;
}) {
  const configurations = family.configurations;
  const groups = useMemo(() => readCommonAnswers(configurations), [configurations]);
  const common = groups.filter((group) => group.status === "common");
  const differs = groups.filter((group) => group.status === "differs");
  const n = configurations.length;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  // The DifferingFields lookup: by local key first, then by BWS field.
  const paletteFor = (group: CommonAnswerGroup): Palette | null => {
    const key =
      paletteByQuestion.find((row) => group.localKey && row.local_key === group.localKey)?.palette_key ??
      paletteByQuestion.find((row) => row.json_id !== null && row.json_id === group.jsonId)?.palette_key;
    const row = key ? palettes.find((palette) => palette.key === key) : undefined;
    return row
      ? {
          key: row.key,
          name: row.name,
          owner: row.owner,
          allowsFreeText: Boolean(row.allows_free_text),
          sourceNote: row.source_note,
          syncedAt: row.synced_at,
          options: row.options ?? [],
        }
      : null;
  };

  if (n < 2) return null;

  async function save(group: CommonAnswerGroup) {
    if (!draft || draft.requirementId !== group.requirementId) return;
    // Said here rather than by disabling the button: the value box commits on
    // blur, so a button disabled on its contents can refuse the very click
    // that would have committed it.
    if (draft.state === "confirmed" && !draft.value.trim()) {
      await onDone("Confirmed needs a value. Use TBC if it is not decided yet.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/records/${encodeURIComponent(lineId)}/common`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "answer",
          requirementId: group.requirementId,
          value: draft.value.trim() === "" ? null : draft.value.trim(),
          state: draft.state,
          reason: draft.reason.trim() || null,
          configurations: configurations.map((configuration) => configuration.recordId),
          seen: group.members.flatMap((member) =>
            member.answer?.answerId ? [{ answerId: member.answer.answerId, version: member.answer.version ?? 0 }] : [],
          ),
        }),
      });
      await onDone(res.ok ? null : res.error);
      if (res.ok) setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  const settledCommon = common.filter((group) => group.shared && group.shared.state !== "missing" && group.shared.state !== "tbc").length;

  return (
    <>
      <Card
        title={`Answered the same on all ${n} configurations`}
        className="mt-0"
        actions={
          <CardHeadingNote>
            {common.length} question{common.length === 1 ? "" : "s"} · {settledCommon} settled
          </CardHeadingNote>
        }
        flush
      >
        <p className="px-4 pt-3 text-xs text-neutral-600">
          Answering one of these here answers it on every configuration, as one change. A question answered differently
          anywhere is listed below and changed on that configuration&rsquo;s own checklist.
        </p>
        {common.length === 0 ? (
          <p className="px-4 py-3 text-sm text-neutral-600">No question is answered the same on every configuration.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-[40%]">Question</Th>
                <Th className="w-[36%]">On all {n}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {common.map((group) => {
                const shared = group.shared!;
                const open = draft?.requirementId === group.requirementId ? draft : null;
                const isDimension = group.jsonId === 3;
                // A configuration with no answer row yet cannot be written by
                // id; that is rare (every configuration is born with its
                // checklist) and is said rather than guessed around.
                const rowless = group.members.some((member) => !member.answer?.answerId);
                const overriding = shared.state === "confirmed";
                return (
                  <Fragment key={group.requirementId}>
                    <Tr>
                      <Td>{group.prompt}</Td>
                      <Td>
                        <Answered value={shared.value} state={shared.state} />
                      </Td>
                      <Td className="text-right">
                        {isDimension ? (
                          <span className="text-xs text-neutral-500">recorded as specs, on the Specs tab</span>
                        ) : rowless ? (
                          <span className="text-xs text-neutral-500">answer on each configuration</span>
                        ) : (
                          <Button
                            size="xs"
                            disabled={busy}
                            onClick={() =>
                              setDraft({
                                requirementId: group.requirementId,
                                value: shared.value ?? "",
                                state: shared.state === "tbc" || shared.state === "na" ? shared.state : "confirmed",
                                reason: "",
                              })
                            }
                          >
                            Answer on all {n}
                          </Button>
                        )}
                      </Td>
                    </Tr>
                    {/* A SPANNING PANEL IS ITS OWN `tr`. */}
                    {open && (
                      <tr className="bg-amber-50/60">
                        <td colSpan={3} className="border-b border-amber-200 px-4 py-3">
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-[14rem] flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                              Value
                              <AnswerValue
                                palette={paletteFor(group)}
                                value={open.value}
                                disabled={busy}
                                inputKey={`common-${group.requirementId}`}
                                onCommit={(next) => setDraft({ ...open, value: next })}
                              />
                            </div>
                            <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                              State
                              <select
                                value={open.state}
                                onChange={(event) => setDraft({ ...open, state: event.target.value as Draft["state"] })}
                                className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                              >
                                <option value="confirmed">Confirmed</option>
                                <option value="tbc">TBC</option>
                                <option value="na">N/A</option>
                              </select>
                            </label>
                            <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                              {/* REQUIRED ONLY TO OVERRIDE A SETTLED ANSWER, which
                                  is editAnswer's rule — or an open change carries it. */}
                              Why{overriding ? "" : " (optional)"}
                              <input
                                value={open.reason}
                                onChange={(event) => setDraft({ ...open, reason: event.target.value })}
                                placeholder={overriding ? "Hayley's email of the 14th" : ""}
                                className="w-full min-w-[12rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                              />
                            </label>
                          </div>
                          <p className="mt-1 text-xs text-neutral-600">
                            Written to {configurations.map((configuration) => configuration.number).join(", ")}.
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={busy}
                              onClick={() => void save(group)}
                            >
                              {busy ? "Saving…" : `Save on all ${n}`}
                            </Button>
                            <Button variant="quiet" size="sm" onClick={() => setDraft(null)}>
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {differs.length > 0 && (
        <Card
          title="Answered differently"
          actions={<CardHeadingNote>changed on each configuration&rsquo;s own checklist</CardHeadingNote>}
          flush
        >
          <Table>
            <thead>
              <tr>
                <Th className="w-[40%]">Question</Th>
                <Th>What each configuration says</Th>
              </tr>
            </thead>
            <tbody>
              {differs.map((group) => (
                <Tr key={group.requirementId}>
                  <Td>{group.prompt}</Td>
                  <Td>
                    <ul className="space-y-0.5">
                      {group.members.map((member) => (
                        <li key={member.recordId} className="flex items-baseline gap-2">
                          <Link
                            href={`/dashboard/records/${member.recordId}?tab=checklist`}
                            className="font-mono text-xs text-neutral-600 underline hover:text-neutral-900"
                          >
                            {member.number}
                          </Link>
                          {member.answer ? (
                            <Answered value={member.answer.value} state={member.answer.state} />
                          ) : (
                            <span className="text-neutral-400">not asked</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
