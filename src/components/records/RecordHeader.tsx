"use client";

// The record's header band: the crumb back to its phase, the label and name,
// the configuration's spoken name, the subtitle row of places to go (client
// ref, phase, area, quantity, mock-up links, category, level, designer), and
// the band's actions. Moved out of src/app/dashboard/records/[id]/page.tsx on
// 2026-11-07 (audit 5.3, cut C).
//
// The TAB BAR is the page's and arrives as `tabs`: its counts come from the
// tabs' own data, and which tab is chosen is the page's URL state.
import { quantityNotGiven } from "@/lib/printed-number";
import { Fragment } from "react";
import Link from "next/link";
import { ITEM_LEVEL_LABELS, normaliseItemLevel, type ItemLevel } from "@/lib/spec-vocab";
import { variantName } from "@/lib/record-variants";
import { recordShortLabel } from "@/lib/record-label";
import Button, { buttonClass } from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import Chip from "@/components/ui/Chip";
import SuggestButton from "@/components/ui/SuggestButton";
import RecordTitle from "@/components/records/RecordTitle";
import type { Payload, SpecRecord } from "@/components/records/record-payload";

export default function RecordHeader({
  record,
  data,
  parentRefs,
  recordLabel,
  runHref,
  level,
  savingLevel,
  setLevel,
  readiness,
  chaseHref,
  chaseCounts,
  onAddSpec,
  tabs,
}: {
  record: SpecRecord;
  data: Pick<Payload, "mockup" | "designerContact">;
  /** The bill line's client refs: a configuration carries none of its own. */
  parentRefs: string;
  recordLabel: string;
  runHref: string;
  level: ItemLevel | null;
  savingLevel: boolean;
  /** Accepting the suggested level: the page's write, which the details' select also makes. */
  setLevel: (next: string) => Promise<void>;
  readiness: Pick<Payload["quoteReadiness"], "toChase">;
  chaseHref: string;
  /** What the record's counts mean, in words, under the Chase button. Null where there is nothing to explain. */
  chaseCounts: string | null;
  /** Add a spec by hand: the page opens the Specs tab with the form showing. */
  onAddSpec: () => void;
  tabs: React.ReactNode;
}) {
  // ---- the header's subtitle, which is a row of places to go ---------------
  //
  // Everything in it either is a link or is a chip saying what is not set.
  // A client ref, a run, a category and a level are all things somebody wants
  // to jump from rather than read, and a figure that makes you go and find the
  // screen it belongs to is the thing the design language exists to stop.
  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <Link href={runHref} className="font-mono text-neutral-700 underline hover:text-neutral-900">
        {parentRefs || "no client ref"}
      </Link>
      <span aria-hidden>·</span>
      <Link href={runHref} className="underline hover:text-neutral-900">{record.run_name}</Link>
      {record.area && <><span aria-hidden>·</span><span>{record.area}</span></>}
      <span aria-hidden>·</span>
      {record.qty !== null ? (
        <span>qty {record.qty}</span>
      ) : record.parent_id ? (
        // 0024: a configuration carries no quantity, because the bill says 45
        // and never says how many are fabric A. Stated, never divided.
        <Chip tone="warn">qty not set</Chip>
      ) : (
        // The phase table's words for the same state. A mock-up item (0043)
        // always reads this: the bill never said how many are in the room.
        <span className="text-amber-800">{quantityNotGiven(record.qty_raw)}</span>
      )}
      {/* THE MOCK-UP, IN WHICHEVER DIRECTION THIS RECORD SITS (0043). */}
      {data.mockup?.of && (
        <>
          <span aria-hidden>·</span>
          <span>
            mock-up of{" "}
            <Link href={`/dashboard/records/${data.mockup.of.id}`} className="underline hover:text-neutral-900">
              {recordShortLabel(data.mockup.of.recordNo)} · {data.mockup.of.runName}
            </Link>
          </span>
        </>
      )}
      {(data.mockup?.copies ?? [])
        .filter((copy) => copy.status === "active")
        .map((copy) => (
          <Fragment key={copy.id}>
            <span aria-hidden>·</span>
            <Link href={`/dashboard/records/${copy.id}`} className="underline hover:text-neutral-900">
              Also in {copy.runName}
            </Link>
          </Fragment>
        ))}
      {record.source_line_no && <><span aria-hidden>·</span><span>BOQ row {record.source_line_no}</span></>}
      <span aria-hidden>·</span>
      {record.category_name ? (
        <Link href={runHref} className="underline hover:text-neutral-900">{record.category_name}</Link>
      ) : (
        <Chip tone="warn">no category</Chip>
      )}
      <span aria-hidden>·</span>
      {level ? (
        <Chip>{ITEM_LEVEL_LABELS[level]}</Chip>
      ) : record.level_suggested ? (
        <SuggestButton
          value={
            normaliseItemLevel(record.level_suggested)
              ? ITEM_LEVEL_LABELS[normaliseItemLevel(record.level_suggested)!]
              : record.level_suggested
          }
          evidence={record.level_suggested_reason ?? "guessed at intake"}
          busy={savingLevel}
          onAccept={() => void setLevel(record.level_suggested ?? "")}
        />
      ) : (
        <Chip tone="warn">no level</Chip>
      )}
      {data.designerContact && (
        <>
          <span aria-hidden>·</span>
          <span>
            designer{" "}
            <Link
              href={`/dashboard/projects/${record.project_id}?tab=overview`}
              className="underline hover:text-neutral-900"
            >
              {data.designerContact.designer_code} — {data.designerContact.name}
            </Link>
          </span>
        </>
      )}
      {!data.designerContact && record.designer && (
        <><span aria-hidden>·</span><span>designer {record.designer}</span></>
      )}
    </span>
  );

  return (
    <PageHeader
      // Back to the run this record is ON, not to the project's first one. A
      // record's number is project-wide, so the same code appears on the
      // mock-up run and the main run, and landing on the wrong tab means
      // hunting for the row you just left.
      crumbs={[{ label: `${record.bws_project_number} · ${record.run_name}`, href: runHref }]}
      // A LONG NAME IS CUT AS A STRING, one line, with the whole of it on
      // hover and in the Description beside the picture. The h1 used to be
      // the bill's entire description cell and stood four lines tall.
      title={<RecordTitle label={recordLabel} name={record.item_description} />}
      titleAside={
        // THE NAME A PERSON USES. A configuration's own record number is the
        // next free one in the project and says nothing about what it belongs
        // to; `S-201 A` is how it gets said out loud.
        record.variant_label ? <Chip mono>{variantName(parentRefs, record.variant_label, "")}</Chip> : undefined
      }
      subtitle={subtitle}
      actions={
        <>
          <Button onClick={onAddSpec}>
            Add a spec by hand
          </Button>
          {/* THE BUTTON COUNTS WHAT IT WILL ASK. `toQuote` includes the
              readiness rows we answer ourselves; the chase screen never
              selects those, so a button naming that figure lands on a screen
              ticking fewer. The muted line under it says which is which. */}
          {readiness.toChase !== null && readiness.toChase > 0 && (
            <Link href={chaseHref} className={buttonClass("primary", "sm")}>
              Chase the {readiness.toChase}
            </Link>
          )}
          {chaseCounts && (
            <span className="basis-full text-right text-xs text-neutral-500">{chaseCounts}</span>
          )}
        </>
      }
      tabs={tabs}
    />
  );
}
