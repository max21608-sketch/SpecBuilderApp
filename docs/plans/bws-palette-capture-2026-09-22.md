# The BWS palette capture, 2026-09-22

The scrape item 0.1 was blocking. Max logged into BWS and asked for it; this is
what came back.

**SEEDED the same day.** `db/migrations/0035_palette_option_code.sql` and
`db/seed/0011_bws_palette_options.sql` put the five into
`spec_palette_options` — 96 options — and set `synced_at` to 2026-09-22. This
file stays as the capture's own record: the raw artefact beside it is what a
re-sync diffs against, and the two findings for Matthew at the foot are now
also in `docs/plans/matrix-assumptions.md`.

- **Source:** `bws.whistlercloud.com/standard_specification_fields` and, per
  field, `/standard_specification_fields/<id>/edit`, the **Palette options**
  box. Read-only GETs against Max's own session; nothing was edited, submitted
  or removed.
- **Captured:** all **84** fields on the index, **59** of them `palette`,
  **413** option lines in total.
- **Raw artefact:** `bws-palette-capture-2026-09-22.json` beside this file, one
  object per field carrying `name`, `category`, `ordering`, `visibility`,
  `searchable_in_bws`, `export_to_public_website`, `name_for_public_website`,
  `field_type` and `palette_options_raw` verbatim. The seed is built from that
  file, and a re-scrape diffs against it.
- **The Values page was NOT read**, per the rule. `/values` is what people have
  typed; the palette is the `palette_options` box on `/edit`. Both exist in the
  UI one click apart, which is how somebody already drew the wrong conclusion.

## The five are all there

Matthew's matrix rows map onto eight BWS fields, every one of them populated.
Nothing came back empty.

| Our palette key | Matrix rows | BWS field(s) | Options |
|---|---|---|---|
| `bws_timber_finish` | 18, 19, 20 | 4 Timber Finish 1 · 31 Timber Finish 2 · 143 Timber Finish 3 | **35** |
| `bws_metal_finish` | 21, 22 | 5 Metal Finish 1 · 35 Metal Finish 2 | **15** |
| `bws_seat_build` | 23 | 11 Seat Upholstery Build | **27** (+1 divider) |
| `bws_back_cushion` | 24 | 25 Back Cushion Build | **6** (+1 divider) |
| `bws_stud` | 26 | 16 Stud spec | **13**, 8 carrying a BWE code |

The three timber lists are **byte-identical to each other**, and so are the two
metal lists — so one palette row serving all three (and all two) is correct, as
`db/seed/0008` already assumes. That is confirmed, not guessed.

## Variances the seed has to handle

Each of these is in the captured data, not hypothetical.

- **A divider line is not an option.** Five palettes (11, 12, 13, 18, 25) use a
  bare `--------` / `-----------` / `--------------------` rule to separate the
  indoor block from the `OUTDOOR - ` block. Lengths differ, so match
  `^-{3,}$` on the trimmed line and drop it. Seeding it produces a selectable
  option named "------".
- **The BWE code is inside the string, after a pipe.** Stud spec only:
  `Standard - French Natural | BWE Code: U1660-6031`. Per the plan, parse the
  code into its own column and **keep the whole string as the label** — five of
  the thirteen carry no code (`Large - Polished Nickel`), and two carry a code
  *and* a trailing qualifier (`... U1660-9431 - Shank Oxidized`, and
  `... U1660-6031 - (Aged Brass - And Objects Only)`, which holds a further
  ` - ` inside its own bracket), so splitting on ` - ` would destroy them.
- **One palette starts with a blank line** — 141 Image cleaning. Drop empty
  lines; do not seed an option with an empty value.
- **Three `free_text_only` fields still carry palette text** — 1 COM 1 and
  14 COM 3 both hold `COM / BW Supplied COM`, and 152 BL Original Repeater
  holds `Yes`. COM 2 holds nothing, so it is leftover rather than meaningful.
  **Seed on `field_type`, never on the box being non-empty**, or COM 1 becomes
  a two-option dropdown in our app and BWS free-texts it.
- **No duplicate values within any palette**, so `(palette_key, value)` is safe
  as the key. Checked across all 59.
- **`–` is an en dash and `”` is a curly quote** in the upholstery build lists
  (`SEAT.01 – Webbed seats…`, `3.5” cushion border`). `normalisePaletteValue`
  folds case, whitespace and the degree sign and deliberately does **not** fold
  a dash — so these must be stored exactly as captured, or an exact match never
  fires. Seat Cushion build also uses a literal `"` for inches (`4"`).

## What else the capture is worth — findings, not tasks

### 1. Our 56-field register is intact, and 28 more exist

Every one of our 56 seeded `json_id`s is still on BWS, and **not one name has
drifted** — checked against both `name` and `name_for_public_website`. The
`bws-export.ts` constant needs no change.

BWS carries 28 fields we do not hold. **19 are `attribute_only`** — BWS's own
product-attribute taxonomy for the public website (Arm style, Back style,
Cabinetry shape, Ready to Order…), not spec sign-off fields, which is the
honest reason our grid stops at 56. The other nine do show on specifications or
sign-off and we have no column for them:

| id | Name | Visibility |
|---|---|---|
| 18 | Seat Cushion build | show_on_specifications_only |
| 19 | Bed Rail Upholstery | show_on_specifications_only |
| 20 | Bed Headboard Upholstery | show_on_specifications_only |
| 113 | BOM 4 | show_on_sign_off |
| 132 | Mechanics | show_on_specifications_only |
| 133 | Show materials | show_on_specifications_only |
| 134 | Drawers | show_on_specifications_only |
| 193 | Timber Grain | show_on_specifications_only |
| 194 | Sample Dimensions | show_on_specifications_only |

### 2. A possible mismapping on seat cushion — for Matthew

Matthew's row 23 is labelled **"Seat cushion type"** and `db/seed/0006` points
it at **field 11, Seat Upholstery Build** — whose options are build
specifications (`SEAT.01 – Webbed seats, +22cm off seat rail`). Row 24, **"Back
cushion type"**, points at field 25 **Back Cushion Build** — whose options are
cushion depths (`2.5"`, `3.5"`, `4"`).

BWS has a separate **field 18, "Seat Cushion build"**, whose options are
`4" / 4.5" / 5" / 6"` — the exact parallel of field 25, and we do not hold it.

So the two rows are not symmetrical: back cushion lands on a cushion field and
seat cushion lands on a build field. Either row 23's label is loose and 11 is
right, or it should point at 18. **This repo cannot tell, and must not guess.**
One question for Matthew.

### 3. Six palettes we called "ours" have a real BWS list behind them

`db/seed/0008` seeds these as `owner = 'app'` from Matthew's matrix wording.
Every one of them is a `palette` field in BWS with its own options, and the
wording differs — in one case completely.

| Our key | Our options | BWS field | BWS's own options |
|---|---|---|---|
| `stitching` | Plain stitch · **Channelling** · **Fluting** | 37 Stitching spec | Plain Stitch · **Top Stitch** · **Saddle Stitch** |
| `environment` | Indoor · Outdoor · Humid indoor | 130 Outdoor | No · Yes; FULL OUTDOOR · No but HUMID INDOOR |
| `site_access` | 4 of Matthew's own | 6 Access - Select option | OK · Needs checking [TBC] · Has been checked - See info for design [TBC] · Has been checked - Confirmed OK · Design confirms allowances made for access |
| `assembly_guide` | No (default) · Yes | 191 Assy guide required | **TBC** · No · Yes |
| `swivel` | None · 360 non-return · 180 return | 232 Swivel Mechs | 360 º Non-Return · 180º Self-Return w/ wood block |
| `fr_interliner` | Required · Not required | 74 FR Interliner | four options splitting Residential/Commercial, naming the label colour and BS7176 |

**`stitching` is the sharp one**: our Channelling and Fluting do not exist in
BWS at all, and BWS's Top Stitch and Saddle Stitch do not exist in ours. A
value chosen in our app would not be a value BWS accepts — the exact failure
`external-vocabulary-sync` is written to prevent, sitting in a palette this
repo believed it owned.

`assembly_guide` is the second: BWS offers **TBC** and we do not, so the app
has nowhere to record the one state `CLAUDE.md` insists is real and distinct.

**None of this is a decision to take here.** Whether these six become
`owner = 'bws'` and re-seed from the capture, or stay as Matthew's deliberate
simplification of BWS's wording, is his call — he wrote the matrix, and
`docs/plans/matrix-assumptions.md` is where the answer belongs.

### 4. Substrate's palette is now known

`Substrate` (192) was named in the catchup as a concept nothing models, with
Max answering provisionally that it is per-item and satisfies TGQ. Its BWS
palette is 16 options: Beech, Oak, Ash, Australian, Walnut, Mahogany, Iroko,
Kambala, Sapele, Ebony Macassar, Chestnut, Eucalyptus, Maple, Teak, Rosewood,
MDF. It is `show_on_specifications_only` and not searchable.

## What the seed did

- `spec_palette_options` gains 96 rows across the five, in BWS's own order.
- `spec_palette_options.code` (0035) carries the eight stud BWE codes; the
  label keeps the whole string.
- `synced_at` is set in the same file as the options, so the claim cannot
  outrun the evidence.
- `db/seed/0008`'s guard flipped from "a BWS palette must have NO options" to
  "options on a BWS palette need a `synced_at` behind them" — the durable half
  of the same rule.
- The db-tier test that asserted the five were empty now asserts the capture's
  exact counts, that no divider was seeded, and that only stud carries codes.

## Still outstanding

- **The two questions are with Matthew**, written up in
  `docs/plans/matrix-assumptions.md` — seat cushion (row 23 → field 11 or 18?)
  and the six app-owned palettes.
- **Nobody has used the dropdowns.** The seed, the counts and the render logic
  are covered by the four checks with the database tier running; a person
  choosing a BWS timber finish on a real record is not done.
- A removed option that an answer already holds must be **kept and flagged**,
  never deleted, on the next sync. Nothing holds one today, so the first sync
  could not hit it; the second can, and no code enforces it yet — the sync is
  a person re-scraping and diffing, not a job.
- Two option strings name outside parties: five Metal Finish options read
  `And Objects - … as per sample #64278`, and Client Code (136) offers
  `Argent` / `KPL`. They are BWS's own vocabulary, same as the 56 field names
  and the 45 boilerplates already committed, so the precedent covers them —
  flagged here rather than decided silently.
