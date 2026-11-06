"use client";
// ============================================================================
// THE PROJECT'S DETAILS: a summary that reads, and a form that opens on Edit.
//
// Extracted from the project page on 2026-11-06 (audit G6) because the page
// re-seeded this form from the server every time its `load()` ran, and seven
// unrelated actions on that screen run it: starting a change, adding a
// contact, flagging or retiring a note, adding a phase, retrying a document,
// accepting levels. A person typing a client name who then started a change
// saw the box snap back to the stored value, and `dirty` went quiet with it,
// so the unsaved-changes warning had nothing to warn about.
//
// FIXED BY CONSTRUCTION, not by remembering. This component owns the form,
// and the form exists only while it is being edited (`draft`). Closed, it
// shows the project it was handed; open, nothing the parent does reaches it,
// because there is nothing to re-seed. A new project from the parent is read
// the next time somebody presses Edit.
//
// Its behaviour is otherwise UNCHANGED (CLAUDE.md, "The details form is
// unchanged and hidden"): it saves as ONE act, never on blur, with the same
// validation, date rules and unsaved-changes warning.
// ============================================================================
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  SPECS_AGREED_LABEL,
  daysUntilSpecsAgreed,
  hasProgramme,
  todayLocal,
  validateProgramme,
} from "@/lib/project-programme";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { ATTRIBUTE_UNITS, ATTRIBUTE_UNIT_LABELS } from "@/lib/spec-vocab";
import { formatDay } from "@/lib/format-day";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Tip from "@/components/ui/Tip";

/** The project fields this card shows and saves. The page's own type carries more. */
export type ProjectDetails = {
  id: string;
  bws_project_number: string;
  name: string;
  client: string | null;
  shared_inbox: string | null;
  order_date: string | null;
  specs_agreed_by: string | null;
  delivery_date: string | null;
  default_dimension_unit: string | null;
  /** The short code in in-house finish codes (0044): AMB → BW-AMB-001. */
  finish_code_prefix: string | null;
  version: number;
};

type Form = {
  name: string;
  client: string;
  sharedInbox: string;
  orderDate: string;
  specsAgreedBy: string;
  deliveryDate: string;
  defaultDimensionUnit: string;
  finishCodePrefix: string;
};

function formOf(project: ProjectDetails): Form {
  return {
    name: project.name,
    client: project.client ?? "",
    sharedInbox: project.shared_inbox ?? "",
    orderDate: project.order_date ?? "",
    specsAgreedBy: project.specs_agreed_by ?? "",
    deliveryDate: project.delivery_date ?? "",
    defaultDimensionUnit: project.default_dimension_unit ?? "",
    finishCodePrefix: project.finish_code_prefix ?? "",
  };
}

/**
 * One field of the project summary: a small label, the value, an optional tip.
 *
 * Deliberately not a `<dl>`: the grid is four across and a definition list
 * would need every term and every description to be siblings, which puts the
 * layout in the CSS and the meaning nowhere.
 */
function Detail({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
        {tip && <Tip>{tip}</Tip>}
      </div>
      <div className="mt-0.5 truncate text-sm text-neutral-900">{children}</div>
    </div>
  );
}

/** A value nobody has set. Grey and in words, never an empty cell. */
function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-neutral-400">{children}</span>;
}

/** A day as a person writes it, or the grey words for one nobody has set. */
function day(value: string | null): React.ReactNode {
  return value ? formatDay(value) : <Unset>not set</Unset>;
}

export default function ProjectDetailsCard<P extends ProjectDetails>({
  project,
  onSaved,
  onError,
}: {
  project: P;
  /** The project as the server returned it after a save. */
  onSaved: (project: P) => void;
  /** A refusal for the page's banner, or null to clear it, as the page always did. */
  onError: (message: string | null) => void;
}) {
  // NON-NULL WHILE THE FORM IS OPEN, and the only copy of what is being typed.
  const [draft, setDraft] = useState<Form | null>(null);
  const editing = draft !== null;
  const form = draft ?? formOf(project);
  const setForm = (next: Form) => setDraft(next);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(() => {
    if (!draft) return false;
    const stored = formOf(project);
    return (Object.keys(stored) as (keyof Form)[]).some((key) => stored[key].trim() !== draft[key].trim());
  }, [project, draft]);

  useUnsavedChangesWarning(dirty, "This project has unsaved changes. Leave without saving them?");

  // Refused before the request, in the same words the server uses. The server
  // check is the real one — this only saves a round trip.
  const dateError = useMemo(
    () =>
      validateProgramme({
        orderDate: form.orderDate || null,
        specsAgreedBy: form.specsAgreedBy || null,
        deliveryDate: form.deliveryDate || null,
      }),
    [form.orderDate, form.specsAgreedBy, form.deliveryDate],
  );

  const today = todayLocal();
  const untilSpecs = daysUntilSpecsAgreed(project.specs_agreed_by, today);
  const programme = hasProgramme({
    orderDate: project.order_date,
    specsAgreedBy: project.specs_agreed_by,
    deliveryDate: project.delivery_date,
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    onError(null);
    setSaved(false);
    try {
      const res = await apiFetch<{ project: P }>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: project.version,
          name: draft.name.trim(),
          client: draft.client.trim() || null,
          sharedInbox: draft.sharedInbox.trim() || null,
          orderDate: draft.orderDate.trim() || null,
          specsAgreedBy: draft.specsAgreedBy.trim() || null,
          deliveryDate: draft.deliveryDate.trim() || null,
          defaultDimensionUnit: draft.defaultDimensionUnit.trim() || null,
          finishCodePrefix: draft.finishCodePrefix.trim().toUpperCase() || null,
        }),
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onSaved(res.data.project);
      setSaved(true);
      // Back to the summary. The panel exists to be filled in and left, and
      // staying in it after a save leaves nine inputs on screen saying nothing.
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
    className: "w-full border border-neutral-300 rounded px-3 py-2 text-sm",
  });

  return (
    <>
      {!editing && (
        <Card
          title="Project"
          className="scroll-mt-20"
          actions={
            <>
              {dirty ? (
                <span className="font-medium normal-case tracking-normal text-amber-800">Unsaved changes</span>
              ) : saved ? (
                <span className="font-medium normal-case tracking-normal text-green-700">Saved</span>
              ) : null}
              <Button size="xs" onClick={() => setDraft(formOf(project))}>
                Edit
              </Button>
            </>
          }
        >
          <div id="project-details" className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            <Detail label="BWS number">
              <span className="font-mono">{project.bws_project_number}</span>
            </Detail>
            <Detail label="Name">{project.name}</Detail>
            <Detail label="Client">{project.client || <Unset>none recorded</Unset>}</Detail>
            <Detail
              label="Shared inbox"
              tip="Mail forwarded here is placed on this project automatically. Blank means there is none, and mail will not route to it."
            >
              {project.shared_inbox ? (
                <a
                  href={`mailto:${project.shared_inbox}`}
                  className="font-mono text-xs text-blue-700 no-underline hover:underline"
                >
                  {project.shared_inbox}
                </a>
              ) : (
                <Unset>none</Unset>
              )}
            </Detail>
            <Detail
              label="Drawing units"
              tip="Used only where a page prints no unit and its own figures do not agree. A unit printed on the page always wins."
            >
              {project.default_dimension_unit ? (
                ATTRIBUTE_UNIT_LABELS[project.default_dimension_unit as keyof typeof ATTRIBUTE_UNIT_LABELS] ??
                project.default_dimension_unit
              ) : (
                <Unset>not set — asked per dimension</Unset>
              )}
            </Detail>
            <Detail
              label="In-house finish codes"
              tip="The code this app gives a finish the client gave none. Set once; changing it later starts a new series and renames nothing."
            >
              {project.finish_code_prefix ? (
                <span className="font-mono">BW-{project.finish_code_prefix}-001…</span>
              ) : (
                <Unset>no short code — BW-F-001…</Unset>
              )}
            </Detail>
            <Detail label="Order date">{day(project.order_date)}</Detail>
            <Detail
              label={SPECS_AGREED_LABEL}
              tip="The gate before drawings can be issued, and the date the spec table measures Overdue against."
            >
              {project.specs_agreed_by ? (
                <span className="font-medium">
                  {formatDay(project.specs_agreed_by)}
                  {untilSpecs !== null && (
                    <Chip tone={untilSpecs < 0 ? "danger" : untilSpecs <= 14 ? "warn" : "plain"} className="ml-1.5">
                      {untilSpecs < 0
                        ? `${-untilSpecs} day${untilSpecs === -1 ? "" : "s"} over`
                        : untilSpecs === 0
                          ? "today"
                          : `${untilSpecs} days`}
                    </Chip>
                  )}
                </span>
              ) : (
                <Unset>not set</Unset>
              )}
            </Detail>
            <Detail label="Delivery">{day(project.delivery_date)}</Detail>
          </div>
          {/* NOT a tip. A project with no programme and a project on time
              look identical otherwise, so this has to be readable without
              hovering anything. */}
          {!programme && (
            <Note tone="warn">
              No programme recorded. Nothing on this project can be flagged overdue until{" "}
              {SPECS_AGREED_LABEL.toLowerCase()} holds a date — that is not the same as being on time.
            </Note>
          )}
        </Card>
      )}

      <form
        onSubmit={save}
        className={`mt-4 rounded-[10px] border border-neutral-200 bg-white p-4 ${editing ? "" : "hidden"}`}
      >
        <h2 className="font-medium text-neutral-900">Details</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm text-neutral-600">
            BWS project number
            <input
              value={project.bws_project_number}
              readOnly
              disabled
              className="mt-1 w-full rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Fixed. Every record number and every export is labelled with it.
            </span>
          </label>
          <label className="text-sm text-neutral-600">
            Name
            <input {...field("name")} className={`mt-1 ${field("name").className}`} />
          </label>
          <label className="text-sm text-neutral-600">
            Client
            <input {...field("client")} placeholder="None recorded" className={`mt-1 ${field("client").className}`} />
          </label>
        </div>

        <h2 className="mt-6 font-medium text-neutral-900">Shared inbox</h2>
        <p className="mt-1 text-xs text-neutral-500">
          The project&rsquo;s shared mailbox, recorded here so correspondence has one home. Leave it blank if
          there is none — that is a real choice, not a gap.
        </p>
        <input
          {...field("sharedInbox")}
          type="email"
          placeholder="p17231@benwhistler.com"
          className={`mt-2 sm:max-w-sm ${field("sharedInbox").className}`}
        />

        {/* The unit question, asked once instead of once per dimension. It is
            the LAST resort of three — a unit printed on the page wins, and the
            page's own figures agreeing wins after that — so the copy has to say
            when it is used, or it reads as "force everything to centimetres". */}
        <h2 className="mt-6 font-medium text-neutral-900">Drawing units</h2>
        <p className="mt-1 text-xs text-neutral-500">
          What this project&rsquo;s drawings are drawn in. Used only where a page prints no unit and its own
          figures do not agree — a unit printed on the page always wins. Leave it unset and every such dimension
          asks you individually, which is the old behaviour.
        </p>
        <select
          value={form.defaultDimensionUnit}
          onChange={(event) => setForm({ ...form, defaultDimensionUnit: event.target.value })}
          className="mt-2 rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="">Not set — ask me per dimension</option>
          {ATTRIBUTE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {ATTRIBUTE_UNIT_LABELS[unit]}
            </option>
          ))}
        </select>
        {form.defaultDimensionUnit && (
          <p className="mt-1 text-xs text-amber-800">
            A dimension that would be implausible at this unit is flagged for a second look, but it is still
            confirmable — this setting trades a check for speed.
          </p>
        )}

        {/* THE SHORT CODE (0044). Upper-cased as it is typed, so what is on
            screen is what is stored; refused in words by the route if it
            is not two to six letters or digits. */}
        <h2 className="mt-6 font-medium text-neutral-900">In-house finish codes</h2>
        <label className="mt-1 block text-sm text-neutral-600">
          Short code for in-house finish codes (e.g. AMB → BW-AMB-001)
          <input
            value={form.finishCodePrefix}
            onChange={(event) => setForm({ ...form, finishCodePrefix: event.target.value.toUpperCase() })}
            placeholder="AMB"
            maxLength={6}
            className="mt-1 block w-32 rounded border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Used for a finish the client gave no code. Changing it later never renames a code already given — the
          next one starts at 001 under the new short code. Leave it blank and codes read BW-F-001.
        </p>

        <h2 className="mt-6 font-medium text-neutral-900">TOE key dates</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {SPECS_AGREED_LABEL} is the gate before drawings can be issued, and the date the spec table measures
          Overdue against.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm text-neutral-600">
            Order date
            <input {...field("orderDate")} type="date" className={`mt-1 ${field("orderDate").className}`} />
          </label>
          <label className="text-sm text-neutral-600">
            {SPECS_AGREED_LABEL}
            <input {...field("specsAgreedBy")} type="date" className={`mt-1 ${field("specsAgreedBy").className}`} />
          </label>
          <label className="text-sm text-neutral-600">
            Delivery date
            <input {...field("deliveryDate")} type="date" className={`mt-1 ${field("deliveryDate").className}`} />
          </label>
        </div>

        {/* A null date means NO PROGRAMME, not "on time". Saying nothing here
            would let an empty programme read as a healthy one — the same error
            as a category with no requirements scoring 0/0 and rendering green. */}
        {!programme ? (
          <Note tone="warn">
            No programme recorded. Nothing on this project can be flagged overdue until{" "}
            {SPECS_AGREED_LABEL.toLowerCase()} holds a date — that is not the same as being on time.
          </Note>
        ) : project.specs_agreed_by === null ? (
          <Note tone="warn">
            No date for {SPECS_AGREED_LABEL.toLowerCase()}. The other dates are recorded, but Overdue is measured
            against this one, so nothing will be flagged.
          </Note>
        ) : untilSpecs !== null && untilSpecs < 0 ? (
          <Note tone="danger">
            Specifications were due {-untilSpecs} day{untilSpecs === -1 ? "" : "s"} ago. Anything outstanding on
            the spec table is overdue.
          </Note>
        ) : (
          <Note tone="plain">
            {untilSpecs === 0
              ? "Specifications are due today."
              : `${untilSpecs} day${untilSpecs === 1 ? "" : "s"} until specifications must be agreed.`}
          </Note>
        )}

        {dateError && <Note tone="danger">{dateError}</Note>}

        <div className="mt-4 flex items-center gap-3">
          {/* SAVED AS ONE ACT, not on blur: typing the name, tabbing to the
              client and typing there used to lose the second box, because
              the first blur saved and the reload re-keyed every input. */}
          <Button type="submit" variant="primary" size="sm" disabled={saving || !dirty || Boolean(dateError)}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {/* DISCARDS NOTHING BY ITSELF — it closes the panel and puts the form
              back to what the server holds, which is the only state the summary
              can honestly render. `dirty` is what makes the difference visible
              before it goes. */}
          <Button
            size="sm"
            onClick={() => setDraft(null)}
          >
            {dirty ? "Discard changes" : "Close"}
          </Button>
          {dirty && <span className="text-xs text-amber-800">Unsaved changes</span>}
          {!dirty && saved && <span className="text-xs text-green-700">Saved</span>}
        </div>
      </form>
    </>
  );
}
