-- ==========================================================================
-- 0041_bw_standard.sql -- the BW standard finish sits BESIDE what the client
-- specified, and never over it.
--
-- WHAT WENT WRONG (traced on staging, 2026-09-23). The drawings card offers a
-- BWS palette under a timber or metal callout (item 2.2), and picking an
-- option wrote the option into the observation's `value`. `valueRaw` kept the
-- drawing's words and the card printed "drawing said: ..." underneath -- but
-- `record_attributes` has no raw column, so the confirm inserted only the
-- option, and `promote-answers` set the answer's `value_raw` from that same
-- option. After confirm the client's words ("feet dark tinted wood as per
-- approved sample") existed only inside `intake_runs.parsed`, and no screen
-- showed them. `bws-export.ts` still said `value` "stays exactly what the
-- drawing said". One column had quietly started meaning two things -- what the
-- client said, and what we will make -- which is the exact disagreement the
-- export check sheet exists to catch.
--
-- THE WORKFLOW IT HAS TO HOLD (Max, 2026-09-23). The client specifies "30%
-- oak". BW proposes its own standard, "25% oak". The client agrees. BOTH stay
-- visible for ever, per ITEM, and the export ships the BW standard where there
-- is one. A BW standard may be TBC -- "we will propose one".
--
-- ---- SO `value` GOES BACK TO MEANING WHAT THE DOCUMENT SAID, ALWAYS -------
--
-- The standard is six columns beside it rather than a second attribute row.
-- `record_attributes_field_slot_key` says one BWS field, one statement per
-- record, and a second row for the same field re-opens "which line wins" --
-- the question that index closed, and 0029's argument for the qualifier. It
-- is not a version of the value either: it is BW's answer TO the value.
--
--   standard_value      the BWS palette option, verbatim (label and code as
--                       BWS prints them), so the cell stays checkable
--                       against BWS itself.
--   standard_option_id  which option. Restrict, not cascade: an option is
--                       deactivated, never deleted (both palette seeds upsert).
--   standard_state      proposed | agreed | tbc. `tbc` is "BW will propose
--                       one" and carries no value, exactly as a TBC answer is
--                       a state and not an empty string.
--   standard_set_by/at  who and when, on the row; the change set says why.
--   standard_agreed_evidence_id
--                       the client's "yes, fine" email, where one was
--                       attached. The change set carries it too; it is here
--                       so the Specs tab can open it without walking the
--                       trail. Set null if the attachment ever goes, which
--                       leaves the agreement standing -- the change set is
--                       still the record of it.
--
-- WHY AN UPDATE IN PLACE IS RIGHT HERE when a correction is a supersession
-- (0033): a correction changes what the row says a DOCUMENT said, and a row
-- saying something its page does not is a false provenance. The standard is
-- not what the page said and cites no page. It is a decision taken beside the
-- page, recorded by a change set and a version like every other decision.
--
-- ---- THE CHANGE-SET KINDS, AND WHICH ONE ASKS WHY ------------------------
--
--   standard_set     proposing a standard, or saying one is TBC, where no
--                    agreed standard is being overridden. No reason: it
--                    overrides nothing a document or a person settled.
--   standard_agreed  the client said yes. No reason -- the evidence is the
--                    reason, and it is optional because a yes is often said
--                    on a call.
--   standard_change  changing or withdrawing an AGREED standard. A reason is
--                    REQUIRED, for the reason attribute_retire needs one: it
--                    overrides something a person (the client) settled.
--
-- BOTH CHANGE-SET LISTS BELOW WERE READ FROM THE LIVE CONSTRAINTS
-- (`pg_get_constraintdef` on `change_sets_kind_check` and
-- `change_sets_reason_required`) on the LOCAL stack at 0040 on 2026-09-23 --
-- this coder has no sandbox access, and the local stack carries every
-- migration through 0040 -- and they equal 0038's lists exactly. The only
-- additions are the ones marked. Re-read the live text before applying this
-- anywhere a later migration may have re-listed them (0032's post-mortem).
-- `tests/db/vocabulary-sync.test.ts` holds CHANGE_SET_KINDS,
-- REASON_REQUIRED_KINDS and STANDARD_STATES to these constraints.
-- ==========================================================================
begin;

alter table record_attributes
  add column standard_value text,
  add column standard_option_id uuid references spec_palette_options(id) on delete restrict,
  add column standard_state text,
  add column standard_set_by text,
  add column standard_set_at timestamptz,
  add column standard_agreed_evidence_id uuid references attachments(id) on delete set null;

alter table record_attributes add constraint record_attributes_standard_state_check
  check (standard_state is null or standard_state in ('proposed', 'agreed', 'tbc'));

-- A value and its option exist exactly when the state is proposed or agreed.
-- `tbc` is a state with nothing yet to say, and no state means no standard.
alter table record_attributes add constraint record_attributes_standard_shape
  check (
    (standard_state in ('proposed', 'agreed')
       and standard_value is not null and btrim(standard_value) <> ''
       and standard_option_id is not null)
    or (standard_state is distinct from 'proposed' and standard_state is distinct from 'agreed'
       and standard_value is null and standard_option_id is null)
  );

-- Who and when, whenever there is a standard at all.
alter table record_attributes add constraint record_attributes_standard_has_actor
  check ((standard_state is null) = (standard_set_by is null and standard_set_at is null));

-- Evidence of an agreement belongs to an agreement.
alter table record_attributes add constraint record_attributes_standard_evidence_is_agreed
  check (standard_agreed_evidence_id is null or standard_state = 'agreed');

comment on column record_attributes.value is
  'What the DOCUMENT said, always. A BW standard proposed beside it lives in standard_value (0041) and never overwrites this.';
comment on column record_attributes.standard_value is
  'The BW standard (a BWS palette option, verbatim) proposed beside what the client specified. Shipped by the export when proposed or agreed (0041).';
comment on column record_attributes.standard_state is
  'proposed | agreed | tbc, or null for no standard. tbc means BW will propose one and carries no value (0041).';

alter table change_sets drop constraint change_sets_kind_check;
alter table change_sets add constraint change_sets_kind_check check (kind in (
  'boq_confirm', 'boq_revision', 'run_retire', 'drawing_confirm',
  'spec_document_confirm', 'preamble_confirm', 'manual_edit',
  'attribute_retire', 'category_set', 'level_set', 'finish_edit', 'finish_link',
  'finish_unlink', 'baseline', 'history_begins', 'email_confirm',
  'run_create', 'record_create', 'attribute_create', 'attribute_correct',
  'record_retire', 'record_restore',
  -- Added here. A BW standard proposed (or said to be TBC), agreed by the
  -- client, and an agreed one changed or withdrawn.
  'standard_set', 'standard_agreed', 'standard_change'
));

alter table change_sets drop constraint change_sets_reason_required;
alter table change_sets add constraint change_sets_reason_required check (
  kind <> all (array[
    'attribute_retire', 'run_retire', 'finish_edit', 'finish_unlink', 'baseline',
    'attribute_correct', 'record_retire',
    -- Added here: it overrides what the client agreed to.
    'standard_change'
  ])
  or (reason is not null and btrim(reason) <> '')
);

commit;
