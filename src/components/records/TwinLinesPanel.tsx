"use client";

// The Twin lines card on a record's Specs tab (0060): the lines this one is
// linked to as ONE item, and the way to link another or unlink one.
//
// A twin is a link, never a merge. Each line keeps its own quantity, area,
// export row and specs; the link only makes Add a spec, Edit value and
// Retire OFFER the act on the twin too, ticked, shown record by record. So
// the card says what a link does in one sentence, and linking or unlinking
// asks why: it is a statement about what the bill meant.
//
// Its own state, unlike the configurations card: a half-typed reason here is
// lost on a tab change, and the cost of retyping one sentence is lower than a
// page-level hook per sidebar card.
import { useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import type { TwinLink } from "@/lib/record-twins";
import type { SpecRecord } from "@/components/records/record-payload";

type Candidate = {
  recordId: string;
  label: string;
  itemDescription: string;
  area: string | null;
  runName: string;
  boqCodes: string[];
};

function nameOf(entry: { boqCodes: string[]; label: string }): string {
  return entry.boqCodes[0] ?? entry.label;
}

export default function TwinLinesPanel({
  record,
  twins,
  reloadThen,
}: {
  record: Pick<SpecRecord, "id" | "parent_id">;
  twins: readonly TwinLink[];
  /** The page's reload, which reports a refusal after it. */
  reloadThen: (message: string | null) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string>("");
  const [reason, setReason] = useState("");
  const [unlinking, setUnlinking] = useState<TwinLink | null>(null);
  const [unlinkReason, setUnlinkReason] = useState("");
  const [busy, setBusy] = useState(false);

  const configuration = record.parent_id !== null;

  async function openPicker() {
    setPicking(true);
    setLoadError(null);
    const res = await apiFetch<{ candidates: Candidate[] }>(`/api/records/${encodeURIComponent(record.id)}/twins`);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setCandidates(res.data.candidates ?? []);
  }

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = candidates ?? [];
    if (!needle) return list.slice(0, 50);
    return list
      .filter((candidate) =>
        [candidate.label, candidate.itemDescription, candidate.area ?? "", ...candidate.boqCodes].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
      .slice(0, 50);
  }, [candidates, search]);

  async function link() {
    if (!chosen || !reason.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/records/${encodeURIComponent(record.id)}/twins`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ otherId: chosen, reason: reason.trim() }),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) {
        setPicking(false);
        setChosen("");
        setReason("");
        setSearch("");
        setCandidates(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!unlinking || !unlinkReason.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/twins/${encodeURIComponent(unlinking.twinId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "retired", version: unlinking.version, reason: unlinkReason.trim() }),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) {
        setUnlinking(null);
        setUnlinkReason("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Twin lines">
      {twins.length === 0 ? (
        <p className="text-[12.5px] text-neutral-500">
          {configuration
            ? "Its bill line has no twins."
            : "This line is the only one of its item. If the bill lists the same item again (another suite, another phase), link it here."}
        </p>
      ) : (
        <>
          <p className="text-[12.5px] text-neutral-700">
            {configuration ? "Its bill line is" : "This line is"} one item on {twins.length + 1} lines. A spec added,
            edited or retired here is offered to {twins.length === 1 ? "its twin" : "each twin"}, ticked.
          </p>
          <ul className="mt-2 space-y-1.5">
            {twins.map((twin) => (
              <li key={twin.twinId} className="text-[12.5px]">
                <Link href={`/dashboard/records/${twin.recordId}`} className="font-mono text-blue-700 no-underline hover:underline">
                  {nameOf(twin)}
                </Link>{" "}
                <span className="text-neutral-500">
                  {[twin.area, twin.runName, twin.qty !== null ? `qty ${twin.qty}` : null].filter(Boolean).join(" · ")}
                </span>
                {!configuration && unlinking?.twinId !== twin.twinId && (
                  <Button
                    variant="quiet"
                    size="xs"
                    className="ml-1 px-1 py-0 text-[11px]"
                    onClick={() => {
                      setUnlinking(twin);
                      setUnlinkReason("");
                    }}
                  >
                    Unlink
                  </Button>
                )}
                {unlinking?.twinId === twin.twinId && (
                  <span className="mt-1 block">
                    <input
                      value={unlinkReason}
                      autoFocus
                      onChange={(event) => setUnlinkReason(event.target.value)}
                      placeholder="Different stools after all"
                      aria-label={`Why ${nameOf(twin)} is not a twin`}
                      className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                    />
                    <span className="mt-1 flex gap-2">
                      <Button variant="danger" size="xs" disabled={busy || !unlinkReason.trim()} onClick={() => void unlink()}>
                        Unlink
                      </Button>
                      <Button variant="quiet" size="xs" onClick={() => setUnlinking(null)}>
                        Keep
                      </Button>
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {!configuration && !picking && (
        <Button variant="secondary" size="xs" className="mt-3" onClick={() => void openPicker()}>
          Link a twin line
        </Button>
      )}
      {picking && (
        <div className="mt-3 space-y-2">
          {loadError && <p className="text-xs text-red-700">{loadError}</p>}
          {candidates === null && !loadError ? (
            <p className="text-xs text-neutral-500">Loading the project&rsquo;s lines…</p>
          ) : (
            <>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by ref or description"
                aria-label="Search the project's lines"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
              />
              <select
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                aria-label="The line this one is a twin of"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                <option value="">— choose a line —</option>
                {shown.map((candidate) => (
                  <option key={candidate.recordId} value={candidate.recordId}>
                    {`${nameOf(candidate)} · ${candidate.itemDescription}${candidate.area ? ` · ${candidate.area}` : ""} · ${candidate.runName}`}
                  </option>
                ))}
              </select>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Same stool, Guest Suites and Ambassador Suite"
                aria-label="Why these lines are one item"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
              />
              <span className="flex gap-2">
                <Button variant="primary" size="xs" disabled={busy || !chosen || !reason.trim()} onClick={() => void link()}>
                  Link
                </Button>
                <Button variant="quiet" size="xs" onClick={() => setPicking(false)}>
                  Cancel
                </Button>
              </span>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
