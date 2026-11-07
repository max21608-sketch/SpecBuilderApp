"use client";

// One spec record: what documents have said about it, and what its category's
// checklist still asks.
//
// THE SPECS COME FIRST, because they are the intake stage's product: statements
// a client document made about this item, each with the page it came from. The
// checklist below them measures a later stage, and a record may not even have
// been given a category yet — intake no longer waits for that decision, so this
// screen is where one is chosen.
//
// A question with no answer row still appears, as `missing` — that half of the
// screen is driven by the requirement list, not by the answers that exist.
//
// ============================================================================
// THE IDENTITY IS THE HEADER AND THE PICTURE, AND NEITHER IS IN A TAB.
//
// CLAUDE.md's rule for this screen is that what tells you WHICH item you are
// looking at stays above the tab content. In this layout the description is
// the `h1` and the picture heads the Specs tab's own sticky column, which is
// where a reader looks while checking a value against a page — and which also
// closes the alignment finding of 2026-09-18: the picture used to be a grid
// track beside `RecordDetails`, whose own heading began lower than the box did,
// so `items-start` aligned two things that did not start in the same place.
// Now both columns begin with a box at the same top edge.
// ============================================================================
import { Fragment, Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Spinner from "@/components/ui/Spinner";
import { ITEM_LEVELS, ITEM_LEVEL_LABELS, normaliseItemLevel } from "@/lib/spec-vocab";
import { NO_LEVEL_EXPLANATION } from "@/lib/tgq";
import { unallocatedQty, variantName } from "@/lib/record-variants";
import { recordLabel as formatRecordLabel, recordShortLabel } from "@/lib/record-label";
import RecordHistory from "@/components/history/RecordHistory";
import RecordDocuments from "@/components/records/RecordDocuments";
import ReasonPrompt from "@/components/history/ReasonPrompt";
import Button, { buttonClass } from "@/components/ui/Button";
import GatePanel from "@/components/records/GatePanel";
import { GATES } from "@/lib/gates";
import { describeChaseCounts, summariseGateRows } from "@/lib/chase-counts";
import PageBody from "@/components/ui/PageBody";
import PageHeader from "@/components/ui/PageHeader";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import SuggestButton from "@/components/ui/SuggestButton";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/lib/use-url-tab";
import RecordTitle from "@/components/records/RecordTitle";
import { useAttributeActions } from "@/components/records/use-attribute-actions";
import { useConfigurationPanelState } from "@/components/records/ConfigurationPanel";
import ChecklistTab, { useChecklistSave } from "@/components/records/ChecklistTab";
import SpecsTab from "@/components/records/SpecsTab";

export type { Answer, DesignerContact, Payload } from "@/components/records/record-payload";
import type { Payload } from "@/components/records/record-payload";

/**
 * The jobs this screen does, one tab each. Documents joined on 2026-10-05
 * ("all the documents relating to that line item"), before Versions: which
 * documents the item is built from is read far more often than its trail.
 */
const RECORD_TABS = ["specs", "checklist", "gates", "documents", "versions"] as const;
type RecordTab = (typeof RECORD_TABS)[number];

function RecordView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);
  /**
   * WHICH TAB. The record was one page of four stacked sections — the specs,
   * the checklist, the gates and the history — and the checklist alone is 43
   * questions, so the history sat below about four screens of scrolling and
   * was collapsed behind a toggle to stop it being five.
   *
   * Collapsing was the wrong fix: a thing you have to expand every time is a
   * thing people stop opening. They are four different jobs done at four
   * different moments, and a tab each is how you get to the one you came for.
   */
  const [tab, setTab] = useUrlTab<RecordTab>({
    fallback: "specs",
    resolve: (raw) => (RECORD_TABS.includes(raw as RecordTab) ? (raw as RecordTab) : null),
  });
  // THE PAYLOAD SAYS WHETHER THERE IS A PICTURE.
  //
  // This used to be optimistic — render the `<img>`, let the 404 turn it off —
  // on the argument that asking first would cost a second round trip. It does
  // not: `/api/records/[id]` is loaded anyway and now carries `has_image`, so
  // the flag is free and the console stops collecting an EXPECTED 404 on every
  // record with no crop (found-in-use 2026-09-20). `onError` stays, for a crop
  // whose blob has gone: the row says there is a picture and the fetch is what
  // finds out there is not.
  const [imageFailed, setImageFailed] = useState(false);
  // Bumped after every successful write, so the history list below reloads
  // under the edit that caused it instead of going stale until a page reload.
  // NEVER part of an input's key (audit G2): see `refusals`.
  const [historyKey, setHistoryKey] = useState(0);
  // NULL UNTIL THE TAB HAS LOADED ITS LIST. The count is the length of that
  // list rather than a second query in the record route: one loader decides
  // which documents count, and a tab number computed elsewhere is how the
  // count and the table come to disagree. Versions makes the same choice.
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const checklist = useChecklistSave({ recordId: id, answers: data?.answers ?? null, reloadThen, setError });
  const { refused, pendingReason, setPendingReason, saveWithReason } = checklist;
  // The spec verbs' open boxes and the retired list's fold are the page's,
  // not the Specs tab's: that tab is unmounted on any other, and an open
  // correction has always outlived a visit to the Checklist and back.
  const attributeActions = useAttributeActions(reloadThen);
  const [showRetired, setShowRetired] = useState(false);
  // The header's "Add a spec by hand" opens the form beside the specs it adds
  // to. One action, one button: the page-level action lives in the band.
  const [addingSpec, setAddingSpec] = useState(false);
  // "Add a configuration" (2026-09-23). The panel opens at the top of the
  // Specs tab; the button is in the Configurations card, beside the family.
  const [addingConfiguration, setAddingConfiguration] = useState(false);
  // A split bill line's own pre-split specs fold away, CLOSED: they are not
  // exported, and heading the tab they read as the item.
  const [lineOwnOpen, setLineOwnOpen] = useState(false);
  // Rename and retire on the Configurations card: the page's, so they outlive
  // a visit to another tab, as they did when they were declared here.
  const configurationPanel = useConfigurationPanelState();

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/records/${id}`);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setData(res.data);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Reload first, report afterwards.
   *
   * `load()` clears the banner on a successful fetch, so `setError(...)`
   * followed by `await load()` showed a refusal for a few milliseconds and
   * then nothing at all — the click simply looked as though it had not
   * registered. The reload itself is still required: a refused request means
   * this screen is out of date. Same rule as both drawings screens.
   */
  async function reloadThen(message: string | null) {
    await load();
    if (message) setError(message);
    setHistoryKey((key) => key + 1);
  }
  /** A reload for a row that reports its own refusal (a disagreement row). */
  async function reloadQuietly() {
    await reloadThen(null);
  }
  // A swap is a different picture, so the failure flag goes with the current
  // picture. A different RECORD is a different view altogether (`RecordForId`
  // keys it by id), so nothing here has to be reset by hand when the id moves,
  // which is how most of this state used to be forgotten.
  const currentPictureId = data?.picture?.current?.id ?? null;
  useEffect(() => { setImageFailed(false); }, [currentPictureId]);

  async function setLevel(next: string) {
    if (!data) return;
    setSavingLevel(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/records/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: next === "" ? null : next, version: data.record.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      // Always reset: an HTML error page must not leave the select disabled.
      setSavingLevel(false);
    }
  }

  async function setCategory(categoryId: string) {
    if (!data || !categoryId) return;
    setSavingCategory(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/records/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, version: data.record.version }),
      });
      await reloadThen(res.ok ? null : res.error);
    } finally {
      // Always reset: an HTML error page must not leave the select disabled.
      setSavingCategory(false);
    }
  }

  /** Opens the Add panel at the top of the Specs tab and brings it into view. */
  function openAddConfiguration() {
    setAddingConfiguration(true);
    setTab("specs");
    requestAnimationFrame(() => document.getElementById("add-configuration")?.scrollIntoView({ block: "start" }));
  }


  if (error && !data) return <PageBody><Note tone="danger">{error}</Note></PageBody>;
  if (!data) return <PageBody><Spinner label="Loading record" /></PageBody>;

  const { record, refs, answers, attributes, categories } = data;

  // ---- the fabric split, from whichever end this record is ------------------
  //
  // `family` comes back parent-first, so the head of it is the bill line
  // whether this record IS that line or hangs off it. The client ref is read
  // from the parent because a configuration deliberately carries none of its
  // own — see `ensureVariant`.
  const family = data.family ?? [];
  // Older payloads have no `configurationFamily`; a bill line then renders as
  // it always did.
  const configurationFamily = data.configurationFamily ?? null;
  const splitLine = !record.parent_id && Boolean(configurationFamily && configurationFamily.configurations.length > 0);
  const billLine = family.find((member) => member.variant_label === null) ?? null;
  const variants = family.filter((member) => member.variant_label !== null);
  const parentRefs = billLine?.refs ?? refs.map((ref) => ref.ref_value).join(", ");
  const billQty = billLine?.qty ?? null;
  const unallocated = unallocatedQty(billQty, variants.map((member) => member.qty));

  // THE ONE LABEL HELPER (0039): `P18181-012.3` on a configuration, whose own
  // record_no is just the next free number in the project.
  const recordLabel = formatRecordLabel(record.bws_project_number, {
    recordNo: record.record_no,
    parentRecordNo: record.parent_record_no ?? null,
    variantOrdinal: record.variant_ordinal ?? null,
  });
  const runHref = `/dashboard/projects/${record.project_id}?tab=${record.run_id}`;
  const level = normaliseItemLevel(record.level);
  const readiness = data.quoteReadiness ?? {
    toQuote: null, toChase: null, alsoOutstanding: null, outstanding: 0, settled: 0, notApplicable: 0, noLevel: true,
  };

  /**
   * The counts the tabs carry.
   *
   * Outstanding is missing OR TBC, which are two different things and both
   * unsettled — the invariant the whole gate model rests on. Settled is
   * confirmed or N/A.
   *
   * The gate label is "n of 3" over the three gates, and NULL where Matthew's
   * matrix does not cover this category. A gates tab reading "0 of 3" there
   * would say the record fails three gates; it has none, and the panel inside
   * says so in words.
   */
  const outstandingCount = answers.filter(
    (answer) => answer.state === "missing" || answer.state === "tbc",
  ).length;
  // WHY THE NUMBERS ON THIS SCREEN DIFFER, DERIVED FROM THE ROWS BELOW THEM.
  //
  // Not from a remembered cause: driven on the sandbox, the gap on one sofa
  // was Spec notes and Designer reference — rows read off this record's own
  // columns, with no checklist question and nowhere to chase — and on another
  // record it is a dimension slot or a readiness question. `summariseGateRows`
  // buckets the TGQ rows the panel is about to list, so the line can only ever
  // describe what is on the screen. Null where Matthew's matrix does not reach
  // the category: there is no second measure there to explain.
  const tgqBuckets = data.gates ? summariseGateRows(data.gates.TGQ.fields, answers) : null;
  const chaseCounts = describeChaseCounts({
    buckets: tgqBuckets,
    toChase: readiness.toChase,
    toQuote: readiness.toQuote,
    projectWide: readiness.projectWide ?? null,
  });

  const gateSummaryLabel = data.gates
    ? `${GATES.filter((gate) => data.gates![gate].satisfied).length} of ${GATES.length}`
    : null;
  const gateTone: "warn" | "good" | "plain" = !data.gates
    ? "plain"
    : GATES.every((gate) => data.gates![gate].satisfied)
      ? "good"
      : "warn";


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
        <span className="text-amber-800">quantity not given</span>
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

  /** The category and level selects, shown inside `RecordDetails`' Edit state. */
  const classification = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs text-neutral-600">
        Category
        <select
          value={record.category_id ?? ""}
          disabled={savingCategory}
          onChange={(event) => void setCategory(event.target.value)}
          className="ml-2 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">— not chosen —</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.family === "upholstery" ? "Uph" : "Cab"} · {category.name}
            </option>
          ))}
        </select>
      </label>
      {/* NOT PRE-FILLED WITH THE SUGGESTION. A select showing "Simple" fires no
          change event when somebody picks Simple, so the one action a reader
          would take to agree would do nothing at all. Agreeing is the dashed
          blue button in the header, which carries its evidence. */}
      <label className="text-xs text-neutral-600">
        Level
        <select
          value={record.level ?? ""}
          disabled={savingLevel}
          onChange={(event) => void setLevel(event.target.value)}
          className="ml-2 border border-neutral-300 rounded px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">— not set —</option>
          {ITEM_LEVELS.map((value) => (
            <option key={value} value={value}>
              {ITEM_LEVEL_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      {!record.category_id && (
        <span className="text-xs text-neutral-500">
          No checklist yet — choosing a category adds its questions.
        </span>
      )}
      {record.category_id && !record.level && !record.level_suggested && (
        <span className="text-xs text-amber-800">{NO_LEVEL_EXPLANATION}</span>
      )}
    </div>
  );

  const chaseHref = `/dashboard/drafts?projectId=${record.project_id}`;
  /** The overview's Project-wide card, where those questions are answered once for every item. */
  const projectWideHref = `/dashboard/projects/${record.project_id}?tab=overview#project-wide`;
  const projectWideCount = readiness.projectWide ?? 0;

  return (
    <>
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
            <Button
              onClick={() => {
                setTab("specs");
                setAddingSpec(true);
              }}
            >
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
        tabs={
          <Tabs
            label="What to do with this record"
            value={tab}
            onChange={setTab}
            items={[
              // A count is null where a number would be a LIE, not merely
              // absent. Versions is not loaded until its tab is opened, so a
              // figure there would either be wrong or force a query nobody
              // asked for; and the Gates count is null where Matthew's matrix
              // does not reach the category, because `0 of 3` there says the
              // record fails three gates it does not have.
              { id: "specs", label: "Specs captured", count: attributes.length === 0 ? null : attributes.length },
              {
                id: "checklist",
                label: "Checklist",
                // "47 OPEN", NOT "47 / 50", which read as 47 done of 50
                // (found-in-use, 2026-10-12). One wording wherever the pair is
                // shown: the open count; the total is the "showing n of N" line inside.
                count: answers.length === 0 ? null : `${outstandingCount} open`,
                tone: outstandingCount > 0 ? "warn" : "good",
              },
              { id: "gates", label: "Gates", count: gateSummaryLabel, tone: gateTone },
              { id: "documents", label: "Documents", count: documentCount },
              { id: "versions", label: "Versions", count: null },
            ]}
          />
        }
      />
      <PageBody>
        {error && <Note tone="danger">{error}</Note>}

        {pendingReason && (
          <ReasonPrompt
            pending={pendingReason}
            projectId={record.project_id}
            onCancel={() => {
              // Nothing was saved, so the box shows the server's value again.
              refused(pendingReason.answerId);
              setPendingReason(null);
            }}
            onSubmit={saveWithReason}
          />
        )}

        {tab === "specs" && (
          <SpecsTab
            data={data}
            parentRefs={parentRefs}
            billQty={billQty}
            variants={variants}
            unallocated={unallocated}
            splitLine={splitLine}
            configurationFamily={configurationFamily}
            readiness={readiness}
            chaseHref={chaseHref}
            projectWideHref={projectWideHref}
            projectWideCount={projectWideCount}
            classification={classification}
            imageFailed={imageFailed}
            setImageFailed={setImageFailed}
            addingSpec={addingSpec}
            setAddingSpec={setAddingSpec}
            addingConfiguration={addingConfiguration}
            onAddingConfigurationChange={setAddingConfiguration}
            openAddConfiguration={openAddConfiguration}
            lineOwnOpen={lineOwnOpen}
            setLineOwnOpen={setLineOwnOpen}
            showRetired={showRetired}
            setShowRetired={setShowRetired}
            actions={attributeActions}
            checklist={checklist}
            configurationPanel={configurationPanel}
            load={load}
            reloadThen={reloadThen}
            reloadQuietly={reloadQuietly}
            onShowVersions={() => setTab("versions")}
          />
        )}


        {tab === "checklist" && (
          <ChecklistTab
            record={record}
            payload={data}
            answers={answers}
            attributes={attributes}
            level={level}
            readiness={readiness}
            commonFamily={splitLine ? configurationFamily : null}
            checklist={checklist}
            reloadThen={reloadThen}
          />
        )}

        {/* MATTHEW'S MATRIX, and what each gate still wants. Its own tab rather
            than a panel above the 43-question checklist: the checklist is the
            full cheat sheet and always was, and this is the part somebody has
            to act on before the next milestone. */}
        {tab === "gates" && (
          <GatePanel
            gates={data.gates}
            matrixFields={data.matrixFields}
            answers={answers}
            palettes={data.palettes ?? []}
            categoryName={record.category_name}
            chaseHref={chaseHref}
            projectWideHref={projectWideHref}
          />
        )}

        {/* NOT COLLAPSED ANY MORE. It was behind a toggle because it sat under
            four screens of checklist; on its own tab it can simply be the page. */}
        {/* Loaded when opened, like Versions; the count appears once it has. */}
        {tab === "documents" && (
          <RecordDocuments recordId={record.id} reloadKey={historyKey} onCount={setDocumentCount} />
        )}

        {tab === "versions" && (
          <RecordHistory recordId={record.id} projectId={record.project_id} reloadKey={historyKey} />
        )}
      </PageBody>
    </>
  );
}

// `useUrlTab` reads `useSearchParams`, which Next requires to sit under a
// Suspense boundary.
export default function RecordPage() {
  return (
    <Suspense fallback={<PageBody><Spinner label="Loading the record" /></PageBody>}>
      <RecordForId />
    </Suspense>
  );
}

/**
 * ONE VIEW PER RECORD (audit G9).
 *
 * Next reuses this page's component when the id in the URL changes, so every
 * piece of state in `RecordView` used to carry over from one record to the
 * next: an open correction, a retire box, a pending reason, a rename, the
 * history's picked versions. And `load()` never cleared `data`, so the previous
 * record rendered under the new URL until the fetch landed, and an action in
 * that window sent A's version to B's id. Keyed by the id, a new record is a
 * new view: its state starts empty and it shows the loading state until its
 * own data is in.
 */
function RecordForId() {
  const { id } = useParams<{ id: string }>();
  return <RecordView key={id} />;
}
