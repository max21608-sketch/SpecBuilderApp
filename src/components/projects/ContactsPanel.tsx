"use client";

// Who to ask about this project, and what each of them owes us.
//
// ============================================================================
// THE REASON YOU OPEN CONTACTS IS TO CHASE SOMEBODY.
//
// It was a collapsed disclosure of name-and-email lines, which answered "who
// is on this project" — a question nobody has. `Owes us` is the column that
// makes it worth looking at, and it is the CHASE SCREEN'S OWN number, computed
// by `loadOutstanding` and `groupByContact` on the project route and handed
// here as data. A second count of the same thing is how two screens come to
// report different figures for one person.
//
// The email is OPTIONAL. Modelling "the LCS design team owe us these answers"
// is useful before anyone has dug the address out of Outlook.
//
// CAPSULE IS WHERE THE COMPANY'S PEOPLE LIVE, and searching it fills the add
// form from a modelled party rather than a name somebody typed twice. The link
// is FLAGGED WHEN ABSENT, never required: a designer Capsule has never heard of
// still has to be chaseable today, and refusing to record them just moves the
// record into somebody's head. With no token the search says so and the manual
// form keeps working — Capsule is not a runtime dependency of chasing anybody.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { CONTACT_ROLES, type ContactRole } from "@/lib/spec-vocab";
import Button, { buttonClass } from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import SuggestButton from "@/components/ui/SuggestButton";
import { Table, Th, Td, Tr } from "@/components/ui/Table";

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

/**
 * What each contact is owed, from the project payload.
 *
 * Three buckets, because two would not add up: `groupByContact` also holds back
 * a record with no LEVEL, which belongs to somebody and still cannot be chased.
 * Folding those into `unassigned` would say nobody owns them.
 */
export type ContactsOutstanding = {
  byContact: { contactId: string; contactName: string; toQuote: number; alsoOutstanding: number; noTier: number }[];
  unassigned: { toQuote: number; alsoOutstanding: number; noTier: number; records: number };
  noLevel: { toQuote: number; alsoOutstanding: number; noTier: number; records: number };
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
  outstanding,
  codeCounts,
  adding,
  onAddingChange,
  onChanged,
}: {
  projectId: string;
  contacts: Contact[];
  /** Designer codes seen on this project's records that have no contact yet. */
  suggestedCodes: string[];
  /** The chase screen's own per-contact counts. Absent until the payload lands. */
  outstanding?: ContactsOutstanding | null;
  /** How many records carry each unclaimed designer code — the suggestion's evidence. */
  codeCounts?: Record<string, number>;
  /** The add form, opened from the card's own heading. */
  adding?: boolean;
  onAddingChange?: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [internalAdding, setInternalAdding] = useState(contacts.length === 0);
  const open = adding ?? internalAdding;
  const setOpen = (value: boolean) => (onAddingChange ? onAddingChange(value) : setInternalAdding(value));

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

  const owed = new Map((outstanding?.byContact ?? []).map((row) => [row.contactId, row]));

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
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const columns = 6;

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th className="w-[24%]">Name</Th>
            <Th className="w-[26%]">Email</Th>
            <Th className="w-[12%]">Designer code</Th>
            <Th className="w-[16%]">Capsule</Th>
            <Th num>Owes us</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {contacts.length === 0 && (
            <tr>
              <Td colSpan={columns} className="text-neutral-600">
                Nobody recorded yet. A record&rsquo;s designer code is what ties its questions to a person, so a
                project with no contacts can hold specs and chase nobody.
              </Td>
            </tr>
          )}
          {contacts.map((contact) => {
            const row = owed.get(contact.id);
            return (
              <Tr key={contact.id}>
                <Td>
                  <span className="font-medium text-neutral-900">{contact.name}</span>
                  <p className="text-xs text-neutral-500">
                    {contact.organisation ? `${contact.organisation} · ` : ""}
                    {ROLE_LABELS[contact.role]}
                  </p>
                </Td>
                <Td>
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="text-blue-700 no-underline hover:underline">
                      {contact.email}
                    </a>
                  ) : (
                    <span className="text-amber-700">no email yet</span>
                  )}
                </Td>
                <Td>
                  {contact.designerCode ? (
                    <Chip mono>{contact.designerCode}</Chip>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </Td>
                <Td>
                  {/* LINKED IS A BUTTON, because pressing it reads Capsule
                      again. Not linked is a CHIP, because it is a state and
                      there is nothing to press. */}
                  {contact.capsulePartyId ? (
                    <Button
                      size="xs"
                      variant="quiet"
                      disabled={refreshing === contact.id}
                      onClick={() => void refresh(contact)}
                      title={
                        contact.capsuleSyncedAt
                          ? `Linked to Capsule, read ${new Date(contact.capsuleSyncedAt).toLocaleDateString("en-GB")}. Press to read it again.`
                          : "Linked to Capsule. Press to read it again."
                      }
                    >
                      {refreshing === contact.id ? "Reading…" : "linked"}
                    </Button>
                  ) : (
                    <Chip
                      tone="warn"
                      title="Added by hand. Capsule is where the company keeps its people; linking makes corrections there reach this project."
                    >
                      not in Capsule
                    </Chip>
                  )}
                </Td>
                <Td num>
                  {/* THE NUMBER THAT SAYS WHY YOU OPENED THIS CARD. Red, and a
                      link to the chase screen — reading it is never the end of
                      the errand. */}
                  {row === undefined ? (
                    <span className="text-neutral-400">—</span>
                  ) : row.toQuote > 0 ? (
                    <>
                      <Link
                        href={`/dashboard/drafts?projectId=${projectId}`}
                        className="font-semibold text-red-700 no-underline hover:underline"
                      >
                        {row.toQuote.toLocaleString()}
                      </Link>
                      <p className="text-xs font-normal text-neutral-500">TGQ</p>
                    </>
                  ) : (
                    <>
                      <span className="text-green-700">0</span>
                      <p className="text-xs font-normal text-neutral-500">TGQ</p>
                    </>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <Link
                      href={`/dashboard/drafts?projectId=${projectId}`}
                      className={buttonClass("secondary", "xs", "no-underline")}
                    >
                      Draft a chase
                    </Link>
                  </div>
                </Td>
              </Tr>
            );
          })}

          {/* A DESIGNER CODE NOBODY CARRIES. The bill names it on n items and
              every one of those items is unchaseable until somebody is it. Its
              own `<tr>`, never a colSpan cell beside the data cells — the
              drawings card paid for that once. */}
          {suggestedCodes.map((code) => (
            <tr key={code}>
              <td colSpan={columns} className="border-b border-neutral-100 bg-[#fcfcfc] px-4 py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Chip tone="info">suggestion</Chip>
                  <span className="text-neutral-700">
                    The BOQ uses the designer code <span className="font-mono">{code}</span> and nobody here carries
                    it.
                  </span>
                  <SuggestButton
                    value={`Add a contact for ${code}`}
                    evidence={
                      codeCounts?.[code]
                        ? `used on ${codeCounts[code]} item${codeCounts[code] === 1 ? "" : "s"} and nobody here carries it`
                        : "used on this project's items and nobody here carries it"
                    }
                    onAccept={() => {
                      setDesignerCode(code);
                      setRole("designer");
                      setOpen(true);
                    }}
                  />
                </span>
              </td>
            </tr>
          ))}

          {/* NOBODY ASSIGNED. Questions on records whose designer resolves to
              no contact — they are owed by somebody, and the table would be
              short of the project's own total without them. */}
          {outstanding && outstanding.unassigned.toQuote > 0 && (
            <tr>
              <td colSpan={columns} className="border-b border-neutral-100 bg-[#fcfcfc] px-4 py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Chip tone="warn">nobody assigned</Chip>
                  <span className="text-neutral-700">
                    <b className="font-semibold text-red-700">{outstanding.unassigned.toQuote.toLocaleString()}</b>{" "}
                    TGQ questions across {outstanding.unassigned.records} record
                    {outstanding.unassigned.records === 1 ? "" : "s"} whose designer code matches nobody above. They
                    cannot be chased until one of them does.
                  </span>
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </Table>

      {error && (
        <Note tone="danger" className="mx-4 mb-4">
          {error}
        </Note>
      )}

      {open && (
        <div className="border-t border-neutral-200 px-4 py-3">
          {/* Capsule first, because a linked contact is the one worth having.
              The manual form below stays usable either way. */}
          <form onSubmit={search} className="flex flex-wrap items-center gap-2">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Find in Capsule (name, company or email)"
              className="min-w-[16rem] flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <Button type="submit" size="sm" disabled={searching || term.trim().length < 2}>
              {searching ? "Searching…" : "Search Capsule"}
            </Button>
          </form>

          {capsuleNotice && <p className="mt-2 text-xs text-amber-800">{capsuleNotice}</p>}

          {results && results.length > 0 && (
            <ul className="mt-2 divide-y divide-neutral-100 rounded border border-neutral-200">
              {results.map((party) => (
                <li key={party.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
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
                  <Button size="xs" onClick={() => choose(party)}>
                    Use this one
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={add} className="mt-3 border-t border-neutral-100 pt-3">
            {partyId !== null && (
              <p className="mb-2 text-xs text-green-800">
                Linked to Capsule. The name and organisation come from there and are read again on save.{" "}
                <button type="button" onClick={() => setPartyId(null)} className="underline hover:text-green-900">
                  Add by hand instead
                </button>
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email (optional)"
                type="email"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <input
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Organisation"
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ContactRole)}
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
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
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <datalist id="suggested-designer-codes">
                {suggestedCodes.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>
                {busy ? "Adding…" : "Add contact"}
              </Button>
              <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <span className="text-xs text-neutral-500">
                The designer code matches the BOQ&rsquo;s own wording (
                {suggestedCodes.length > 0 ? suggestedCodes.join(", ") : "e.g. LCS, TA"}) and is what routes a
                record&rsquo;s questions to this person. Leave it blank for someone chosen by hand.
              </span>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
