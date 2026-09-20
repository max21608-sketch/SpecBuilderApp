// What this project needs next, decided in ONE place.
//
// ============================================================================
// THE LAYOUT IS THE WORKFLOW, SO THE NEXT STEP IS A BUTTON AND NEVER A SENTENCE
//
// Matthew, on the drawings review and again on a record: "How do you get to
// this page? At what point in the workflow do you come to this?" The app could
// do every one of those things; the controls were not where the work was. A
// line of text saying where to go next is the failure, not the fix — a sentence
// explaining where a button is means the button is in the wrong place
// (`docs/plans/make-it-work-2026-09-19.md` §0.3).
//
// So every screen a person is on during an intake renders THE SAME answer as
// its primary action, and this function is the only thing that decides what
// that answer is. Four screens each deciding for themselves is four answers
// that drift, which is the defect `composeDimensionCell`, `questionTier` and
// `gateStatus` each already exist to prevent, in a fourth place.
//
// ---- NOTHING NEW IS COMPUTED -----------------------------------------------
//
// Every number here is one a loader already produced: `loadProjectSummary` for
// the records, the categories and the to-quote figure, and the project's own
// intake rows for the documents. This function is PURE and reads no clock, no
// database and no URL, so its precedence is a table of fixtures rather than a
// screen somebody has to drive.
//
// ---- WHERE `waiting` IS, AND WHY IT IS OPTIONAL ----------------------------
//
// `GET /api/projects/[id]` does not carry a waiting count: waiting is derived
// per RECORD in `/api/records` (chased, and still outstanding) and the project
// payload has never held it. Rather than add a second reading of that rule to
// a loader, `waiting` is optional here — absent means "this caller cannot tell"
// and the step is skipped, never guessed at as zero on one screen and a real
// number on another. Recorded as a gap rather than filled in.
// ============================================================================
import type { Tone } from "@/components/ui/tone";

/**
 * Why a step is the step. The KIND is what a screen keys off; the label is what
 * it prints. A screen that needs to suppress one (the project overview already
 * carries the export cluster in its own header band) names the kind.
 */
export type NextStepKind =
  | "upload"
  | "reading"
  | "retry_failed"
  | "review_boq"
  | "review_documents"
  | "categorise"
  | "to_quote"
  | "waiting"
  | "export";

export type NextStep = {
  kind: NextStepKind;
  /** What the control says. Reads as what it leads to, never as a category. */
  label: string;
  href: string;
  /** The figure behind the label, or null where the step has no count. */
  count: number | null;
  tone: Tone;
  /**
   * The app is doing this and nobody is wanted. A pending step is still shown —
   * it is the true answer to "what now" — but it is NEVER the primary action,
   * because a primary that does nothing when pressed teaches people that the
   * primary means nothing.
   */
  pending: boolean;
};

/** One intake document, as `GET /api/projects/[id]` already returns it. */
export type NextStepDocument = {
  id: string;
  status: string;
  source_kind: string;
  document_kind: string | null;
};

export type NextStepInput = {
  projectId: string;
  /** Straight off `loadProjectSummary`. Only these five are read. */
  summary: {
    records: number;
    uncategorised: number;
    toQuote: number;
    documentsReading: number;
    documentsFailed: number;
  };
  /**
   * The project's intake rows. The route caps this list at 50, which is why the
   * COUNTS above come from the summary and this list is only ever used to find
   * something to link to.
   */
  documents: NextStepDocument[];
  /** Active phases, in the order the project shows them. */
  runs: { id: string }[];
  /** The newest pack, where a whole delivery is read and reviewed together. */
  packId: string | null;
  /** Questions chased with nothing back. Omit where the caller cannot tell. */
  waiting?: number;
};

/**
 * The next step, or null where nothing applies.
 *
 * THE ORDER IS THE ORDER OF THE WORK (§0.3): upload → bill review → pack →
 * drawings review → phase table → record → chase. The first that applies wins,
 * and each one lands on the screen that does it.
 */
export function nextStep(input: NextStepInput): NextStep | null {
  const { projectId, summary, documents, runs, packId } = input;
  const project = `/dashboard/projects/${encodeURIComponent(projectId)}`;
  const pack = packId ? `${project}/intake/${encodeURIComponent(packId)}` : null;
  const documentsTab = `${project}?tab=documents`;
  const firstRun = runs[0]?.id ?? null;
  /* THE SPEC TABLE REQUIRES A PHASE. There is no merged view to send anybody
     to — it was deleted for listing three sub-quotes in one flat list — so a
     project with no phase yet has nothing to focus, and the steps that would
     land there are skipped rather than linked somewhere approximate. */
  const phaseTab = (focus: string) =>
    firstRun ? `${project}?tab=${encodeURIComponent(firstRun)}&focus=${focus}` : null;

  // ---- nothing has arrived -------------------------------------------------
  if (documents.length === 0) {
    return {
      kind: "upload",
      label: "Upload the pack",
      href: documentsTab,
      count: null,
      tone: "info",
      pending: false,
    };
  }

  // ---- the app is reading ---------------------------------------------------
  // Before the failures, deliberately: a pack still being read may yet produce
  // more of them, and "retry 1 of 11" while ten are in flight is a number that
  // changes under the person reading it.
  if (summary.documentsReading > 0) {
    return {
      kind: "reading",
      label: `Reading ${summary.documentsReading} document${summary.documentsReading === 1 ? "" : "s"}…`,
      href: pack ?? documentsTab,
      count: summary.documentsReading,
      tone: "info",
      pending: true,
    };
  }

  if (summary.documentsFailed > 0) {
    const failed = documents.find((doc) => doc.status === "failed");
    return {
      kind: "retry_failed",
      label:
        summary.documentsFailed === 1
          ? "Retry the failed read"
          : `Retry ${summary.documentsFailed} failed reads`,
      href: pack ?? (failed ? importHref(failed.id) : documentsTab),
      count: summary.documentsFailed,
      tone: "danger",
      pending: false,
    };
  }

  // ---- a bill waiting to be reviewed ---------------------------------------
  // The bill is what CREATES the records, so it comes before every document
  // that describes them. A pack whose drawings are read and whose bill is not
  // confirmed resolves nothing at all.
  const boq = documents.find((doc) => doc.source_kind === "boq_xlsx" && doc.status === "parsed");
  if (boq) {
    return {
      kind: "review_boq",
      label: "Review the bill",
      href: importHref(boq.id),
      count: null,
      tone: "warn",
      pending: false,
    };
  }

  /* ---- a document waiting to be reviewed ----------------------------------
     NOT IN THE BRIEF'S LIST, AND NAMED AS A JUDGEMENT. §0.3 sets the order of
     the work as upload → bill review → pack → drawings review → phase table,
     and without this step a project whose drawings are read and unreviewed is
     told "Categorise 14 items" while 240 specs sit staged and unconfirmed —
     a concrete wrong answer somebody would act on, which is the test §0.2 sets
     for building the less simple version.

     An EMAIL is excluded: it is reviewed from the Inbox, it belongs to no pack,
     and one sitting unreviewed is not a step in this project's intake. */
  const toReview = documents.filter(
    (doc) => doc.source_kind === "spec_document" && doc.status === "parsed" && doc.document_kind !== "email",
  );
  if (toReview.length > 0) {
    return {
      kind: "review_documents",
      label:
        toReview.length === 1
          ? "Review the document"
          : `Review ${toReview.length} documents`,
      href: pack ?? importHref(toReview[0]!.id),
      count: toReview.length,
      tone: "warn",
      pending: false,
    };
  }

  // ---- the records themselves ----------------------------------------------
  // An uncategorised record has NO questions at all, so it scores zero
  // outstanding and would drag a project toward looking finished by having been
  // ignored. It comes before the to-quote figure for that reason: the figure is
  // an undercount until every record has a category.
  const categorise = phaseTab("no_category");
  if (summary.uncategorised > 0 && categorise) {
    return {
      kind: "categorise",
      label: `Categorise ${summary.uncategorised} item${summary.uncategorised === 1 ? "" : "s"}`,
      href: categorise,
      count: summary.uncategorised,
      tone: "warn",
      pending: false,
    };
  }

  const toQuote = phaseTab("tgq");
  if (summary.toQuote > 0 && toQuote) {
    /* THE COUNT IS QUESTIONS, AND THE LABEL SAYS SO. `loadProjectSummary`
       counts to-quote QUESTIONS across the project; how many ITEMS carry one is
       a per-record figure only the spec table's own payload holds. Printing the
       question count beside the word "items" would be a number that reads as
       something it is not. */
    return {
      kind: "to_quote",
      label: `Review ${summary.records} item${summary.records === 1 ? "" : "s"} — ${summary.toQuote} to-quote spec${
        summary.toQuote === 1 ? "" : "s"
      } outstanding`,
      href: toQuote,
      count: summary.toQuote,
      tone: "danger",
      pending: false,
    };
  }

  if ((input.waiting ?? 0) > 0) {
    const waiting = input.waiting!;
    return {
      kind: "waiting",
      label: `${waiting} question${waiting === 1 ? "" : "s"} waiting on a reply`,
      href: `/dashboard/drafts?projectId=${encodeURIComponent(projectId)}`,
      count: waiting,
      tone: "info",
      pending: false,
    };
  }

  // ---- nothing outstanding --------------------------------------------------
  // Only over records that exist. A project with none is one nobody has
  // started, and offering it the export would be the same claim as a green
  // COMPLETED pill over 0 of 0.
  if (summary.records > 0) {
    return {
      kind: "export",
      label: "Export",
      href: firstRun ? `${project}?tab=${encodeURIComponent(firstRun)}` : project,
      count: null,
      tone: "good",
      pending: false,
    };
  }

  return null;
}

function importHref(importId: string): string {
  return `/dashboard/imports/${encodeURIComponent(importId)}`;
}
