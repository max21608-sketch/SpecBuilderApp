-- ==========================================================================
-- 0045_finish_standard.sql -- BW's own finish is set ONCE PER CODE, in the
-- finishes library, and applies to every item carrying the code.
--
-- WHY (Max, 2026-10-05). "BW own finishes should be set once per code in the
-- finishes library" -- and earlier: "main timber finish is like a Ben Whistler
-- standard finish ... when someone actually looks at it in the finishes
-- library they'll then apply it there." Per code only. No per-item override.
--
-- 0041 put the BW standard on `record_attributes`, per ITEM: the client
-- specifies "30% oak", BW proposes its own "25% oak", the client agrees, and
-- both stay visible for ever. That reasoning is unchanged and is not repeated
-- here -- read 0041's header. What moves is WHERE the decision is taken. A
-- client's timber code is on eleven items; choosing BW's oak eleven times is
-- eleven chances to choose two different oaks for one code, and the library is
-- already the place where "if that code changes, it needs to change on all of
-- them" is answered (0018).
--
-- ---- THE SAME SIX COLUMNS, THE SAME SHAPE ---------------------------------
--
-- Copied from 0041 column for column and CHECK for CHECK, because they are the
-- same statement made about a different row, and `standardFromRow` reads both.
-- A second shape would be a second set of rules about what "agreed" means.
--
--   standard_value      the BWS palette option, verbatim.
--   standard_option_id  which option. Restrict: an option is deactivated,
--                       never deleted (both palette seeds upsert).
--   standard_state      proposed | agreed | tbc. `tbc` is "BW will propose
--                       one" and carries no value.
--   standard_set_by/at  who and when; the change set says why.
--   standard_agreed_evidence_id
--                       the client's "yes, fine" email, where one was
--                       attached. Set null if the attachment goes, leaving
--                       the agreement standing on its change set.
--
-- WHICH PALETTE a code's standard comes from is NOT a column. It is read from
-- the BWS fields the code's items sit in (timber 4/31/143, metal 5/35) and
-- then from the finish's kind -- `paletteForFinish` in
-- `src/lib/finish-standard-palette.ts`, a pure function the screen and the
-- write path both call. A stored palette key would be a third answer beside
-- those two, and it would go stale the first time a code moved fields.
--
-- ---- WHAT HAPPENS TO 0041'S PER-ITEM COLUMNS -------------------------------
--
-- Nothing is dropped and nothing is copied. For an attribute LINKED to a
-- finish, the finish's standard is the standard -- `standardInForce` in
-- `src/lib/bw-standard.ts` is the one rule, and every reader calls it. For an
-- UNLINKED attribute (a finish nobody filed), 0041's per-item columns stay
-- exactly as they are, because there is no code to set it on. A per-item
-- standard on a linked attribute is kept as history and the record screen
-- says the library's replaces it; the library offers it back as a suggestion,
-- which a person files. This migration writes no row: a copy made here would
-- be a standard nobody chose for the code, written outside a change set.
--
-- ---- THE CHANGE-SET KINDS ARE NOT RE-LISTED ------------------------------
--
-- `standard_set`, `standard_agreed` and `standard_change` (0041) are the same
-- three acts on a different row, and `standard_change` already requires a
-- reason in `change_sets_reason_required`. Neither CHECK is touched here.
-- `tests/db/vocabulary-sync.test.ts` holds STANDARD_STATES to the new state
-- constraint as it does to 0041's.
-- ==========================================================================
begin;

alter table project_finishes
  add column standard_value text,
  add column standard_option_id uuid references spec_palette_options(id) on delete restrict,
  add column standard_state text,
  add column standard_set_by text,
  add column standard_set_at timestamptz,
  add column standard_agreed_evidence_id uuid references attachments(id) on delete set null;

alter table project_finishes add constraint project_finishes_standard_state_check
  check (standard_state is null or standard_state in ('proposed', 'agreed', 'tbc'));

-- A value and its option exist exactly when the state is proposed or agreed.
-- `tbc` is a state with nothing yet to say, and no state means no standard.
alter table project_finishes add constraint project_finishes_standard_shape
  check (
    (standard_state in ('proposed', 'agreed')
       and standard_value is not null and btrim(standard_value) <> ''
       and standard_option_id is not null)
    or (standard_state is distinct from 'proposed' and standard_state is distinct from 'agreed'
       and standard_value is null and standard_option_id is null)
  );

-- Who and when, whenever there is a standard at all.
alter table project_finishes add constraint project_finishes_standard_has_actor
  check ((standard_state is null) = (standard_set_by is null and standard_set_at is null));

-- Evidence of an agreement belongs to an agreement.
alter table project_finishes add constraint project_finishes_standard_evidence_is_agreed
  check (standard_agreed_evidence_id is null or standard_state = 'agreed');

comment on column project_finishes.standard_value is
  'BW''s own finish for this code (a BWS palette option, verbatim), applying to every item carrying the code. Wins over any per-item standard on a linked attribute (0045).';
comment on column project_finishes.standard_state is
  'proposed | agreed | tbc, or null for no BW finish on this code. tbc means BW will propose one and carries no value (0045).';
comment on column record_attributes.standard_value is
  'The BW standard (a BWS palette option, verbatim) proposed beside what the client specified. Shipped by the export when proposed or agreed (0041) -- for an UNLINKED attribute only: a linked one takes its finish''s standard (0045).';

commit;
