"use client";
// Adding one item to a run by hand.
//
// The counterpart to a BOQ confirm, for the projects that do not start with a
// spreadsheet — which Matthew says is most of the ones coming into TG0 now.
// Deliberately small: a description is the only required field, because the
// alternative to typing one item is not typing a better one, it is not
// recording the item at all.
//
// The category is offered here rather than left for later because setting one
// is what creates the checklist rows; an item added without it shows no
// questions, which reads as an item with nothing outstanding.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";

type Category = { id: string; family: string; name: string };

export default function AddItem({
  projectId,
  runId,
  categories,
  onAdded,
}: {
  projectId: string;
  runId: string;
  categories: Category[];
  onAdded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ itemDescription: "", clientRef: "", area: "", qty: "", categoryId: "" });

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit() {
    const description = form.itemDescription.trim();
    if (!description) {
      setError("An item needs a description.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch("/api/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          runId,
          itemDescription: description,
          clientRef: form.clientRef.trim() || null,
          area: form.area.trim() || null,
          // An empty box is "the bill did not say", which is a real answer and
          // not zero. `unallocatedQty` does not clamp a negative for the same
          // reason: a quantity nobody has stated must not read as one.
          qty: form.qty.trim() === "" ? null : Number(form.qty),
          categoryId: form.categoryId || null,
        }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setForm({ itemDescription: "", clientRef: "", area: "", qty: "", categoryId: "" });
      setOpen(false);
      await onAdded();
    } finally {
      // In a `finally`, so an HTML error page or a dropped connection cannot
      // leave the form disabled with no way back.
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add an item
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-neutral-600">
          Item
          <input
            autoFocus
            value={form.itemDescription}
            onChange={set("itemDescription")}
            placeholder="Armchair"
            className="mt-1 block w-56 border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-neutral-600">
          Client ref
          <input
            value={form.clientRef}
            onChange={set("clientRef")}
            placeholder="S-201"
            className="mt-1 block w-28 border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-neutral-600">
          Area
          <input
            value={form.area}
            onChange={set("area")}
            placeholder="Guest room"
            className="mt-1 block w-32 border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-neutral-600">
          Qty
          <input
            value={form.qty}
            onChange={set("qty")}
            inputMode="numeric"
            placeholder="—"
            className="mt-1 block w-16 border border-neutral-300 rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-neutral-600">
          Category
          <select
            value={form.categoryId}
            onChange={set("categoryId")}
            className="mt-1 block w-52 border border-neutral-300 rounded px-2 py-1 text-sm"
          >
            <option value="">— set it later —</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.family === "upholstery" ? "Uph" : "Cab"} · {category.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void submit()}>
          {saving ? "Adding…" : "Add"}
        </Button>
        <Button variant="quiet" size="sm" disabled={saving} onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-neutral-500">
        A hand-typed item carries no document and no page, which is the truth about it. Its level is guessed from the
        description and stays a suggestion until you agree.
      </p>
    </div>
  );
}
