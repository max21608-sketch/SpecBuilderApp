"use client";

// The record's sidebar cards about where it sits: a mock-up item's card (0043)
// and the Configurations card, in whichever direction this record sits in its
// family, with rename, retire and put back. Moved out of
// src/app/dashboard/records/[id]/page.tsx on 2026-11-07 (audit 5.3, cut C).
//
// "Add a configuration" is the page's: its panel opens WIDE at the top of the
// Specs tab, so the button here only asks the page to open it.
import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { variantName } from "@/lib/record-variants";
import { recordShortLabel } from "@/lib/record-label";
import { describeRetireEffect } from "@/lib/configuration-carry";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Note from "@/components/ui/Note";
import { TONE } from "@/components/ui/tone";
import type { FamilyMember, Payload, SpecRecord } from "@/components/records/record-payload";

/**
 * THE PANEL'S STATE IS THE PAGE'S. This panel sits on the Specs tab and is
 * unmounted when another tab is chosen, and before the split a half-typed
 * rename or retire reason was still there on coming back. Held here, it would
 * be gone; the page calls this hook and passes it in.
 */
export function useConfigurationPanelState() {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  /** The reason box for retiring a configuration; null while it is closed. */
  const [configReason, setConfigReason] = useState<string | null>(null);
  const [configStatusBusy, setConfigStatusBusy] = useState(false);
  return { renaming, setRenaming, renameBusy, setRenameBusy, configReason, setConfigReason, configStatusBusy, setConfigStatusBusy };
}

export type ConfigurationPanelState = ReturnType<typeof useConfigurationPanelState>;

export default function ConfigurationPanel({
  state,
  record,
  mockup,
  parentRefs,
  billQty,
  variants,
  unallocated,
  addingConfiguration,
  onAddConfiguration,
  reloadThen,
}: {
  state: ConfigurationPanelState;
  record: SpecRecord;
  mockup: Payload["mockup"];
  /** The bill line's client refs: a configuration carries none of its own. */
  parentRefs: string;
  billQty: number | null;
  variants: FamilyMember[];
  unallocated: number | null;
  addingConfiguration: boolean;
  onAddConfiguration: () => void;
  /** The page's reload, which reports a refusal after it. */
  reloadThen: (message: string | null) => Promise<void>;
}) {
  const { renaming, setRenaming, renameBusy, setRenameBusy, configReason, setConfigReason, configStatusBusy, setConfigStatusBusy } =
    state;

  /** A configuration's name, corrected. Refused in words for one already used. */
  async function rename() {
    if (renaming === null) return;
    setRenameBusy(true);
    try {
      const res = await apiFetch(`/api/records/${record.id}/configuration-name`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: renaming, version: record.version }),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) setRenaming(null);
    } finally {
      setRenameBusy(false);
    }
  }

  /** Retire a configuration (a reason is required) or put it back. */
  async function setConfigurationStatus(status: "active" | "retired") {
    if (status === "retired" && !configReason?.trim()) return;
    setConfigStatusBusy(true);
    try {
      const res = await apiFetch(`/api/records/${record.id}/configuration-status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          version: record.version,
          reason: status === "retired" ? configReason?.trim() : null,
        }),
      });
      await reloadThen(res.ok ? null : res.error);
      if (res.ok) setConfigReason(null);
    } finally {
      setConfigStatusBusy(false);
    }
  }

  return (
    <>
      {/* ==========================================================
          THE FAMILY, IN WHICHEVER DIRECTION THIS RECORD SITS IN IT.
          A bill line drawn in two fabrics is a HEADING: its
          configurations are what the export ships, so the card has to
          say so or the line reads as an item nobody has specced. A
          configuration has to name the bill line it came from, because
          its record number does not.
          ========================================================== */}
      {/* ==========================================================
          A MOCK-UP ITEM (0043) SAYS WHAT IT IS AND WHERE IT CAME
          FROM, and can be taken off the mock-up phase by the same
          verb that retires a configuration — with a reason, because
          it leaves the export.
          ========================================================== */}
      {mockup?.isMockup && (
        <Card title="Mock-up">
          <p className="text-[12.5px] text-neutral-700">
            {mockup.of ? (
              <>
                Added to {record.run_name} from{" "}
                <Link
                  href={`/dashboard/records/${mockup.of.id}`}
                  className="underline hover:text-neutral-900"
                >
                  {recordShortLabel(mockup.of.recordNo)} on {mockup.of.runName}
                </Link>
                , which keeps its own place there.
              </>
            ) : (
              <>On {record.run_name}. The item it was added from no longer exists.</>
            )}{" "}
            Its identity was copied and nothing else: no quantity, and no specs — it takes its own from the
            mock-up drawings, which may differ.
          </p>
          {record.status === "retired" ? (
            <Note
              tone="blocked"
              title="Retired."
              actions={
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={configStatusBusy}
                  onClick={() => void setConfigurationStatus("active")}
                >
                  Put it back
                </Button>
              }
            >
              This mock-up item is not exported.
            </Note>
          ) : configReason !== null ? (
            <div className="mt-2">
              <label className="block text-xs text-neutral-600">
                Why is it coming off {record.run_name}?
                <textarea
                  autoFocus
                  value={configReason}
                  onChange={(event) => setConfigReason(event.target.value)}
                  rows={2}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="danger"
                  size="xs"
                  disabled={configStatusBusy || !configReason.trim()}
                  onClick={() => void setConfigurationStatus("retired")}
                >
                  Retire it
                </Button>
                <Button variant="quiet" size="xs" onClick={() => setConfigReason(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Button variant="quiet" size="xs" onClick={() => setConfigReason("")}>
                Retire
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card title="Configurations">
        {record.parent_id ? (
          <>
          <p className="text-[12.5px] text-neutral-700">
            Configuration {record.variant_label} of{" "}
            <Link href={`/dashboard/records/${record.parent_id}`} className="underline hover:text-neutral-900">
              {parentRefs || "the bill line"}
            </Link>
            , which the bill lists once
            {billQty !== null && <> at {billQty} off</>}. This configuration is what BWS receives.
          </p>
          {record.status === "retired" ? (
            /* RETIRED, NOT GONE. Its name stays taken, and putting it
               back is one click — refused in words if a live sibling
               now has the same name. */
            <Note
              tone="blocked"
              title="Retired."
              actions={
                <Button
                  variant="secondary"
                  size="xs"
                  disabled={configStatusBusy}
                  onClick={() => void setConfigurationStatus("active")}
                >
                  Put it back
                </Button>
              }
            >
              This configuration is not exported. Its name is never reused.
            </Note>
          ) : configReason !== null ? (
            <div className="mt-2">
              <Note tone="warn">
                {describeRetireEffect(
                  parentRefs || "the bill line",
                  record.variant_label ?? "",
                  variants.filter((member) => member.id !== record.id).length,
                )}
              </Note>
              <label className="mt-2 block text-xs text-neutral-600">
                Why is it being retired?
                <textarea
                  autoFocus
                  value={configReason}
                  onChange={(event) => setConfigReason(event.target.value)}
                  rows={2}
                  className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="danger"
                  size="xs"
                  disabled={configStatusBusy || !configReason.trim()}
                  onClick={() => void setConfigurationStatus("retired")}
                >
                  Retire it
                </Button>
                <Button variant="quiet" size="xs" onClick={() => setConfigReason(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : renaming === null ? (
            <div className="mt-2 flex gap-2">
              <Button variant="quiet" size="xs" onClick={() => setRenaming(record.variant_label ?? "")}>
                Rename
              </Button>
              <Button variant="quiet" size="xs" onClick={() => setConfigReason("")}>
                Retire
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
                aria-label="New name for this configuration"
                className="w-28 rounded border border-neutral-300 px-2 py-1 text-sm"
              />
              <Button variant="primary" size="xs" disabled={renameBusy || !renaming.trim()} onClick={() => void rename()}>
                Save
              </Button>
              <Button variant="quiet" size="xs" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </div>
          )}
          </>
        ) : variants.length > 0 ? (
          <>
            <p className="text-[12.5px] text-neutral-700">
              The bill lists this once{record.qty !== null && <> at {record.qty} off</>}, and the drawings
              show it in {variants.length} configurations.{" "}
              <strong className="font-medium">They are what the export carries</strong>, not this line.
            </p>
            <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
              {variants.map((member) => (
                <li key={member.id} className="py-1.5 text-[12.5px]">
                  <span className="font-medium text-neutral-900">
                    {variantName(parentRefs, member.variant_label, `#${member.record_no}`)}
                  </span>
                  <span className="ml-1.5 font-mono text-neutral-500">
                    {recordShortLabel({
                      recordNo: member.record_no,
                      parentRecordNo: member.parent_record_no ?? null,
                      variantOrdinal: member.variant_ordinal ?? null,
                    })}
                  </span>
                  {member.id === record.id ? (
                    <span className="ml-2 text-neutral-400">you are here</span>
                  ) : (
                    <Link
                      href={`/dashboard/records/${member.id}`}
                      className="ml-2 underline hover:text-neutral-900"
                    >
                      open
                    </Link>
                  )}
                  <span className="mt-0.5 block text-neutral-500">
                    {Number(member.attribute_count) > 0
                      ? `${member.attribute_count} specs captured`
                      : "nothing captured yet"}
                    {" · "}
                    {member.qty === null ? (
                      <span className={TONE.warn.text}>quantity not allocated</span>
                    ) : (
                      `qty ${member.qty}`
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {/* The bill's quantity is not apportioned by anything:
                splitting it has a price attached. So the gap is stated,
                never divided. */}
            {unallocated !== null && unallocated !== 0 && (
              <p className={`mt-2 text-xs ${TONE.warn.text}`}>
                {unallocated} of the bill&rsquo;s {billQty} is not allocated to a configuration.
              </p>
            )}
          </>
        ) : (
          <p className="text-[12.5px] text-neutral-500">
            This bill line is not split.
            {record.qty !== null && <> Its {record.qty} are one item.</>}
          </p>
        )}
        {/* UNDER THE TEXT, not in the heading: this column is 260px and
            a heading action ran past the card's edge. The panel it
            opens is WIDE, at the top of this tab. */}
        {!addingConfiguration && (
          <Button variant="secondary" size="xs" className="mt-3" onClick={onAddConfiguration}>
            Add a configuration
          </Button>
        )}
      </Card>
    </>
  );
}
