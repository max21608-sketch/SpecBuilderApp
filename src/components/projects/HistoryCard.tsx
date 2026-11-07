"use client";

// The project's History card: its three heading controls and the trail under
// them. Moved out of src/app/dashboard/projects/[id]/page.tsx on 2026-11-07
// (audit 5.3, cut B).
//
// THE CONTROLS' STATE IS A HOOK THE PAGE CALLS. The page renders this card on
// the Overview and again on the History tab, with the hidden Overview copy
// still mounted, and its tab strip carries the count; state inside the card
// would be two cards that disagree about whether "Name this point" is open.
import { useState } from "react";
import ProjectHistory from "@/components/history/ProjectHistory";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

/** The history card's three controls live in its heading, so the page holds their state and the card is told. */
export function useHistoryCard() {
  const [count, setCount] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  return { count, setCount, naming, setNaming, comparing, setComparing, showAll, setShowAll };
}

export type HistoryCardState = ReturnType<typeof useHistoryCard>;

export default function HistoryCard({
  projectId,
  specsAgreedBy,
  toQuote,
  history,
}: {
  projectId: string;
  specsAgreedBy: string | null;
  toQuote: number;
  history: HistoryCardState;
}) {
  return (
    <Card
      title="History"
      flush
      actions={
        <>
          <Button size="xs" onClick={() => history.setNaming((open) => !open)}>
            Name this point
          </Button>
          <Button size="xs" onClick={() => history.setComparing((open) => !open)}>
            Compare two points
          </Button>
          {history.count !== null && history.count > 0 && (
            <button
              type="button"
              onClick={() => history.setShowAll((open) => !open)}
              className="text-[12px] font-medium normal-case tracking-normal text-blue-700 hover:underline"
            >
              {history.showAll ? "Show fewer" : `All ${history.count}`}
            </button>
          )}
        </>
      }
    >
      <ProjectHistory
        projectId={projectId}
        specsAgreedBy={specsAgreedBy}
        toQuote={toQuote}
        onLoaded={history.setCount}
        naming={history.naming}
        onNamingChange={history.setNaming}
        comparing={history.comparing}
        onComparingChange={history.setComparing}
        showAll={history.showAll}
        onShowAllChange={history.setShowAll}
      />
    </Card>
  );
}
