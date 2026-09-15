-- ==========================================================================
-- 0011_dimension_slots.sql -- the BWS Dimensions field has a fixed shape, so a
-- dimension row has a fixed slot.
-- Target: PostgreSQL 13+. Forward-only.
--
-- WHY: "ENDLESS DIMENSIONS" IS A REAL OUTPUT, NOT A WORRY.
--
-- 0007 let a dimension carry whatever label a document printed, because a
-- drawing labels its figures however it likes. One real AP364 armchair page
-- came back with 44 of them. The Panther specification sheets in the same pack
-- add WIDTH SEAT, DEPTH SEAT, WIDTH BACK, DEPTH BACK and ARM HEIGHT on top of
-- width/depth/height, and a second template in the SAME pack prints the whole
-- thing as one unlabelled line, "80 x 70 x 90 cm". Composed into BWS field 3
-- that produced a cell nobody could read and nobody could check against a page.
--
-- Matthew ruled what the cell contains on 2026-09-15: W*** x D*** x H***mm,
-- everything in millimetres with the unit written ONCE at the end; seat height
-- appended as SH***; a round item written Dia.*** IN PLACE OF W*** x D***.
-- Five slots and nothing else.
--
-- `dimension_slot` is the machine key for that ruling. `label` stays the
-- document's own word. Constraining `label` instead was the other option and it
-- is wrong twice: it destroys the provenance that makes a mis-mapped row
-- traceable back to its page, and it makes the composer compare a controlled
-- vocabulary as raw strings -- which is how a tariff priced per "sqm" was
-- invisible to a line quoted in "m" on the fabric app, with no error anywhere
-- and the money simply missing.
--
-- WHAT HAPPENS TO EVERY OTHER FIGURE: IT BECOMES A NOTE, INTACT. Nothing a
-- document printed is dropped. ARM HEIGHT 520mm keeps its label, its value, its
-- unit, its source run and its page, and still prints on the long-form sheet of
-- the export. It has only stopped claiming a BWS dimension.
--
-- That is why record_attributes_unit_is_dimension is REPLACED here rather than
-- kept. A note that IS a measurement must keep its unit in its own column;
-- folding "520" and "mm" into one string is the exact thing
-- src/lib/anthropic.ts tells the MODEL never to do, and it would be perverse
-- for this app to do it instead.
--
-- ROUND IS INFERRED FROM THE SLOT. If DIA is filled the item is round; there is
-- no shape flag that can disagree with the data. A record carrying DIA *and* W
-- or D is a CONFLICT that the review screen and the export both name in words.
-- It is cross-row, so no check constraint can hold it, and a trigger would fire
-- in the middle of a fan-out with a message about a row the reviewer never saw.
-- Blockers are computed, never stored, and this one belongs there.
--
-- THE 0007 EXEMPTION IS HALF-LIFTED. record_attributes_field_slot_key exempts
-- dimensions from slot uniqueness because "many of them compose into the single
-- Dimensions field by design". Still true -- five rows still compose into json
-- id 3 -- so that index is left exactly as it is. But with a fixed slot set,
-- "one active W per record" IS enforceable, and a second drawing page adding a
-- second W is precisely the silent overwrite that index exists to prevent:
-- composeDimensionCell would pick one by sort order and the other would vanish
-- with no error anywhere.
--
-- KNOWN RISK, recorded rather than discovered later: a nest of three tables, or
-- a pair of bedsides, quoted as ONE BOQ line has three widths. The unique index
-- refuses that and the extras land as notes. Whether that is a real case at
-- Ben Whistler is open item 21 and is a question for Matthew, not a guess for
-- this migration.
--
-- BACKFILL, AND WHAT IT CANNOT DO. Existing dimension rows are mapped through
-- the same synonym table normaliseDimensionSlot uses. A label that maps to
-- nothing is NOT deleted and NOT guessed at -- it becomes a note, keeping every
-- column it had. Read the raise notice; it is the count of rows that moved.
-- ==========================================================================

begin;

alter table record_attributes add column dimension_slot text;

-- The same folding normaliseDimensionSlot does: diameter symbols first (the
-- character class below would strip them), then lowercase, punctuation to
-- spaces, collapse, trim. EXACT matches only -- "width seat" is a seat width,
-- not a width, and it maps to nothing on purpose.
update record_attributes
set dimension_slot = case
      btrim(regexp_replace(
        regexp_replace(lower(label), '[ø⌀]', 'dia', 'g'),
        '[^a-z0-9]+', ' ', 'g'))
      when 'w' then 'W'
      when 'width' then 'W'
      when 'wide' then 'W'
      when 'overall width' then 'W'
      when 'width overall' then 'W'
      when 'd' then 'D'
      when 'depth' then 'D'
      when 'deep' then 'D'
      when 'overall depth' then 'D'
      when 'depth overall' then 'D'
      when 'h' then 'H'
      when 'ht' then 'H'
      when 'height' then 'H'
      when 'high' then 'H'
      when 'overall height' then 'H'
      when 'height overall' then 'H'
      when 'sh' then 'SH'
      when 'seat height' then 'SH'
      when 'height seat' then 'SH'
      when 'seat ht' then 'SH'
      when 'seat h' then 'SH'
      when 'dia' then 'DIA'
      when 'diameter' then 'DIA'
      else null
    end
where attr_group = 'dimension';

-- ORDER MATTERS HERE, and getting it wrong is how this file failed the first
-- time it ran. The demotion below turns dimensions into notes, and the OLD
-- constraint forbids a unit on a note -- so a row like ("Front view width",
-- 190, cm) fails the moment it becomes a note. The constraint has to be
-- replaced BEFORE the rows move, not after.
--
-- Replaced, not dropped: a note that is a measurement keeps its unit in its own
-- column. See the header. Materials, finishes and hardware still cannot carry
-- one -- a fabric has no unit and a row claiming otherwise is a mis-read.
alter table record_attributes drop constraint record_attributes_unit_is_dimension;

alter table record_attributes
  add constraint record_attributes_unit_is_measurement
  check (unit is null or attr_group in ('dimension', 'note'));

-- Whatever the synonyms could not place stops being a dimension and stays a
-- complete record of what the page said. Every column it had, it keeps.
do $$
declare moved integer;
begin
  select count(*) into moved
    from record_attributes
   where attr_group = 'dimension' and dimension_slot is null;

  update record_attributes
     set attr_group = 'note'
   where attr_group = 'dimension' and dimension_slot is null;

  raise notice '0011: % dimension row(s) became notes; label, value and unit kept', moved;
end $$;

-- The skill's rule: name the offending rows rather than let a bare constraint
-- violation be the error message. Nothing should reach this after the update
-- above; if something does, the reader gets ids and labels instead of a code.
do $$
declare offenders text;
begin
  select string_agg(id::text || ' "' || label || '"', ', ') into offenders
    from record_attributes
   where attr_group = 'dimension' and dimension_slot is null;

  if offenders is not null then
    raise exception '0011: dimension rows still carry no slot: %', offenders;
  end if;
end $$;

alter table record_attributes
  add constraint record_attributes_dimension_slot_check
  check (dimension_slot is null or dimension_slot in ('W', 'D', 'H', 'SH', 'DIA'));

-- Biconditional on purpose. After this, attr_group = 'dimension' MEANS one of
-- Matthew's five slots -- which is what makes composeDimensionCell total: there
-- is no such thing as a slotless dimension for it to drop on the floor.
alter table record_attributes
  add constraint record_attributes_dimension_has_slot
  check ((attr_group = 'dimension') = (dimension_slot is not null));

-- One active width per record. Retiring the occupant frees the slot, and two
-- different records fanned out from one drawing page are unaffected -- which is
-- what keeps the fan-out working.
create unique index record_attributes_dimension_slot_key
  on record_attributes (record_id, dimension_slot)
  where dimension_slot is not null and status = 'active';

commit;
