"use client";

// One card for a code whose pages NAME its configurations (schemaVersion 3).
//
// ============================================================================
// FIVE CHAIRS, ONE TAB EACH.
//
// Panther's S-301 sheet prints one set of overall dimensions and a fabric
// heading "As per room type: Type 1 & 5 - …, Type 2 - …, Type 3 - … ; Type 4 -
// …". That is five chairs to make (Max, 2026-09-23), named as the document
// names them: `S-301 TYPE 1` … `S-301 TYPE 5`. The confirm creates one record
// per configuration on every phase that quotes the line, and each row lands
// only on the configurations it belongs to.
//
// So the card is a TAB STRIP, one tab per configuration, and a tab shows that
// configuration COMPLETE in the same layout every time — its dimensions, then
// its fabrics and finishes, then its notes. Max: "you just see configuration
// one, and it's got the dimensions and the fabric. And then you go to
// configuration two ... it's the same every time."
//
// A ROW SHARED BY SEVERAL CONFIGURATIONS IS ONE OBSERVATION ON EVERY TAB IT IS
// ON, and says so in words ("shared by all 5", "shared with TYPE 1 · TYPE 5").
// Editing the width on TYPE 2 edits it for all five, because it is one row and
// the confirm writes it to each. Only one tab is mounted at a time, so there is
// still one input per observation in the DOM — two inputs for one row race.
//
// WHICH ROWS LAND WHERE IS NOT DECIDED HERE. It is `namedConfigurationPlans`,
// read off the staged pages, and the server's copy of it on each resolution;
// the confirm calls the same function. This file only lays it out.
//
// THE CONFIRM IS UNCHANGED: one request per PAGE, each atomic, in page order.
// ============================================================================
import { Fragment, useState } from "react";
import { composeDimensionCell } from "@/lib/dimensions";
import type { DrawingItem, DrawingObservation } from "@/lib/drawing-document";
import { fieldSlotGaps, naturalConfigurationOrder, sharedTargets, sharedWithSentence, type NamedTab, type NamedTabRow } from "@/lib/configuration-cards";
import { variantName } from "@/lib/record-variants";
import type { DimensionSlot } from "@/lib/spec-vocab";
import LevelControl, { levelTargets, suggestLevelFromCard } from "@/components/imports/LevelControl";
import ItemImagePicker from "@/components/imports/ItemImagePicker";
import PagePreview from "@/components/imports/PagePreview";
import {
  ObservationRow,
  OBSERVATION_COLUMNS,
  ObservationTableHead,
  OtherDimensionsToggle,
  ReplacePanel,
  RowNotes,
  RunTargets,
  orderRows,
  type RowBlocker,
} from "@/components/imports/ObservationRows";
import { BulkUnit } from "@/components/imports/DrawingItemCard";
import type { ConfigurationCardProps } from "@/components/imports/ConfigurationCard";
import ConfigurationTabs from "@/components/imports/ConfigurationTabs";
import {
  AddConfiguration,
  RemoveConfiguration,
  RenameConfiguration,
  RowConfigurationPicker,
} from "@/components/imports/ConfigurationControls";
import PagePicker from "@/components/imports/PagePicker";
import { colourAt } from "@/components/imports/configuration-colours";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Tip from "@/components/ui/Tip";

type Member = ConfigurationCardProps["card"]["members"][number];

/** A card-level blocker: one not about any single row. */
function isCardBlocker(blocker: RowBlocker): boolean {
  return !blocker.observationId;
}

export default function NamedConfigurationCard({
  card,
  importId,
  importIdFor,
  specFields,
  records,
  drafts,
  setDrafts,
  busy,
  onSaveObservation,
  onSaveTargets,
  onSetBulkUnit,
  onReview,
  onReviewMany,
  onImage,
  onSwatch,
  onSetLevel,
  onSaveItem,
}: ConfigurationCardProps) {
  const named = card.named!;
  const [open, setOpen] = useState(true);
  const [showOther, setShowOther] = useState(false);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  /** Which configuration's tab is open. Local state: nothing links into it. */
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [joinArmed, setJoinArmed] = useState(false);

  const pendingMembers = card.members.filter((member) => member.state === "pending");
  const busyHere = busy === card.id || pendingMembers.some((member) => busy === member.item.id);
  const pageImportId = (itemId: string) => importIdFor?.(itemId) ?? importId;
  const memberOf = (itemId: string): Member | undefined => card.members.find((member) => member.item.id === itemId);
  const total = named.tabs.length;

  // ---------------------------------------------------------------- blockers
  //
  // A card-level blocker (a name the database refuses, a configuration about
  // to be created beside others, no phase) belongs to the CARD, once, however
  // many pages raised it.
  const cardBlockers: RowBlocker[] = [];
  const seen = new Set<string>();
  for (const member of pendingMembers) {
    for (const blocker of member.resolution?.blockers ?? []) {
      if (!isCardBlocker(blocker)) continue;
      const key = `${blocker.code}|${blocker.recordId ?? ""}|${blocker.label ?? ""}|${blocker.runId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cardBlockers.push(blocker);
    }
  }
  const rowBlockers = (row: { item: DrawingItem; observation: DrawingObservation }) =>
    memberOf(row.item.id)?.resolution?.blockers.filter((blocker) => blocker.observationId === row.observation.id) ?? [];
  // A BWS field skipped on a configuration — COM 2 with COM 1 free — is a
  // warning beside the row, never a blocker: moving it is the reviewer's call.
  const gaps = fieldSlotGaps(named.tabs, specFields);
  const rowWarnings = (row: { item: DrawingItem; observation: DrawingObservation }) => [
    ...(memberOf(row.item.id)?.resolution?.warnings?.filter((warning) => warning.observationId === row.observation.id) ?? []),
    ...(gaps.has(row.observation.id)
      ? [{ code: "field_gap", observationId: row.observation.id, message: gaps.get(row.observation.id)! }]
      : []),
  ];

  // ------------------------------------------------ a reviewer's corrections
  //
  // Brief C1. The list is written to EVERY page of the code, each with its own
  // item version, and read from the first — see `configurationsByReviewer`. A
  // row's own answer goes on the observation, beside the model's reading.
  const currentList = named.configurations.map((entry) => ({ label: entry.label, readAs: entry.readAs ?? null }));
  // STORED in the code's order (what `saveList` writes); SHOWN in natural order.
  const labels = naturalConfigurationOrder(currentList.map((entry) => entry.label));
  const canEdit = Boolean(onSaveItem);
  const saveList = (list: { label: string; readAs: string | null }[] | null) => {
    if (!onSaveItem) return;
    for (const member of card.members) void onSaveItem(member.item, { configurationsByReviewer: list });
  };
  const saveRow = (row: NamedTabRow, configurations: string[] | null) =>
    void onSaveObservation(row.item, row.observation, { configurations });

  const tabBlocked = (tab: NamedTab): string | null => {
    const own = cardBlockers.find(
      (blocker) =>
        (blocker.code === "configuration_name" || blocker.code === "configuration_new") && blocker.label === tab.label,
    );
    if (own) return own.message;
    for (const row of tab.rows) {
      const found = rowBlockers(row)[0];
      if (found) return found.message;
    }
    return null;
  };

  const activeTab =
    named.tabs.find((tab) => tab.label === activeLabel) ??
    named.tabs.find((tab) => tab.state === "pending") ??
    named.tabs[0];

  // ------------------------------------------------------------ applies to
  const { ticked, mixed } = sharedTargets(card.members);
  const runs = pendingMembers[0]?.resolution?.resolution.runs ?? card.members[0]?.resolution?.resolution.runs ?? [];
  const levelForTargets = levelTargets(runs, [...ticked]);
  const toggleRun = (recordId: string, on: boolean) => {
    for (const member of pendingMembers) {
      const current = new Set(member.item.targets?.ticked ?? member.resolution?.resolution.suggested ?? []);
      const unticked = new Set(member.item.targets?.unticked ?? []);
      if (on) {
        current.add(recordId);
        unticked.delete(recordId);
      } else {
        current.delete(recordId);
        unticked.add(recordId);
      }
      void onSaveTargets(member.item, [...current], [...unticked]);
    }
  };

  // ------------------------------------------- what the confirm will create
  //
  // SAID IN WORDS, because it is the most consequential thing on the card: the
  // bill line stops exporting and each configuration ships as its own job.
  const toCreate = new Set<string>();
  const existing = new Set<string>();
  for (const member of pendingMembers) {
    for (const [parentId, labels] of Object.entries(member.resolution?.named?.create ?? {})) {
      if (!ticked.has(parentId)) continue;
      for (const label of labels) toCreate.add(`${parentId}|${label}`);
    }
  }
  for (const parentId of ticked) {
    for (const tab of named.tabs) {
      const exists = pendingMembers.some((member) => member.resolution?.named?.existing?.[parentId]?.[tab.label]);
      if (exists) existing.add(`${parentId}|${tab.label}`);
    }
  }
  const phases = ticked.size;
  const recordsSentence =
    phases === 0
      ? "Tick a phase to say where these configurations are made."
      : `${total} configuration${total === 1 ? "" : "s"} × ${phases} phase${phases === 1 ? "" : "s"} — confirming creates ${toCreate.size} record${
          toCreate.size === 1 ? "" : "s"
        } under ${card.codeRaw}` + (existing.size > 0 ? ` and writes to ${existing.size} that already exist.` : ".");

  // ----------------------------------------------------- acknowledgements
  //
  // Creating a configuration beside a bill line's EXISTING ones waits for a
  // tick, per bill line and name. Ticked here, stored on each page that would
  // create it, so every page's confirm sees the same decision.
  const acksWanted = cardBlockers.filter((blocker) => blocker.code === "configuration_new");
  const acked = new Map<string, { recordId: string; label: string }>();
  for (const member of pendingMembers) {
    for (const ack of member.item.configurationAcks ?? []) {
      const stillCreates = member.resolution?.named?.create?.[ack.recordId]?.includes(ack.label);
      if (stillCreates) acked.set(`${ack.recordId}|${ack.label}`, ack);
    }
  }
  const runNameOf = (recordId: string) =>
    runs.find((run) => run.status === "matched" && run.record.id === recordId)?.runName ?? "this phase";
  const setAck = (recordId: string, label: string, on: boolean) => {
    if (!onSaveItem) return;
    for (const member of pendingMembers) {
      const wants = member.resolution?.named?.create?.[recordId]?.includes(label);
      if (!wants) continue;
      const others = (member.item.configurationAcks ?? []).filter(
        (ack) => !(ack.recordId === recordId && ack.label === label),
      );
      void onSaveItem(member.item, { configurationAcks: on ? [...others, { recordId, label }] : others });
    }
  };
  const ackRows = [
    ...acksWanted.map((blocker) => ({ recordId: blocker.recordId!, label: blocker.label!, on: false })),
    ...[...acked.values()].map((ack) => ({ ...ack, on: true })),
  ];

  // --------------------------------------------------------------- confirm
  const blockedMember = pendingMembers.find((member) => (member.resolution?.blockers.length ?? 0) > 0);
  const confirmable =
    pendingMembers.length > 0 &&
    !blockedMember &&
    pendingMembers.every((member) => (member.resolution?.targets.length ?? 0) > 0 && member.pending.length > 0);
  const confirmAll = () =>
    void onReviewMany(
      card.id,
      pendingMembers.map((member) => ({
        label: `Page ${member.item.page ?? "?"}`,
        item: member.item,
        observations: member.pending,
      })),
    );

  // ------------------------------------------------------------------ header
  const header = (
    <div className="border-b border-neutral-200 px-4 pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-neutral-900">{card.codeRaw}</span>
        {card.name && <span className="text-neutral-700">{card.name}</span>}
        <Chip tone="info">
          {total} configuration{total === 1 ? "" : "s"}
        </Chip>
        <span className="flex-1" />
        {open && pendingMembers.length > 0 && (
          <BulkUnit
            label="All dimensions:"
            disabled={busyHere}
            onSet={(unit) => {
              for (const member of pendingMembers) void onSetBulkUnit("item", unit, member.item.id);
            }}
          />
        )}
        <Button size="xs" variant="quiet" onClick={() => setOpen((value) => !value)}>
          {open ? "Collapse" : "Expand"}
        </Button>
      </div>
      <p className="mt-1.5 max-w-3xl text-xs text-neutral-600">
        The document names {total} configuration{total === 1 ? "" : "s"} of this item. Each becomes its own record
        under the bill line and ships as its own job; the bill line stops exporting, and its quantity stays
        unallocated. <span className="font-medium text-neutral-800">{recordsSentence}</span>
      </p>
      {card.groupedBecause && (
        <p className="mt-1 max-w-3xl text-xs text-neutral-500">
          <span className="font-medium text-neutral-600">The pages, read as one item:</span> {card.groupedBecause}
        </p>
      )}
      {/* WHAT THE REVIEWER CHANGED, against what was read — the model's
          reading is still in the staged JSON, and this is where it shows. */}
      {(named.editSummary || canEdit) && (
        <p className="mt-1 flex max-w-3xl flex-wrap items-center gap-2 text-xs text-neutral-600">
          {named.editSummary && <span className="font-medium text-violet-800">{named.editSummary}</span>}
          {named.editSummary && canEdit && (
            <Button size="xs" variant="quiet" disabled={busyHere} onClick={() => saveList(null)}>
              {named.read.length > 0 ? "Put the reading back" : "Undo — no configurations, as read"}
            </Button>
          )}
          {canEdit && (
            <Button
              size="xs"
              variant="quiet"
              disabled={busyHere}
              className={joinArmed ? "border-amber-400 bg-amber-50 text-amber-900" : undefined}
              onClick={() => {
                // Two presses: it takes every configuration off the card at once.
                if (!joinArmed) {
                  setJoinArmed(true);
                  return;
                }
                setJoinArmed(false);
                saveList([]);
              }}
            >
              {joinArmed ? `Make ${card.codeRaw} one item, with no configurations?` : "Not configurations — this is one item"}
            </Button>
          )}
        </p>
      )}
      {open && activeTab && (
        <div className="mt-2">
          <ConfigurationTabs
            label={`Configurations of ${card.codeRaw}`}
            active={activeTab.label}
            onSelect={setActiveLabel}
            tabs={named.tabs.map((tab) => ({
              key: tab.label,
              label: tab.label,
              colour: colourAt(tab.index),
              pending: tab.pending,
              state: tab.state,
              blocked: tabBlocked(tab),
            }))}
            trailing={
              canEdit ? (
                <AddConfiguration
                  existing={labels}
                  disabled={busyHere}
                  onAdd={(added) => saveList([...currentList, ...added.map((label) => ({ label, readAs: null }))])}
                />
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );

  if (!open) {
    return (
      <div className="mt-4 rounded-[10px] border border-neutral-200 bg-white">
        {header}
        <p className="px-4 py-3 text-neutral-600">
          {named.tabs.filter((tab) => tab.state === "pending").length} of {total} configurations still to review.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------ the open tab
  const tab = activeTab!;
  const colour = colourAt(tab.index);
  const rowById = new Map(tab.rows.map((row) => [row.observation.id, row]));
  const order = orderRows(tab.rows.map((row) => row.observation));
  const dimensionCell = composeDimensionCell(
    tab.rows
      .filter((row) => row.observation.attrGroup === "dimension" && row.observation.dimensionSlot)
      .map((row, index) => ({
        slot: row.observation.dimensionSlot as DimensionSlot,
        value:
          drafts[row.observation.id]?.value !== undefined
            ? (drafts[row.observation.id]?.value ?? null)
            : row.observation.value,
        unit: row.observation.unit,
        state: row.observation.state ?? "confirmed",
        sortOrder: index,
      })),
  );

  const pages = card.pages.length > 0 ? card.pages : card.members.map((m) => m.item.page).filter((p): p is number => Boolean(p));
  const shownPage = pages.includes(previewPage ?? -1) ? previewPage : (tab.rows[0]?.item.page ?? pages[0] ?? null);
  const previewItem = card.members.find((member) => member.item.page === shownPage)?.item.id;

  return (
    <div className="mt-4 rounded-[10px] border border-neutral-200 bg-white">
      {header}

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0" role="tabpanel" aria-label={variantName(card.codeRaw, tab.label, card.codeRaw)}>
          {cardBlockers
            .filter((blocker) => blocker.code === "configuration_name" || blocker.code === "no_targets" || blocker.code === "ambiguous_run")
            .map((blocker, index) => (
              <Note key={index} tone="warn" className="mb-3">
                {blocker.message}
              </Note>
            ))}

          {ackRows.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="text-th font-semibold uppercase tracking-wider text-amber-800">
                New configurations beside existing ones
              </p>
              <p className="mt-0.5">
                These bill lines already have configurations, and this document names others. If one is the same
                chair under another name, stop and correct the name instead — ticking creates a new record.
              </p>
              {ackRows.map((row) => {
                const others = Object.keys(
                  pendingMembers.map((member) => member.resolution?.named?.existing?.[row.recordId]).find(Boolean) ?? {},
                );
                return (
                  <label key={`${row.recordId}|${row.label}`} className="mt-1 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={row.on}
                      disabled={busyHere || !onSaveItem}
                      onChange={(event) => setAck(row.recordId, row.label, event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Create <span className="font-mono font-medium">{row.label}</span> on {runNameOf(row.recordId)}
                      {others.length > 0 ? `, beside ${others.join(", ")}` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* ROWS THAT LAND NOWHERE: theirs were removed. On no tab, so they
              are listed here, above the tabs, until somebody places them. */}
          {named.undecided.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50">
              <p className="px-3 pt-2 text-xs font-medium text-amber-900">
                {named.undecided.length} row{named.undecided.length === 1 ? "" : "s"} belonged only to a configuration
                that has been removed. Say which configurations {named.undecided.length === 1 ? "it applies" : "they apply"}{" "}
                to — nothing is shared or dropped until you do.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-cell">
                  <ObservationTableHead />
                  <tbody>
                    {named.undecided.map((row) => (
                      <Fragment key={row.observation.id}>
                        <ObservationRow
                          observation={row.observation}
                          page={row.item.page}
                          itemPages={card.pages}
                          importId={pageImportId(row.item.id)}
                          specFields={specFields}
                          drafts={drafts}
                          setDrafts={setDrafts}
                          busy={busyHere}
                          blocked
                          guessWhy={undefined}
                          callbacks={{
                            onChange: (target, changes) => void onSaveObservation(row.item, target, changes),
                            onIgnore: (target) => void onReview(row.item, [target], "ignore"),
                            onSwatch,
                          }}
                        />
                        <tr>
                          <td colSpan={OBSERVATION_COLUMNS} className="px-4 pb-2 text-[11px] text-amber-900">
                            Page {row.item.page ?? "?"} · read as{" "}
                            {row.observation.configurations?.length ? row.observation.configurations.join(" · ") : "shared"}{" "}
                            {canEdit && (
                              <RowConfigurationPicker
                                labels={labels}
                                lands={[]}
                                readAs={row.observation.configurations ?? []}
                                byReviewer={row.observation.configurationsByReviewer}
                                disabled={busyHere}
                                startOpen
                                onSave={(configurations) => saveRow(row, configurations)}
                              />
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className={`rounded-lg border border-neutral-200 border-l-4 ${colour.border}`}>
            <div className={`flex flex-wrap items-center gap-2 px-3 py-2 ${colour.band}`}>
              <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${colour.chip}`}>
                {variantName(card.codeRaw, tab.label, card.codeRaw)}
              </span>
              {tab.namesRaw.length > 0 ? (
                <span className="text-xs text-neutral-600">
                  named on the page{tab.namesRaw.length === 1 ? "" : "s"} as{" "}
                  {tab.namesRaw.map((raw) => `“${raw}”`).join(", ")}
                </span>
              ) : (
                named.configurations[tab.index]?.readAs === null && (
                  <span className="text-xs text-violet-800">added by a reviewer — no page names it</span>
                )
              )}
              {canEdit && (
                <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
                  <RenameConfiguration
                    key={`rename-${tab.label}`}
                    label={tab.label}
                    existing={labels}
                    disabled={busyHere}
                    onRename={(to) => {
                      saveList(currentList.map((entry) => (entry.label === tab.label ? { ...entry, label: to } : entry)));
                      // A row a reviewer had already placed on the old name
                      // follows it, or it would land nowhere.
                      for (const row of named.tabs.flatMap((entry) => entry.rows)) {
                        const own = row.observation.configurationsByReviewer;
                        if (Array.isArray(own) && own.includes(tab.label)) {
                          saveRow(row, own.map((label) => (label === tab.label ? to : label)));
                        }
                      }
                    }}
                  />
                  <RemoveConfiguration
                    key={`remove-${tab.label}`}
                    label={tab.label}
                    others={labels.filter((label) => label !== tab.label)}
                    ownRows={tab.rows.filter((row) => row.lands.length === 1).length}
                    disabled={busyHere}
                    onRemove={(rowsTo) => {
                      saveList(currentList.filter((entry) => entry.label !== tab.label));
                      if (rowsTo.mode === "none") return;
                      // IN THE SAME ACT: every row that was only this
                      // configuration's goes where the reviewer said.
                      for (const row of tab.rows.filter((entry) => entry.lands.length === 1)) {
                        saveRow(row, rowsTo.mode === "shared" ? [] : [rowsTo.to]);
                      }
                    }}
                  />
                </span>
              )}
            </div>

            {tab.rows.length === 0 ? (
              <p className="px-3 py-3 text-neutral-600">
                {tab.state === "applied"
                  ? "Everything that lands on this configuration has been written."
                  : "Nothing on these pages lands on this configuration."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-cell">
                  <ObservationTableHead />
                  <tbody>
                    {order.ordered.map((observation) => {
                      const row = rowById.get(observation.id)!;
                      const member = memberOf(row.item.id);
                      const blockers = rowBlockers(row);
                      const warnings = rowWarnings(row);
                      const isOther = order.otherIds.has(observation.id);
                      const shared = sharedWithSentence(row.lands, tab.label, total);
                      const callbacks = {
                        onChange: (target: DrawingObservation, changes: Record<string, unknown>) =>
                          void onSaveObservation(row.item, target, changes),
                        onIgnore: (target: DrawingObservation) => void onReview(row.item, [target], "ignore"),
                        onSwatch,
                      };
                      return (
                        <Fragment key={observation.id}>
                          {observation.id === order.firstOtherId && (
                            <OtherDimensionsToggle
                              count={order.otherDimensionRows.length}
                              shown={showOther}
                              onToggle={() => setShowOther((value) => !value)}
                            />
                          )}
                          {(!isOther || showOther) && (
                            <>
                              <ObservationRow
                                observation={observation}
                                page={row.item.page}
                                itemPages={card.pages}
                                importId={pageImportId(row.item.id)}
                                specFields={specFields}
                                drafts={drafts}
                                setDrafts={setDrafts}
                                busy={busyHere}
                                blocked={blockers.length > 0 || warnings.length > 0}
                                guessWhy={undefined}
                                finishFiling={member?.resolution?.finishFilings?.[observation.id]}
                                callbacks={callbacks}
                              />
                              {/* WHERE ELSE THIS ROW LANDS, in words: an edit
                                  here is an edit on every tab it is on. */}
                              <tr>
                                <td colSpan={OBSERVATION_COLUMNS} className="px-4 pb-1 text-[11px] text-neutral-500">
                                  Page {row.item.page ?? "?"}
                                  {shared ? ` · ${shared} — one row, written to each` : ` · ${tab.label} only`}
                                  {Array.isArray(row.observation.configurationsByReviewer) && (
                                    <span className="text-violet-800">
                                      {" "}
                                      · you set this; read as{" "}
                                      {row.observation.configurations?.length
                                        ? row.observation.configurations.join(" · ")
                                        : "shared"}
                                    </span>
                                  )}{" "}
                                  {canEdit && (
                                    <RowConfigurationPicker
                                      key={`${observation.id}-${row.lands.join("|")}`}
                                      labels={labels}
                                      lands={row.lands}
                                      readAs={row.observation.configurations ?? []}
                                      byReviewer={row.observation.configurationsByReviewer}
                                      disabled={busyHere}
                                      onSave={(configurations) => saveRow(row, configurations)}
                                    />
                                  )}
                                </td>
                              </tr>
                              <ReplacePanel
                                observation={observation}
                                occupants={member?.resolution?.occupants?.[observation.id] ?? []}
                                runs={member?.resolution?.resolution.runs ?? []}
                                recordNames={member?.resolution?.named?.recordNames}
                                busy={busyHere}
                                blocked={blockers.length > 0 || warnings.length > 0}
                                onChange={(target, changes) => void onSaveObservation(row.item, target, changes)}
                              />
                              <RowNotes blockers={blockers} warnings={warnings} />
                            </>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-neutral-200 bg-neutral-50 px-3 py-2">
              <p className="text-th font-semibold uppercase tracking-wider text-neutral-500">
                BWS Dimensions
                <Tip>Exactly what BWS field 3 will receive for this configuration, composed the way the export composes it.</Tip>
              </p>
              {dimensionCell.text ? (
                <p className="font-mono text-[13px] text-neutral-900">{dimensionCell.text}</p>
              ) : (
                <p className="text-neutral-500">No width, depth or height lands on this configuration yet.</p>
              )}
              {dimensionCell.problems.map((problem, index) => (
                <p key={index} className="text-xs text-amber-700">
                  {problem.message}
                </p>
              ))}
            </div>
          </div>

          {/* A PAGE'S PICTURE goes on every configuration that page writes, so
              it is chosen per page, below the tabs rather than on one of them. */}
          {pendingMembers.map((member) => (
            <div key={member.item.id} className="mt-3 rounded-lg border border-neutral-200">
              <p className="px-3 pt-2 text-xs text-neutral-600">
                Picture from page {member.item.page ?? "?"} — shown on every configuration this page writes.
              </p>
              <ItemImagePicker
                importId={pageImportId(member.item.id)}
                itemPage={member.item.page}
                proposal={member.item.imageProposal ?? null}
                views={member.item.viewRegions ?? []}
                onCropped={(image) => onImage(member.item.id, image)}
              />
            </div>
          ))}
        </div>

        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <PagePreview
            importId={previewItem ? pageImportId(previewItem) : importId}
            page={shownPage}
            className="w-full"
          />
          <PagePicker pages={pages} current={shownPage} onPick={setPreviewPage} />

          <RunTargets
            runs={runs}
            ticked={ticked}
            mixed={mixed}
            itemCodeRaw={card.codeRaw}
            records={records}
            busy={busyHere}
            onToggle={toggleRun}
            onPick={(recordId) => {
              for (const member of pendingMembers) void onSaveTargets(member.item, [recordId], []);
            }}
            className="rounded-lg border border-neutral-200 px-3 py-2.5"
            note={
              mixed.size > 0 ? (
                <p className="mt-1 text-xs text-amber-800">
                  The pages do not currently agree about which phases they apply to. Tick or untick to settle it — a
                  phase that quotes this line quotes every configuration of it.
                </p>
              ) : undefined
            }
          />

          <LevelControl
            targets={levelForTargets}
            suggestion={suggestLevelFromCard(
              pendingMembers.flatMap((member) =>
                member.pending.map((observation) => ({ ...observation, page: member.item.page })),
              ),
            )}
            busy={busyHere}
            onSet={(level) => void onSetLevel(levelForTargets.map((entry) => entry.id), level)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-[#fcfcfc] px-4 py-3">
        <p className="text-neutral-600">
          {blockedMember
            ? `Page ${blockedMember.item.page ?? "?"} cannot be confirmed yet: ${blockedMember.resolution?.blockers[0]?.message ?? ""}`
            : recordsSentence}
        </p>
        <span className="flex-1" />
        {/* ONE CONFIRM FOR THE CARD; each PAGE still commits on its own request,
            atomically, in page order. Enabled only when every page can. */}
        <Button variant="primary" onClick={confirmAll} disabled={busyHere || !confirmable}>
          {busyHere ? "Confirming…" : `Confirm ${card.codeRaw} (${total} configuration${total === 1 ? "" : "s"})`}
        </Button>
      </div>
    </div>
  );
}
