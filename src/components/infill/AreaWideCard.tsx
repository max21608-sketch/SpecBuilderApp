"use client";

// Questions answered ONCE FOR AN AREA, on the fill-in screen (decision C of
// 2026-11-20, `requirements.answer_scope = 'area'`).
//
// The project-wide card with `scope="area"`: one row per (area, question), read
// from and written to `/api/projects/[id]/area-wide`, whose rules are the
// project-wide mechanism's own (src/lib/project-wide.ts) — the set re-derived
// under the lock and refused whole if it moved, a settled different answer
// never overwritten without a tick and a reason, one change set, one version
// per record. One card component, so the two cannot drift apart.
import ProjectWideCard from "@/components/projects/ProjectWideCard";

//
// It takes the fill-in's PHASE FILTER (chase review C3): filtered, its items
// and its writes are that phase's alone; unfiltered, every card names its
// phases and how many items in each before the press.
export default function AreaWideCard({
  projectId,
  onChanged,
  runId = "",
  phaseName = null,
}: {
  projectId: string;
  onChanged?: () => void;
  /** The fill-in's phase filter; "" is every phase. */
  runId?: string;
  phaseName?: string | null;
}) {
  return (
    <ProjectWideCard
      projectId={projectId}
      onChanged={onChanged}
      scope="area"
      runId={runId}
      phaseName={phaseName}
    />
  );
}
