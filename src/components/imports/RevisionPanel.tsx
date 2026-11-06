"use client";

// What a revised bill does to the phase it revises: the summary note over the
// table and each line's "Against the phase" cell. Moved out of
// src/app/dashboard/imports/[id]/page.tsx on 2026-11-06 (audit 5.3, cut A).
//
// Both read the reconciliation the review GET computes on every load, so a
// record retired or paired since the page loaded shows as it is now. Neither
// decides a pairing: each control writes what the reviewer chose through the
// staged line's PATCH, and the confirm writes only what is stored.
import Button from "@/components/ui/Button";
import Note from "@/components/ui/Note";
import SuggestButton from "@/components/ui/SuggestButton";
import { configurationRange, type LinePairing } from "@/lib/boq-reconcile";
import type { Line, Reconciliation } from "@/components/imports/use-boq-import";

/** "and its 5 configurations (12.1–12.5)" — what a line takes with it. */
function configurationsClause(labels: readonly string[] | undefined): string {
  if (!labels || labels.length === 0) return "";
  return ` and its ${labels.length === 1 ? "configuration" : `${labels.length} configurations`} (${configurationRange(labels)})`;
}

/** The suggested pairings the summary's one press stores, each at the version shown. */
type SuggestedPairing = { index: number; recordId: string; recordVersion: number };

/** The summary over a revising tab's table: counts, what is suggested, and what will be retired. */
export default function RevisionPanel({
  reconciliation,
  status,
  busy,
  onAcceptPairings,
}: {
  reconciliation: Reconciliation;
  /** The bill's run status: only a `parsed` bill offers to pair. */
  status: string;
  busy: boolean;
  onAcceptPairings: (pairs: SuggestedPairing[]) => Promise<void>;
}) {
  return (
    <Note
      tone="info"
      title={`${reconciliation.counts.changed} changed`}
      className="mt-4"
    >
      · {reconciliation.counts.paired - reconciliation.counts.changed} unchanged ·{" "}
      {reconciliation.counts.new} new · {reconciliation.counts.missing} no longer listed
      {(reconciliation.counts.restored ?? 0) > 0 && <> · {reconciliation.counts.restored} brought back</>}
      {reconciliation.counts.ambiguous > 0 && (
        <> · <b>{reconciliation.counts.ambiguous} to pair by hand</b></>
      )}
      {/* A SUGGESTION IS NOT A PAIRING until it is accepted: the
          confirm writes only what is stored, so an unaccepted one
          confirms as a new item and retires its record. */}
      {(reconciliation.counts.suggested ?? 0) > 0 && status === "parsed" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <SuggestButton
            size="sm"
            value={`Pair the ${reconciliation.counts.suggested} suggested`}
            evidence="each line's code is on exactly one item of the phase"
            disabled={busy}
            onAccept={() =>
              void onAcceptPairings(
                reconciliation.lines.flatMap((entry) => {
                  if (entry.status !== "paired" || entry.accepted !== false || !entry.suggestedRecordId) return [];
                  const record = reconciliation.records.find((row) => row.id === entry.suggestedRecordId);
                  return record ? [{ index: entry.index, recordId: record.id, recordVersion: record.version }] : [];
                }),
              )
            }
          />
          <span className="text-amber-800">Until they are paired, those lines confirm as new items.</span>
        </div>
      )}
      <p className="mt-0.5">
        Items carried forward keep their record — and with it their drawings, their specs, their picture
        and their answers. Only the bill&rsquo;s own columns are written over.
      </p>
      {reconciliation.missing.some((missing) => missing.suggestedFor === undefined) && (
        <>
          <p className="mt-1.5 font-semibold">Not in this revision — these will be retired, not deleted:</p>
          <ul className="mt-1 space-y-0.5">
            {reconciliation.missing.filter((missing) => missing.suggestedFor === undefined).map((missing) => (
              <li key={missing.recordId}>
                <span className="font-mono">{missing.label}</span> {missing.itemDescription}
                {missing.codes.length > 0 && <span> · {missing.codes.join(", ")}</span>}
                {/* A configuration follows its line (C1): retired
                    with it here, in the same change. */}
                {(missing.configurations?.length ?? 0) > 0 && (
                  <span>{configurationsClause(missing.configurations)}</span>
                )}
                {/* Named, not counted. A record with 14 specs and a
                    picture is somebody's afternoon, and pairing it
                    is usually what was meant. */}
                {(missing.attributeCount > 0 || missing.hasImage || missing.settledAnswers > 0) && (
                  <span className="text-amber-800">
                    {" — carries "}
                    {[
                      missing.attributeCount > 0
                        ? `${missing.attributeCount} spec${missing.attributeCount === 1 ? "" : "s"}`
                        : null,
                      missing.settledAnswers > 0
                        ? `${missing.settledAnswers} answer${missing.settledAnswers === 1 ? "" : "s"}`
                        : null,
                      missing.hasImage ? "a picture" : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Pair it with a line above, or it stops being live.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Note>
  );
}

/** One line's "Against the phase" cell. */
export function PairingCell({
  line,
  pairing,
  reconciliation,
  status,
  busy,
  onSet,
}: {
  line: Pick<Line, "ignored" | "replaces">;
  /** The reconciliation's entry for this line, or null where it has none. */
  pairing: Reconciliation["lines"][number] | null;
  reconciliation: Reconciliation;
  status: string;
  busy: boolean;
  /** Stores the reviewer's pairing on the staged line, or takes it back with null. */
  onSet: (patch: { replaces: LinePairing | null }) => Promise<void>;
}) {
  if (!pairing || line.ignored) return <span className="text-neutral-400">—</span>;
  const retiredById = new Map((reconciliation.retired ?? []).map((row) => [row.id, row]));
  // A LINE AN EARLIER REVISION RETIRED, BROUGHT BACK (C14).
  // Only ever the reviewer's choice; one press undoes it.
  if (pairing.status === "restore") {
    const back = retiredById.get(pairing.suggestedRecordId ?? "");
    return (
      <div className="text-xs">
        <p>
          Brings back <span className="font-mono">{back?.label ?? "a retired record"}</span>
          {configurationsClause(back?.configurations)}, with its specs and picture.
        </p>
        {pairing.deltas.length > 0 && (
          <ul className="mt-0.5 text-neutral-600">
            {pairing.deltas.map((delta) => (
              <li key={delta.field}>
                {delta.label}:{" "}
                <span className="text-neutral-400 line-through">{delta.was ?? "—"}</span>{" "}
                → <span className="text-neutral-900">{delta.now ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="quiet"
          className="mt-1"
          disabled={status !== "parsed" || busy}
          onClick={() => void onSet({ replaces: null })}
        >
          Make it a new item instead
        </Button>
      </div>
    );
  }
  const pairedRecord = reconciliation.records.find(
    (row) => row.id === (line.replaces?.recordId ?? pairing.suggestedRecordId),
  );
  return (
    <div>
      <select
        // THE STORED DECISION ONLY. A select
        // showing the suggestion as chosen
        // fires no change when somebody agrees
        // with it, and the confirm then wrote
        // the line as new (found 2026-11-06).
        value={line.replaces?.recordId ?? ""}
        disabled={status !== "parsed" || busy}
        onChange={(event) => {
          const recordId = event.target.value;
          const record = reconciliation.records.find((row) => row.id === recordId);
          void onSet({
            // The VERSION the reviewer is
            // looking at travels with the
            // pairing, so a record edited since
            // refuses the confirm rather than
            // being quietly overwritten.
            replaces: record
              ? { recordId: record.id, recordVersion: record.version }
              : null,
          });
        }}
        className={`max-w-[13rem] rounded border px-2 py-1 text-xs disabled:opacity-50 ${
          pairing.status === "ambiguous" && !line.replaces
            ? "border-amber-400 bg-amber-50"
            : "border-neutral-300"
        }`}
      >
        <option value="">new item</option>
        {reconciliation.records.map((record) => (
          <option key={record.id} value={record.id}>
            {record.label} · {record.itemDescription.slice(0, 32)}
          </option>
        ))}
      </select>
      {pairing.status === "paired" && !line.replaces && pairedRecord && (
        <SuggestButton
          className="mt-1"
          value={`Pair with ${pairedRecord.label}`}
          evidence="the same code, on one item of the phase"
          disabled={status !== "parsed" || busy}
          onAccept={() =>
            void onSet({
              replaces: { recordId: pairedRecord.id, recordVersion: pairedRecord.version },
            })
          }
        />
      )}
      {pairing.status === "ambiguous" && !line.replaces && (
        <p className="mt-0.5 text-xs text-amber-800">
          This code is on {pairing.candidates.length} records. Choose which one, or
          leave it as a new item.
        </p>
      )}
      {pairing.deltas.length > 0 && (
        <ul className="mt-0.5 text-xs text-neutral-600">
          {pairing.deltas.map((delta) => (
            <li key={delta.field}>
              {delta.label}:{" "}
              <span className="text-neutral-400 line-through">{delta.was ?? "—"}</span>{" "}
              → <span className="text-neutral-900">{delta.now ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
      {pairing.status === "paired" && pairing.deltas.length === 0 && (
        <p className="mt-0.5 text-xs text-neutral-500">unchanged</p>
      )}
      {/* ITS CONFIGURATIONS FOLLOW IT (C1): carried with it, never
          a line of their own to pair. */}
      {pairing.status === "paired" && (pairedRecord?.configurations?.length ?? 0) > 0 && (
        <p className="mt-0.5 text-xs text-neutral-600">
          {configurationRange(pairedRecord?.configurations ?? [])}{" "}
          {line.replaces ? "follow it" : "follow it once it is paired"}
        </p>
      )}
      {/* A RETIRED LINE WITH THIS CODE, OFFERED BACK (C14) —
          never chosen for the reviewer, however many. */}
      {pairing.status === "new" &&
        (pairing.restoreCandidates ?? []).map((candidateId) => {
          const candidate = retiredById.get(candidateId);
          if (!candidate) return null;
          return (
            <SuggestButton
              key={candidateId}
              className="mt-1"
              value={`Bring back ${candidate.label}`}
              evidence={`retired by an earlier revision, same code${configurationsClause(candidate.configurations)}`}
              disabled={status !== "parsed" || busy}
              onAccept={() =>
                void onSet({
                  replaces: { recordId: candidate.id, recordVersion: candidate.version, restore: true },
                })
              }
            />
          );
        })}
    </div>
  );
}
