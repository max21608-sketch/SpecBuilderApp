"use client";

// The next step, for a screen that does not already hold the project payload.
//
// ============================================================================
// THE SAME ENDPOINT THE OVERVIEW READS, NEVER A NEW ONE.
//
// The project overview computes `nextStep()` from the payload it has loaded
// anyway. The review screens do not have it: they are mounted from an import id
// and learn the project id only once the document has loaded. So they read
// `GET /api/projects/[id]` — the one endpoint that already returns every number
// the function needs — rather than growing an endpoint of their own, which
// would be a second place for the summary's clauses to drift.
//
// IT FAILS TOWARD SILENCE. A step nobody can compute renders nothing at all:
// the screens that use this each keep their own way back, so a failed fetch
// costs an emphasis and never a route. Nothing here surfaces an error, because
// a red banner about a button that was only ever an accelerator would be worse
// than the button's absence.
// ============================================================================
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { nextStep, type NextStep, type NextStepDocument } from "@/lib/next-step";

type ProjectPayload = {
  summary?: {
    records?: number;
    uncategorised?: number;
    toQuote?: number;
    documentsReading?: number;
    documentsFailed?: number;
  };
  documents?: (NextStepDocument & { batch_id?: string | null })[];
  runs?: { id: string }[];
};

/** Null while loading, when there is no project yet, or when the read fails. */
export function useNextStep(projectId: string | null | undefined): NextStep | null {
  const [step, setStep] = useState<NextStep | null>(null);

  useEffect(() => {
    if (!projectId) {
      setStep(null);
      return;
    }
    let live = true;
    void (async () => {
      const res = await apiFetch<ProjectPayload>(`/api/projects/${encodeURIComponent(projectId)}`);
      if (!live) return;
      if (!res.ok) {
        setStep(null);
        return;
      }
      const data = res.data ?? {};
      // Read defensively: this payload is a server shape a screen does not own,
      // and a missing key here must cost an emphasis rather than throw inside a
      // review somebody is halfway through.
      const documents = Array.isArray(data.documents) ? data.documents : [];
      setStep(
        nextStep({
          projectId,
          summary: {
            records: Number(data.summary?.records ?? 0),
            uncategorised: Number(data.summary?.uncategorised ?? 0),
            toQuote: Number(data.summary?.toQuote ?? 0),
            documentsReading: Number(data.summary?.documentsReading ?? 0),
            documentsFailed: Number(data.summary?.documentsFailed ?? 0),
          },
          documents,
          runs: Array.isArray(data.runs) ? data.runs : [],
          // The newest delivery. `documents` comes back newest first and a row
          // uploaded before 0007 carries no batch at all, which is why this
          // looks for the first one that has one rather than taking [0].
          packId: documents.find((doc) => doc.batch_id)?.batch_id ?? null,
        }),
      );
    })();
    return () => {
      live = false;
    };
  }, [projectId]);

  return step;
}
