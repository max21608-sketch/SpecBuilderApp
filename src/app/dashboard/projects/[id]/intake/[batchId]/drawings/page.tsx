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

export default function PackDrawingsPage({
  params,
}: {
  params: Promise<{ id: string; batchId: string }>;
}) {
  const [ids, setIds] = useState<{ id: string; batchId: string } | null>(null);

  useEffect(() => {
    void params.then(setIds);
  }, [params]);

  if (!ids) return <Spinner label="Loading" />;

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold text-neutral-900">Drawings in this pack</h1>
      <PackDrawingsReview projectId={ids.id} batchId={ids.batchId} />
    </div>
  );
}
