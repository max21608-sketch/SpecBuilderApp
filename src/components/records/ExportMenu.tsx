// The three outputs this app produces, and the sheet you check the first one
// against.
//
// ============================================================================
// THREE OUTPUTS, AND A FORMAT IS NOT ONE OF THEM.
//
// Asked for directly on 2026-09-18, on sight of five buttons in a row: "surely
// we only should have three". There ARE three — the spec upload, the quote and
// the costing block — and the row was showing a FORMAT (.csv) and a
// VERIFICATION TOOL (Check sheet) as their peers, which made five things that
// look equally like deliverables and are not.
//
// So each output is one segmented control: its name, then the formats it comes
// in. A format sits inside the thing it is a format of and cannot be mistaken
// for a fourth output. The check sheet is below, labelled with what it is for —
// it produces no deliverable, it is how the spec upload gets accepted against
// the pack.
//
// LIFTED OUT OF `SpecTable` so the project screen can put it in the header
// band, which is where the mock-up has it. One component, two scopes: a run
// tab passes its `runId`, the Overview passes null and every link becomes the
// project-wide file. All four routes take `runId` as their only scope
// parameter and 400 on anything else, because a BWS import replaces rather
// than merges — THE EXPORT IS NEVER FILTERED, and the reason this component
// takes a run id and nothing else is that there is nothing else it may take.
// ============================================================================
import { buttonClass } from "@/components/ui/Button";
import Tip from "@/components/ui/Tip";

/**
 * One OUTPUT, with the formats it comes in.
 *
 * A segmented control rather than loose buttons, because the row is where
 * somebody counts how many deliverables this app produces. The name is a
 * static label and each format is the action — a download is an `<a href>`
 * because the browser has to fetch it, and `buttonClass`'s reason for existing
 * is that such a link should still look like the action it is.
 */
function Output({
  name,
  tip,
  formats,
  emphasis = false,
}: {
  name: string;
  /** What this file does NOT carry. See the note at the foot of this file. */
  tip: string;
  formats: { label: string; href: string }[];
  emphasis?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-stretch overflow-hidden rounded border ${
        emphasis ? "border-neutral-900" : "border-neutral-300"
      }`}
    >
      <span
        className={`px-3 py-1.5 text-sm ${emphasis ? "bg-neutral-900 text-white" : "bg-white text-neutral-700"}`}
      >
        {name}
        <Tip>{tip}</Tip>
      </span>
      {formats.map((format) => (
        <a
          key={format.label}
          href={format.href}
          className={`border-l px-2.5 py-1.5 text-sm no-underline ${
            emphasis
              ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-700 hover:text-white"
              : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
          }`}
        >
          {format.label}
        </a>
      ))}
    </span>
  );
}

export default function ExportMenu({
  projectId,
  runId = null,
  emphasis = true,
}: {
  projectId: string;
  /** One run's scope, or null for the whole project. Never anything else. */
  runId?: string | null;
  /**
   * Whether the spec upload is drawn as this band's emphatic control.
   *
   * ONE PRIMARY PER BAND (§0.3). The spec upload carries the emphasis because
   * it is the output that matters of the three — but on a screen whose header
   * also shows a NEXT STEP (`src/lib/next-step.ts`), two black controls sit
   * side by side and neither reads as the thing to do. The step wins there,
   * because the export is what happens when nothing is outstanding; where the
   * step IS the export it is suppressed and this keeps its emphasis.
   *
   * It changes which of the three outputs is emphasised and NOTHING else: all
   * three are still offered, in the same order, with the same formats and the
   * same scope. The export is never filtered.
   */
  emphasis?: boolean;
}) {
  const scope = runId ? `?runId=${runId}` : "";
  const and = runId ? "&" : "?";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Output
        name="Spec upload"
        emphasis={emphasis}
        tip="Always every record in scope — a BWS import replaces the fields it is given, so a partial file would erase what it left out. It carries no job number: it is a file to read, not to import."
        formats={[
          { label: ".xlsx", href: `/api/projects/${projectId}/export${scope}` },
          // Tim's grid importer takes the csv, so this is not a lesser
          // format — it is the one BWS actually reads.
          { label: ".csv", href: `/api/projects/${projectId}/export${scope}${and}format=csv` },
        ]}
      />
      <Output
        name="Quote lines"
        tip="Eight of the twelve columns Matthew's quote sheet carries. The prices, the UUID and the image URL are blank because this app holds none of them, and the interliner, stone, mattress and delivery lines are not generated — the interliner quantity is the fabric metreage, which this app deliberately does not hold. A person adds those and prices the file."
        formats={[{ label: ".csv", href: `/api/projects/${projectId}/export/quote${scope}` }]}
      />
      <Output
        name="Costing block"
        tip="Columns A–J of the estimating sheet — the item block, to paste into the template. Everything from K rightwards is the estimator's: three pricing blocks and the stone block, whose formulas and rates this app does not hold and will not reproduce. Tags carries the composed dimensions, from the same composer as the BWS file."
        formats={[
          { label: ".xlsx", href: `/api/projects/${projectId}/export/costing${scope}` },
          { label: ".csv", href: `/api/projects/${projectId}/export/costing${scope}${and}format=csv` },
        ]}
      />
      {/* The check sheet is NOT a fourth output: it produces no deliverable, it
          is how the spec upload gets accepted against the pack. Quiet, so it
          reads as a tool beside the three files rather than as one of them,
          and its purpose is a hover rather than a caption row — the caption
          was what made the cluster too tall for a header band. */}
      <span className="inline-flex items-center">
        <a
          href={`/api/projects/${projectId}/export/check-sheet${scope}`}
          className={buttonClass("quiet", "sm", "no-underline")}
        >
          Check sheet
        </a>
        <Tip>
          For checking the spec upload against the pack, line by line: one row per record and field, naming the
          document and page each value came from, with the verdict columns left empty for the reviewer.
        </Tip>
      </span>
    </div>
  );
}

// ============================================================================
// WHERE THE THREE STANDING PARAGRAPHS WENT.
//
// Under the old row sat three paragraphs saying what each file does NOT hold —
// that the quote's prices are blank because this app has none, that the costing
// block stops at column J, that the spec upload is never a subset. Every one of
// them is a caveat whose ABSENCE could mislead somebody into pricing off a
// file, so none could simply be deleted; and all three on the page every visit
// is exactly the furniture `Tip` exists to remove. They are the three tips
// above, one on each output's own name, which is where somebody wonders.
//
// The costing block's caveat is ALSO on the "About this file" sheet inside the
// workbook, deliberately: a caveat that lives only on the screen that produced
// the download is one nobody reads at the moment it matters, which is when
// somebody opens it next week and wonders why column K is empty.
// ============================================================================
