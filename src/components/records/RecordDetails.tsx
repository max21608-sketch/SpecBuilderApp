"use client";
// The bill's own words, and the two free-text columns.
//
// ============================================================================
// TWO BOXES, NOT ONE — and the labels have to keep saying which is which.
//
// `spec_description` is quote-facing: it becomes the prose at the top of the
// quote's Specification block, which the client reads. `internal_notes` never
// leaves this app except as the quote CSV's own Internal notes column. The
// real quote example carries both, and one of its internal notes is a previous
// price — which is exactly what must not end up in the client-facing half.
//
// ---- ONE SAVE FOR THE PANEL, NOT SAVE-ON-BLUR -----------------------------
//
// The checklist answers save on blur and should: each is its own decision.
// This panel is not. Found in the browser on 2026-09-17: typing the quote
// description, tabbing to Internal notes and typing there LOST the second
// box — the first blur saved, the screen reloaded, and the reload re-keyed
// every input to what the server held, discarding text somebody was still
// typing. Silent data loss in a form.
//
// It is also wrong in the trail: correcting four fields of one row is ONE act,
// and blur-saving made it four change sets and four versions, each reading
// "Edited item_description".
//
// So: local state, an explicit Save, and the whole patch in one request —
// which `editRecordDetails` already takes and already reports back as
// `changed`. Save is disabled until something differs, so it cannot write a
// no-op either.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";

type Details = {
  item_description: string;
  area: string | null;
  qty: number | string | null;
  designer: string | null;
  spec_description: string | null;
  internal_notes: string | null;
  version: number;
};

type Form = {
  itemDescription: string;
  area: string;
  qty: string;
  designer: string;
  specDescription: string;
  internalNotes: string;
};

const formOf = (record: Details): Form => ({
  itemDescription: record.item_description ?? "",
  area: record.area ?? "",
  qty: record.qty === null || record.qty === undefined ? "" : String(record.qty),
  designer: record.designer ?? "",
  specDescription: record.spec_description ?? "",
  internalNotes: record.internal_notes ?? "",
});

export default function RecordDetails({
  recordId,
  record,
  onSaved,
}: {
  recordId: string;
  record: Details;
  onSaved: () => void | Promise<void>;
}) {
  const server = useMemo(() => formOf(record), [record]);
  const [form, setForm] = useState<Form>(server);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);

  // Re-seed only when the SERVER's copy changes — a reload, or somebody else's
  // edit arriving. Keyed on the version, so a save of this panel resets it and
  // an unrelated reload does not wipe what is being typed.
  useEffect(() => {
    setForm(server);
  }, [server]);

  const set = (key: keyof Form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const dirty = (Object.keys(server) as (keyof Form)[]).filter((key) => form[key].trim() !== server[key].trim());

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const result = await apiFetch<{ changed: string[] }>(`/api/records/${recordId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          details: {
            itemDescription: form.itemDescription.trim(),
            area: form.area.trim() || null,
            // An empty box is "nobody has said", which is a real answer and
            // not zero.
            qty: form.qty.trim() === "" ? null : Number(form.qty),
            designer: form.designer.trim() || null,
            specDescription: form.specDescription.trim() || null,
            internalNotes: form.internalNotes.trim() || null,
          },
          version: record.version,
        }),
      });
      // Reload FIRST and report afterwards. A screen that refreshes after every
      // action clears its banner on a successful load, so setError() followed
      // by a reload showed a 409 for a few milliseconds and then nothing at all.
      await onSaved();
      if (!result.ok) setError(result.error);
      else setSaved(result.data.changed ?? []);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">This item</h2>
      {error && <p className="mt-2 text-xs text-red-700 border border-red-200 bg-red-50 rounded px-2 py-1">{error}</p>}
      <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="text-xs text-neutral-600">
            Description
            <input
              value={form.itemDescription}
              onChange={set("itemDescription")}
              disabled={saving}
              className="mt-1 block w-64 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-xs text-neutral-600">
            Area or room
            <input
              value={form.area}
              onChange={set("area")}
              disabled={saving}
              className="mt-1 block w-48 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-xs text-neutral-600">
            Qty
            <input
              value={form.qty}
              onChange={set("qty")}
              disabled={saving}
              inputMode="numeric"
              placeholder="—"
              className="mt-1 block w-20 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-xs text-neutral-600">
            Designer
            <input
              value={form.designer}
              onChange={set("designer")}
              disabled={saving}
              className="mt-1 block w-40 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
        </div>

        <label className="block text-xs text-neutral-600">
          Description for the quote
          <span className="ml-2 font-normal text-neutral-400">
            Goes to the client, at the top of the quoted specification. Not sent to BWS.
          </span>
          <textarea
            value={form.specDescription}
            onChange={set("specDescription")}
            disabled={saving}
            rows={3}
            placeholder={"Curved sofa with fixed back and seat\nRecessed timber plinth"}
            className="mt-1 block w-full border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>

        <label className="block text-xs text-neutral-600">
          Internal notes
          <span className="ml-2 font-normal text-neutral-400">
            Never leaves this app, and never reaches BWS. Previous prices, who to ask, what is still doubtful.
          </span>
          <textarea
            value={form.internalNotes}
            onChange={set("internalNotes")}
            disabled={saving}
            rows={2}
            className="mt-1 block w-full border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>

        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" disabled={saving || dirty.length === 0} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {dirty.length > 0 && !saving && (
            <span className="text-xs text-amber-800">
              {dirty.length} unsaved change{dirty.length === 1 ? "" : "s"}
            </span>
          )}
          {saved && dirty.length === 0 && (
            <span className="text-xs text-green-700">
              {saved.length === 0 ? "Nothing had changed." : `Saved ${saved.length} field${saved.length === 1 ? "" : "s"}.`}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
