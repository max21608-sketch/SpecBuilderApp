"use client";
// Typing one spec value onto an item.
//
// ============================================================================
// ONLY OFFER A GROUP THE ROW CAN BE GIVEN.
//
// The drawings review learned this the hard way: a dropdown listing all six
// groups, where the route refused every one of them, appeared to do nothing —
// twenty-four times on one card. So the SLOT and the UNIT appear only when the
// group is `dimension`, and the BWS field picker disappears when it is, because
// a dimension reaches field 3 through its slot and never through a field id.
//
// `record_attributes` is requirement-free on purpose: a statement the checklist
// has no question for is still worth recording against the item. This is the
// only way to record one that no document said.
// ============================================================================
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import { ATTRIBUTE_GROUPS, ATTRIBUTE_GROUP_LABELS, ATTRIBUTE_UNITS, DIMENSION_SLOTS } from "@/lib/spec-vocab";

type SpecField = { id: string; name: string; json_id: number };

export default function AddSpec({
  recordId,
  specFields,
  onAdded,
  open: controlledOpen,
  onOpenChange,
}: {
  recordId: string;
  specFields: SpecField[];
  onAdded: () => void | Promise<void>;
  /**
   * CONTROLLED WHEN GIVEN, and then this component renders NO trigger of its
   * own. The record screen's "Add a spec by hand" is a page-level action and
   * lives in the header band with the rest of them; the form it opens belongs
   * beside the specs it is adding to. Two buttons for one action is how a
   * reader comes to believe they do different things.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    attrGroup: "note" as (typeof ATTRIBUTE_GROUPS)[number],
    label: "",
    value: "",
    qualifier: "",
    unit: "",
    dimensionSlot: "",
    specFieldId: "",
    materialCode: "",
    state: "confirmed" as "confirmed" | "tbc",
  });

  const isDimension = form.attrGroup === "dimension";

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch("/api/attributes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordId,
          attrGroup: form.attrGroup,
          label: form.label.trim(),
          value: form.value.trim() || null,
          qualifier: form.qualifier.trim() || null,
          unit: isDimension && form.unit ? form.unit : null,
          dimensionSlot: isDimension && form.dimensionSlot ? form.dimensionSlot : null,
          specFieldId: !isDimension && form.specFieldId ? form.specFieldId : null,
          materialCode: form.materialCode.trim() || null,
          state: form.state,
        }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm({ ...form, label: "", value: "", qualifier: "", materialCode: "", dimensionSlot: "" });
      setOpen(false);
      await onAdded();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    if (controlled) return null;
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add a spec by hand
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-neutral-600">
          Group
          <select
            value={form.attrGroup}
            onChange={(e) =>
              setForm({ ...form, attrGroup: e.target.value as typeof form.attrGroup, dimensionSlot: "", unit: "", specFieldId: "" })
            }
            className="mt-1 block w-32 border border-neutral-300 rounded px-2 py-1 text-sm"
          >
            {ATTRIBUTE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {ATTRIBUTE_GROUP_LABELS[group]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-600">
          Label
          <input
            autoFocus
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder={isDimension ? "Width" : "COM 1"}
            className="mt-1 block w-40 border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-neutral-600">
          Value
          <input
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder={isDimension ? "1900" : "Pierre Frey Teddy Mohair F2500017"}
            className="mt-1 block w-72 border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        </label>

        {/* THE RETURN LINE. Matthew: "the top line as the spec and the return
            line as the qualifier" — COM 1 is the fabric, and "Main body & self
            pipe" is where it goes. Not offered on a dimension: a figure has a
            slot, not a placement. */}
        {!isDimension && (
          <label className="text-xs text-neutral-600">
            Where on the item
            <input
              value={form.qualifier}
              onChange={(e) => setForm({ ...form, qualifier: e.target.value })}
              placeholder="Main body &amp; self pipe"
              className="mt-1 block w-52 border border-neutral-300 rounded px-2 py-1 text-sm"
            />
          </label>
        )}

        {isDimension ? (
          <>
            <label className="text-xs text-neutral-600">
              Slot
              <select
                value={form.dimensionSlot}
                onChange={(e) => setForm({ ...form, dimensionSlot: e.target.value })}
                className="mt-1 block w-20 border border-neutral-300 rounded px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {DIMENSION_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-600">
              Unit
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="mt-1 block w-20 border border-neutral-300 rounded px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {ATTRIBUTE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="text-xs text-neutral-600">
            BWS field
            <select
              value={form.specFieldId}
              onChange={(e) => setForm({ ...form, specFieldId: e.target.value })}
              className="mt-1 block w-56 border border-neutral-300 rounded px-2 py-1 text-sm"
            >
              <option value="">— no BWS field —</option>
              {specFields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name.trim()} ({field.json_id})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="text-xs text-neutral-600">
          State
          <select
            value={form.state}
            onChange={(e) => setForm({ ...form, state: e.target.value as "confirmed" | "tbc" })}
            className="mt-1 block w-28 border border-neutral-300 rounded px-2 py-1 text-sm"
          >
            <option value="confirmed">Stated</option>
            <option value="tbc">TBC</option>
          </select>
        </label>

        <Button variant="primary" size="sm" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Add"}
        </Button>
        <Button variant="quiet" size="sm" disabled={saving} onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-neutral-500">
        No document and no page: this is what you say, not what a drawing said. It fills the checklist answer its field
        answers, exactly as confirming a drawing card does.
      </p>
    </div>
  );
}
