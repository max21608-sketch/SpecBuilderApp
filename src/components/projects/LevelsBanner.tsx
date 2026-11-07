"use client";

// The overview's "No level" line: how many items have no level, how many of
// them carry a suggestion, and Accept, which takes every suggestion in one
// act. Moved out of src/app/dashboard/projects/[id]/page.tsx on 2026-11-07
// (audit 5.3, cut B). It is a row of the Specifications card's table, not a
// banner; the name is the brief's.
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Button, { buttonClass } from "@/components/ui/Button";
import SummaryRow from "@/components/projects/SummaryRow";

export default function LevelsBanner({
  projectId,
  summary,
  firstRunHref,
  onReload,
  onError,
}: {
  projectId: string;
  /** The three of the overview's numbers this line reads. */
  summary: { noLevel: number; levelSuggested: number; tgqFromFallback: number };
  /** The first live phase's tab, where the levels are reviewed. Null before there is one. */
  firstRunHref: string | null;
  /** The page's whole load, which a refusal is reported after. */
  onReload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [acceptingLevels, setAcceptingLevels] = useState(false);

  /** Agree with every level this project's records were guessed, in one act. */
  async function acceptLevels() {
    setAcceptingLevels(true);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/levels/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: null }),
      });
      await onReload();
      if (!res.ok) onError(res.error);
    } finally {
      setAcceptingLevels(false);
    }
  }

  return (
    <SummaryRow
      label="No level"
      tone="warn"
      count={summary.noLevel}
      href={firstRunHref}
      meaning={
        <>
          Needed by the{" "}
          {summary.tgqFromFallback > 0 ? "placeholder half of TGQ and by the " : ""}
          BWS boilerplate.
          {summary.levelSuggested > 0 && ` ${summary.levelSuggested} have a suggestion.`}
        </>
      }
      action={
        <>
          {summary.levelSuggested > 0 && (
            <Button size="xs" disabled={acceptingLevels} onClick={() => void acceptLevels()}>
              {acceptingLevels ? "Accepting…" : `Accept ${summary.levelSuggested}`}
            </Button>
          )}
          {firstRunHref && (
            <Link href={firstRunHref} className={buttonClass("quiet", "xs", "no-underline")}>
              Review
            </Link>
          )}
        </>
      }
    />
  );
}
