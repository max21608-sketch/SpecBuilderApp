# The BWS spec grid — blocks, order, and how each field is written

Matthew Lewis circulated a tidied **Spec Grid for BWS** on 2026-09-15: our
109-column export layout, re-ordered, cut to the fields this project needs,
colour-blocked into meaning groups, and carrying worked example rows that show
**how each field is written**.

Those formatting rules are the valuable part, and this document is where they
live. The blocks and ordering drive how the app's own screens group fields.

## The trap, stated first

**The grid describes screens. It does not describe the file.**

A reader who "applies" it to the export — reordering the columns, or cutting it
to the 36 it shows — produces a file that on import **wipes every field it
omits**. A BWS import replaces; it does not merge. That is the same trap as a
filtered export, and it is the most dangerous thing anyone can do to this file.

The export stays at 109 columns in BWS's own order. Read the header of
`src/lib/bws-export.ts` before touching the column list.

### No client data is in this document

Every field name, json id and column letter below is copied from
`src/lib/bws-export.ts` and `db/seed/0001_spec_fields.sql` — files already in
the repo — **not transcribed from Matthew's workbook**. His example rows name
real clients, hotels, suppliers and fabric references. Every illustrative
example here is invented. The repo commits schema, never rows.

### The colour names do not match the colours

Matthew's email calls two different blocks "green" and the pink block "purple".
The table below is resolved from the workbook's own theme, so **use it rather
than re-deriving blocks from the words in the email**.

## The blocks

| Block | Columns | Fields (json id) |
|---|---|---|
| Job level | A–T | `Id`, `job_client_item_reference`, `Job Number`, `Order Number`, `Lifecycle State`, `Client`, `Project Ref`, `Client PO`, `KAM`, `Name`, `Category`, `Parent Category`, `Item Count`, `Product Code`, `Specifications i flag`, `RRHS Stream`, `Repeat Reference id`, `Sales Stream name`, `Cluster Name`, `Cluster URL` |
| Dimensions | U | Dimensions (3) |
| Upholstery | W–AE | Fabric requirement (142), COM 1 (1), COM 2 (2), COM 3 (14), FR Interliner (74), Stud spec (16), Stitching spec (37), Swivel Mechs (232), Mattress setting (36) |
| Cabinetry | AG–AR | Substrate (192), Timber Finish 1 (4), Timber Finish 2 (31), Timber Finish 3 (143), Metal Finish 1 (5), Metal Finish 2 (35), Glass & Mirror Spec (15), Stone (147), Runners (10), Hinges (9), BW Supplied Hardware (75), Drawer liner (190) |
| Setting and site | AT–AZ | Fitted (131), Outdoor (130), Floor type (39), Access (6), Site Info — survey + dry fit (7), Skirting (72), Wall build (73) |
| Upholstery build | BB–BH | Upholstery free text (267), Seat Upholstery Build (11), Back Upholstery Build (12), *[unnamed]*, Arm Upholstery Build (13), Back Cushion Build (25), *[unnamed]* |
| Finishing | BJ–BK | Finishing Sheen (22), COM Hardware (8) |

V, AF, AS, BA and BI are blank spacers.

The job-level block is export metadata, not spec fields — it carries no json
ids, and most of it is a BWS-owned vocabulary the export deliberately leaves
blank. It is not part of the app's field grouping.

**The upholstery-build block has two columns with a colour, a position, no
header and no id.** They were kept deliberately, so they mean something.
Nothing in the app can act on them until they are named — Still open 17.

## Formatting rules

Each rule has a stable id so it can be cited in a review comment or handed to an
extraction prompt. The **Shape** column is the machine-readable half; the
**Cost** column is why it matters.

### Dimensions (json id 3)

| | |
|---|---|
| **Rule id** | `FMT-DIM-01` |
| **Rule** | Write width, depth and height in millimetres, with the unit once at the end. |
| **Shape** | `W<mm> x D<mm> x H<mm>mm` |
| **Example** | `W1900 x D790 x H720mm` *(invented)* |
| **Cost** | A per-figure unit (`W190cm x D79cm`) is not the house format, and a figure with no unit at all is a number nothing downstream questions. |

| | |
|---|---|
| **Rule id** | `FMT-DIM-02` |
| **Rule** | Append seat height as `SH`, last. |
| **Shape** | `W<mm> x D<mm> x H<mm> x SH<mm>mm` |
| **Example** | `W2925 x D1685 x H825 x SH420mm` *(invented)* |
| **Cost** | Seat height drives the shop-floor build. Recorded as a second `H` it overwrites the item's real height. |

| | |
|---|---|
| **Rule id** | `FMT-DIM-03` |
| **Rule** | A round item is written `Dia.` **in place of** width and depth. |
| **Shape** | `Dia.<mm> x H<mm>mm` |
| **Example** | `Dia.460 x H450mm` *(invented)* |
| **Cost** | `Dia.` beside a `W` and a `D` describes an item that does not exist. The app treats the pairing as a conflict rather than picking one. |

| | |
|---|---|
| **Rule id** | `FMT-DIM-04` |
| **Rule** | A dimension the client has not settled keeps its figure and is marked `TBC` in place. |
| **Shape** | `W<mm> TBC`, or `W TBC` when there is no figure at all |
| **Example** | `W1520 TBC x D560 x H1005mm` *(invented)* |
| **Cost** | A blank cell says nobody looked. `TBC` says somebody asked and the client has not decided. Those produce different actions. |

**Only those five slots exist** — W, D, H, SH, Dia. A source document routinely
prints more (seat widths, back depths, arm heights, and unlabelled figures off a
shop drawing). Those are kept as **notes** against the item, with their label,
figure, unit and page, and appear on the export's long-form sheet. They do not
enter this cell. See `src/lib/dimensions.ts`.

### Upholstery (COM 1–3, json ids 1, 2, 14)

| | |
|---|---|
| **Rule id** | `FMT-COM-01` |
| **Rule** | Lead with the client's own fabric code, then the quantity, then the supplier's full reference. |
| **Shape** | `<client code>; <n>m of <supplier> <range> <reference> <colourway>` |
| **Example** | `FB-001; 12m of Example Mills Sample Weave EM-1234 col. 07` *(invented)* |
| **Cost** | The client's code is how the fabric is tracked on their schedule; the supplier reference is what gets ordered. Dropping either makes the line unorderable or untraceable. |

| | |
|---|---|
| **Rule id** | `FMT-COM-02` |
| **Rule** | Note railroading where it applies, in brackets after the reference. |
| **Shape** | `… <colourway> (Railroaded)` |
| **Cost** | Pattern direction changes the metreage and cannot be recovered from the reference alone. |

**KNOWN GAP (observed 2026-09-15).** There are three COM slots and one `Fabric
requirement`. Matthew raised the limit himself: a multi-COM item needs more.
A fourth fabric currently has nowhere to go and the reviewer gets a
duplicate-slot blocker — the correct failure while it is unknown, but a failure.
Still open 19.

### Upholstery build (json ids 11, 12, 13, 25)

| | |
|---|---|
| **Rule id** | `FMT-BUILD-01` |
| **Rule** | Use the workshop's coded picklist entry verbatim, code first, then its description. |
| **Shape** | `<CODE>.<nn> – <description>` |
| **Example** | `SEAT.00 – Example build description` *(invented)* |
| **Cost** | These are shop-floor instructions. A paraphrase is not the same instruction, and nothing downstream can tell that it changed. |

These are post-sale fields. Matthew's note: *"we'll want to build the specs past
point of sale to TG1."*

### Everywhere

| | |
|---|---|
| **Rule id** | `FMT-GEN-01` |
| **Rule** | A BWS-owned vocabulary this app does not know is left **blank**, never guessed. |
| **Cost** | A guessed enum is either rejected on import or accepted as a wrong classification — and the second is silent. |

| | |
|---|---|
| **Rule id** | `FMT-GEN-02` |
| **Rule** | Quote a finish against its approved sample reference where the document gives one. |
| **Shape** | `<finish description> to match BW Sample #<number>` |
| **Example** | `Stained oak, 10% sheen, to match BW Sample #00000` *(invented)* |
| **Cost** | A finish description without its sample number cannot be matched on the bench. |

| | |
|---|---|
| **Rule id** | `FMT-GEN-03` |
| **Rule** | An unsettled value carries `TBC` **once**. Where the document's own wording already says it, nothing is appended, and the wording is never edited to make room. |
| **Shape** | `<value> TBC`, or `<value as written>` when that value already says TBC |
| **Example** | `Brass TBC`; and `TBC - Example Fabric AB01234 - 01` *(invented)* left exactly as printed |
| **Cost** | Appending regardless produced `TBC - … - 01 TBC` and `TBC TBC` on the real pack. That reads as a rendering fault in the one file a human signs off, and a reviewer who finds one in a cell they can check stops trusting the cells they cannot. Stripping the word instead would edit the client's wording; emitting only the marker would lose the candidate the page named. |

## What the grid does not show

Twenty-two of the 56 seeded spec fields are absent from Matthew's grid: Routing,
Ex VAT RRP, the four BOM fields and two BOM Hardware fields, the four Bed
fields, the three Blue Label fields, Timber Cut, Finishing Recipe, Purchasing
Notes, Job Budget, Assy guide required, Dimensions checked, Finishing — Colour
of sample, and Upholstery pictures & Wash-up.

**Read that as "not relevant to this project", never as a deletion list.** The
boilerplate comparison of 2026-09-14 (`docs/plans/boilerplate-grouping.md`)
found most of them are post-sale: BOM, Blue Label, finishing detail and
purchasing. All 56 remain available on every screen — the app's field grouping
puts anything outside Matthew's set into a final block rather than hiding it,
because a field that cannot be selected is a spec value that cannot be recorded.

## KNOWN GAP (observed 2026-09-15)

Five things the grid raises and does not settle. Each is a numbered item under
**Still open** in `docs/plans/README.md`.

1. **`job_client_item_reference`** — a column in Matthew's grid that appears in
   no BWS export we hold. Still open 14.
2. **Column A `Id`** — he says it matters for uploading post-sale; the export is
   deliberately a review file with no `Id` and no `Job Number`. Still open 15.
3. **The two unnamed upholstery-build columns.** Still open 17.
4. **`Timber Finish 1` vs `Main timber finish`** (ids 4 and 5) — same ids, two
   spellings. Still open 18.
5. **Multi-COM past COM 3.** Still open 19.
