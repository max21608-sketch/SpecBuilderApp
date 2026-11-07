"use client";

// Every verb on a captured spec, with its reason handling: retire, correct,
// link to the finishes library or unlink, put back, and which spec's BW
// standard is open. What it returns is what the record page used, named the
// same. Moved out of src/app/dashboard/records/[id]/page.tsx on 2026-11-07
// (audit 5.3, cut C).
//
// EVERY VERB RELOADS FIRST AND REPORTS AFTER, through the page's
// `reloadThen`: the page clears its banner on a successful load, so a refusal
// set before the reload would show for a few milliseconds and then nothing.
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { AttributeState, AttributeUnit } from "@/lib/spec-vocab";
import type { Attribute, RetiredAttribute } from "@/components/records/record-payload";

export function useAttributeActions(reloadThen: (message: string | null) => Promise<void>) {
  // The spec a reviewer has asked to take off this item, waiting for a reason.
  // Retiring destroys a statement a document made, so the reason is required
  // here rather than only on an override.
  const [retiring, setRetiring] = useState<Attribute | null>(null);
  const [retireReason, setRetireReason] = useState("");
  const [retireBusy, setRetireBusy] = useState(false);
  /**
   * THE SPEC BEING CORRECTED, and the boxes it opened pre-filled.
   *
   * PRE-FILLING IS RIGHT HERE and the level picker's trap does not apply: that
   * rule is about a control whose ACTION is the selection, where a select
   * already reading "Simple" fires no change event when somebody picks Simple.
   * The action here is the Save, which fires whatever the boxes say.
   *
   * A correction is a SUPERSESSION, not an edit in place — see
   * `src/lib/attribute-correct.ts`. The old row stays under "show retired",
   * marked as superseded, with who corrected it and why.
   */
  const [correcting, setCorrecting] = useState<Attribute | null>(null);
  const [correctValue, setCorrectValue] = useState("");
  const [correctUnit, setCorrectUnit] = useState<AttributeUnit | "">("");
  const [correctState, setCorrectState] = useState<AttributeState>("confirmed");
  const [correctReason, setCorrectReason] = useState("");
  const [correctBusy, setCorrectBusy] = useState(false);
  /** The spec whose finishes-library link is being changed, and what to. */
  /** Which spec's BW standard is being set or agreed, and which of the two (0041). */
  const [standardEditing, setStandardEditing] = useState<{ id: string; mode: "set" | "agree" } | null>(null);
  const [attaching, setAttaching] = useState<Attribute | null>(null);
  const [attachTo, setAttachTo] = useState("");
  const [attachReason, setAttachReason] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);

  async function retire() {
    if (!retiring || !retireReason.trim()) return;
    setRetireBusy(true);
    try {
      const res = await apiFetch(`/api/attributes/${retiring.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "retired", version: retiring.version, reason: retireReason.trim() }),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) {
        setRetiring(null);
        setRetireReason("");
      }
    } finally {
      // Always reset: a non-JSON error must not leave the dialog stuck.
      setRetireBusy(false);
    }
  }

  /** Open the editor on one spec, filled in with what it currently says. */
  function beginCorrection(attribute: Attribute) {
    setCorrecting(attribute);
    setCorrectValue(attribute.value ?? "");
    setCorrectUnit((attribute.unit as AttributeUnit | null) ?? "");
    setCorrectState(attribute.state);
    // NOT pre-filled: the reason is the one thing nobody can guess, and a
    // default would be twenty rows in the trail reading the same sentence.
    setCorrectReason("");
  }

  async function correct() {
    if (!correcting || !correctReason.trim()) return;
    setCorrectBusy(true);
    try {
      const res = await apiFetch<{ finishUnlinked?: boolean }>(
        `/api/attributes/${encodeURIComponent(correcting.id)}/correct`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value: correctState === "tbc" && !correctValue.trim() ? null : correctValue,
            unit: correctUnit === "" ? null : correctUnit,
            state: correctState,
            version: correcting.version,
            reason: correctReason.trim(),
          }),
        },
      );
      // RELOAD FIRST, REPORT AFTER. This screen clears its banner on a
      // successful load, so setting the message first shows a 409 for a few
      // milliseconds and then nothing at all — the click looks as though it
      // never registered.
      await reloadThen(
        res.ok
          ? res.data?.finishUnlinked
            ? "Corrected. The finishes library says something else about that code, so this item is no longer linked to it — the library row is untouched."
            : null
          : res.error,
      );
      if (res.ok) setCorrecting(null);
    } finally {
      // Always, so an HTML error page cannot leave the Save button dead.
      setCorrectBusy(false);
    }
  }

  /**
   * LINKING ONE SPEC TO THE FINISHES LIBRARY, or letting it stand on its own
   * words.
   *
   * ==========================================================================
   * `PATCH /api/attributes/[id]/finish` has been built since 0018 — version-
   * checked, reason-bearing, with its own `finish_link` / `finish_unlink`
   * change kinds — and no screen called it. Found while tracing why the S-203
   * fabric never reached the library (found-in-use.md, 2026-09-22): half of
   * that entry was a keying decision and half was a route with no button.
   *
   * LINKING CHANGES WHAT THE FILE SAYS. `composeFinishCell` renders the
   * LIBRARY wherever an attribute is linked, so the BWS cell, the checklist
   * answer and this screen all move from the page's own words to the
   * library's. That is edit-once working as designed, and it is exactly why
   * this is a person's act with a sentence beside it rather than something a
   * confirm does on a resemblance.
   * ==========================================================================
   */
  async function attach() {
    if (!attaching) return;
    const unlinking = attachTo === "";
    if (unlinking && !attachReason.trim()) return;
    setAttachBusy(true);
    try {
      const res = await apiFetch(`/api/attributes/${encodeURIComponent(attaching.id)}/finish`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          finishId: unlinking ? null : attachTo,
          version: attaching.version,
          ...(attachReason.trim() ? { reason: attachReason.trim() } : {}),
        }),
      });
      // Reload first, report after — this screen clears its banner on a
      // successful load, so a 409 set beforehand flashes and vanishes.
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) {
        setAttaching(null);
        setAttachTo("");
        setAttachReason("");
      }
    } finally {
      // Always, so an HTML error page cannot leave the button dead.
      setAttachBusy(false);
    }
  }

  async function restore(attribute: RetiredAttribute) {
    setRetireBusy(true);
    try {
      const res = await apiFetch(`/api/attributes/${attribute.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "active",
          version: attribute.version,
          reason: `Put back on the item after being retired${attribute.retired_by ? ` by ${attribute.retired_by}` : ""}.`,
        }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      setRetireBusy(false);
    }
  }

  return {
    retiring,
    setRetiring,
    retireReason,
    setRetireReason,
    retireBusy,
    correcting,
    setCorrecting,
    correctValue,
    setCorrectValue,
    correctUnit,
    setCorrectUnit,
    correctState,
    setCorrectState,
    correctReason,
    setCorrectReason,
    correctBusy,
    standardEditing,
    setStandardEditing,
    attaching,
    setAttaching,
    attachTo,
    setAttachTo,
    attachReason,
    setAttachReason,
    attachBusy,
    retire,
    beginCorrection,
    correct,
    attach,
    restore,
  };
}
