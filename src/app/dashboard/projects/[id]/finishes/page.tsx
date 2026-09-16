"use client";

// The project's finishes library.
//
// Sorted by the client's own code, because that is how their schedule is
// organised and how they will ask about it. Each row says what the code means
// and which line items carry it — "if that code changes, it needs to change on
// all of them" is the requirement this page exists for, and the count is the
// first half of the answer.
//
// THE LIBRARY IS THE TRUTH. Editing a finish here changes what every linked
// item's export cell says and recomposes each one's checklist answer. The one
// thing it cannot move is an answer somebody typed — that stays theirs — so
// the result names those items rather than letting them quietly fall behind.
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { FINISH_KINDS, FINISH_KIND_LABELS, type FinishKind } from "@/lib/finishes";
import FinishSwatch from "@/components/finishes/FinishSwatch";
import Button from "@/components/ui/Button";

type UsedOn = { recordId: string; label: string; itemDescription: string; runName: string; attributeLabel: string };
type Finish = {
  id: string; code: string; code_norm: string; kind: FinishKind | null;
  description: string | null; supplier_raw: string | null; reference: string | null; colour: string | null;
  notes: string | null; state: "confirmed" | "tbc"; status: "active" | "retired";
  version: number; retired_at: string | null; retired_by: string | null;
  updated_at: string; updated_by: string | null;
  swatch_attachment_id: string | null;
  used_on: UsedOn[];
};
type Payload = {
  project: { id: string; number: string; name: string };
  finishes: Finish[];
  unlinked: { code: string; records: number }[];
};

type Draft = {
  code: string; kind: string; description: string; supplierRaw: string;
  reference: string; colour: string; notes: string; state: "confirmed" | "tbc"; reason: string;
};

const draftOf = (finish: Finish): Draft => ({
  code: finish.code,
  kind: finish.kind ?? "",
  description: finish.description ?? "",
  supplierRaw: finish.supplier_raw ?? "",
  reference: finish.reference ?? "",
  colour: finish.colour ?? "",
  notes: finish.notes ?? "",
  state: finish.state,
  reason: "",
});

export default function FinishesPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/projects/${id}/finishes`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Reload first, report afterwards — a reload clears the banner. */
  async function reloadThen(message: string | null, ok: boolean) {
    await load();
    if (!ok) setError(message);
    else {
      setError(null);
      setNote(message);
    }
  }

  async function save(finish: Finish) {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ recordsTouched: number; recordsWithManualAnswers: { label: string }[] }>(
        `/api/projects/${id}/finishes/${finish.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: finish.version,
            reason: draft.reason || undefined,
            code: draft.code,
            kind: draft.kind ? (draft.kind as FinishKind) : null,
            description: draft.description || null,
            supplierRaw: draft.supplierRaw || null,
            reference: draft.reference || null,
            colour: draft.colour || null,
            notes: draft.notes || null,
            state: draft.state,
          }),
        },
      );
      if (!res.ok) {
        await reloadThen(res.error, false);
        return;
      }
      const stuck = res.data.recordsWithManualAnswers ?? [];
      await reloadThen(
        `Updated on ${res.data.recordsTouched} item${res.data.recordsTouched === 1 ? "" : "s"}.` +
          (stuck.length > 0
            ? ` ${stuck.length} of them (${stuck.map((row) => row.label).join(", ")}) has a value somebody typed by hand, so it did not follow — change it there if it should.`
            : ""),
        true,
      );
      setEditing(null);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newCode.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/finishes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: newCode.trim() }),
      });
      await reloadThen(res.ok ? `Added ${newCode.trim()}.` : res.error, res.ok);
      if (res.ok) setNewCode("");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading finishes" />;

  const active = data.finishes.filter((finish) => finish.status === "active");
  const retired = data.finishes.filter((finish) => finish.status === "retired");

  return (
    <div>
      <Link href={`/dashboard/projects/${id}`} className="text-sm text-neutral-500 hover:text-neutral-900">
        ← {data.project.number} {data.project.name}
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-neutral-900">Finishes</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Every finish code this project&rsquo;s documents carry, and the items that use it. Correcting one here corrects
        it on every linked item at once — which is the only way to correct one, because a client finish code exists
        nowhere but on their drawings.
      </p>

      {error && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
      {note && <p className="mt-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{note}</p>}

      {data.unlinked.length > 0 && (
        <div className="mt-3 border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm">
          <p className="text-amber-900">
            {data.unlinked.length} code{data.unlinked.length === 1 ? "" : "s"} on the drawings {data.unlinked.length === 1 ? "is" : "are"} not
            in the library yet, so correcting {data.unlinked.length === 1 ? "it" : "them"} once is not possible:
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {data.unlinked.map((row) => `${row.code} (${row.records} item${row.records === 1 ? "" : "s"})`).join(" · ")}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Run <code className="font-mono">npm run db:backfill-finishes -- --apply</code> to bring them in.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={newCode}
          onChange={(event) => setNewCode(event.target.value)}
          placeholder="CH-01.1"
          className="border border-neutral-300 rounded px-2 py-1"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!newCode.trim() || busy}
          className="border border-neutral-300 rounded px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
        >
          Add a finish
        </button>
      </div>

      {active.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-600">
          No finishes yet. They arrive when a drawing naming a finish code is confirmed, or you can add one above.
        </p>
      ) : (
        <ul className="mt-4 border border-neutral-200 rounded-lg divide-y divide-neutral-200 bg-white">
          {active.map((finish) => (
            <li key={finish.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <FinishSwatch finishId={finish.id} hasSwatch={Boolean(finish.swatch_attachment_id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-sm font-medium text-neutral-900">{finish.code}</span>
                    {finish.kind && <span className="text-xs text-neutral-500">{FINISH_KIND_LABELS[finish.kind]}</span>}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border ${
                        finish.state === "confirmed"
                          ? "text-green-700 border-green-300 bg-green-50"
                          : "text-amber-800 border-amber-300 bg-amber-50"
                      }`}
                    >
                      {finish.state === "confirmed" ? "Confirmed" : "TBC"}
                    </span>
                    <Button size="xs" variant="quiet" onClick={() => setExpanded(expanded === finish.id ? null : finish.id)}>
                      used on {finish.used_on.length} item{finish.used_on.length === 1 ? "" : "s"}
                    </Button>
                    <Button
                      size="xs"
                      className="ml-auto"
                      onClick={() => {
                        setEditing(editing === finish.id ? null : finish.id);
                        setDraft(draftOf(finish));
                      }}
                    >
                      {editing === finish.id ? "Cancel" : "Edit"}
                    </Button>
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-700">
                    {finish.description ?? <span className="text-neutral-400">Nothing recorded yet</span>}
                    {finish.supplier_raw && <span className="text-neutral-500"> · {finish.supplier_raw}</span>}
                    {finish.reference && <span className="text-neutral-500"> · {finish.reference}</span>}
                    {finish.colour && <span className="text-neutral-500"> · {finish.colour}</span>}
                  </p>
                  {finish.notes && <p className="mt-0.5 text-xs text-neutral-500">{finish.notes}</p>}
                </div>
              </div>

              {expanded === finish.id && (
                <ul className="mt-2 ml-1 border-l-2 border-neutral-200 pl-3 space-y-0.5">
                  {finish.used_on.length === 0 ? (
                    <li className="text-xs text-neutral-500">
                      Nothing uses this yet. It can be retired without affecting any item.
                    </li>
                  ) : (
                    finish.used_on.map((use) => (
                      <li key={`${use.recordId}:${use.attributeLabel}`} className="text-xs">
                        <Link href={`/dashboard/records/${use.recordId}`} className="text-neutral-700 underline hover:text-neutral-900">
                          <span className="font-mono">{use.label}</span> {use.itemDescription}
                        </Link>
                        <span className="text-neutral-400"> · {use.runName} · as {use.attributeLabel}</span>
                      </li>
                    ))
                  )}
                </ul>
              )}

              {editing === finish.id && draft && (
                <div className="mt-3 border border-neutral-300 rounded-lg bg-neutral-50 px-3 py-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <label className="text-neutral-600">
                      Code
                      <input
                        value={draft.code}
                        onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white font-mono"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Kind
                      <select
                        value={draft.kind}
                        onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      >
                        <option value="">— not said —</option>
                        {FINISH_KINDS.map((kind) => (
                          <option key={kind} value={kind}>{FINISH_KIND_LABELS[kind]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-neutral-600 sm:col-span-2">
                      What it is
                      <input
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        placeholder="Yarn Collective Tessarae"
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Supplier (as written)
                      <input
                        value={draft.supplierRaw}
                        onChange={(event) => setDraft({ ...draft, supplierRaw: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Reference
                      <input
                        value={draft.reference}
                        onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
                        placeholder="YC04158 - 01"
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      Colourway
                      <input
                        value={draft.colour}
                        onChange={(event) => setDraft({ ...draft, colour: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600">
                      State
                      <select
                        value={draft.state}
                        onChange={(event) => setDraft({ ...draft, state: event.target.value as "confirmed" | "tbc" })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      >
                        <option value="tbc">TBC — not decided</option>
                        <option value="confirmed">Confirmed</option>
                      </select>
                    </label>
                    <label className="text-neutral-600 sm:col-span-2">
                      Notes
                      <input
                        value={draft.notes}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                    <label className="text-neutral-600 sm:col-span-2">
                      Why is this changing?
                      <input
                        value={draft.reason}
                        onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                        placeholder={
                          finish.state === "confirmed"
                            ? "Required — this finish is confirmed and is on live items"
                            : "Optional while the finish is still TBC"
                        }
                        className="mt-0.5 w-full border border-neutral-300 rounded px-2 py-1 bg-white"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Saving changes what all {finish.used_on.length} linked item{finish.used_on.length === 1 ? "" : "s"} show
                    and export. An answer somebody typed by hand stays theirs and will be named.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void save(finish)}
                      disabled={busy}
                      className="border border-neutral-300 rounded px-3 py-1 text-sm bg-white hover:bg-neutral-100 disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <FinishSwatch.Upload finishId={finish.id} projectId={id} onDone={() => void load()} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {retired.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Retired</h2>
          <ul className="mt-1 text-sm text-neutral-500">
            {retired.map((finish) => (
              <li key={finish.id} className="font-mono">
                {finish.code}
                {finish.retired_by && <span className="font-sans"> · retired by {finish.retired_by}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
