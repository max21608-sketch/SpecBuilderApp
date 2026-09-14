"use client";

// The spec table for a whole project, across every run.
//
// One component, two mounts: the project screen shows one of these per run tab,
// and this page shows them all together. Two tables would drift, and the one
// that drifted would be the one used less.
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Spinner from "@/components/ui/Spinner";
import SpecTable from "@/components/records/SpecTable";

function AllRecords() {
  const projectId = useSearchParams().get("projectId");
  if (!projectId) return <p className="text-sm text-red-700">No project selected.</p>;
  return (
    <>
      <p className="mt-1 text-sm text-neutral-600">
        Every run on this project.{" "}
        <Link href={`/dashboard/projects/${projectId}`} className="underline">
          Open the project
        </Link>{" "}
        to see them as separate sub-quotes.
      </p>
      <SpecTable projectId={projectId} />
    </>
  );
}

export default function RecordsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-neutral-900">Spec table</h1>
      <Suspense fallback={<Spinner label="Loading" />}>
        <AllRecords />
      </Suspense>
    </div>
  );
}
