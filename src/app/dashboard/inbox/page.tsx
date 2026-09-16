"use client";

// Every email that has reached the app, and where it went.
//
// ============================================================================
// THE UNPLACED LIST IS THE POINT OF THIS SCREEN
//
// An email nobody has placed on a project is the one state in this feature
// that silently stops work: the sender believes they have told us, and nothing
// on any project screen says otherwise. So held messages sort first, are never
// hidden behind a filter, and carry the reason the headers were not enough.
//
// Assigning one is the SPEND POINT — it starts a charged model read — and the
// button says so. Nothing is ever assigned automatically from an ambiguous
// outcome: two projects matching equally well is a decision, not a tie to
// break.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { intakeStatusLabel } from "@/lib/intake-status";

type Message = {
  id: string;
  origin: string;
  mailbox: string;
  fetch_status: string;
  fetch_error: string | null;
  from_addr: string | null;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  has_attachments: boolean;
  routing_status: "assigned" | "ambiguous" | "unassigned";
  routing_reason: string | null;
  routing_candidates: { projectId: string; signal: string; evidence: string }[] | null;
  project_id: string | null;
  bws_project_number: string | null;
  project_name: string | null;
  assignment_kind: string | null;
  intake_run_id: string | null;
  run_status: string | null;
  run_error: string | null;
  pending_count: string | number;
  applied_count: string | number;
  chase_match: string | null;
  triage: string;
  parse_error: string | null;
  version: number;
};

type Project = { id: string; bws_project_number: string; name: string };

type Payload = { messages: Message[]; heldCount: number; projects: Project[] };

export default function InboxPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [includeTriaged, setIncludeTriaged] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/email-messages?includeTriaged=${includeTriaged ? "1" : "0"}`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setData(res.data);
  }, [includeTriaged]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Say what an action returned, AFTER the reload it triggers. */
  const reloadThen = useCallback(
    async (failure: string | null) => {
      await load();
      if (failure) setError(failure);
    },
    [load],
  );

  async function act(message: Message, body: Record<string, unknown>) {
    setBusy(message.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/email-messages/${message.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, version: message.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      // Always reset: an HTML error page must not leave the row disabled.
      setBusy(null);
    }
  }

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading the inbox" />;

  const held = data.messages.filter((m) => m.routing_status !== "assigned");
  const assigned = data.messages.filter((m) => m.routing_status === "assigned");

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Inbox</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Mail forwarded from the project inboxes. An email assigned to a project is read automatically — one charged
        model call each. An unplaced email is never read.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <label className="mt-3 flex items-center gap-1.5 text-sm text-neutral-700">
        <input type="checkbox" checked={includeTriaged} onChange={(e) => setIncludeTriaged(e.target.checked)} />
        Include emails already ruled on
      </label>

      <h2 className="mt-6 text-sm font-semibold text-neutral-800">
        Not on a project {held.length > 0 && <span className="text-amber-800">({held.length})</span>}
      </h2>
      {held.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">Nothing waiting to be placed.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {held.map((message) => (
            <li key={message.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
              <MessageSummary message={message} />
              <p className="mt-1 text-xs text-amber-900">{message.routing_reason}</p>
              {message.routing_candidates && message.routing_candidates.length > 0 && (
                <ul className="mt-1 text-xs text-amber-800 list-disc list-inside">
                  {message.routing_candidates.slice(0, 4).map((candidate, index) => (
                    <li key={index}>{candidate.evidence}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  defaultValue=""
                  disabled={busy === message.id}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    void act(message, { action: "assign", projectId: event.target.value });
                  }}
                  className="border border-amber-400 rounded px-2 py-1 text-sm bg-white disabled:opacity-50"
                >
                  <option value="">Assign and read (one charged call)…</option>
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.bws_project_number} {project.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy === message.id}
                  onClick={() => void act(message, { action: "triage", triage: "not_specification" })}
                  className="text-xs px-2 py-1 rounded border border-amber-400 disabled:opacity-50"
                >
                  Not specification
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-sm font-semibold text-neutral-800">On a project</h2>
      {assigned.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">No email has been placed on a project yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {assigned.map((message) => {
            const pending = Number(message.pending_count ?? 0);
            const applied = Number(message.applied_count ?? 0);
            return (
              <li key={message.id} className="border border-neutral-200 bg-white rounded-lg p-3">
                <MessageSummary message={message} />
                <p className="mt-1 text-xs text-neutral-600">
                  {message.bws_project_number} {message.project_name}
                  {message.assignment_kind === "auto" ? " · placed automatically" : " · placed by hand"}
                  {message.run_status && ` · ${intakeStatusLabel(message.run_status)}`}
                </p>
                {message.run_error && <p className="mt-1 text-xs text-red-700">{message.run_error}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  {message.intake_run_id && (
                    <Link
                      href={`/dashboard/imports/${message.intake_run_id}`}
                      className="text-neutral-900 underline hover:text-neutral-600"
                    >
                      {pending > 0
                        ? `Review ${pending} proposal${pending === 1 ? "" : "s"}`
                        : applied > 0
                          ? `Review complete — ${applied} applied`
                          : "Open the review"}
                    </Link>
                  )}
                  <Link
                    href={`/api/email-messages/${message.id}/mime`}
                    className="text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100 text-neutral-700"
                  >
                    Open in Outlook (.eml)
                  </Link>
                  {applied === 0 && (
                    <button
                      type="button"
                      disabled={busy === message.id}
                      onClick={() => void act(message, { action: "unassign" })}
                      className="text-xs text-neutral-600 underline hover:text-neutral-900 disabled:opacity-50"
                    >
                      Wrong project
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MessageSummary({ message }: { message: Message }) {
  const from = message.from_name
    ? `${message.from_name} <${message.from_addr ?? "unknown"}>`
    : (message.from_addr ?? "unknown sender");
  return (
    <>
      <p className="text-sm font-medium text-neutral-900">{message.subject ?? "(no subject)"}</p>
      <p className="text-xs text-neutral-600">
        {from}
        {message.received_at && ` · ${new Date(message.received_at).toLocaleString("en-GB")}`}
        {message.has_attachments && " · has attachments"}
        {message.chase_match === "confident" && " · reads as a reply to a chase"}
        {message.triage !== "open" && " · ruled on"}
      </p>
      {message.parse_error && (
        <p className="text-xs text-red-700">This message could not be fully parsed: {message.parse_error}</p>
      )}
    </>
  );
}
