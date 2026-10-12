"use client";

// "Read the specifications in this bill — one read, charged", on a confirmed
// bill's row of the project's Documents tab (plan any-bill, Step 2.5).
//
// The bill's descriptions carry sizes, models and finishes, and the confirm
// that made its records never read what the words say. This registers the
// bill's own stored file as a specification document and reads it — the same
// route the bill's review screen calls, so a press on either returns the one
// read the other started. Once it exists the row links to it instead: a link
// goes somewhere, a button does something (`Button.tsx`).
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Button, { buttonClass } from "@/components/ui/Button";

export default function ReadBillSpecsAction({
  billRunId,
  specsRunId,
  descriptionsRead = false,
  onRead,
}: {
  billRunId: string;
  /** The specification read this bill already has, or null. */
  specsRunId: string | null;
  /**
   * The bill's confirm read its description cells (`billDescriptionsReadAtConfirm`,
   * computed by the server). The charged read would be refused, so it is not
   * offered, and the row says where its specifications came from instead.
   */
  descriptionsRead?: boolean;
  /** After a successful press: the caller reloads its list. */
  onRead?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (specsRunId) {
    return (
      <Link href={`/dashboard/imports/${specsRunId}`} className={buttonClass("quiet", "xs", "no-underline")}>
        Its specifications
      </Link>
    );
  }

  if (descriptionsRead) {
    return (
      <span className="text-right text-[11.5px] text-neutral-500">
        Specifications read from its descriptions at confirm
      </span>
    );
  }

  async function press() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/imports/${billRunId}/read-specifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onRead?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      <Button size="xs" disabled={busy} title="Registers this bill's own file as a specification document and reads it." onClick={() => void press()}>
        {busy ? "Registering…" : "Read the specifications in this bill — one read, charged"}
      </Button>
      {error && (
        <span className="max-w-[260px] text-right text-[11px] text-red-700" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
