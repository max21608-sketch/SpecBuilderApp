# The design language

**Written 2026-09-18, the day the screens were rebuilt to it.** The approved reference is `docs/design/spec-builder-mockups.html` — the
sixteen mock-ups Max signed off that day. Where this document and that file
disagree, the file wins and this document is wrong; where a built screen and
that file disagree, the screen is wrong, and "the mock-up was treated as a
direction" is the fault that cost the first attempt (see `17ff4e0`).

The live version of this page is `/dashboard/design`, which renders the real
primitives with the rule beside each. Read that when you want to see it; read
this when you want to know why.

This is a B2B tool used all day by a handful of people. Nothing here is
decoration. Every rule exists because a screen made a specific job harder —
finding the blocking number, telling a guess from a decision, or getting from a
number to the place you change it. **The measure of a screen is not whether it
looks modern: it is whether the blocking number is the first thing you see,
whether a guess is still obviously a guess, and whether you can get from any
number to the place you change it without going via a menu.**

## The eight rules

### 1. Everything actionable is a link, and there are several routes to each place

A count, an item code, a finish code, a filename, a designer, a date, a phase
name — all of them go somewhere. There is no cost to offering the same
destination three times and a real cost to a figure that makes somebody go and
find the screen it belongs to.

A number that blocks something carries its fix beside it: "312 TGQ" is a link
to the filtered table AND has a *Chase them* button on the same row. The cards
on a project are also tabs — Phases, Finishes, Documents and History are
reachable from the bar and from the page, because which one you reach for
depends on whether you already know where you are going.

### 2. A summary tile is a filter

Pressing a `StatTile` opens the list already narrowed to it. The tile you are
on is outlined, and the filter is repeated as a removable chip in the filter
row — a filter you cannot see is a filter you forget you set.

The rule that travels with it, from the chase screen: **a filter narrows what
is LISTED, never what is asked or what an edit touches.** The counts on a row
stay the row's own, with "n shown" beside them only when the list was actually
narrowed. Printing "n shown" on every row by default teaches people to ignore
the one row where it means something.

### 3. Do not explain in a paragraph what a hover can say

A caption under every field is read once and then becomes furniture that
pushes the content down the page. Where a field carries a rule worth knowing it
gets a `Tip` — a 14px circle, one or two sentences on hover, never more. If it
needs a paragraph it belongs in the docs.

**What stays on the page in words: anything that would otherwise be silently
wrong.** "No programme recorded — nothing can be flagged overdue" stays visible,
because a project with no dates and a project on time render identically
otherwise. The test is whether a reader who never hovers would be MISLED. If
yes, it is not a tip.

### 4. Colour means one thing each

| Tone | Colour | Means | Examples |
|---|---|---|---|
| `danger` | red | **blocks money going out** | TGQ, a refused confirm, an export that would wipe fields |
| `warn` | amber | **needs a person.** Not an error | TBC, no category, no level, a held email |
| `info` | blue | **the app is suggesting.** Always with its reason, one click to accept | a suggested level, a suggested kind |
| `good` | green | **settled** | confirmed, N/A, review complete, a named baseline |
| `guess` | yellow | **a value the app filled in and nobody has confirmed.** A whole row, never a chip | a slot read off three views, a W×D×H read positionally |
| `blocked` | slate, dashed | **nowhere to record it.** The fix is a seed or a migration, not a question for the reader | a matrix field this category cannot ask; a gate whose predecessor is unmet |
| `live` | sky | the ordinary working state | an ACTIVE project; the letter A of a split line |
| `plain` | grey | a count with no judgement | |

Two of these are traps rather than preferences. **Yellow and amber mean
different things and a row can be both**: yellow is "this is a guess, confirm
it", amber beside it is "this cannot commit as it stands", and amber used to
REPLACE the yellow so a guessed row that also had a blocker stopped looking like
a guess. **Slate is deliberately not red**: painting work that cannot start yet
in red teaches people to ignore red, which is the one colour that must never be
ignored.

The vocabulary is `src/components/ui/tone.ts`, as complete literal class
strings — Tailwind's JIT purges anything it cannot read in source, so an
interpolated `bg-${tone}-700` renders unstyled with no error anywhere.
`tests/lib/tone.test.ts` guards it. Green is SETTLED everywhere, which is why
it belongs to COMPLETED and not to ACTIVE: two screens had that the other way
round from each other, under a comment claiming they matched, until the tone
was decided once beside the label (`PROJECT_STATE_TONE`).

### 5. A guess is one click from a decision, and never wears its authority

`SuggestButton`: dashed blue, the evidence REQUIRED beside it ("the code `WD`
says so"; "the bill says 'brass frame'"). Pressing it accepts. Where several can
be accepted together there is one button for all of them, because 59 records
must not mean 59 visits.

**Never a pre-selected dropdown.** A select already reading "Simple" fires no
change event when somebody chooses Simple, so the one action recording their
agreement would do nothing at all. A default is a hint beside the control, and
writes no answer: `missing` means nobody has looked, and a gate passed by a
default is a gate passed by nobody.

### 6. A version is not a change

In any trail an ordinary change is a row. A **baseline** — a point somebody
named and can compare against — is a green bar straight across, so you can see
at a glance which changes fall inside it. **Key dates** sit in the same trail
as violet bars, so the programme reads against the work. A key date is passed
as a `YYYY-MM-DD` string and compared as one; a component taking a `Date` here
is where the TOE-dates trap comes back (`src/lib/project-programme.ts`).

### 7. Layout, type and rhythm

**Three bands on every page**: the identity bar (breadcrumb, name, status pill,
page-level actions right-aligned) · tabs with counts · content, numbers first.

- The **top bar** is dark and full-width, with the brand, the environment chip,
  the two nav items (Inbox carrying a red bubble of unplaced mail) and Log out.
- **The environment chip says which BUILD, and the colour is the fast half of
  that.** `STAGING` and `DEV` are the mock-up's solid yellow, verbatim. `PILOT`
  — Matthew's stable build, added 2026-09-19 — is `TONE.live.bubble`, SKY, the
  ordinary working state, and it is a tone rather than a literal for the
  purge reason every colour in this app is: a class string Tailwind's JIT
  cannot read renders as nothing, and an unstyled chip says nothing at all.
  The reason the colours differ is not decoration: Matthew reports by
  screenshot, staging moves hourly and pilot does not, and two chips reading
  the same word send somebody hunting a defect in code that is not running.
  The tab title carries the same word — `[PILOT]`, `[STAGING]`, `[DEV]` — from
  the SAME function (`currentEnvLabel`), because a tab and a chip naming two
  builds is worse than either alone.
- The **header band** (`PageHeader`) is white, full-bleed, and its row is
  ALWAYS 1100px centred — the mock-up's own `.phead .row` is fixed at 1100 even
  on screens whose content is wider. It holds the ONE `h1` on the page.
- The **body** (`PageBody`) is `std` (1100px) or `wide` (1400px). Dense tables
  go wide: the spec table, the chase, the BOQ review, the drawings review and
  the email review. There is no third width. Before this rule there were five
  (`max-w-3xl` to `7xl`) and the chase screen was full-bleed.

**A list of more than six things is a table.** Stacked bordered cards are for a
single object you are ruling on; a list you are scanning gets aligned columns.
Seventeen inbox cards was four screens of scrolling; seventeen rows is one.

| | |
|---|---|
| Page title | 20px, semibold, one per page, in `PageHeader` |
| Card heading | 11px, bold, uppercase, tracked, muted — `Card` |
| Table header | 11px, semibold, uppercase, muted, on `#fcfcfc` — `Th` |
| Body | 14px (`text-sm`, set once on `body`) |
| Table cell | 13px — `Td` |
| Chip | 11.5px; pill 10.5px uppercase |
| Values and codes | monospace, always: `W1900 x D790mm` · `UPH-07` · `AP364c-021` |
| Spacing | a 4px scale; cards 16px apart |

Sizes are applied INSIDE the primitives and nowhere else. A page that states a
font size is a page that will drift.

### 8. A link goes somewhere; a button does something

Unchanged from `Button.tsx`: four variants and no more — `primary` (one per
group), `secondary`, `danger` (destroys or overrides something a document said
or a person decided), `quiet` (a per-row action in a dense table). `buttonClass`
exists for the anchors that must stay anchors, such as downloads. The suggestion
is NOT a fifth variant: the four grade an action's consequence, and a suggestion
is a different thing whose rule is "it says so" — a variant could be used with
no evidence beside it, a component with a required prop cannot.

## The primitives

All in `src/components/ui/`. Reach for these before writing a class string.

| Component | Use it for | Never for |
|---|---|---|
| `PageHeader` | the identity band: crumbs, the h1, a status `Pill` beside it, subtitle, actions, the `Tabs` | a second h1 lower on the page |
| `PageBody` | the content column, `std` or `wide` | — |
| `Tabs` + `useUrlTab` | a strip anything links INTO lives in the URL (`?tab=`); a strip nested in a review component keeps `useState` | a tab that reads the URL itself |
| `StatTile` | one number and where it takes you; `href: null` renders a box, never a dead link | a number with nowhere to go and no judgement |
| `Card` | a titled box; `flush` when it holds a table | wrapping a single paragraph |
| `Table` / `Th` / `Td` / `Tr` / `GroupRow` | any list over six long | the drawings card's inner tables until Part B reaches them |
| `Chip` | a fact about one cell: a state, a code (`mono`), a routing signal | a row's overall state |
| `Pill` | a row's STATE from a closed set: ACTIVE, COMPLETED, BASELINE | a value |
| `Note` | a conditional banner that appears because of the data | standing explanation |
| `Tip` | one or two sentences on hover | a sentence whose absence would mislead |
| `SuggestButton` | an app guess, its evidence, one click to accept | anything without evidence |
| `Button` / `buttonClass` | every action; `buttonClass` for downloads | colour through `className` |
| `EnvironmentChip` (`components/layout/`) | the environment marker, server-rendered so it fails toward SHOWING; yellow STAGING/DEV, sky PILOT | a client fetch, which fails toward hiding; a colour picked outside `tone.ts` |

## DOM rules a restyle breaks silently

Collected from CLAUDE.md so they are in one place. Each has bitten once.

- **A panel spanning a table row is its own `<tr>`**, never an extra
  `<td colSpan>` beside the data cells: seven cells plus a colSpan of seven is a
  21-slot row and the browser squeezes the acknowledgement control into a
  100px ribbon.
- **`divide-y` goes on the data row, not the tbody**, or a divider draws between
  a value and its own panel.
- **The chase table and the email review wrappers are never `overflow-hidden`**:
  it makes the wrapper the sticky scroll container and the column header offsets
  down over a furniture line nobody would know to look for.
- **`clampText` cuts the string; CSS `line-clamp` does nothing here** because
  `whitespace-pre-line` needs a block box and the `block` utility beside it wins.
  Measured: 320px with the CSS clamp, 100px with `clampText`.
- **`softenShout` is display only** and every screen that softens offers
  *As printed*.
- **`onCropped` lives in a ref** and crops are serialised; a re-render caused by
  a restyle must not restart a rasterisation (33 for 12 panels, once).
- **A hidden browser tab renders no pdfjs canvas.** Verify the drawings review
  in a visible pane or you will hunt a deadlock that is not there.
- **`RecordDetails` saves as one act**, not on blur.
- **The record's picture is a grid track, never a float.**

## Deviations from the mock-up, and why

- **"Needed to quote" reads TGQ.** The mock-ups were drawn before TGQ was
  settled as the one name (2026-09-18, `46d4142`). "Also outstanding" stays.
- **"Waiting on a reply" is the one name**; the mock-ups also say "Awaiting a
  reply" and the app said both.
- **Two widths, not five.** 1200/1250/1300 in the mock-ups collapse to 1400.
- **The spec table's header action is the three outputs**, not one "Export this
  run": Spec upload, Quote lines and Costing block shipped with tests the same
  day and a format is not an output.
- **Configuration letters keep the code's palette** (A sky, B emerald, C
  violet …). The mock-up paints B violet but says in words "coloured the way
  the review card colours it", and the card's test pins its palette.
- **No "Columns" chooser** on the spec table. One button in the mock-up, no
  behaviour; a real feature, still open.
- **No per-spec tick boxes on the email review.** The confirm route takes ONE
  record and all of its pending proposals and refuses a subset, and a row's
  phases are shared with other rows — a per-row tick cannot become a
  per-record one. The footer says what Confirm WILL write and a red chip names what
  blocks it.
- **No "Bring them in" on the finishes library.** `createFinish` writes the
  library row and links nothing, so the button would appear to work. The note
  names today's route (`db:backfill-finishes`) in words.
- **No "Preview the email" on the chase screen** — there is no preview route,
  and a button with no behaviour is the Columns chooser again.
- **The BOQ review keeps its Category column**: it is the only place a
  category is set at intake.
- **The captured-specs table has no "read as upholstery" chip.**
  `groupSuggested` is a staged-document flag; a confirmed attribute has no
  column for it.
- **The checklist's State is a select, not a static pill** — a pill would
  remove the only way to record TBC or N/A.
- **The environment banner is gone**, at Max's decision, and the house rule in
  `house/conventions.md` §2 was changed to match rather than departed from.

## Still open

- The "Columns" chooser, the email-review ticks, "Bring them in" and the chase
  preview, above.
- `spec_description` and `internal_notes` are not in `record-atoms.ts`, so a
  hand edit of either produces a version whose diff is empty (found building
  the Versions tab; schema-shaped, not fixed).
- Seven db-tier tests fail on the sandbox for reasons unrelated to this work —
  `chase-drafts` ×3 and `project-overview` ×1 hold tier/level expectations the
  TGQ-matrix change of 18 Sept invalidated; `intake-routes` ×3 include a
  blocker message another session reworded. Confirmed failing at `b3a5f95`,
  before any of this landed.
- A configuration's quantity has no field; the screens say "qty not set".
- The fabric-ordering app still carries the banner this app dropped.
- Nobody has accepted any rebuilt screen against the mock-up yet. Acceptance
  is Max putting the two side by side, per screen.
