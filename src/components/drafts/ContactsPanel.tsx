"use client";

// Who gets chased, and the form to add them.
//
// This lives on the chase screen rather than behind a settings page because of
// the order the work actually happens in: a new project has records with a
// designer code off the BOQ and nobody to send anything to, so the first thing
// the screen has to let you do is say who "LCS" is. Hanging contact creation
// off a draft card would be circular — there are no drafts until there is a
// contact.
//
// The email is OPTIONAL. Modelling "the LCS design team owe us these answers"
// is useful before anyone has dug the address out of Outlook; the missing
// address blocks recording a send, which is the right place for it.
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

          <form onSubmit={add} className="p-3 border-t border-neutral-100">
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
