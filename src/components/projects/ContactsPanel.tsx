"use client";

// Who to ask about this project, and the form to add them.
//
// Mounted on the project overview, which is the canonical home: contacts are
// project data. It was also mounted on the chase screen, as the bootstrap case
// — a new project has records carrying a designer code off the BOQ and nobody
// to send anything to. That screen is hidden for now (see
// src/app/dashboard/drafts/page.tsx); this component is unchanged and has no
// dependency on it, so bringing it back needs no edit here.
//
// The email is OPTIONAL. Modelling "the LCS design team owe us these answers"
// is useful before anyone has dug the address out of Outlook.
//
// CAPSULE IS WHERE THE COMPANY'S PEOPLE LIVE, and searching it fills this form
// from a modelled party rather than a name somebody typed twice. The link is
// FLAGGED WHEN ABSENT, never required: a designer Capsule has never heard of
// still has to be chaseable today, and refusing to record them just moves the
// record into somebody's head. With no token the search says so and the manual
// form keeps working — Capsule is not a runtime dependency of chasing anybody.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { CONTACT_ROLES, type ContactRole } from "@/lib/spec-vocab";

export type Contact = {
  id: string;
  name: string;
  email: string | null;
  organisation: string | null;
  role: ContactRole;
  designerCode: string | null;
  version: number;
  // camelCase like `designerCode` beside it: both callers map the row, and two
  // spellings of one field is how one of them starts rendering every contact
  // as unlinked.
  capsulePartyId?: number | null;
  capsulePartyType?: string | null;
  capsuleSyncedAt?: string | null;
};

type CapsuleParty = {
  id: number;
  type: "person" | "organisation";
  name: string;
  jobTitle: string | null;
  organisation: { id: number; name: string } | null;
  emails: string[];
};

const ROLE_LABELS: Record<ContactRole, string> = {
  designer: "Designer",
  client: "Client",
  internal: "Internal",
};

export default function ContactsPanel({
  projectId,
  contacts,
  suggestedCodes,
  onChanged,
}: {
  projectId: string;
  contacts: Contact[];
  /** Designer codes seen on this project's records that have no contact yet. */
  suggestedCodes: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(contacts.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [role, setRole] = useState<ContactRole>("designer");
  const [designerCode, setDesignerCode] = useState("");

  // Capsule search. `capsuleNotice` carries the 503 wording when there is no
  // token, so the reason is on screen rather than the search silently doing
  // nothing.
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<CapsuleParty[] | null>(null);
  const [capsuleNotice, setCapsuleNotice] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2) return;
    setSearching(true);
    setCapsuleNotice(null);
    setResults(null);
    try {
      const res = await apiFetch<{ parties: CapsuleParty[] }>(
        `/api/capsule/parties?q=${encodeURIComponent(term.trim())}`,
      );
      if (!res.ok) {
        setCapsuleNotice(res.error);
        return;
      }
      setResults(res.data.parties);
      if (res.data.parties.length === 0) {
        setCapsuleNotice("Nobody in Capsule matches that. Add the contact by hand below.");
      }
    } finally {
      // Always reset: an HTML error page must not leave the button spinning.
      setSearching(false);
    }
  }

  function choose(party: CapsuleParty) {
    setPartyId(party.id);
    setName(party.name);
    setOrganisation(party.organisation?.name ?? "");
    setEmail(party.emails[0] ?? "");
    setResults(null);
    setTerm("");
  }

  async function refresh(contact: Contact) {
    setRefreshing(contact.id);
    setError(null);
    try {
      const res = await apiFetch<{ emailNotInCapsule: boolean; capsuleEmails: string[] }>(
        `/api/projects/${projectId}/contacts/${contact.id}/refresh`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: contact.version }),
        },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.emailNotInCapsule) {
        // Reported, never acted on: somebody may have corrected the address
        // here on purpose after a bounce.
        setError(
          `Capsule no longer lists ${contact.email} for ${contact.name}` +
            (res.data.capsuleEmails.length ? ` (it has ${res.data.capsuleEmails.join(", ")})` : "") +
            ". The address here was left as it is — change it yourself if it is wrong.",
        );
      }
      onChanged();
    } finally {
      setRefreshing(null);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/contacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          organisation: organisation.trim() || null,
          role,
          designerCode: designerCode.trim() || null,
          capsulePartyId: partyId,
        }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setEmail("");
      setOrganisation("");
      setDesignerCode("");
      setPartyId(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border border-neutral-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
      >
        {open ? "▾" : "▸"} Contacts ({contacts.length})
        {suggestedCodes.length > 0 && (
          <span className="ml-2 text-xs font-normal text-amber-800">
            {suggestedCodes.join(", ")} {suggestedCodes.length === 1 ? "has" : "have"} no contact
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-neutral-100">
          {contacts.length > 0 && (
            <ul className="divide-y divide-neutral-100">
              {contacts.map((contact) => (
                <li key={contact.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-neutral-900">{contact.name}</span>
                    {contact.organisation && <span className="text-neutral-500"> · {contact.organisation}</span>}
                    <span className="block text-xs text-neutral-500">
                      {contact.email ?? <span className="text-amber-700">no email yet</span>}
                    </span>
                  </span>
                  {contact.capsulePartyId ? (
                    <button
                      type="button"
                      disabled={refreshing === contact.id}
                      onClick={() => void refresh(contact)}
                      title={
                        contact.capsuleSyncedAt
                          ? `Linked to Capsule, read ${new Date(contact.capsuleSyncedAt).toLocaleDateString("en-GB")}. Click to read it again.`
                          : "Linked to Capsule."
                      }
                      className="shrink-0 text-xs px-2 py-0.5 rounded border border-green-300 bg-green-50 text-green-800 hover:bg-green-100 disabled:opacity-50"
                    >
                      {refreshing === contact.id ? "Reading…" : "Capsule"}
                    </button>
                  ) : (
                    <span
                      title="Added by hand. Capsule is where the company keeps its people; linking makes corrections there reach this project."
                      className="shrink-0 text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800"
                    >
                      Not linked
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-neutral-600">{ROLE_LABELS[contact.role]}</span>
                  {contact.designerCode && (
                    <span className="shrink-0 text-xs px-2 py-0.5 rounded border border-neutral-300 bg-neutral-50 text-neutral-700">
                      {contact.designerCode}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="mx-3 mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          {/* Capsule first, because a linked contact is the one worth having.
              The manual form below stays usable either way. */}
          <div className="p-3 border-t border-neutral-100">
            <form onSubmit={search} className="flex flex-wrap items-center gap-2">
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Find in Capsule (name, company or email)"
                className="flex-1 min-w-[16rem] border border-neutral-300 rounded px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={searching || term.trim().length < 2}
                className="text-sm px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
              >
                {searching ? "Searching…" : "Search Capsule"}
              </button>
            </form>

            {capsuleNotice && <p className="mt-2 text-xs text-amber-800">{capsuleNotice}</p>}

            {results && results.length > 0 && (
              <ul className="mt-2 border border-neutral-200 rounded divide-y divide-neutral-100">
                {results.map((party) => (
                  <li key={party.id} className="px-3 py-1.5 flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-neutral-900">{party.name}</span>
                      {party.organisation?.name && (
                        <span className="text-neutral-500"> · {party.organisation.name}</span>
                      )}
                      <span className="block text-xs text-neutral-500">
                        {party.emails.length > 0 ? party.emails.join(", ") : "no email in Capsule"}
                        {party.type === "organisation" && " · an organisation"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => choose(party)}
                      className="shrink-0 text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
                    >
                      Use this one
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={add} className="p-3 border-t border-neutral-100">
            {partyId !== null && (
              <p className="mb-2 text-xs text-green-800">
                Linked to Capsule. The name and organisation come from there and are read again on save.{" "}
                <button
                  type="button"
                  onClick={() => setPartyId(null)}
                  className="underline hover:text-green-900"
                >
                  Add by hand instead
                </button>
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="border border-neutral-300 rounded px-2 py-1 text-sm"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                type="email"
                className="border border-neutral-300 rounded px-2 py-1 text-sm"
              />
              <input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Organisation"
                className="border border-neutral-300 rounded px-2 py-1 text-sm"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ContactRole)}
                className="border border-neutral-300 rounded px-2 py-1 text-sm"
              >
                {CONTACT_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
              <input
                value={designerCode}
                onChange={(e) => setDesignerCode(e.target.value)}
                placeholder="Designer code"
                list="suggested-designer-codes"
                className="border border-neutral-300 rounded px-2 py-1 text-sm"
              />
              <datalist id="suggested-designer-codes">
                {suggestedCodes.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {busy ? "Adding…" : "Add contact"}
              </button>
              <span className="text-xs text-neutral-500">
                The designer code matches the BOQ&rsquo;s own wording (
                {suggestedCodes.length > 0 ? suggestedCodes.join(", ") : "e.g. LCS, TA"}) and is what routes a
                record&rsquo;s questions to this person. Leave it blank for someone chosen by hand.
              </span>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
