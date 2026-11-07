"use client";

// The record's Specs tab: what documents have said about the item, each with
// the page it came from, the verbs on each spec, the disagreements between
// documents, the retired specs, the item's details, and the sidebar (the
// picture, quote readiness, the mock-up and Configurations cards). Moved out
// of src/app/dashboard/records/[id]/page.tsx on 2026-11-07 (audit 5.3, cut C).
//
// EVERY PIECE OF STATE HERE IS THE PAGE'S, passed in. This tab is unmounted
// whenever another is chosen, and before the split an open correction, a
// half-typed retire reason, the retired list and the bill line's folded specs
// were all still as they were left on coming back. Only what is derived from
// the payload is computed here.
import { Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fieldDisplayName } from "@/lib/spec-field-label";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { isFinishGroup } from "@/lib/finishes";
import { attributeDisplayLabel, documentLabelTitle } from "@/lib/attribute-label";
import { composeDimensionCell, toMillimetres, valueCarriesItsUnit } from "@/lib/dimensions";
import { ComposedDimensionText } from "@/components/records/ItemSpecChips";
import { OpenDisagreementRow, SettledDisagreementItem } from "@/components/records/DisagreementRows";
import SpecValue from "@/components/records/SpecValue";
import { variantName } from "@/lib/record-variants";
import { BwFinishFromLibrary, BwStandardPanel, BwStandardSummary, paletteForJsonId } from "@/components/records/BwStandardControl";
import Button, { buttonClass } from "@/components/ui/Button";
import RecordDetails from "@/components/records/RecordDetails";
import RecordPicture, { type RecordPictureState } from "@/components/records/RecordPicture";
import AddSpec from "@/components/records/AddSpec";
import TwinTicks, { asTwinAttribute, useTwinTicks } from "@/components/records/TwinTicks";
import TwinLinesPanel from "@/components/records/TwinLinesPanel";
import { twinOffer } from "@/lib/twin-offer";
import AddConfiguration from "@/components/records/AddConfiguration";
import BillLineConfigurations from "@/components/records/BillLineConfigurations";
import DifferingFields from "@/components/records/DifferingFields";
import { dimensionProvenance } from "@/components/records/dimension-provenance";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Tip from "@/components/ui/Tip";
import { Table, Th, Td, Tr, GroupRow } from "@/components/ui/Table";
import { TONE } from "@/components/ui/tone";
import ConfigurationPanel, { type ConfigurationPanelState } from "@/components/records/ConfigurationPanel";
import type { ChecklistSave } from "@/components/records/ChecklistTab";
import type { useAttributeActions } from "@/components/records/use-attribute-actions";
import type { ConfigurationFamily } from "@/lib/configuration-family";
import { labelOf, type FamilyMember, type Payload } from "@/components/records/record-payload";

const NO_PICTURE: RecordPictureState = { current: null, offered: null };

/**
 * Half a sentence on a group of captured specs, where the group carries a rule.
 *
 * On the heading rather than in a doc: "why is Dimension 5 a note and not a
 * height?" is a question somebody asks while looking at the row, and the
 * answer is the rule `normaliseDimensionSlot` follows.
 */
const GROUP_RULE: Partial<Record<AttributeGroup, string>> = {
  dimension: "— the ones that compose the cell above",
  note: "— kept with their own label, never folded into a slot",
};

export default function SpecsTab({
  data,
  parentRefs,
  billQty,
  variants,
  unallocated,
  splitLine,
  configurationFamily,
  readiness,
  chaseHref,
  projectWideHref,
  projectWideCount,
  classification,
  imageFailed,
  setImageFailed,
  addingSpec,
  setAddingSpec,
  addingConfiguration,
  onAddingConfigurationChange,
  openAddConfiguration,
  lineOwnOpen,
  setLineOwnOpen,
  showRetired,
  setShowRetired,
  actions,
  checklist,
  configurationPanel,
  load,
  reloadThen,
  reloadQuietly,
  onShowVersions,
}: {
  data: Payload;
  /** The bill line's client refs, read from the parent on a configuration. */
  parentRefs: string;
  billQty: number | null;
  variants: FamilyMember[];
  unallocated: number | null;
  /** A bill line with live configurations: its own specs fold away. */
  splitLine: boolean;
  configurationFamily: ConfigurationFamily | null;
  readiness: Payload["quoteReadiness"];
  chaseHref: string;
  projectWideHref: string;
  projectWideCount: number;
  /** The category and level selects, shown inside the details' Edit state. */
  classification: React.ReactNode;
  imageFailed: boolean;
  setImageFailed: (failed: boolean) => void;
  addingSpec: boolean;
  setAddingSpec: (open: boolean) => void;
  addingConfiguration: boolean;
  onAddingConfigurationChange: (open: boolean) => void;
  openAddConfiguration: () => void;
  lineOwnOpen: boolean;
  setLineOwnOpen: (update: (open: boolean) => boolean) => void;
  showRetired: boolean;
  setShowRetired: (update: (open: boolean) => boolean) => void;
  actions: ReturnType<typeof useAttributeActions>;
  checklist: Pick<ChecklistSave, "savingId" | "refusals" | "save">;
  configurationPanel: ConfigurationPanelState;
  load: () => Promise<void>;
  reloadThen: (message: string | null) => Promise<void>;
  reloadQuietly: () => Promise<void>;
  /** The Versions tab, where the reason for a supersession is read. */
  onShowVersions: () => void;
}) {
  const router = useRouter();
  const { record, answers, attributes } = data;
  const { savingId, refusals, save } = checklist;
  const {
    retiring,
    setRetiring,
    retireReason,
    setRetireReason,
    retireBusy,
    correcting,
    setCorrecting,
    correctValue,
    setCorrectValue,
    correctUnit,
    setCorrectUnit,
    correctState,
    setCorrectState,
    correctReason,
    setCorrectReason,
    correctBusy,
    standardEditing,
    setStandardEditing,
    attaching,
    setAttaching,
    attachTo,
    setAttachTo,
    attachReason,
    setAttachReason,
    attachBusy,
    retire,
    beginCorrection,
    correct,
    attach,
    restore,
  } = actions;

  // 0060: WHAT AN EDIT OR A RETIRE OFFERS THIS LINE'S TWINS, through the
  // function the write boundary re-runs under the lock. A configuration's
  // specs are its own, so it offers none.
  const lineTwins = record.parent_id ? [] : (data.twins ?? []);
  const correctOffer = correcting
    ? twinOffer({ act: "correct", row: asTwinAttribute(correcting, data.specFields ?? []) }, lineTwins)
    : [];
  const retireOffer = retiring
    ? twinOffer({ act: "retire", row: asTwinAttribute(retiring, data.specFields ?? []) }, lineTwins)
    : [];
  const correctTicks = useTwinTicks(correctOffer);
  const retireTicks = useTwinTicks(retireOffer);

  // The payload says whether a picture exists; `imageFailed` covers the one
  // case it cannot — a row that names a blob the store no longer holds. An
  // offered picture alone still puts the panel above the readiness card.
  const hasImage = (record.has_image && !imageFailed) || Boolean(data.picture?.offered);

  // Older responses have no `retiredAttributes`; a screen that assumed the key
  // exists would crash on the first record loaded from a cached payload.
  const retiredAttributes = data.retiredAttributes ?? [];
  // ---- disagreements between documents (0046) ------------------------------
  // An OPEN one sits under the live row it is about — the held row, or the row
  // that has since replaced it (`currentAttributeId`). One whose value has
  // gone with nothing in its place is listed on its own, never dropped. A
  // SETTLED one goes under "show retired", with the decision.
  const disagreements = data.disagreements ?? [];
  const openDisagreements = disagreements.filter((entry) => entry.status === "open");
  const liveIds = new Set(attributes.map((attribute) => attribute.id));
  const openUnder = (attributeId: string) =>
    openDisagreements.filter((entry) => entry.currentAttributeId === attributeId);
  const strandedDisagreements = openDisagreements.filter(
    (entry) => !entry.currentAttributeId || !liveIds.has(entry.currentAttributeId),
  );
  const settledDisagreements = disagreements.filter((entry) => entry.status !== "open");
  const slotted = attributes.filter(
    (attribute) => attribute.attr_group === "dimension" && attribute.dimension_slot,
  );
  const dimensionRows = slotted.map((attribute) => ({
    slot: attribute.dimension_slot as DimensionSlot,
    value: attribute.value,
    unit: (attribute.unit ?? null) as AttributeUnit | null,
    state: attribute.state,
    sortOrder: attribute.sort_order,
  }));
  // The note IS part of the cell, not a caption beside it (0034). Rendering
  // it separately here would show a reviewer something the file does not
  // say, which is the whole reason there is one composer.
  const dimensionCell = composeDimensionCell(dimensionRows, record.dimension_note);
  // THE SAME ROWS AS A PERSON READS THEM (2026-10-05): a feet-and-inches slot
  // as the page printed it, its millimetres in brackets. `dimensionCell` is
  // still what BWS receives, and is printed under it whenever they differ.
  const dimensionShown = composeDimensionCell(dimensionRows, record.dimension_note, { mode: "screen" });
  const provenance = dimensionProvenance(
    slotted.map((attribute) => ({
      unit: attribute.unit,
      sourceFilename: attribute.source_filename,
      sourcePage: attribute.source_page,
      sourceIsBill: attribute.source_is_bill === true,
    })),
  );
  const byGroup = ATTRIBUTE_GROUPS.map((group) => ({
    group,
    rows: attributes.filter((attribute) => attribute.attr_group === group),
  })).filter((entry) => entry.rows.length > 0);
  // How many distinct pages the captured specs came off, for the card heading.
  const pageCount = new Set(
    attributes
      .filter((attribute) => attribute.source_run_id)
      .map((attribute) => `${attribute.source_run_id}:${attribute.source_page ?? ""}`),
  ).size;
  /** The drawing set this item's specs came off — where its crop is chosen. */
  const drawingRunId =
    attributes.find((attribute) => attribute.source_document_kind === "shop_drawings" && attribute.source_run_id)
      ?.source_run_id ?? null;

  const specSource = (attribute: { source_run_id: string | null; source_page: number | null; source_filename: string | null }) =>
    attribute.source_run_id ? (
      // NO PAGE MEANS NO LINK TO A PAGE. A hand-typed spec carries neither,
      // deliberately, and a link opening a document at page 1 to stand in
      // would be a false provenance rather than a missing one.
      <a
        href={`/api/imports/${attribute.source_run_id}/source${attribute.source_page ? `#page=${attribute.source_page}` : ""}`}
        target="_blank"
        rel="noreferrer"
        title={`${attribute.source_filename ?? "source"}${attribute.source_page ? ` — page ${attribute.source_page}` : ""}`}
        // TRUNCATED, NOT WRAPPED. A real filename is `Ashcombe House - Shop
        // Drawings - Issue A.pdf`, and wrapping it made every row in the table
        // six lines tall — the value the reader came for pushed apart by the
        // name of the file it came from. The full name is on hover and in the
        // document it opens.
        className="block max-w-[9rem] truncate underline hover:text-neutral-900"
      >
        {attribute.source_filename ?? "source"}
        {attribute.source_page ? ` p${attribute.source_page}` : ""}
      </a>
    ) : (
      <span className="text-neutral-400">typed by hand</span>
    );

  return (
    <div className="grid items-start gap-4 min-[820px]:grid-cols-[minmax(0,1fr)_260px]">
      {/* ADD, BY HAND (2026-09-23), SPANNING BOTH COLUMNS: its own block,
          never squeezed into the sidebar. A sibling from a
          configuration's screen goes under the SAME bill line, so the
          panel is always given the parent. */}
      {addingConfiguration && (
        <div id="add-configuration" className="min-w-0 min-[820px]:col-span-2">
          <AddConfiguration
            billLineId={record.parent_id ?? record.id}
            onCancel={() => onAddingConfigurationChange(false)}
            onAdded={(added) => {
              onAddingConfigurationChange(false);
              router.push(`/dashboard/records/${added.recordId}`);
            }}
          />
        </div>
      )}
      <div className="min-w-0">
        {/* A CONFIGURATION'S OWN FIELDS COME FIRST, blank until somebody
            fills them: the fabrics (COM 1 to COM 3) are what make it a
            different chair from its siblings, and a configuration added
            by hand starts with every one of them `missing`. */}
        {record.parent_id && (
          <Card title={`What makes ${variantName(parentRefs, record.variant_label, "this configuration")} different`} className="mb-4">
            <DifferingFields
              answers={answers}
              palettes={data.palettes ?? []}
              paletteByQuestion={data.paletteByQuestion ?? []}
              savingId={savingId}
              refusals={refusals}
              onSave={(answer, value, state, qualifier) =>
                void save(answer, value, state, undefined, undefined, qualifier)
              }
            />
          </Card>
        )}
        {addingSpec && (
          <div className="mb-4">
            <AddSpec
              recordId={record.id}
              specFields={data.specFields ?? []}
              // 0060: a bill line's twins are offered the new spec; a
              // configuration's specs are its own.
              twins={record.parent_id ? [] : (data.twins ?? [])}
              onAdded={load}
              open
              onOpenChange={setAddingSpec}
            />
          </div>
        )}

        {/* A SPLIT BILL LINE SHOWS WHAT ITS CONFIGURATIONS HAVE IN COMMON
            (2026-09-23). Its own specs — anything it carried before it
            was split — are NOT exported, so they fold into one closed
            section below rather than heading the tab as though they
            were the item. */}
        {splitLine && configurationFamily && (
          <BillLineConfigurations
            lineId={record.id}
            family={configurationFamily}
            specFields={data.specFields ?? []}
            onDone={reloadThen}
          />
        )}
        {splitLine && (
          <div className="mt-4">
            <Button variant="quiet" size="xs" onClick={() => setLineOwnOpen((value) => !value)}>
              {lineOwnOpen ? "▾" : "▸"} On the bill line itself — not exported
              {attributes.length > 0 ? ` (${attributes.length} spec${attributes.length === 1 ? "" : "s"})` : " (none)"}
            </Button>
          </div>
        )}
        {/* TWO DOCUMENTS DISAGREE (0046). Said once at the top in red —
            the phase table's "n disagree" chip lands here — and each one
            is in red under the value it is about, where it is decided. */}
        {openDisagreements.length > 0 && (
          <div id="disagreements" className="mb-4 scroll-mt-24">
            <Note tone="danger" title={`${openDisagreements.length} value${openDisagreements.length === 1 ? "" : "s"} disagree between documents.`}>
              — the held value stands until somebody decides. Each is in red under the spec it is about: keep
              the held value, or use the other document&rsquo;s instead, and say why.
            </Note>
          </div>
        )}
        {(!splitLine || lineOwnOpen) && (
        <>
        {/* What BWS field 3 will receive, composed by the same function
            the export calls. The rows below keep each figure's ORIGINAL
            value and unit, which is what makes a converted W1900
            checkable against a page that says 190. */}
        {dimensionCell.text && (
          <Card
            title={dimensionShown.fromImperial ? "Dimensions" : "Dimensions, as BWS will receive them"}
            className="mt-0"
          >
            <ComposedDimensionText
              shown={dimensionShown}
              fileText={dimensionCell.text}
              className="font-mono text-base leading-6 tracking-[0.01em] text-neutral-900"
            />
            {provenance && <p className="mt-1.5 text-xs text-neutral-500">{provenance}</p>}
            {dimensionCell.problems.map((problem, index) => (
              <Note key={index} tone="warn">
                {problem.message}
              </Note>
            ))}
          </Card>
        )}

        {attributes.length === 0 ? (
          <Card title="Specs captured" className={dimensionCell.text ? "" : "mt-0"}>
            <p className="text-sm text-neutral-600">
              Nothing captured for this item yet. Upload the shop drawings for this pack and review them — a
              drawing confirmed against this code writes here.
            </p>
          </Card>
        ) : (
          <Card
            title="Specs captured"
            className={dimensionCell.text ? "" : "mt-0"}
            actions={
              <CardHeadingNote>
                {attributes.length} row{attributes.length === 1 ? "" : "s"} ·{" "}
                {pageCount === 0
                  ? "none off a document"
                  : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
              </CardHeadingNote>
            }
            flush
          >
            <Table>
              <thead>
                <tr>
                  <Th className="w-[24%]">Label</Th>
                  <Th className="w-[28%]">Value</Th>
                  <Th className="w-[22%]">BWS field</Th>
                  <Th className="w-[16%]">Source</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {byGroup.map(({ group, rows }) => (
                  <Fragment key={group}>
                    <GroupRow span={5} aside={GROUP_RULE[group]}>
                      {ATTRIBUTE_GROUP_LABELS[group]}
                    </GroupRow>
                    {rows.map((attribute) => (
                      <Fragment key={attribute.id}>
                      <Tr tone={openUnder(attribute.id).length > 0 ? "danger" : "plain"}>
                        <Td title={documentLabelTitle(labelOf(attribute))}>{attributeDisplayLabel(labelOf(attribute))}</Td>
                        <Td>
                          {attribute.state === "tbc" && !attribute.value ? (
                            <Chip tone="warn">TBC</Chip>
                          ) : (
                            <span className="text-neutral-900 [overflow-wrap:anywhere]">
                              {/* A note is routinely a page of general
                                  conditions in one row: clamped, and read
                                  back out of the drawing's capitals. Both
                                  are display only — see src/lib/shout.ts. */}
                              {attribute.value && <SpecValue text={attribute.value} />}
                              {/* An inch figure reads as the page printed it, 24", not "24in". */}
                              {attribute.unit && !valueCarriesItsUnit(attribute.value) && (
                                <span className="text-neutral-500">{attribute.unit === "in" ? '"' : attribute.unit}</span>
                              )}
                              <ImperialMillimetres attribute={attribute} />
                              {attribute.state === "tbc" && (
                                <span className="ml-1.5 align-middle"><Chip tone="warn">TBC</Chip></span>
                              )}
                            </span>
                          )}
                          {/* THE RETURN LINE (0029). Its own line, in its
                              own colour, because the whole point of
                              holding it apart is that a reader can tell
                              the spec from where it goes — which the
                              exported cell, joined with a hyphen, cannot. */}
                          {attribute.qualifier && (
                            <span className="mt-0.5 block text-xs text-neutral-500">{attribute.qualifier}</span>
                          )}
                          {/* THE BW STANDARD, BESIDE THE CLIENT'S WORDS
                              (0041). The value above is what the page
                              said and stays so; this is what BW will
                              make, and what the BWS file ships.
                              PER CODE ONLY (0045): a spec filed under a
                              library code takes BW's finish from the
                              code, so here it is a line and a link; an
                              unfiled one keeps the per-item control. */}
                          {attribute.finish_id ? (
                            <BwFinishFromLibrary attribute={attribute} projectId={record.project_id} />
                          ) : (
                            <BwStandardSummary
                              attribute={attribute}
                              palette={paletteForJsonId(data.palettes ?? [], data.paletteByQuestion ?? [], attribute.json_id)}
                              onSet={() => setStandardEditing({ id: attribute.id, mode: "set" })}
                              onAgree={() => setStandardEditing({ id: attribute.id, mode: "agree" })}
                            />
                          )}
                          {/* A LINKED finish is a link to the library,
                              because the library is what the export
                              renders and what a correction has to be made
                              in. An unlinked code is still just what the
                              page said. */}
                          {attribute.finish_id ? (
                            <Link
                              href={`/dashboard/projects/${record.project_id}?tab=finishes`}
                              className="ml-1.5 inline-block align-middle"
                              title={
                                attribute.finish_description
                                  ? `The library says: ${attribute.finish_description}`
                                  : "In the finishes library, with nothing recorded about it yet"
                              }
                            >
                              <Chip mono tone={attribute.finish_state === "tbc" ? "warn" : "plain"}>
                                {attribute.finish_code ?? attribute.material_code}
                                {/* WHOSE CODE IT IS (0036). `BW-F-001`
                                    is ours, minted because the client
                                    gave none, and it never reaches the
                                    BWS file — so a reader has to be able
                                    to tell it from a code they could go
                                    and look up on the client's own
                                    schedule. */}
                                {attribute.finish_code_origin === "internal" ? " · ours" : ""}
                                {attribute.finish_state === "tbc" ? " TBC" : ""}
                              </Chip>
                            </Link>
                          ) : (
                            attribute.material_code && (
                              <span className="ml-1.5 inline-block align-middle">
                                <Chip mono>{attribute.material_code}</Chip>
                              </span>
                            )
                          )}
                          {/* A FINISH ON NO LIBRARY ROW follows no
                              correction: editing the code later reaches
                              every item carrying it and not this one.
                              Said in words, because the row otherwise
                              looks exactly like a linked one. */}
                          {!attribute.finish_id && isFinishGroup(attribute.attr_group) && (
                            <span className="mt-0.5 block text-xs text-neutral-500">Not in the finishes library</span>
                          )}
                        </Td>
                        <Td muted>
                          {/* THE BWS ID IS OURS, AND IT IS NOT A LABEL.
                              `1 · COM 1` and a bare `3 ·` cost Matthew
                              ninety seconds and a wrong guess on
                              2026-09-18. The NAME stays, because that is
                              the word BWS shows him; the number moves
                              onto the title, where an editor debugging an
                              export cell can still reach it. This table
                              was the one screen item 1.3 missed.

                              A DIMENSION REACHES FIELD 3 BY ITS SLOT and
                              carries no `spec_field_id` of its own, so it
                              names the cell it composes into and takes
                              the same title. A row with neither prints a
                              dash — never "BWS null". */}
                          {attribute.field_name ? (
                            <span
                              title={
                                attribute.json_id !== null ? `BWS field ${attribute.json_id}` : undefined
                              }
                            >
                              {fieldDisplayName(attribute.field_name, attribute.json_id)}
                              {attribute.dimension_slot ? ` (${attribute.dimension_slot})` : ""}
                            </span>
                          ) : attribute.dimension_slot ? (
                            <span title="BWS field 3">Dimensions ({attribute.dimension_slot})</span>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td muted>{specSource(attribute)}</Td>
                        <Td className="text-right">
                          {/* May WRAP: three buttons side by side made
                              this a 279px column, and the table ran 39px
                              past its card at 1440. */}
                          <span className="flex flex-wrap items-center justify-end gap-1">
                            {/* A CONTROL LIVES BESIDE THE THING IT ACTS
                                ON. Matthew went looking for
                                confirm-or-update on a confirmed record
                                and there was no such verb: a value could
                                be retired, or a new one typed with no
                                page. Correcting keeps the page. */}
                            {/* "EDIT VALUE", NOT "CORRECT" (2026-10-15): Matthew
                                asked whether "Correct" marks the value as
                                correct. It opens the correction. */}
                            <Button
                              size="xs"
                              title="Change this value, keeping the page it was read from"
                              onClick={() => beginCorrection(attribute)}
                            >
                              Edit value
                            </Button>
                            {/* Kept, never deleted — the row stays as
                                evidence that a document said this, with who
                                took it off and why. */}
                            {/* THE LINK ROUTE HAS EXISTED SINCE 0018 AND
                                HAD NO BUTTON. This is it, and it is also
                                the recovery path for anything the
                                drawings card's automatic matching got
                                wrong. */}
                            {isFinishGroup(attribute.attr_group) && (
                              <Button
                                variant="quiet"
                                size="xs"
                                title="Link this spec to the project's finishes library, or let it stand on its own words"
                                onClick={() => {
                                  setAttaching(attribute);
                                  setAttachTo(attribute.finish_id ?? "");
                                  setAttachReason("");
                                }}
                              >
                                {attribute.finish_id ? "Change the finish…" : "Attach to a finish…"}
                              </Button>
                            )}
                            {/* Kept, never deleted — the row stays as
                                evidence that a document said this, with who
                                took it off and why. */}
                            <Button
                              variant="quiet"
                              size="xs"
                              title="Take this spec off the item"
                              onClick={() => {
                                setRetiring(attribute);
                                setRetireReason("");
                              }}
                            >
                              Retire
                            </Button>
                          </span>
                        </Td>
                      </Tr>
                      {/* EVERY OPEN DISAGREEMENT DIRECTLY BENEATH THE
                          VALUE IT IS ABOUT, red, each its own `tr`. */}
                      {openUnder(attribute.id).map((entry) => (
                        <OpenDisagreementRow key={entry.id} disagreement={entry} span={5} onReload={reloadQuietly} />
                      ))}
                      {/* A SPANNING PANEL IS ITS OWN `tr`, never an extra
                          `td colSpan` beside the data cells — that makes
                          the row ten column slots wide and the browser
                          squeezes the editor into a ribbon beside the
                          value it is editing. */}
                      {attaching?.id === attribute.id && (
                        <tr className="bg-blue-50/50">
                          <td colSpan={5} className="border-b border-blue-200 px-4 py-3">
                            <p className="text-sm font-medium text-neutral-900">
                              Which finish is “{attributeDisplayLabel(labelOf(attribute))}”?
                            </p>
                            <p className="mt-0.5 text-xs text-neutral-600">
                              A linked spec reads as the LIBRARY says it is — on this screen, in the checklist
                              answer and in the BWS file — so correcting the finish once corrects every item
                              carrying it. Unlinking leaves this item standing on its own words, and a later
                              correction will not reach it.
                            </p>
                            <div className="mt-2 flex flex-wrap items-end gap-3">
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                Finish
                                <select
                                  value={attachTo}
                                  onChange={(event) => setAttachTo(event.target.value)}
                                  className="min-w-[20rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                >
                                  <option value="">Not in the library — stand on this page&rsquo;s words</option>
                                  {data.finishes.map((finish) => (
                                    <option key={finish.id} value={finish.id}>
                                      {finish.code}
                                      {finish.code_origin === "internal" ? " (ours)" : ""}
                                      {finish.description ? ` — ${finish.description}` : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                                {/* REQUIRED TO UNLINK and optional to link, which is the
                                    route's own rule: unlinking is the one direction that
                                    takes an item out of reach of a later correction. */}
                                Why{attachTo === "" ? "" : " (optional)"}
                                <input
                                  value={attachReason}
                                  onChange={(event) => setAttachReason(event.target.value)}
                                  placeholder={
                                    attachTo === ""
                                      ? "This item's fabric is not the one the code names"
                                      : "Same fabric as S-203, filed under one code"
                                  }
                                  className="w-full min-w-[16rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                />
                              </label>
                            </div>
                            {data.finishes.length === 0 && (
                              <p className="mt-2 text-xs text-neutral-600">
                                This project&rsquo;s finishes library is empty. A finish is filed when a drawings
                                card is confirmed, or by hand on the project&rsquo;s Finishes tab.
                              </p>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={attachBusy || (attachTo === "" && !attachReason.trim())}
                                onClick={() => void attach()}
                              >
                                {attachBusy ? "Saving…" : attachTo === "" ? "Unlink it" : "Link it"}
                              </Button>
                              <Button variant="quiet" size="sm" onClick={() => setAttaching(null)}>
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {standardEditing?.id === attribute.id && !attribute.finish_id && (
                        <BwStandardPanel
                          attribute={attribute}
                          palette={paletteForJsonId(data.palettes ?? [], data.paletteByQuestion ?? [], attribute.json_id)}
                          projectId={record.project_id}
                          mode={standardEditing.mode}
                          span={5}
                          onClose={() => setStandardEditing(null)}
                          onSaved={async (message, ok) => {
                            await reloadThen(message);
                            if (ok) setStandardEditing(null);
                          }}
                        />
                      )}
                      {correcting?.id === attribute.id && (
                        <tr className="bg-amber-50/60">
                          <td colSpan={5} className="border-b border-amber-200 px-4 py-3">
                            <p className="text-sm font-medium text-neutral-900">
                              Edit “{attributeDisplayLabel(labelOf(attribute))}”
                            </p>
                            <p className="mt-0.5 text-xs text-neutral-600">
                              The old value is kept and marked as superseded, and the new one KEEPS the page it
                              was read from — {specSource(attribute)} — because that is still where to check it.
                              Any checklist answer it fills is recomposed.
                            </p>
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                Value
                                <input
                                  value={correctValue}
                                  autoFocus
                                  onChange={(event) => setCorrectValue(event.target.value)}
                                  className="w-64 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                />
                              </label>
                              {/* Dimensions only: 0007 refuses a unit on
                                  anything else, and an empty select
                                  beside a fabric reads as a question. */}
                              {attribute.attr_group === "dimension" && (
                                <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                  Unit
                                  <select
                                    value={correctUnit}
                                    onChange={(event) =>
                                      setCorrectUnit(event.target.value as AttributeUnit | "")
                                    }
                                    className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                  >
                                    <option value="">not stated</option>
                                    {ATTRIBUTE_UNITS.map((unit) => (
                                      <option key={unit} value={unit}>
                                        {unit}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                State
                                <select
                                  value={correctState}
                                  onChange={(event) =>
                                    setCorrectState(event.target.value as AttributeState)
                                  }
                                  className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                >
                                  <option value="confirmed">Confirmed</option>
                                  <option value="tbc">TBC</option>
                                </select>
                              </label>
                              <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                                Why
                                <input
                                  value={correctReason}
                                  onChange={(event) => setCorrectReason(event.target.value)}
                                  placeholder="Misread off page 4 — the drawing says 1090"
                                  className="w-full min-w-[16rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                />
                              </label>
                            </div>
                            <TwinTicks offer={correctOffer} ticks={correctTicks} disabled={correctBusy} />
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={!correctReason.trim() || correctBusy}
                                onClick={() => void correct(correctTicks.also)}
                              >
                                {correctBusy ? "Saving…" : "Save the correction"}
                              </Button>
                              <Button variant="quiet" size="sm" onClick={() => setCorrecting(null)}>
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        {retiring && (
          <Note
            tone="danger"
            title={`Take “${attributeDisplayLabel(labelOf(retiring))}${retiring.value ? `: ${retiring.value}` : ""}” off this item?`}
          >
            <span className="block">
              It is kept as a record that the document said it, and stops counting towards the checklist and
              the export. Any checklist answer it filled is recomposed from what is left, or put back to
              missing.
            </span>
            <input
              value={retireReason}
              autoFocus
              onChange={(event) => setRetireReason(event.target.value)}
              placeholder="Superseded by the Rev B drawing issued 14 Sep"
              className="mt-2 w-full rounded border border-red-300 bg-white px-2 py-1 text-sm"
            />
            <TwinTicks offer={retireOffer} ticks={retireTicks} disabled={retireBusy} />
            <span className="mt-2 flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={!retireReason.trim() || retireBusy}
                onClick={() => void retire(retireTicks.also)}
              >
                {retireBusy ? "Retiring…" : "Retire it"}
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setRetiring(null)}>
                Keep it
              </Button>
            </span>
          </Note>
        )}

        {/* AN OPEN DISAGREEMENT WHOSE VALUE HAS GONE, with nothing live
            in its place (retired, not replaced). Still undecided, so it
            is listed — in red, on its own — and never dropped. */}
        {strandedDisagreements.length > 0 && (
          <Card title="Disagreements about specs no longer on this item" flush>
            <Table>
              <tbody>
                {strandedDisagreements.map((entry) => (
                  <OpenDisagreementRow key={entry.id} disagreement={entry} span={1} onReload={reloadQuietly} />
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        {/* Kept, never deleted, and never silently. A retired spec that
            could not be seen would make "retire" a delete with extra
            steps. A SETTLED disagreement goes here too: both values
            stay on record whichever won, with who decided and why. */}
        {(retiredAttributes.length > 0 || settledDisagreements.length > 0) && (
          <div className="mt-3">
            <Button variant="quiet" size="xs" onClick={() => setShowRetired((value) => !value)}>
              {showRetired ? "▾" : "▸"}{" "}
              {[
                retiredAttributes.length > 0
                  ? `${retiredAttributes.length} retired spec${retiredAttributes.length === 1 ? "" : "s"}`
                  : null,
                settledDisagreements.length > 0
                  ? `${settledDisagreements.length} settled disagreement${settledDisagreements.length === 1 ? "" : "s"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Button>
            {showRetired && settledDisagreements.length > 0 && (
              <ul
                aria-label="Settled disagreements"
                className="mt-1 divide-y divide-neutral-200 rounded-[10px] border border-neutral-200 bg-neutral-50"
              >
                {settledDisagreements.map((entry) => (
                  <SettledDisagreementItem key={entry.id} disagreement={entry} />
                ))}
              </ul>
            )}
            {showRetired && retiredAttributes.length > 0 && (
              <ul className="mt-1 divide-y divide-neutral-200 rounded-[10px] border border-neutral-200 bg-neutral-50">
                {retiredAttributes.map((attribute) => (
                  <li key={attribute.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <span className="w-40 shrink-0 text-neutral-400 line-through" title={documentLabelTitle(labelOf(attribute))}>
                      {attributeDisplayLabel(labelOf(attribute))}
                    </span>
                    <span className="min-w-[10rem] flex-1 text-neutral-400 line-through">
                      {attribute.value}
                      {valueCarriesItsUnit(attribute.value) ? null : attribute.unit}
                    </span>
                    <span className="text-xs text-neutral-400">
                      retired{attribute.retired_by ? ` by ${attribute.retired_by}` : ""}
                    </span>
                    {attribute.superseded_by_id ? (
                      // SUPERSEDED, and by WHAT. Putting it back would
                      // leave the item holding both with nothing to say
                      // which is current, so the button is not offered —
                      // and the row names the value that took over,
                      // looked up among the live specs above rather than
                      // asserted to be "a later drawing", which since
                      // 0033 it may not be.
                      (() => {
                        const replacement = attributes.find(
                          (live) => live.id === attribute.superseded_by_id,
                        );
                        return (
                          <span className="text-xs text-neutral-500">
                            {replacement
                              ? `superseded by “${replacement.value ?? "TBC"}${replacement.unit ?? ""}”`
                              : "superseded by a later spec"}
                            {/* THE WHY LIVES ON THE CHANGE, not on this
                                row: a reason belongs to the act, and the
                                Versions tab is where the act is read. */}
                            {" · "}
                            <button
                              type="button"
                              onClick={onShowVersions}
                              className="text-blue-700 hover:underline"
                            >
                              why
                            </button>
                          </span>
                        );
                      })()
                    ) : (
                      <Button size="xs" disabled={retireBusy} onClick={() => void restore(attribute)}>
                        Put back
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        </>
        )}

        {/* THE BILL'S OWN WORDS, AND THE TWO FREE-TEXT COLUMNS (0028).
            Last, because the specs are what you came to read and this is
            filled in once. */}
        {/* The anchor a TGQ row on a record column links to ("Designer
            reference — on this item's details"). */}
        <div id="item-details" className="scroll-mt-24">
          <RecordDetails
            recordId={record.id}
            record={record}
            onSaved={load}
            classification={classification}
          />
        </div>
      </div>

      {/* THE STICKY SIDEBAR. Recognising the item is the reason the
          picture is there at all, so it stays beside you while the spec
          table scrolls. It heads its own column, which is what makes the
          two columns start on the same line. */}
      <div className="min-[820px]:sticky min-[820px]:top-4">
        {/* WHERE THE PICTURE CAME FROM, and the one other picture a
            person may swap in — a drawing never displaces a bill's
            photograph on its own (2026-10-05). */}
        <RecordPicture
          recordId={record.id}
          alt={record.item_description}
          picture={data.picture ?? NO_PICTURE}
          failed={imageFailed}
          onFailed={() => setImageFailed(true)}
          drawingRunId={drawingRunId}
          onChosen={(failure) => void reloadThen(failure)}
        />

        <Card title="Quote readiness" className={hasImage ? "" : "mt-0"}>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-semibold tabular-nums ${
                readiness.toQuote === null ? TONE.plain.text : TONE.danger.text
              }`}
            >
              {readiness.toQuote ?? "—"}
            </span>
            <span className="text-neutral-500">
              TGQ
              {readiness.noLevel && (
                <Tip>
                  This item has no level, and the fallback model needs one to say which questions block a
                  quote. A guess here would make the record look urgent or quotable, and only a person can
                  decide which.
                </Tip>
              )}
            </span>
          </div>
          {/* PROJECT-WIDE, APART FROM THE ITEM'S OWN (Max, 2026-10-12).
              They still block every quote, so they are said here — but
              they are answered once on the project, and the number
              above is this item's own work. */}
          {projectWideCount > 0 && (
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-[17px] font-semibold tabular-nums ${TONE.danger.text}`}>
                {projectWideCount}
              </span>
              <Link href={projectWideHref} className="text-neutral-500 no-underline hover:underline">
                project-wide, answered once on the project
              </Link>
            </div>
          )}
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-[17px] font-semibold tabular-nums ${TONE.warn.text}`}>
              {readiness.alsoOutstanding ?? readiness.outstanding}
            </span>
            <span className="text-neutral-500">
              {readiness.alsoOutstanding === null ? "outstanding, untiered" : "also outstanding"}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-[17px] font-semibold tabular-nums ${TONE.good.text}`}>
              {readiness.settled}
            </span>
            <span className="text-neutral-500">settled</span>
          </div>
          {/* The same button, so it carries the same number. */}
          {readiness.toChase !== null && readiness.toChase > 0 && (
            <Link href={chaseHref} className={buttonClass("secondary", "sm", "mt-3 w-full")}>
              Chase the {readiness.toChase}
            </Link>
          )}
        </Card>

        <ConfigurationPanel
          state={configurationPanel}
          record={record}
          mockup={data.mockup}
          parentRefs={parentRefs}
          billQty={billQty}
          variants={variants}
          unallocated={unallocated}
          addingConfiguration={addingConfiguration}
          onAddConfiguration={openAddConfiguration}
          reloadThen={reloadThen}
        />
        {/* 0060: the lines that are this item too. Under Configurations,
            in the same sidebar column. */}
        <TwinLinesPanel record={record} twins={data.twins ?? []} reloadThen={reloadThen} />
      </div>
    </div>
  );
}

/**
 * The millimetres beside a dimension the page printed in feet and inches —
 * "always keep the original measurement, but have in brackets beside it the
 * one in millimeters" (Max, 2026-10-05). `toMillimetres` is the conversion the
 * composer uses, so this bracket and the composed cell above cannot differ.
 * Nothing for a metric row, a note, or a figure that does not read completely.
 */
function ImperialMillimetres({
  attribute,
}: {
  attribute: { attr_group: string; value: string | null; unit: string | null };
}) {
  if (attribute.attr_group !== "dimension" || !attribute.value) return null;
  const imperial = attribute.unit === "in" || (attribute.unit === null && valueCarriesItsUnit(attribute.value));
  if (!imperial) return null;
  const result = toMillimetres(attribute.value, "in");
  if (!result.ok) return null;
  return <span className="ml-1 font-mono text-neutral-500">({result.mm}mm)</span>;
}
