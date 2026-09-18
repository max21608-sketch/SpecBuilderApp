"use client";

// One card for one CODE, with every configuration of it inside.
//
// ============================================================================
// WHY THE PAGES OF ONE CODE ARE ONE CARD
//
// The AP364 set draws S-201 on two pages, S-200 on two, S-301 on four: the same
// chair, the same geometry, different fabric and timber callouts. The bill has
// ONE line each, and confirming creates one variant record per page under it
// (`variant-create.ts`).
//
// As one card per page, that was carried by a grey chip and a sentence above
// four cards a reviewer had to hold in their head as related. The same four
// dimensions were checked four times, and the one thing that genuinely differs
// -- the fabric -- was what got scrolled past. Asked for directly by Max on
// 2026-09-16: one box, a chip per configuration, the dimensions once, and each
// configuration's own specs below, all visible at once and plainly separated.
//
// ============================================================================
// WHAT IS SHARED ON SCREEN IS STILL WRITTEN PER PAGE
//
// The geometry table is rendered once and edited once, and every edit reaches
// the MATCHING row on every configuration's page (`fanOut` below). That is not
// a shortcut around the data model, it is the data model: `record_attributes`
// holds what a page SAID, so configuration B's width has to come from page 6
// and carry page 6 as its source. Writing page 5's row to B would either
// fabricate a source page or lie about one.
//
// It also keeps the confirm route untouched. One request still names ONE staged
// item and its whole pending set, re-checked against the live grouping; the
// card just issues several of them. Copying rows at confirm time instead would
// make B's atomicity depend on A's state.
//
// THE LETTER IS NEVER SENT. It is derived from page order by
// `variantLettersByItem`, on the server and here, so the screen and the confirm
// reach the same answer without either telling the other.
// ============================================================================
import { Fragment, useEffect, useState } from "react";
import { composeDimensionCell } from "@/lib/dimensions";
import { measuredRows, wasReadByModel, type DrawingItem, type DrawingObservation } from "@/lib/drawing-document";
import { EMPTY_GUESS, guessSlotsFromViews } from "@/lib/dimension-guess";
import { sharedTargets, type ConfigurationMember, type ReviewCard } from "@/lib/configuration-cards";
import { variantName } from "@/lib/record-variants";
import { DIMENSION_SLOT_LABELS, type DimensionSlot } from "@/lib/spec-vocab";
import ItemImagePicker from "@/components/imports/ItemImagePicker";
import PagePreview from "@/components/imports/PagePreview";
import {
  ObservationRow,
  ObservationTableHead,
  OtherDimensionsToggle,
  ReplacePanel,
  RowNotes,
  RunTargets,
  orderRows,
  type RecordChoice,
  type SpecField,
} from "@/components/imports/ObservationRows";
import { BulkUnit, type ItemResolution } from "@/components/imports/DrawingItemCard";
import Button from "@/components/ui/Button";
import type { CroppedImage } from "@/lib/pdf-crop";

/**
 * A colour per configuration, fixed by LETTER rather than by position on
 * screen.
 *
 * A reviewer matches the chip at the top of the card to the section below it by
 * colour, so A has to be the same colour on every reload and on every card --
 * if it shifted when a configuration was reviewed, the chip would stop being a
 * way of finding anything. Written out as literal class strings because
 * Tailwind reads the source, not the runtime.
 */
const CONFIGURATION_COLOURS = [
  { chip: "bg-sky-100 text-sky-900 border-sky-300", band: "bg-sky-50", border: "border-l-sky-400" },
  { chip: "bg-emerald-100 text-emerald-900 border-emerald-300", band: "bg-emerald-50", border: "border-l-emerald-400" },
  { chip: "bg-violet-100 text-violet-900 border-violet-300", band: "bg-violet-50", border: "border-l-violet-400" },
  { chip: "bg-amber-100 text-amber-900 border-amber-300", band: "bg-amber-50", border: "border-l-amber-400" },
  { chip: "bg-rose-100 text-rose-900 border-rose-300", band: "bg-rose-50", border: "border-l-rose-400" },
  { chip: "bg-teal-100 text-teal-900 border-teal-300", band: "bg-teal-50", border: "border-l-teal-400" },
];

const colourFor = (letter: string) => {
  const index = letter.charCodeAt(0) - 65;
  return CONFIGURATION_COLOURS[((index % CONFIGURATION_COLOURS.length) + CONFIGURATION_COLOURS.length) % CONFIGURATION_COLOURS.length]!;
};

export type ConfigurationCardProps = {
  card: Extract<ReviewCard<ItemResolution>, { kind: "configurations" }>;
  importId: string;
  /** Which run each member belongs to, for the pack screen. Single-run screens pass the same id. */
  importIdFor?: (itemId: string) => string;
  specFields: SpecField[];
  records: RecordChoice[];
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Partial<DrawingObservation>>>>;
  /** The screen's raw busy key, so the card can tell "this card" from "that page". */
  busy: string | null;
  onSaveObservation: (item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) => Promise<void>;
  onSaveObservations: (edits: { item: DrawingItem; observation: DrawingObservation; changes: Record<string, unknown> }[]) => Promise<void>;
  onSaveTargets: (item: DrawingItem, ticked: string[], unticked: string[]) => Promise<void>;
  onSetBulkUnit: (scope: "item" | "run", unit: "mm" | "cm", itemId?: string) => Promise<void>;
  onReview: (item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") => Promise<void>;
  onReviewMany: (
    key: string,
    entries: { label: string; item: DrawingItem; observations: DrawingObservation[] }[],
  ) => Promise<void>;
  onImage: (itemId: string, image: CroppedImage | null) => void;
  onSwatch: (observationId: string, image: CroppedImage | null) => void;
};

export default function ConfigurationCard({
  card,
  importId,
  importIdFor,
  specFields,
  records,
  drafts,
  setDrafts,
  busy,
  onSaveObservation,
  onSaveObservations,
  onSaveTargets,
  onSetBulkUnit,
  onReview,
  onReviewMany,
  onImage,
  onSwatch,
}: ConfigurationCardProps) {
  const [open, setOpen] = useState(true);
  const [showOther, setShowOther] = useState(false);

  const pendingMembers = card.members.filter((member) => member.state === "pending");
  const busyHere = busy === card.id || pendingMembers.some((member) => busy === member.item.id);
  const pageImportId = (itemId: string) => importIdFor?.(itemId) ?? importId;

  // ------------------------------------------------------------------ header
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-neutral-100">
      <div>
        <h3 className="text-base font-semibold text-neutral-900">
          {card.codeRaw}
          {card.name && <span className="ml-2 text-sm font-normal text-neutral-600">{card.name}</span>}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {card.members.map((member) => (
            <ConfigurationChip key={member.item.id} card={card} member={member} importId={pageImportId(member.item.id)} />
          ))}
        </div>
        {/* WHAT THIS CARD IS ABOUT TO DO, said differently for the two cases it
            covers — because they are different, and the card used to claim the
            expensive one whatever the truth.

            A SPLIT creates a record per configuration and takes the bill line
            out of the export, so the file ships several jobs where the bill has
            one line. Saying that about one armchair drawn on its specification
            sheet and again on its shop drawing is the S-200 defect, and the
            sentence was how it announced itself. */}
        <p className="mt-1.5 max-w-3xl text-xs text-neutral-600">
          {card.split
            ? `One bill line, drawn as ${card.members.length} configurations. ` +
              (card.geometry.status === "shared"
                ? "They are the same size; each carries its own finishes and becomes its own record under the bill line, and the export ships the configurations rather than the line."
                : "These pages do not state the same size — see below.")
            : `One item, described on ${card.members.length} pages. Everything confirmed here lands on the same record, and the bill line is what the export ships. ` +
              (card.geometry.status === "shared"
                ? "The pages state the same size."
                : "These pages do not state the same size — see below, and one of the readings is wrong.")}
        </p>
        {/* WHY THEY ARE ON ONE CARD, quoting the pages. Whether these are one
            item or several is the most consequential thing this card asserts,
            and it is checked the same way a dimension is: by reading the reason
            against the drawing. A version 1 run has none — a page count gave
            no reason — and says nothing rather than inventing one. */}
        {card.groupedBecause && (
          <p className="mt-1 max-w-3xl text-xs text-neutral-500">
            <span className="font-medium text-neutral-600">Read as {card.split ? "configurations" : "one item"}:</span>{" "}
            {card.groupedBecause}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
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
    </div>
  );

  if (!open) {
    return (
      <div className="border border-neutral-200 rounded-lg bg-white">
        {header}
        <p className="px-4 py-3 text-sm text-neutral-600">
          {pendingMembers.length} configuration{pendingMembers.length === 1 ? "" : "s"} still to review.
        </p>
      </div>
    );
  }

  // --------------------------------------------------------------- geometry
  const geometry = card.geometry;
  const leader =
    geometry.status === "shared" ? pendingMembers.find((member) => member.item.id === geometry.leaderId) : undefined;

  // Computed from the LEADER, and identical rows give an identical answer on
  // every configuration — which is exactly what `status: "shared"` established.
  const guess = leader
    ? // NOT ON A VERSION 2 ITEM — see `wasReadByModel`. The model said which
      // figure is which and why, and those reasons are on the rows; re-guessing
      // here only produces a dispute banner describing a sort this app no
      // longer does, above rows that say something else.
      wasReadByModel(leader.item)
      ? EMPTY_GUESS
      : guessSlotsFromViews(
          measuredRows(leader.item).map((observation) => ({
            id: observation.id,
            labelRaw: observation.labelRaw,
            value: observation.value ?? observation.valueRaw,
          })),
          leader.item.itemNameRaw,
        )
    : EMPTY_GUESS;
  const guessWhy = new Map(guess.guesses.map((entry) => [entry.observationId, entry.why]));

  const dimensionCell = leader
    ? composeDimensionCell(
        leader.pending
          .filter((o) => o.attrGroup === "dimension" && o.dimensionSlot)
          .map((o, index) => ({
            slot: o.dimensionSlot as DimensionSlot,
            value: drafts[o.id]?.value !== undefined ? (drafts[o.id]?.value ?? null) : o.value,
            unit: o.unit,
            state: o.state ?? "confirmed",
            sortOrder: index,
          })),
      )
    : { text: "", problems: [] as { message: string }[] };

  /**
   * One edit, written to the matching row on every configuration.
   *
   * Sent as ONE batch so the screen saves and reloads once: four separate
   * autosaves would mean four reloads under the reviewer's cursor. Each carries
   * its own page's observation and that observation's own version, so a row
   * somebody else has edited is refused on its own rather than taking the
   * others with it.
   */
  const fanOut = (leaderRow: DrawingObservation, changes: Record<string, unknown>) => {
    if (geometry.status !== "shared") return;
    const row = geometry.rows.find((entry) => entry.leader.id === leaderRow.id);
    if (!row) return;
    const edits = pendingMembers
      .map((member) => ({ item: member.item, observation: row.byMember[member.item.id], changes }))
      .filter((edit): edit is { item: DrawingItem; observation: DrawingObservation; changes: Record<string, unknown> } =>
        Boolean(edit.observation),
      );
    void onSaveObservations(edits);
  };

  const fanOutIgnore = (leaderRow: DrawingObservation) => {
    if (geometry.status !== "shared") return;
    const row = geometry.rows.find((entry) => entry.leader.id === leaderRow.id);
    if (!row) return;
    for (const member of pendingMembers) {
      const observation = row.byMember[member.item.id];
      if (observation) void onReview(member.item, [observation], "ignore");
    }
  };

  // ------------------------------------------------------------ applies to
  const { ticked, mixed } = sharedTargets(card.members);
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

  // --------------------------------------------------------------- confirm
  const blockedMember = pendingMembers.find((member) => (member.resolution?.blockers.length ?? 0) > 0);
  const totalSpecs = pendingMembers.reduce((total, member) => total + member.pending.length, 0);
  const confirmable =
    pendingMembers.length > 0 &&
    !blockedMember &&
    pendingMembers.every((member) => (member.resolution?.targets.length ?? 0) > 0 && member.pending.length > 0);

  const confirmAll = () =>
    void onReviewMany(
      card.id,
      pendingMembers.map((member) => ({
        label: memberName(card, member),
        item: member.item,
        observations: member.pending,
      })),
    );

  const sharedRows = geometry.status === "shared" ? geometry.rows : [];
  const sharedOrder = orderRows(sharedRows.map((row) => row.leader));

  return (
    <div className="border border-neutral-200 rounded-lg bg-white">
      {header}

      {/* A KEY MEASUREMENT DISPUTE, WITH THE DRAWING. The views do not agree
          about which figure is the overall size, so the sizes below are the
          weak reading — and the page goes here, because a question that is
          unreadable as a list of figures is answerable in two seconds off the
          drawing. */}
      {geometry.status === "shared" && guess.dispute && leader && (
        <div className="px-4 py-3 border-b border-amber-300 bg-amber-50">
          <p className="text-xs uppercase tracking-wide text-amber-800">Key measurement dispute</p>
          <div className="mt-1 flex flex-wrap gap-4">
            <p className="flex-1 min-w-[16rem] text-sm text-amber-900">
              {guess.dispute}
              <span className="block mt-1 text-xs text-amber-800">
                The yellow lines below carry this guess. Correct any that are wrong, or set one back to a note — it
                stays on the item with its label and figure intact either way.
              </span>
            </p>
            <PagePreview importId={pageImportId(leader.item.id)} page={leader.item.page} className="w-72 max-w-full" />
          </div>
        </div>
      )}

      {/* THE PAGES DISAGREE ABOUT THE SIZE. Never averaged and never resolved:
          either these are genuinely different sizes, which is a real thing a
          bill line can be, or one of them is a misread. Both are a person's
          call, so each configuration keeps its own figures and shows them
          below. Not a blocker — the card still commits. */}
      {geometry.status === "disagree" && (
        <div className="px-4 py-3 border-b border-amber-300 bg-amber-50 text-sm text-amber-900">
          <p className="text-xs uppercase tracking-wide text-amber-800">These pages do not agree on the size</p>
          <ul className="mt-1 space-y-0.5">
            {geometry.differences.map((difference) => (
              <li key={difference.slot}>
                <span className="font-medium">{DIMENSION_SLOT_LABELS[difference.slot]}</span>:{" "}
                {Object.entries(difference.byLetter)
                  .map(([letter, value]) => `${letter} ${value ?? "says nothing"}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-800">
            If these are genuinely different sizes this is a configuration split rather than a fabric one — confirm
            them as they are and each keeps its own figures. If one is a misread, correct it in that configuration
            below and the shared view comes back.
          </p>
        </div>
      )}

      {geometry.status === "shared" && (
        <>
          <div className="px-4 py-2 border-b border-neutral-100 bg-neutral-50">
            <p className="text-xs uppercase tracking-wide text-neutral-500">BWS Dimensions</p>
            {dimensionCell.text ? (
              <p className="font-mono text-sm text-neutral-900">{dimensionCell.text}</p>
            ) : (
              <p className="text-sm text-neutral-500">
                No width, depth or height placed yet. Give a figure below its slot, or leave them as notes — they stay
                on the item either way.
              </p>
            )}
            {dimensionCell.problems.map((problem, index) => (
              <p key={index} className="text-xs text-amber-700">
                {problem.message}
              </p>
            ))}
          </div>

          <div className="px-4 pt-3">
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              Shared geometry — written to every configuration from its own page
            </p>
            {geometry.withoutGeometry.length > 0 && (
              <p className="mt-0.5 text-xs text-neutral-600">
                {geometry.withoutGeometry.join(" and ")} draw{geometry.withoutGeometry.length === 1 ? "s" : ""} no
                dimensions, so {geometry.withoutGeometry.length === 1 ? "that configuration carries" : "those configurations carry"}{" "}
                only their own finishes.
              </p>
            )}
          </div>

          <table className="w-full text-sm">
            <ObservationTableHead />
            <tbody>
              {sharedOrder.ordered.map((leaderRow) => {
                const row = sharedRows.find((entry) => entry.leader.id === leaderRow.id)!;
                // Blocked where ANY configuration is blocked on its own copy of
                // this measurement: the shared row is one control over several
                // rows, so it cannot look clear while one of them refuses.
                const blockers = pendingMembers.flatMap(
                  (member) =>
                    member.resolution?.blockers.filter(
                      (blocker) => blocker.observationId === row.byMember[member.item.id]?.id,
                    ) ?? [],
                );
                const warnings = pendingMembers.flatMap(
                  (member) =>
                    member.resolution?.warnings?.filter(
                      (warning) => warning.observationId === row.byMember[member.item.id]?.id,
                    ) ?? [],
                );
                const isOther = sharedOrder.otherIds.has(leaderRow.id);
                return (
                  <Fragment key={leaderRow.id}>
                    {leaderRow.id === sharedOrder.firstOtherId && (
                      <OtherDimensionsToggle
                        count={sharedOrder.otherDimensionRows.length}
                        shown={showOther}
                        onToggle={() => setShowOther((value) => !value)}
                      />
                    )}
                    {(!isOther || showOther) && (
                      <>
                        <ObservationRow
                          observation={leaderRow}
                          page={leader?.item.page ?? null}
                          importId={leader ? pageImportId(leader.item.id) : importId}
                          specFields={specFields}
                          drafts={drafts}
                          setDrafts={setDrafts}
                          busy={busyHere}
                          blocked={blockers.length > 0 || warnings.length > 0}
                          guessWhy={guessWhy.get(leaderRow.id)}
                          callbacks={{ onChange: fanOut, onIgnore: fanOutIgnore, onSwatch }}
                        />
                        {row.missingOn.length > 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 pb-1 text-xs text-neutral-500">
                              Not drawn on {row.missingOn.join(" or ")} — nothing is written there for this
                              measurement.
                            </td>
                          </tr>
                        )}
                        {/* PER CONFIGURATION, because what a measurement
                            replaces is the VARIANT's own existing value: A may
                            hold a height that B does not. */}
                        {pendingMembers.map((member) => {
                          const observation = row.byMember[member.item.id];
                          if (!observation) return null;
                          const occupants = member.resolution?.occupants?.[observation.id] ?? [];
                          if (occupants.length === 0) return null;
                          return (
                            <ReplacePanel
                              key={`${member.item.id}-${observation.id}`}
                              observation={observation}
                              occupants={occupants}
                              runs={member.resolution?.resolution.runs ?? []}
                              busy={busyHere}
                              blocked
                              heading={memberName(card, member)}
                              onChange={(target, changes) => void onSaveObservation(member.item, target, changes)}
                            />
                          );
                        })}
                        <RowNotes blockers={blockers} warnings={warnings} />
                      </>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <RunTargets
        runs={pendingMembers[0]?.resolution?.resolution.runs ?? card.members[0]?.resolution?.resolution.runs ?? []}
        ticked={ticked}
        mixed={mixed}
        itemCodeRaw={card.codeRaw}
        records={records}
        busy={busyHere}
        onToggle={toggleRun}
        onPick={(recordId) => {
          for (const member of pendingMembers) void onSaveTargets(member.item, [recordId], []);
        }}
        note={
          mixed.size > 0 ? (
            <p className="mt-1 text-xs text-amber-800">
              The configurations do not currently agree about which runs they apply to. Tick or untick to settle it —
              a run that quotes this line quotes every configuration of it.
            </p>
          ) : undefined
        }
      />

      {card.members.map((member) => (
        <ConfigurationSection
          key={member.item.id}
          card={card}
          member={member}
          importId={pageImportId(member.item.id)}
          specFields={specFields}
          drafts={drafts}
          setDrafts={setDrafts}
          busy={busyHere}
          sharedRowIds={
            geometry.status === "shared"
              ? new Set(sharedRows.map((row) => row.byMember[member.item.id]?.id).filter(Boolean) as string[])
              : new Set<string>()
          }
          extras={geometry.status === "shared" ? (geometry.extras[member.item.id] ?? []) : []}
          onSaveObservation={onSaveObservation}
          onReview={onReview}
          onImage={onImage}
          onSwatch={onSwatch}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-neutral-100">
        <p className="text-xs text-neutral-500">
          {blockedMember
            ? `${memberName(card, blockedMember)} cannot be confirmed yet: ${
                blockedMember.resolution?.blockers[0]?.message ?? ""
              }`
            : `Writes ${totalSpecs} spec${totalSpecs === 1 ? "" : "s"} across ${pendingMembers.length} configuration${
                pendingMembers.length === 1 ? "" : "s"
              }.`}
        </p>
        {/* ONE CONFIRM FOR THE CARD. Each configuration still commits on its
            own request, atomically, in letter order -- the item is the unit of
            commit and that has not changed. What has changed is that a
            reviewer rules on the item once, having seen all of it.
            Enabled only when EVERY configuration can commit: one that skipped
            a blocked configuration would read as done. */}
        <Button variant="primary" onClick={confirmAll} disabled={busyHere || !confirmable}>
          {busyHere
            ? "Confirming…"
            : `Confirm ${card.codeRaw} (${pendingMembers.length} configuration${pendingMembers.length === 1 ? "" : "s"})`}
        </Button>
      </div>
    </div>
  );
}

/**
 * What to call one member of a configuration card.
 *
 * `S-200 A` is THE NAME OF A RECORD — the confirm creates it, the export ships
 * it, and somebody will quote it in an email six weeks later. It may only
 * appear where such a record is actually being created. Where the card is not
 * splitting anything, the pages are sources and a page number is what tells
 * them apart.
 *
 * One helper because five places name a member — the chip, the band header, the
 * picture heading, the blocker sentence and the confirm summary — and four of
 * them saying "S-200 A" while the fifth says "Page 2" is its own confusion.
 */
function memberName(
  card: Extract<ReviewCard<ItemResolution>, { kind: "configurations" }>,
  member: ConfigurationMember<ItemResolution>,
): string {
  return card.split
    ? variantName(card.codeRaw, member.letter, card.codeRaw)
    : `Page ${member.item.page ?? "?"}`;
}

function ConfigurationChip({
  card,
  member,
  importId,
}: {
  card: Extract<ReviewCard<ItemResolution>, { kind: "configurations" }>;
  member: ConfigurationMember<ItemResolution>;
  importId: string;
}) {
  const colour = colourFor(member.letter);
  const exists = Object.keys(member.resolution?.writesTo ?? {}).length > 0;
  // "RECORD WILL BE CREATED" IS ABOUT A RECORD PER CONFIGURATION, and printing
  // it on each page of a card that is creating none says the opposite of what
  // the card is doing — two chips, two promises of a record, for one chair. On
  // a non-split card the pages write to the SAME record, which the Applies-to
  // panel below states once; only what has happened to this page belongs here.
  const state = card.split
    ? member.state === "applied"
      ? "applied"
      : member.state === "ignored"
        ? "ignored"
        : exists
          ? "record exists"
          : "record will be created"
    : member.state === "applied"
      ? "applied"
      : member.state === "ignored"
        ? "ignored"
        : null;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded border px-2 py-0.5 text-xs ${colour.chip} ${
        member.state === "pending" ? "" : "opacity-60"
      }`}
    >
      {/* "S-200 A" is the NAME OF A RECORD this confirm will create, and it is
          what somebody will later quote in an email. It must not appear on a
          card that is not splitting anything — there the pages are sources, and
          the page number is what identifies one. */}
      {/* The NAME, then a link to the page it came from. On a non-splitting
          card the name IS the page, so the link carries the word instead of
          the chip saying "Page 1 Page 1". */}
      {card.split && <span className="font-medium">{memberName(card, member)}</span>}
      {member.item.page ? (
        <a
          href={`/api/imports/${importId}/source#page=${member.item.page}`}
          className={card.split ? "underline" : "font-medium underline"}
          target="_blank"
          rel="noreferrer"
        >
          Page {member.item.page}
        </a>
      ) : (
        !card.split && <span className="font-medium">{memberName(card, member)}</span>
      )}
      {state && <span>· {state}</span>}
    </span>
  );
}

/**
 * One configuration's own specs: its picture, its finishes, its notes.
 *
 * Banded and bordered in the configuration's colour, because the whole point of
 * one card is that a reviewer can see at a glance which fabric belongs to which
 * letter. A reviewed configuration collapses to a line -- it is history, and
 * history does not need controls.
 */
function ConfigurationSection({
  card,
  member,
  importId,
  specFields,
  drafts,
  setDrafts,
  busy,
  sharedRowIds,
  extras,
  onSaveObservation,
  onReview,
  onImage,
  onSwatch,
}: {
  card: Extract<ReviewCard<ItemResolution>, { kind: "configurations" }>;
  member: ConfigurationMember<ItemResolution>;
  importId: string;
  specFields: SpecField[];
  drafts: Record<string, Partial<DrawingObservation>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, Partial<DrawingObservation>>>>;
  busy: boolean;
  sharedRowIds: ReadonlySet<string>;
  extras: DrawingObservation[];
  onSaveObservation: (item: DrawingItem, observation: DrawingObservation, changes: Record<string, unknown>) => Promise<void>;
  onReview: (item: DrawingItem, observations: DrawingObservation[], action: "confirm" | "ignore" | "restore") => Promise<void>;
  onImage: (itemId: string, image: CroppedImage | null) => void;
  onSwatch: (observationId: string, image: CroppedImage | null) => void;
}) {
  const colour = colourFor(member.letter);
  const [armed, setArmed] = useState(false);
  const [showExtras, setShowExtras] = useState(false);
  useEffect(() => setArmed(false), [member.pending.length]);
  const name = memberName(card, member);

  if (member.state !== "pending") {
    const applied = member.item.observations.filter((o) => o.reviewStatus === "applied");
    const reviewed = member.item.observations.find((o) => o.reviewedAt)?.reviewedAt ?? null;
    return (
      <div className={`border-t border-neutral-100 border-l-4 ${colour.border} px-4 py-2 text-xs text-neutral-500`}>
        <span className="font-medium text-neutral-700">{name}</span>{" "}
        {member.state === "applied"
          ? `— applied${reviewed ? ` on ${new Date(reviewed).toLocaleDateString("en-GB")}` : ""}, ${applied.length} spec${
              applied.length === 1 ? "" : "s"
            } written.`
          : "— ignored. The rows are restorable under Ignored below."}
      </div>
    );
  }

  // Everything this page says that the shared geometry table is not already
  // showing: its finishes, its materials, its notes.
  const own = member.pending.filter((observation) => !sharedRowIds.has(observation.id));
  const callbacks = {
    onChange: (observation: DrawingObservation, changes: Record<string, unknown>) =>
      void onSaveObservation(member.item, observation, changes),
    onIgnore: (observation: DrawingObservation) => void onReview(member.item, [observation], "ignore"),
    onSwatch,
  };

  return (
    <div className={`border-t border-neutral-100 border-l-4 ${colour.border}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 ${colour.band}`}>
        <p className="text-sm">
          <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${colour.chip}`}>{name}</span>
          {member.item.page && <span className="ml-2 text-xs text-neutral-600">Page {member.item.page}</span>}
        </p>
        <Button
          size="xs"
          disabled={busy || member.pending.length === 0}
          className={armed ? "border-amber-400 bg-amber-50 text-amber-900" : undefined}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            void onReview(member.item, member.pending, "ignore");
          }}
        >
          {/* IT IGNORES THIS ITEM'S ROWS, NOT THE PAGE. `onReview` is called
              with `member.pending`, which is correct — but a page can carry
              several item codes, and on such a sheet "Ignore page 4" promises
              to discard the other items on it too. */}
          {armed ? `Ignore all ${member.pending.length} rows?` : "Ignore these rows"}
        </Button>
      </div>

      <ItemImagePicker
        importId={importId}
        itemPage={member.item.page}
        proposal={member.item.imageProposal ?? null}
        views={member.item.viewRegions ?? []}
        onCropped={(image) => onImage(member.item.id, image)}
      />

      {own.length > 0 && (
        <table className="w-full text-sm">
          <ObservationTableHead />
          <tbody>
            {own.map((observation) => {
              const blockers = member.resolution?.blockers.filter((b) => b.observationId === observation.id) ?? [];
              const warnings = member.resolution?.warnings?.filter((w) => w.observationId === observation.id) ?? [];
              const occupants = member.resolution?.occupants?.[observation.id] ?? [];
              const isExtra = extras.some((extra) => extra.id === observation.id);
              if (isExtra && !showExtras) return null;
              return (
                <Fragment key={observation.id}>
                  <ObservationRow
                    observation={observation}
                    page={member.item.page}
                    importId={importId}
                    specFields={specFields}
                    drafts={drafts}
                    setDrafts={setDrafts}
                    busy={busy}
                    blocked={blockers.length > 0 || warnings.length > 0}
                    guessWhy={undefined}
                    callbacks={callbacks}
                  />
                  <ReplacePanel
                    observation={observation}
                    occupants={occupants}
                    runs={member.resolution?.resolution.runs ?? []}
                    busy={busy}
                    blocked={blockers.length > 0 || warnings.length > 0}
                    onChange={(target, changes) => void onSaveObservation(member.item, target, changes)}
                  />
                  <RowNotes blockers={blockers} warnings={warnings} />
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {extras.length > 0 && (
        <p className="px-4 py-2 text-xs">
          <Button size="xs" variant="quiet" onClick={() => setShowExtras((value) => !value)}>
            {showExtras ? "Hide" : `Also measured on this page only (${extras.length}) — show`}
          </Button>
        </p>
      )}
    </div>
  );
}
