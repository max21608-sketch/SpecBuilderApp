"use client";

// Every drawing document in one pack, reviewed together.
//
// The pack screen next door lists the documents; this one lists the ITEMS
// across all of them, because at one PDF per line item the document is an
// implementation detail of how the drawings arrived and the item is the thing
// being specified.
import { useEffect, useState } from "react";
import PackDrawingsReview from "@/components/imports/PackDrawingsReview";
import Spinner from "@/components/ui/Spinner";
import { apiFetch } from "@/lib/api-fetch";

export default function PackDrawingsPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const [ids, setIds] = useState<{ id: string; batchId: string } | null>(null);
  /** The day the pack was delivered, for the crumb back to it. */
  const [packDay, setPackDay] = useState<string | null>(null);

  useEffect(() => {
    void params.then(setIds);
  }, [params]);

  useEffect(() => {
    if (!ids) return;
    void apiFetch<{ batches: { id: string; created_at: string }[] }>(`/api/projects/${ids.id}/batches`).then((res) => {
      if (!res.ok) return;
      const found = res.data.batches.find((batch) => batch.id === ids.batchId);
      // Sliced from the timestamp rather than parsed: `formatDay` builds a day
      // from the string's own parts, which is the TOE-dates rule applied to
      // formatting.
      setPackDay(found ? found.created_at.slice(0, 10) : null);
    });
  }, [ids]);

  if (!ids) return <Spinner label="Loading" />;

  // The review component renders its own band: `PageHeader` is full-bleed and
  // sits outside `PageBody`, and the counts on it come from the pack payload
  // that component loads.
  return <PackDrawingsReview projectId={ids.id} batchId={ids.batchId} packDay={packDay} />;
}
