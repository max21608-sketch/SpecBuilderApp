"use client";

// A split bill line's Specs tab: what its configurations have in common, where
// they differ, and each one's own.
//
// ============================================================================
// THE LINE IS A HEADING, AND IT USED TO SHOW NOTHING.
//
// A bill line with live configurations is not exported — its configurations
// are the jobs (0024) — so its own "Specs captured" held only whatever it
// carried before it was split, and S-301's line 12 read as an item nobody had
// specced. Max, 2026-09-23: show the specs COMMON to all its configurations,
// and let an edit there change every one of them.
//
// Three blocks, in the order a reader needs them:
//
//   1. COMMON TO ALL N — the rows every configuration states identically,
//      each with Correct and Retire that fan out to all N as ONE change
//      (`POST /api/records/[id]/common`), and "Add to all" for a spec none of
//      them holds yet. The composed dimension cell over the common slots is
//      `composeDimensionCell`'s, as everywhere.
//   2. DIFFERS — each row that is not the same everywhere, with every
//      configuration's value beside its number. NOT EDITABLE HERE, and that is
//      the trap it exists to avoid: a "common" edit landing on a
//      configuration somebody deliberately made different. It is changed on
//      that configuration's own screen.
//   3. A TAB PER CONFIGURATION, in natural order, in the same layout every
//      time, showing what is that configuration's own — everything not common.
//
// Every edit sends every row and version the screen showed, and the server
// refuses the whole edit in words if any of it moved. The refusal is shown,
// and the screen reloads so the next attempt is against what is there.
// ============================================================================
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Tabs from "@/components/ui/Tabs";
import { Table, Th, Td, Tr, GroupRow } from "@/components/ui/Table";
import SpecValue from "@/components/records/SpecValue";
import { composeDimensionCell, parseDimensionFigure } from "@/lib/dimensions";
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_GROUP_LABELS,
  ATTRIBUTE_UNITS,
  DIMENSION_SLOTS,
  DIMENSION_SLOT_LABELS,
  type AttributeGroup,
  type AttributeState,
  type AttributeUnit,
  type DimensionSlot,
} from "@/lib/spec-vocab";
import { readCommonSpecs, sectionOfGroup, seenRows, type CommonGroup, type CommonSection } from "@/lib/configuration-common";
import type { ConfigurationFamily, FamilyAttribute } from "@/lib/configuration-family";

const SECTION_LABELS: Record<CommonSection, string> = {
  dimensions: "Dimensions",
  finishes: "Fabrics and finishes",
  notes: "Notes and the rest",
};

type Editing =
  | { kind: "correct"; key: string; value: string; unit: AttributeUnit | ""; state: AttributeState; reason: string }
  | { kind: "retire"; key: string; reason: string };

type Adding = {
  attrGroup: AttributeGroup;
  dimensionSlot: DimensionSlot | "";
  label: string;
  value: string;
  unit: AttributeUnit | "";
  specFieldId: string;
  state: AttributeState;
};

const EMPTY_ADD: Adding = {
  attrGroup: "dimension",
  dimensionSlot: "SH",
  label: "",
  value: "",
  unit: "mm",
  specFieldId: "",
  state: "confirmed",
};

function ValueCell({ value, unit, state, qualifier }: { value: string | null; unit: string | null; state: AttributeState; qualifier: string | null }) {
  return (
    <>
      {state === "tbc" && !value ? (
        <Chip tone="warn">TBC</Chip>
      ) : (
        <span className="text-neutral-900">
          {value && <SpecValue text={value} />}
          {/* The unit belongs to a FIGURE. "TBC", "N/A" or "REFER TO … DRAWINGS"
              carry the row's unit too, and printing it welded on ("TBCmm")
              reads as a measurement nobody took. */}
          {unit && parseDimensionFigure(value).figure !== null && <span className="text-neutral-500">{unit}</span>}
          {state === "tbc" && (
            <span className="ml-1.5 align-middle">
              <Chip tone="warn">TBC</Chip>
            </span>
          )}
        </span>
      )}
      {qualifier && <span className="mt-0.5 block text-xs text-neutral-500">{qualifier}</span>}
    </>
  );
}

function fieldOf(row: { fieldName: string | null; dimensionSlot: DimensionSlot | null; jsonId?: number | null }): React.ReactNode {
  if (row.fieldName) {
    return (
      <span title={row.jsonId !== null && row.jsonId !== undefined ? `BWS field ${row.jsonId}` : undefined}>
        {row.fieldName.trim()}
        {row.dimensionSlot ? ` (${row.dimensionSlot})` : ""}
      </span>
    );
  }
  if (row.dimensionSlot) return <span title="BWS field 3">Dimensions ({row.dimensionSlot})</span>;
  return "—";
}

export default function BillLineConfigurations({
  lineId,
  family,
  specFields,
  onDone,
}: {
  lineId: string;
  family: ConfigurationFamily;
  specFields: { id: string; name: string; json_id: number }[];
  /** Reload the screen, THEN show the message — the page's `reloadThen`, so a 409 is not swallowed by the reload. */
  onDone: (message: string | null) => Promise<void> | void;
}) {
  const configurations = family.configurations;
  const reading = useMemo(() => readCommonSpecs(configurations), [configurations]);
  const common = reading.groups.filter((group) => group.status === "common");
  const differs = reading.groups.filter((group) => group.status === "differs");
  const commonKeys = new Set(common.map((group) => group.key));

  const [tab, setTab] = useState<string>(configurations[0]?.recordId ?? "");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [busy, setBusy] = useState(false);
  // The notes a sheet prints (its general conditions, a title block) are common
  // to every configuration and can run to fifteen rows; open, they push the
  // rows that DIFFER and the per-configuration tabs a screen down. Folded, with
  // the count on the toggle — never dropped.
  const [showNotes, setShowNotes] = useState(false);

  const configurationIds = configurations.map((configuration) => configuration.recordId);
  const n = configurations.length;

  async function post(body: Record<string, unknown>, done: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await apiFetch<{ written?: { number: string }[]; finishesUnlinked?: number }>(
        `/api/records/${encodeURIComponent(lineId)}/common`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );
      // RELOAD FIRST, REPORT AFTER: the page clears its banner on a load.
      if (res.ok) {
        const unlinked = res.data?.finishesUnlinked ?? 0;
        await onDone(
          unlinked > 0
            ? `${done} On ${unlinked} of them the corrected words no longer match the finishes library, so ${unlinked === 1 ? "that one is" : "those are"} no longer linked to it.`
            : null,
        );
      } else {
        await onDone(res.error);
      }
      return res.ok;
    } finally {
      // Always, so an HTML error page cannot leave the buttons dead.
      setBusy(false);
    }
  }

  async function saveEdit(group: CommonGroup<FamilyAttribute>) {
    if (!editing || editing.key !== group.key) return;
    const ok =
      editing.kind === "correct"
        ? await post(
            {
              op: "correct",
              groupKey: group.key,
              value: editing.state === "tbc" && !editing.value.trim() ? null : editing.value.trim(),
              unit: group.attrGroup === "dimension" && editing.unit !== "" ? editing.unit : null,
              state: editing.state,
              reason: editing.reason.trim(),
              configurations: configurationIds,
              seen: seenRows(group),
            },
            `Corrected on all ${n}.`,
          )
        : await post(
            {
              op: "retire",
              groupKey: group.key,
              reason: editing.reason.trim(),
              configurations: configurationIds,
              seen: seenRows(group),
            },
            `Retired on all ${n}.`,
          );
    if (ok) setEditing(null);
  }

  async function saveAdd() {
    if (!adding) return;
    const isDimension = adding.attrGroup === "dimension";
    const label = adding.label.trim() || (isDimension && adding.dimensionSlot ? DIMENSION_SLOT_LABELS[adding.dimensionSlot] : "");
    const ok = await post(
      {
        op: "add",
        attrGroup: adding.attrGroup,
        label,
        value: adding.state === "tbc" && !adding.value.trim() ? null : adding.value.trim(),
        unit: isDimension && adding.unit !== "" ? adding.unit : null,
        dimensionSlot: isDimension && adding.dimensionSlot !== "" ? adding.dimensionSlot : null,
        specFieldId: !isDimension && adding.specFieldId ? adding.specFieldId : null,
        state: adding.state,
        seen: configurations.map((configuration) => ({ recordId: configuration.recordId, version: configuration.version })),
      },
      `Added to all ${n}.`,
    );
    if (ok) setAdding(null);
  }

  // The cell BWS field 3 would receive from the common slots alone, by the
  // one composer. Each configuration's own cell carries its own note too.
  const commonDimensions = composeDimensionCell(
    common
      .filter((group) => group.dimensionSlot && group.shared)
      .map((group) => ({
        slot: group.dimensionSlot as DimensionSlot,
        value: group.shared!.value,
        unit: group.shared!.unit,
        state: group.shared!.state,
        sortOrder: group.members[0]?.rows[0]?.sortOrder ?? 0,
      })),
    null,
  );

  const sections = (groups: CommonGroup<FamilyAttribute>[]) =>
    (["dimensions", "finishes", "notes"] as CommonSection[])
      .map((section) => ({ section, groups: groups.filter((group) => group.section === section) }))
      .filter((entry) => entry.groups.length > 0);

  const current = configurations.find((configuration) => configuration.recordId === tab) ?? configurations[0] ?? null;
  const ownRows = current
    ? current.attributes.filter((attribute) => !commonKeys.has(readKey(attribute, reading.groups)))
    : [];

  if (n < 2) {
    // One configuration has nothing to compare; its tab below is the whole story.
    return current ? <ConfigurationTab configuration={current} rows={current.attributes} /> : null;
  }

  return (
    <>
      <Card
        title={`Common to all ${n} configurations`}
        className="mt-0"
        actions={
          <CardHeadingNote>
            {common.length} the same · {differs.length} differ
          </CardHeadingNote>
        }
        flush
      >
        <p className="px-4 pt-3 text-xs text-neutral-600">
          Each configuration keeps its own copy — this is what they all say. Correcting a row here corrects it on every
          one of them, as one change; a row that differs is changed on that configuration&rsquo;s own screen.
        </p>
        {commonDimensions.text && (
          <p className="px-4 pt-2 font-mono text-[15px] text-neutral-900" title="Composed from the common slots only">
            {commonDimensions.text}
          </p>
        )}
        {common.length === 0 ? (
          <p className="px-4 py-3 text-sm text-neutral-600">Nothing is the same on every configuration yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-[24%]">Spec</Th>
                <Th className="w-[34%]">Value</Th>
                <Th className="w-[22%]">BWS field</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sections(common).map(({ section, groups }) => (
                <Fragment key={section}>
                  <GroupRow
                    span={4}
                    aside={
                      section === "notes" ? (
                        <button
                          type="button"
                          className="text-sky-700 underline-offset-2 hover:underline"
                          onClick={() => setShowNotes((open) => !open)}
                        >
                          {showNotes ? "Hide" : `Show ${groups.length}`}
                        </button>
                      ) : undefined
                    }
                  >
                    {SECTION_LABELS[section]}
                  </GroupRow>
                  {(section === "notes" && !showNotes ? [] : groups).map((group) => {
                    const shared = group.shared!;
                    const first = group.members[0]!.rows[0]!;
                    const open = editing?.key === group.key ? editing : null;
                    return (
                      <Fragment key={group.key}>
                        <Tr>
                          <Td>{shared.label}</Td>
                          <Td>
                            <ValueCell value={shared.value} unit={shared.unit} state={shared.state} qualifier={shared.qualifier} />
                          </Td>
                          <Td muted>{fieldOf(first)}</Td>
                          <Td className="text-right">
                            <span className="inline-flex items-center gap-1">
                              <Button
                                size="xs"
                                disabled={busy}
                                title={`Correct this on all ${n} configurations`}
                                onClick={() =>
                                  setEditing({
                                    kind: "correct",
                                    key: group.key,
                                    value: shared.value ?? "",
                                    unit: (shared.unit ?? "") as AttributeUnit | "",
                                    state: shared.state,
                                    reason: "",
                                  })
                                }
                              >
                                Correct on all {n}
                              </Button>
                              <Button
                                variant="quiet"
                                size="xs"
                                disabled={busy}
                                title={`Take this off all ${n} configurations`}
                                onClick={() => setEditing({ kind: "retire", key: group.key, reason: "" })}
                              >
                                Retire
                              </Button>
                            </span>
                          </Td>
                        </Tr>
                        {/* A SPANNING PANEL IS ITS OWN `tr`, never a `td
                            colSpan` beside the data cells. */}
                        {open && (
                          <tr className={open.kind === "retire" ? "bg-red-50/60" : "bg-amber-50/60"}>
                            <td colSpan={4} className="border-b border-amber-200 px-4 py-3">
                              <p className="text-sm font-medium text-neutral-900">
                                {open.kind === "correct" ? `Correct “${shared.label}” on all ${n}` : `Retire “${shared.label}” from all ${n}`}
                              </p>
                              <p className="mt-0.5 text-xs text-neutral-600">
                                {open.kind === "correct"
                                  ? "Each configuration's old value is kept and marked as superseded, and each new one keeps the page its old one was read from. One change, one new version of each."
                                  : "Each is kept as a record that the document said it, and stops counting towards the checklist and the export. Any checklist answer it filled is recomposed."}{" "}
                                Written to {configurations.map((configuration) => configuration.number).join(", ")}.
                              </p>
                              <div className="mt-2 flex flex-wrap items-end gap-2">
                                {open.kind === "correct" && (
                                  <>
                                    <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                      Value
                                      <input
                                        value={open.value}
                                        autoFocus
                                        onChange={(event) => setEditing({ ...open, value: event.target.value })}
                                        className="w-56 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      />
                                    </label>
                                    {group.attrGroup === "dimension" && (
                                      <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                                        Unit
                                        <select
                                          value={open.unit}
                                          onChange={(event) => setEditing({ ...open, unit: event.target.value as AttributeUnit | "" })}
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
                                        value={open.state}
                                        onChange={(event) => setEditing({ ...open, state: event.target.value as AttributeState })}
                                        className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                      >
                                        <option value="confirmed">Confirmed</option>
                                        <option value="tbc">TBC</option>
                                      </select>
                                    </label>
                                  </>
                                )}
                                <label className="flex flex-1 flex-col gap-0.5 text-xs text-neutral-600">
                                  Why
                                  <input
                                    value={open.reason}
                                    autoFocus={open.kind === "retire"}
                                    onChange={(event) => setEditing({ ...open, reason: event.target.value })}
                                    placeholder={open.kind === "correct" ? "Re-measured off the Rev B drawing" : "Not on the Rev B drawing"}
                                    className="w-full min-w-[16rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
                                  />
                                </label>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  variant={open.kind === "retire" ? "danger" : "primary"}
                                  size="sm"
                                  disabled={busy || !open.reason.trim()}
                                  onClick={() => void saveEdit(group)}
                                >
                                  {busy ? "Saving…" : open.kind === "correct" ? `Save on all ${n}` : `Retire from all ${n}`}
                                </Button>
                                <Button variant="quiet" size="sm" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-neutral-100 px-4 py-3">
          {adding ? (
            <AddToAll
              adding={adding}
              n={n}
              busy={busy}
              specFields={specFields}
              onChange={setAdding}
              onSave={() => void saveAdd()}
              onCancel={() => setAdding(null)}
            />
          ) : (
            <Button variant="secondary" size="xs" disabled={busy} onClick={() => setAdding(EMPTY_ADD)}>
              Add a spec to all {n}
            </Button>
          )}
        </div>
      </Card>

      {differs.length > 0 && (
        <Card
          title="Differs between configurations"
          actions={<CardHeadingNote>changed on each configuration&rsquo;s own screen</CardHeadingNote>}
          flush
        >
          <Table>
            <thead>
              <tr>
                <Th className="w-[24%]">Spec</Th>
                <Th>What each configuration says</Th>
              </tr>
            </thead>
            <tbody>
              {sections(differs).map(({ section, groups }) => (
                <Fragment key={section}>
                  <GroupRow span={2}>{SECTION_LABELS[section]}</GroupRow>
                  {groups.map((group) => (
                    <Tr key={group.key}>
                      <Td>
                        {group.title}
                        <span className="mt-0.5 block text-xs text-neutral-500">{fieldOf(group.members.find((member) => member.rows[0])?.rows[0] ?? { fieldName: null, dimensionSlot: group.dimensionSlot })}</span>
                      </Td>
                      <Td>
                        <ul className="space-y-0.5">
                          {group.members.map((member) => (
                            <li key={member.recordId} className="flex items-baseline gap-2">
                              <Link href={`/dashboard/records/${member.recordId}`} className="font-mono text-xs text-neutral-600 underline hover:text-neutral-900">
                                {member.number}
                              </Link>
                              {member.rows.length === 0 ? (
                                <span className="text-neutral-400">none</span>
                              ) : (
                                <span className="min-w-0">
                                  {member.rows.map((row, index) => (
                                    <span key={row.id} className="block">
                                      {index > 0 && <span className="text-xs text-neutral-400">also: </span>}
                                      <ValueCell value={row.value} unit={row.unit} state={row.state} qualifier={row.qualifier} />
                                    </span>
                                  ))}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Td>
                    </Tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mt-4">
        <Tabs
          label="Each configuration's own specs"
          value={current?.recordId ?? ""}
          onChange={setTab}
          items={configurations.map((configuration) => ({
            id: configuration.recordId,
            label: (
              <span>
                <span className="font-mono">{configuration.number}</span> {configuration.variantLabel}
              </span>
            ),
            count: configuration.attributes.filter((attribute) => !commonKeys.has(readKey(attribute, reading.groups))).length,
          }))}
        />
        {current && <ConfigurationTab configuration={current} rows={ownRows} />}
      </div>
    </>
  );
}

/** Which group a row was read into, off the reading itself, so the tab and the cards cannot disagree. */
function readKey(attribute: FamilyAttribute, groups: CommonGroup<FamilyAttribute>[]): string {
  return groups.find((group) => group.members.some((member) => member.rows.some((row) => row.id === attribute.id)))?.key ?? "";
}

/**
 * One configuration's own specs — everything that is not common — in the same
 * layout for every configuration, with the way to its full record.
 */
function ConfigurationTab({
  configuration,
  rows,
}: {
  configuration: ConfigurationFamily["configurations"][number];
  rows: FamilyAttribute[];
}) {
  const bySection = (["dimensions", "finishes", "notes"] as CommonSection[])
    .map((section) => ({
      section,
      // `sectionOf`'s split, so a row sits under the same heading here as it
      // does in the two cards above.
      rows: rows.filter((row) => sectionOfGroup(row.attrGroup) === section),
    }))
    .filter((entry) => entry.rows.length > 0);
  return (
    <Card
      className="mt-3"
      title={
        <span>
          <span className="font-mono">{configuration.number}</span> {configuration.variantLabel}
        </span>
      }
      actions={
        <Link href={`/dashboard/records/${configuration.recordId}`} className="text-[12.5px] text-blue-700 underline hover:text-blue-900">
          Open {configuration.number}
        </Link>
      }
      flush
    >
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-neutral-600">
          Nothing of its own — everything this configuration holds is common to all of them.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-[24%]">Label</Th>
              <Th className="w-[34%]">Value</Th>
              <Th className="w-[22%]">BWS field</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {bySection.map(({ section, rows: sectionRows }) => (
              <Fragment key={section}>
                <GroupRow span={4}>{SECTION_LABELS[section]}</GroupRow>
                {sectionRows.map((row) => (
                  <Tr key={row.id}>
                    <Td>{row.label}</Td>
                    <Td>
                      <ValueCell value={row.value} unit={row.unit} state={row.state} qualifier={row.qualifier} />
                      {(row.finishCode ?? row.materialCode) && (
                        <span className="ml-1.5 inline-block align-middle">
                          <Chip mono tone={row.finishState === "tbc" ? "warn" : "plain"}>
                            {row.finishCode ?? row.materialCode}
                          </Chip>
                        </span>
                      )}
                    </Td>
                    <Td muted>{fieldOf(row)}</Td>
                    <Td muted>
                      {row.sourceRunId ? (
                        // NO PAGE MEANS NO LINK TO A PAGE — the record screen's rule.
                        <a
                          href={`/api/imports/${row.sourceRunId}/source${row.sourcePage ? `#page=${row.sourcePage}` : ""}`}
                          target="_blank"
                          rel="noreferrer"
                          title={`${row.sourceFilename ?? "source"}${row.sourcePage ? ` — page ${row.sourcePage}` : ""}`}
                          className="block max-w-[9rem] truncate underline hover:text-neutral-900"
                        >
                          {row.sourceFilename ?? "source"}
                          {row.sourcePage ? ` p${row.sourcePage}` : ""}
                        </a>
                      ) : (
                        <span className="text-neutral-400">typed by hand</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AddToAll({
  adding,
  n,
  busy,
  specFields,
  onChange,
  onSave,
  onCancel,
}: {
  adding: Adding;
  n: number;
  busy: boolean;
  specFields: { id: string; name: string; json_id: number }[];
  onChange: (next: Adding) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isDimension = adding.attrGroup === "dimension";
  const ready =
    (isDimension ? adding.dimensionSlot !== "" : adding.label.trim() !== "") &&
    (adding.state === "tbc" || adding.value.trim() !== "");
  return (
    <div>
      <p className="text-sm font-medium text-neutral-900">Add a spec to all {n} configurations</p>
      <p className="mt-0.5 text-xs text-neutral-600">
        Typed by hand, so it carries no page. Refused if any configuration already holds one there — correct it instead.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
          Kind
          <select
            value={adding.attrGroup}
            onChange={(event) => {
              const attrGroup = event.target.value as AttributeGroup;
              onChange({
                ...adding,
                attrGroup,
                dimensionSlot: attrGroup === "dimension" ? adding.dimensionSlot || "SH" : "",
                unit: attrGroup === "dimension" ? adding.unit || "mm" : "",
              });
            }}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
          >
            {ATTRIBUTE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {ATTRIBUTE_GROUP_LABELS[group]}
              </option>
            ))}
          </select>
        </label>
        {isDimension ? (
          <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
            Slot
            <select
              value={adding.dimensionSlot}
              onChange={(event) => onChange({ ...adding, dimensionSlot: event.target.value as DimensionSlot })}
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
            >
              {DIMENSION_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {DIMENSION_SLOT_LABELS[slot]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
              Label
              <input
                value={adding.label}
                onChange={(event) => onChange({ ...adding, label: event.target.value })}
                placeholder="Arm height"
                className="w-40 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
              BWS field
              <select
                value={adding.specFieldId}
                onChange={(event) => onChange({ ...adding, specFieldId: event.target.value })}
                className="max-w-[14rem] rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
              >
                <option value="">none — a note</option>
                {specFields
                  .filter((field) => field.json_id !== 3)
                  .map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name.trim()}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
          Value
          <input
            value={adding.value}
            onChange={(event) => onChange({ ...adding, value: event.target.value })}
            className="w-44 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
          />
        </label>
        {isDimension && (
          <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
            Unit
            <select
              value={adding.unit}
              onChange={(event) => onChange({ ...adding, unit: event.target.value as AttributeUnit | "" })}
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
            value={adding.state}
            onChange={(event) => onChange({ ...adding, state: event.target.value as AttributeState })}
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900"
          >
            <option value="confirmed">Confirmed</option>
            <option value="tbc">TBC</option>
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy || !ready} onClick={onSave}>
          {busy ? "Saving…" : `Add to all ${n}`}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {!isDimension && adding.label.trim() === "" && (
        <Note tone="plain">A spec that is not a dimension needs a label — what the drawing would call it.</Note>
      )}
    </div>
  );
}
