-- ==========================================================================
-- 0011_bws_palette_options.sql -- the five BWS-owned palettes, as BWS holds
-- them.
--
-- WHY. 0008 seeded these five as rows with zero options and a null
-- `synced_at`, because BWS owns the lists and this app had never been given
-- them: "this vocabulary exists, BWS owns it, we have never had it". Item 0.1
-- of docs/plans/make-it-work-2026-09-19.md -- a real BWS account for Max --
-- was what blocked it, and on 2026-09-22 it stopped blocking.
--
-- ---- WHERE THESE CAME FROM ----------------------------------------------
--
-- All 84 standard specification fields were read read-only from Max's own BWS
-- session: `/standard_specification_fields/<id>/edit`, the **Palette options**
-- box, per field whose Field type is `palette`. 59 palettes, 413 option lines.
-- The capture is docs/plans/bws-palette-capture-2026-09-22.json, verified
-- byte-for-byte against a hash computed in the browser, and every row below
-- was GENERATED from that file rather than retyped. A re-sync re-scrapes,
-- diffs against the capture, and a person reads the diff.
--
-- **The Values page was NOT read, and must never be.** `/values` is what
-- people have TYPED into that field (`self-piped`, thirteen times); the
-- palette is the `palette_options` box on `/edit`. They are one click apart in
-- the BWS UI and somebody had already been caught by it. Seeding from Values
-- fills a controlled vocabulary with other people's free text.
--
-- ---- WHAT THE PARSE DROPS, AND WHY --------------------------------------
--
-- A bare rule -- `--------`, of varying length -- separates the indoor block
-- from the `OUTDOOR - ` block in five of BWS's palettes. It is a visual
-- divider in a textarea, not an option, and seeding it produces a selectable
-- answer called "------". It is dropped; the grouping survives in each
-- outdoor option's own prefix, which is how BWS spells it anyway.
--
-- Everything else is kept VERBATIM, including BWS's own inconsistencies: the
-- en dashes in `SEAT.01 - Webbed seats`, the curly quote in `3.5" cushion
-- border`, the double space in `BW Walnut -  Natural 10%`. `comparisonKey` in
-- src/lib/palettes.ts folds dash variants and runs of whitespace, so matching
-- still works; the stored value stays what BWS shows, which is what makes it
-- checkable against BWS.
--
-- ---- THE CODE IS PARSED OUT AND THE LABEL KEEPS IT -----------------------
--
-- Stud spec, alone, prints a BWE code inside the option. 0035's header has the
-- reasoning; the short version is that eight of thirteen carry one, five do
-- not, and two carry a further qualifier after the code, so neither half can
-- be thrown away. Both are stored.
--
-- ---- SEED ON `field_type`, NEVER ON THE BOX BEING NON-EMPTY -------------
--
-- Three of BWS's `free_text_only` fields still hold leftover text in their
-- palette_options box: COM 1 and COM 3 both offer `COM / BW Supplied COM`, and
-- BL Original Repeater holds `Yes`. COM 2 holds nothing, so it is residue
-- rather than intent. None of them is a palette in BWS and none is seeded
-- here. Anything that later widens this seed reads `field_type`.
--
-- ---- WHAT THIS DOES NOT DO ----------------------------------------------
--
-- It does not touch the six `owner = 'app'` palettes, though every one of them
-- turned out to have a BWS list behind it with different wording. Those are
-- Matthew's own words from his decision matrix and changing them is his call,
-- not this file's. Recorded in the capture note and for
-- docs/plans/matrix-assumptions.md.
--
-- It seeds five of BWS's 59 palettes -- the five the gate overlay points at.
-- The other 54 are in the capture; a palette row nothing references would be
-- an empty promise of the kind 0030's header is about.
-- ==========================================================================

-- The sync is claimed HERE, in the same file and the same statement batch as
-- the evidence for it, so `synced_at` can never be set by a run that did not
-- also insert the options. 0008's guard reads it.
update spec_palettes
   set synced_at  = timestamptz '2026-09-22 00:00:00+00',
       updated_by = 'seed'
 where owner = 'bws'
   and key in ('bws_timber_finish', 'bws_metal_finish', 'bws_seat_build',
               'bws_back_cushion', 'bws_stud');

insert into spec_palette_options
  (palette_key, value, label, sort_order, code, created_by, updated_by)
values
  ('bws_timber_finish', 'BW Beech Anthracite 30%', 'BW Beech Anthracite 30%', 1, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Anthracite 90%', 'BW Beech Anthracite 90%', 2, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Bison 30%', 'BW Beech Bison 30%', 3, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Bison 90%', 'BW Beech Bison 90%', 4, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Jet Black 30%', 'BW Beech Jet Black 30%', 5, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Jet Black 90%', 'BW Beech Jet Black 90%', 6, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Dark Brown 30%', 'BW Beech Dark Brown 30%', 7, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Dark Brown 90%', 'BW Beech Dark Brown 90%', 8, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Jacobean 30%', 'BW Beech Jacobean 30%', 9, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Beech Jacobean 90%', 'BW Beech Jacobean 90%', 10, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Grey - Open grain 10%', 'BW Oak Grey - Open grain 10%', 11, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Gun Metal - Open grain 10%', 'BW Oak Gun Metal - Open grain 10%', 12, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Natural - Open grain 10%', 'BW Oak Natural - Open grain 10%', 13, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Sable - Open grain 10%', 'BW Oak Sable - Open grain 10%', 14, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Espresso - Open grain 10%', 'BW Oak Espresso - Open grain 10%', 15, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak White washed - Open grain 10%', 'BW Oak White washed - Open grain 10%', 16, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Latte - Oiled', 'BW Oak Latte - Oiled', 17, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Honeycomb - Oiled', 'BW Oak Honeycomb - Oiled', 18, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Golden - Oiled', 'BW Oak Golden - Oiled', 19, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Dark Rum - Oiled', 'BW Oak Dark Rum - Oiled', 20, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Smoked Hickory - Oiled', 'BW Oak Smoked Hickory - Oiled', 21, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Oak Burnt Caramel - Oiled', 'BW Oak Burnt Caramel - Oiled', 22, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Ash Arabica - Closed grain 30%', 'BW Ash Arabica - Closed grain 30%', 23, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Ash Arabica - Closed grain 90%', 'BW Ash Arabica - Closed grain 90%', 24, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Australian Burnished 30%', 'BW Australian Burnished 30%', 25, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Australian Burnished 90%', 'BW Australian Burnished 90%', 26, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Australian Tinted 30%', 'BW Australian Tinted 30%', 27, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Walnut -  Natural 10%', 'BW Walnut -  Natural 10%', 28, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Ebony Macassar Natural 90%', 'BW Ebony Macassar Natural 90%', 29, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW Ebony Macassar Tinted 90%', 'BW Ebony Macassar Tinted 90%', 30, null, 'seed', 'seed'),
  ('bws_timber_finish', 'BW RAL 5011, 90%', 'BW RAL 5011, 90%', 31, null, 'seed', 'seed'),
  ('bws_timber_finish', 'RAL Paint', 'RAL Paint', 32, null, 'seed', 'seed'),
  ('bws_timber_finish', 'Specialist Finish', 'Specialist Finish', 33, null, 'seed', 'seed'),
  ('bws_timber_finish', 'Oak build - Finish TBC', 'Oak build - Finish TBC', 34, null, 'seed', 'seed'),
  ('bws_timber_finish', 'Beech build - Finish TBC', 'Beech build - Finish TBC', 35, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Bronzed Brass', 'BW Bronzed Brass', 1, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Antiqued Brass', 'BW Antiqued Brass', 2, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Polished Brass', 'BW Polished Brass', 3, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Brushed Brass', 'BW Brushed Brass', 4, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Polished Stainless Steel', 'BW Polished Stainless Steel', 5, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Brushed Stainless Steel', 'BW Brushed Stainless Steel', 6, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Brushed Champagne - Plated', 'BW Brushed Champagne - Plated', 7, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Copper - Plated', 'BW Copper - Plated', 8, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Almond Gold - Plated', 'BW Almond Gold - Plated', 9, null, 'seed', 'seed'),
  ('bws_metal_finish', 'BW Black Nickel - Plated', 'BW Black Nickel - Plated', 10, null, 'seed', 'seed'),
  ('bws_metal_finish', 'And Objects - Brushed Brass as per sample #64278 - WAX', 'And Objects - Brushed Brass as per sample #64278 - WAX', 11, null, 'seed', 'seed'),
  ('bws_metal_finish', 'And Objects - Polished Nickel as per sample #64278', 'And Objects - Polished Nickel as per sample #64278', 12, null, 'seed', 'seed'),
  ('bws_metal_finish', 'And Objects - Brass Bronze as per sample #64278 - WAX', 'And Objects - Brass Bronze as per sample #64278 - WAX', 13, null, 'seed', 'seed'),
  ('bws_metal_finish', 'And Objects - Aged Brass as per sample #64278 - SEALANT', 'And Objects - Aged Brass as per sample #64278 - SEALANT', 14, null, 'seed', 'seed'),
  ('bws_metal_finish', 'And Objects - Polished Brass as per sample #64278 - WAX', 'And Objects - Polished Brass as per sample #64278 - WAX', 15, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT.01 – Webbed seats, +22cm off seat rail', 'SEAT.01 – Webbed seats, +22cm off seat rail', 1, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT.02 – Superlooped seat, +22cm off seat rail', 'SEAT.02 – Superlooped seat, +22cm off seat rail', 2, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT.03 – Handsprung seat, +22cm off seat rail', 'SEAT.03 – Handsprung seat, +22cm off seat rail', 3, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT.04 – Fully upholstered seat, no cushion, +10cm from seat rail', 'SEAT.04 – Fully upholstered seat, no cushion, +10cm from seat rail', 4, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT.05 – Fully upholstered seat, no cushion, +7cm from seat rail', 'SEAT.05 – Fully upholstered seat, no cushion, +7cm from seat rail', 5, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT.06 – Fully Upholstered Handsprung seat, +5cm off seat rail', 'SEAT.06 – Fully Upholstered Handsprung seat, +5cm off seat rail', 6, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT DC.01 – Webbed +5cm off seat rail', 'SEAT DC.01 – Webbed +5cm off seat rail', 7, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT DC.02 - Zig Zag,  +5cm off seat rail', 'SEAT DC.02 - Zig Zag,  +5cm off seat rail', 8, null, 'seed', 'seed'),
  ('bws_seat_build', 'SEAT DC.03 – Hand Sprung +7cm off seat rail', 'SEAT DC.03 – Hand Sprung +7cm off seat rail', 9, null, 'seed', 'seed'),
  ('bws_seat_build', 'Banquette seat.01 – Boarded, Plain, adds 7cm', 'Banquette seat.01 – Boarded, Plain, adds 7cm', 10, null, 'seed', 'seed'),
  ('bws_seat_build', 'Banquette seat.02 – Webbed, Plain, adds 7cm', 'Banquette seat.02 – Webbed, Plain, adds 7cm', 11, null, 'seed', 'seed'),
  ('bws_seat_build', 'Banquette seat.03 – Zig-Zag, Plain, adds 7cm', 'Banquette seat.03 – Zig-Zag, Plain, adds 7cm', 12, null, 'seed', 'seed'),
  ('bws_seat_build', 'Banquette seat.04 – Hand-sprung, Plain, adds 7cm', 'Banquette seat.04 – Hand-sprung, Plain, adds 7cm', 13, null, 'seed', 'seed'),
  ('bws_seat_build', 'Boarded Seat - 5cm  1" chip & 1" blue', 'Boarded Seat - 5cm  1" chip & 1" blue', 14, null, 'seed', 'seed'),
  ('bws_seat_build', 'Boarded Seat - 7cm  1" chip 1" blue  1" pink', 'Boarded Seat - 7cm  1" chip 1" blue  1" pink', 15, null, 'seed', 'seed'),
  ('bws_seat_build', 'Boarded Seat - 10cm 1" Chip 1" blue 1" pink & 1" white', 'Boarded Seat - 10cm 1" Chip 1" blue 1" pink & 1" white', 16, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT.01 – Webbed seats, +22cm off seat rail', 'OUTDOOR - SEAT.01 – Webbed seats, +22cm off seat rail', 17, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT.02 – Superlooped seat, +22cm off seat rail', 'OUTDOOR - SEAT.02 – Superlooped seat, +22cm off seat rail', 18, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT.04 – Fully upholstered seat, no cushion, +10cm from seat rail', 'OUTDOOR - SEAT.04 – Fully upholstered seat, no cushion, +10cm from seat rail', 19, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT.05 – Fully upholstered seat, no cushion, +7cm from seat rail', 'OUTDOOR - SEAT.05 – Fully upholstered seat, no cushion, +7cm from seat rail', 20, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT.06 – Fully Upholstered Handsprung seat, +5cm off seat rail', 'OUTDOOR - SEAT.06 – Fully Upholstered Handsprung seat, +5cm off seat rail', 21, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT DC.01 – Webbed +5cm off seat rail', 'OUTDOOR - SEAT DC.01 – Webbed +5cm off seat rail', 22, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT DC.02 - Zig Zag,  +5cm off seat rail', 'OUTDOOR - SEAT DC.02 - Zig Zag,  +5cm off seat rail', 23, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - SEAT DC.03 – Hand Sprung +7cm off seat rail', 'OUTDOOR - SEAT DC.03 – Hand Sprung +7cm off seat rail', 24, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - Banquette seat.02 – Webbed, Plain, adds 7cm', 'OUTDOOR - Banquette seat.02 – Webbed, Plain, adds 7cm', 25, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - Banquette seat.03 – Zig-Zag, Plain, adds 7cm', 'OUTDOOR - Banquette seat.03 – Zig-Zag, Plain, adds 7cm', 26, null, 'seed', 'seed'),
  ('bws_seat_build', 'OUTDOOR - Banquette seat.04 – Hand-sprung, Plain, adds 7cm', 'OUTDOOR - Banquette seat.04 – Hand-sprung, Plain, adds 7cm', 27, null, 'seed', 'seed'),
  ('bws_back_cushion', '2.5"', '2.5"', 1, null, 'seed', 'seed'),
  ('bws_back_cushion', '3.5"', '3.5"', 2, null, 'seed', 'seed'),
  ('bws_back_cushion', '4"', '4"', 3, null, 'seed', 'seed'),
  ('bws_back_cushion', 'OUTDOOR - 2.5"', 'OUTDOOR - 2.5"', 4, null, 'seed', 'seed'),
  ('bws_back_cushion', 'OUTDOOR - 3.5"', 'OUTDOOR - 3.5"', 5, null, 'seed', 'seed'),
  ('bws_back_cushion', 'OUTDOOR - 4"', 'OUTDOOR - 4"', 6, null, 'seed', 'seed'),
  ('bws_stud', 'Standard - French Natural | BWE Code: U1660-6031', 'Standard - French Natural | BWE Code: U1660-6031', 1, 'U1660-6031', 'seed', 'seed'),
  ('bws_stud', 'Standard - Polished Nickel | BWE Code: U1660-1031', 'Standard - Polished Nickel | BWE Code: U1660-1031', 2, 'U1660-1031', 'seed', 'seed'),
  ('bws_stud', 'Standard - Polished Brass | BWE Code: U1660-9031', 'Standard - Polished Brass | BWE Code: U1660-9031', 3, 'U1660-9031', 'seed', 'seed'),
  ('bws_stud', 'Standard - Antique on Brass | BWE Code: U1660-9431 - Shank Oxidized', 'Standard - Antique on Brass | BWE Code: U1660-9431 - Shank Oxidized', 4, 'U1660-9431', 'seed', 'seed'),
  ('bws_stud', 'Standard - Pewter | BWE Code: U1660P131', 'Standard - Pewter | BWE Code: U1660P131', 5, 'U1660P131', 'seed', 'seed'),
  ('bws_stud', 'Standard - Bronze Renaissance | BWE Code: U1660-7031', 'Standard - Bronze Renaissance | BWE Code: U1660-7031', 6, 'U1660-7031', 'seed', 'seed'),
  ('bws_stud', 'Large - French Natural | BWE Code: U0219-6041', 'Large - French Natural | BWE Code: U0219-6041', 7, 'U0219-6041', 'seed', 'seed'),
  ('bws_stud', 'Large - Polished Nickel', 'Large - Polished Nickel', 8, null, 'seed', 'seed'),
  ('bws_stud', 'Large - Polished Brass', 'Large - Polished Brass', 9, null, 'seed', 'seed'),
  ('bws_stud', 'Large - Antique on Brass', 'Large - Antique on Brass', 10, null, 'seed', 'seed'),
  ('bws_stud', 'Large - Pewter', 'Large - Pewter', 11, null, 'seed', 'seed'),
  ('bws_stud', 'Large - Bronze Renaissance', 'Large - Bronze Renaissance', 12, null, 'seed', 'seed'),
  ('bws_stud', 'Standard - French Natural | BWE Code: U1660-6031 - (Aged Brass - And Objects Only)', 'Standard - French Natural | BWE Code: U1660-6031 - (Aged Brass - And Objects Only)', 13, 'U1660-6031', 'seed', 'seed')
on conflict (palette_key, value) do update set
  label      = excluded.label,
  sort_order = excluded.sort_order,
  code       = excluded.code,
  active     = true,
  updated_by = 'seed';

-- ---- what the capture said, asserted -------------------------------------
--
-- Not decoration. This seed is generated from a file, and the failure worth
-- catching is a re-generation that silently drops rows -- a changed divider
-- rule, a parse that swallows a blank line, a palette BWS has since shortened.
-- The counts are the capture's, and they are what a re-sync has to explain.
do $$
declare bad text;
begin
  select string_agg(format('%s has %s (expected %s)', key, actual, wanted), '; ')
    into bad
    from (values ('bws_timber_finish', 35), ('bws_metal_finish', 15),
                 ('bws_seat_build', 27), ('bws_back_cushion', 6),
                 ('bws_stud', 13)) as e(key, wanted)
    join lateral (select count(*)::int actual from spec_palette_options o
                   where o.palette_key = e.key and o.active) c on true
   where c.actual <> e.wanted;
  if bad is not null then
    raise exception '0011 seed: option counts do not match the 2026-09-22 capture: %', bad;
  end if;

  -- Eight stud options carry a BWE code and no other palette carries any. A
  -- code appearing elsewhere means the parse widened; one disappearing means
  -- a label changed shape upstream.
  select string_agg(format('%s: %s coded', palette_key, n), '; ') into bad
    from (select palette_key, count(*) filter (where code is not null)::int n
            from spec_palette_options group by palette_key) s
   where (palette_key = 'bws_stud' and n <> 8) or (palette_key <> 'bws_stud' and n <> 0);
  if bad is not null then
    raise exception '0011 seed: BWE codes are not where the capture put them: %', bad;
  end if;

  -- A divider that reached the table. Nothing else in this seed would catch it
  -- before somebody saw it in a dropdown.
  select string_agg(format('%s: %L', palette_key, value), '; ') into bad
    from spec_palette_options where btrim(value) ~ '^-{3,}$';
  if bad is not null then
    raise exception '0011 seed: a divider line was seeded as an option: %', bad;
  end if;
end $$;
