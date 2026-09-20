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
import Card from "@/components/ui/Card";
import Tip from "@/components/ui/Tip";

type Details = {
  item_description: string;
  area: string | null;
  qty: number | string | null;
  designer: string | null;
  spec_description: string | null;
  internal_notes: string | null;
  /** 0034. Goes INTO the dimension cell, after the figures. */
  dimension_note: string | null;
  version: number;
};

type Form = {
  itemDescription: string;
  area: string;
  qty: string;
  designer: string;
  specDescription: string;
  internalNotes: string;
  dimensionNote: string;
};

const formOf = (record: Details): Form => ({
  itemDescription: record.item_description ?? "",
  area: record.area ?? "",
  qty: record.qty === null || record.qty === undefined ? "" : String(record.qty),
  designer: record.designer ?? "",
  specDescription: record.spec_description ?? "",
  internalNotes: record.internal_notes ?? "",
  dimensionNote: record.dimension_note ?? "",
});

/** One field of the read-only summary. */
function Read({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-4" : ""}>
      <dt className="text-th font-semibold uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-neutral-900">{children}</dd>
    </div>
  );
}

/** A value nobody has set — in words, never an empty cell. */
function Blank({ children = "not set" }: { children?: React.ReactNode }) {
  return <span className="text-neutral-400">{children}</span>;
}

export default function RecordDetails({
  recordId,
  record,
  onSaved,
  classification,
}: {
  recordId: string;
  record: Details;
  onSaved: () => void | Promise<void>;
  /**
   * The CATEGORY and LEVEL selects, rendered inside the Edit state.
   *
   * They are not part of this form and must not be: each is its own decision
   * with its own change-set kind, and `PATCH /api/records/[id]` takes one or
   * the other per request precisely so two changes cannot share one reason.
   * They live in here because the header shows them as facts about the item,
   * and the place you go to change a fact about the item is Edit — otherwise
   * the two selects are a third panel on a screen that already has four tabs.
   */
  classification?: React.ReactNode;
}) {
  const server = useMemo(() => formOf(record), [record]);
  const [form, setForm] = useState<Form>(server);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [editing, setEditing] = useState(false);

  /** Back to exactly what the server holds. */
  const reset = () => setForm(server);

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
            dimensionNote: form.dimensionNote.trim() || null,
          },
          version: record.version,
        }),
      });
      // Reload FIRST and report afterwards. A screen that refreshes after every
      // action clears its banner on a successful load, so setError() followed
      // by a reload showed a 409 for a few milliseconds and then nothing at all.
      // Back to the summary. The panel exists to be filled in and left.
      setEditing(false);
      await onSaved();
      if (!result.ok) setError(result.error);
      else setSaved(result.data.changed ?? []);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="This item"
      actions={
        <>
        {/* FILLED IN ONCE, THEN READ. Six inputs and two paragraphs of help,
            above the tabs, on every visit to every record — so the tabs
            themselves started below the fold. It reads as a summary until
            somebody presses Edit.

            The form is UNCHANGED inside, including the rule that matters most
            about it: it saves as ONE act rather than on blur, because typing
            the quote description, tabbing to Internal notes and typing there
            used to lose the second box — the first blur saved, the screen
            reloaded, and the reload re-keyed every input to what the server
            held. */}
        {!editing && (
          <Button size="xs" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        </>
      }
    >
      {error && <p className="mb-2 text-xs text-red-700 border border-red-200 bg-red-50 rounded px-2 py-1">{error}</p>}

      {!editing && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <Read label="Description">{form.itemDescription || <Blank />}</Read>
          <Read label="Area or room">{form.area || <Blank />}</Read>
          <Read label="Quantity">{form.qty || <Blank />}</Read>
          <Read label="Designer">{form.designer || <Blank />}</Read>
          <Read label="Dimension note" wide>
            {form.dimensionNote ? (
              <span className="font-mono">({form.dimensionNote})</span>
            ) : (
              <Blank>nothing recorded</Blank>
            )}
          </Read>
          <Read label="For the quote" wide>
            {form.specDescription ? (
              <span className="whitespace-pre-line">{form.specDescription}</span>
            ) : (
              <Blank>nothing recorded</Blank>
            )}
          </Read>
          <Read label="Internal notes" wide>
            {form.internalNotes ? (
              <span className="whitespace-pre-line">{form.internalNotes}</span>
            ) : (
              <Blank>nothing recorded — never leaves this app</Blank>
            )}
          </Read>
        </dl>
      )}

      <div className={`space-y-4 ${editing ? "" : "hidden"}`}>
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

        {/* ONE INPUT, ON THIS FORM, saved with everything else in one act.
            It is the thing the five structured slots cannot hold -- Matthew's
            "1250 bracket L-shaped return" -- and it goes INTO the cell rather
            than beside it, which is why the placeholder shows the bracket.
            Never a second box per slot: four slots off three pages could carry
            four qualifiers and the cell would have to pick one. */}
        <label className="block text-xs text-neutral-600">
          Dimension note (in the cell, after the figures)
          <span className="ml-2 font-normal text-neutral-400">
            One line, up to 200 characters. Reaches BWS inside the dimensions cell, in brackets.
          </span>
          <input
            value={form.dimensionNote}
            onChange={set("dimensionNote")}
            disabled={saving}
            maxLength={200}
            placeholder="1250 L-shaped return"
            className="mt-1 block w-full border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>

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
          <span className="flex-1" />
          {/* Puts the form back to what the server holds and closes it — the
              only state the summary can honestly render. `dirty` is what makes
              the difference visible before it goes. */}
          <Button
            size="sm"
            onClick={() => {
              reset();
              setEditing(false);
            }}
          >
            {dirty.length > 0 ? "Discard changes" : "Close"}
          </Button>
        </div>

        {/* CATEGORY AND LEVEL, BELOW THE SAVE AND OUTSIDE IT.
            Each writes on its own, under its own change-set kind, because the
            PATCH route takes one decision per request — so they sit under a
            rule with their own sentence rather than above the Save button,
            where they would read as part of what Save writes. */}
        {classification && (
          <div className="border-t border-neutral-200 pt-3">
            <p className="text-th font-semibold uppercase tracking-wider text-neutral-500">
              What kind of item it is
              <Tip>
                Each of these saves on its own, not with the Save above: the category creates the checklist and the
                level decides which of its questions hold up a quote, so each is recorded as its own change.
              </Tip>
            </p>
            <div className="mt-2">{classification}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
