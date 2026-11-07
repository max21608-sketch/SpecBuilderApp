"use client";

// The review screen for one document, whichever kind it is. This page is the
// DISPATCHER (audit 5.3, cut A, 2026-11-06): it loads the import, finds the
// pack it arrived in for the crumb, and hands the document to the screen that
// understands its staged shape. A bill's review is `BoqReview`; the drawings,
// preamble, finishes-schedule and specification-document screens are their
// own components. Everything a review shows is a draft until its Confirm.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import SpecDocumentReview, { type SpecImport } from "@/components/imports/SpecDocumentReview";
import DrawingsReview from "@/components/imports/DrawingsReview";
import PreambleReview from "@/components/imports/PreambleReview";
import FinishScheduleReview from "@/components/imports/FinishScheduleReview";
import BoqReview from "@/components/imports/BoqReview";
import { useBoqImport } from "@/components/imports/use-boq-import";
import { useStructureRead } from "@/components/imports/StructureRead";
import { useNextStep } from "@/lib/use-next-step";
import { formatDay } from "@/lib/format-day";

export default function ReviewImportPage() {
  const { id } = useParams<{ id: string }>();
  // The load is the dispatch's before it is the bill's: one GET serves every
  // review screen. The bill review receives the whole hook.
  const boq = useBoqImport(id);
  const { data, load, error, setNotice } = boq;
  /**
   * The pack this document arrived in, for the crumb.
   *
   * Read from the project's batches rather than from the import, because
   * `/api/imports/[id]` carries no batch id and this screen is not where an API
   * shape is changed. An absent pack is normal — anything uploaded before
   * deliveries were grouped has none — and the crumb falls back to the project,
   * which is the way back either way.
   */
  const [pack, setPack] = useState<{ id: string; created_at: string; drawings: number } | null>(null);
  const projectId = data?.import.project_id ?? "";
  /**
   * WHAT COMES AFTER THIS BILL. The confirm already pushes to the phase tabs,
   * where the header's own primary is this same step; this is the other half —
   * a bill somebody comes BACK to, already confirmed, whose screen said "This
   * import has already been confirmed" and offered nothing to do about it.
   *
   * Re-read whenever THIS document moves: a confirm that stays on the page
   * otherwise keeps the step computed while the bill was waiting, "Review the
   * bill", linking here (audit 2026-11-06, G7).
   */
  const step = useNextStep(projectId || null, data ? `${data.import.status}:${data.import.version}` : null);
  useEffect(() => {
    if (!projectId || !id) return;
    void apiFetch<{ batches: { id: string; created_at: string; runs: { id: string; documentKind: string | null }[] }[] }>(
      `/api/projects/${projectId}/batches`,
    ).then((res) => {
      if (!res.ok) return;
      const found = res.data.batches.find((batch) => batch.runs.some((batchRun) => batchRun.id === id));
      setPack(
        found
          ? {
              id: found.id,
              created_at: found.created_at,
              drawings: found.runs.filter((batchRun) => batchRun.documentKind === "shop_drawings").length,
            }
          : null,
      );
    });
  }, [projectId, id]);

  // Called where these lines sat, AFTER the next-step and pack effects: the
  // automatic structure read is dispatched in the order it always was.
  const structure = useStructureRead({ id, data, load, setNotice });

  if (error && !data) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading import" />;

  const run = data.import;
  const packCrumb = pack
    ? {
        label: `Pack delivered ${formatDay(pack.created_at.slice(0, 10))}`,
        href: `/dashboard/projects/${run.project_id}/intake/${pack.id}`,
      }
    : { label: `${run.bws_project_number} — ${run.project_name}`, href: `/dashboard/projects/${run.project_id}` };

  // Four documents, four review screens, one route. Each staged shape is edited
  // by the screen that understands it; nothing shares a component with a shape
  // it cannot display.
  if (run.document_kind === "shop_drawings") {
    return (
      // The review component renders its own band — see the note on the
      // spec-document branch below.
      <DrawingsReview
        importId={run.id}
        crumb={packCrumb}
        packHref={pack ? `/dashboard/projects/${run.project_id}/intake/${pack.id}/drawings` : undefined}
        packDrawingCount={pack?.drawings}
      />
    );
  }

  if (run.document_kind === "preamble") {
    return (
      <PreambleReview
        importId={run.id}
        crumb={packCrumb}
        project={{ id: run.project_id, number: run.bws_project_number, name: run.project_name }}
      />
    );
  }

  // A finishes schedule read as ENTRIES (schemaVersion 2), or one not read yet
  // — which will be. A version 1 schedule (proposals) keeps the screen below.
  if (
    run.document_kind === "finishes_schedule" &&
    (!run.parsed || (run.parsed as unknown as { kind?: string }).kind === "finishes_schedule")
  ) {
    return (
      <FinishScheduleReview
        importId={run.id}
        crumb={packCrumb}
        project={{ id: run.project_id, number: run.bws_project_number, name: run.project_name }}
      />
    );
  }

  if (run.source_kind === "spec_document") {
    if (!data.registers) return <Spinner label="Loading the document" />;
    return (
      // The review component renders its OWN band: `PageHeader` is full-bleed
      // and sits outside `PageBody`, and the tabs, the Re-match button and the
      // confirm footer all read state that lives inside it.
      <SpecDocumentReview
        data={{ import: run as unknown as SpecImport, registers: data.registers, message: data.message }}
        reload={() => load()}
        quietReload={() => load(true)}
        crumb={
          run.document_kind === "email" ? { label: "Inbox", href: "/dashboard/inbox" } : packCrumb
        }
      />
    );
  }

  return <BoqReview id={id} boq={boq} data={data} structure={structure} step={step} crumb={packCrumb} />;
}
