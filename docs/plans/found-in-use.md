# Found in use

A running record of things that need fixing, written down as they are found so
they stop being fixed one at a time out of order.

**This file plans nothing.** Each entry says what was seen, where, and what is
actually wrong — enough that somebody can later group these into a plan without
re-diagnosing them. No entry is a design, and no entry is a promise about how it
gets fixed. Nothing here is fixed unless its own line says so.

Asked for on 2026-09-18: "I just end up fixing this little thing, this little
thing, this little thing, and I have so many agents going and so many people
working on the project."

**How to add one.** Newest section at the top, one `###` per finding, dated by
when it was SEEN. Say what was on the screen, not what you think the cause is —
and where you do name a cause, say so separately, because a wrong diagnosis
written as fact is what sends the fix to the wrong file. Never delete an entry;
mark it FIXED with the date and the commit.

---

## 2026-09-18

### Seen in the catchup demo of 2026-09-18 — fifteen things, all small

**Status: all open.** Found by driving the Panther pack live in front of
Matthew, Sebastian, Steve and Tony. The full record of that call — what was
said, by whom, with timestamps — is `docs/plans/catchup-2026-09-18.md`; this
entry exists so the defects are in the place defects live, and nothing here
plans a fix.

Grouped because each is a line or two, not because they are one problem.

1. **The header-row message names the wrong row.** The BOQ review said *"row 6
   was skipped, header found on row 6"*. Matthew opened the workbook: products
   start at row 7. The message is about the header and reads as an error about
   the data. (12:39)
2. **Packaging and delivery came through as records.** `PACK` and `DEL` lines
   became furniture. Matthew confirmed outright they should not be there. Max:
   *"probably a good test — how easy is it to ignore?"* Today it is a per-row
   action with nothing suggesting it. (19:47)
3. **The phase overview's tiles say nothing anybody acted on.** Max, unprompted:
   *"just an overview of where it is, a few just little boxes. We can change
   those to have something useful or meaningful in them."* Matthew read one
   aloud — *"the 22 product categories"* — and immediately re-described the run
   as *"sofas and armchairs, basically"*. Nobody said the number was wrong; a
   tile that needs that much explaining is one nobody is reading. (19:15)
4. **A pack document is ticked because it was OPENED, not checked.** Matthew:
   *"so it's ticked because you've opened it."* Max: *"because I've reviewed it
   now."* He let it go, but the pack's progress is therefore a record of what
   somebody looked at. On a thirty-document pack that distinction matters.
   (23:29)
5. **The per-document banner stack does not scale.** White and yellow notices,
   one per document on the pack screen. Max, unprompted: *"if you were doing a
   larger order it would just stack up and you'd have like 300."* Matthew
   checked they carried nothing needing review. (24:02)
6. **The item picture crop failed on a real page.** *"The picture extract hasn't
   worked very well this time. It's meant to just take a crop of the image, but
   it hasn't."* Max drew the box by hand. The card offering the whole page and
   *Drag a box* is what saved it, so the recovery path works — the extraction
   did not. (28:02)
7. **`TBC – <fabric>` puts the marker inside the value.** The sheet prints a
   fabric *and* the word TBC; both landed in the value. Matthew: *"it shouldn't
   really be in the name."* (31:01)
8. **The swatch picker cannot reach the page the finishes are on.** *"It was on
   the second page, and I've only got one page, so… I need to work on that."*
   Matthew confirmed two-page items are normal for this pack: *"you've got the
   shop drawing and then with the finishes."* (31:59)
9. **The internal BWS field ordinal leaks to the screen.** `1 · COM 1` beside a
   fabric, `3 ·` beside dimensions. Matthew spent about ninety seconds working
   out whether the number was a BWS reference — including a wrong guess,
   *"it's the reference for the JSON file"* — before Max said *"that's just an
   internal app thing… I'll get it to hide it."* (36:43)
10. **Project-level questions are asked inside every item's checklist.** TOE
    agreement, sales folder and similar appear on each furniture line. Matthew:
    *"you do that once for the project presumably?"* (40:22)
11. **There is no visible route from a confirmed intake to reviewing each line.**
    Matthew asked *"how do you get to this page? At what point in the workflow do
    you come to this?"* and, when told email intake would handle it, correctly
    pushed back: the intake may have missed a dimension, so there has to be a
    pass where you confirm, deny and adjust — and know what is outstanding while
    you do it. Max: *"sorry, I misunderstood that."* **The app can do all of
    this.** He could not find the way in. (41:42–45:06)
12. **The phase table shows a button where it should show what is missing.**
    *"On this page, you can't see what's missing? There's a button to go and see
    them, but you can't see it on this page."* Confirmed by Max. (50:44)
13. **Two counts differ by one on the same screen, unexplained.** The gate panel
    read *"5 to answer"*; the button top right read *"Chase the 4"*. Sebastian
    asked outright: *"top right-hand corner is 4. Is that something different?"*
    It took Max a moment to work out why — Spec notes is a manual entry and is
    not chased. The reason is right; the screen says none of it. (49:38–50:18)
14. **A confirmed record's update path could not be found, and Matthew went
    looking for it.** *"I remember seeing a page… where it kind of had confirm,
    or you could update it. You could confirm that what was captured is correct,
    or you could update it."* Max: *"I think it's kind of been locked down at
    this point."* Immutability of an applied proposal is deliberate; the route
    to changing a value on purpose is what is missing. Same failure as 11, one
    step later. (51:08–51:58)
15. **The chase draft preselects everything instead of the TGQ set.** Max named
    it in the room: *"it hasn't automatically selected… it's still selecting all
    of them, when in fact it should have just selected [the four]."* Red dot =
    needed to quote, grey = also outstanding; the reading is right and the
    default selection is not. (1:21:29)

One thing that looked like a defect and is not: **"These pages do not agree"**
fired because two pages state the same dimension in different units. Sebastian
asked whether it could divide by ten; Max explained the drawings state no unit
anywhere, so the app reasons about the range and flags every row it touched.
Matthew accepted it. That is the unit-resolution rule working, in front of a
user, and it should be left alone. (26:23)

And one that is a gap rather than a fault: **Product code has nowhere to be
recorded**, said out loud by Max to the person who wrote the requirement —
*"I haven't included this in the app yet, so there's nowhere to record that."*
It is already its own entry below. What changed is that Matthew has now seen
it. (48:59)

### A level cannot be set or changed at the drawings stage

**Status: open. A CHANGE ASKED FOR, and its first half is still to be
confirmed by Max** — "I'm going to check up on this, but I'm pretty sure".

Seen on the BOQ review screen (screenshot), `MAIN RUN`, 14 lines. Every row
reads **Simple · guessed**, including `PACK · Packaging` and `DEL · Delivery`,
which are not furniture at all. The descriptions the guess had to work with are
`Sofa`, `Armchair`, `Desk chair`, `Headboard` — one or two words each.

Two separate things were said, and they are not the same size:

1. **Probably the level can only really be determined at the drawing stage.**
   Max's own reading, offered as something he will go and check. If it holds,
   it questions whether guessing at BOQ intake is worth doing at all.
2. **At minimum, there must be a way to switch it AT the drawings intake
   stage.** Asked for outright, and not conditional on (1).

**(2) is a plain gap today.** `confirm-drawings.ts:689` revises the level after
a drawings confirm — but only `level_suggested`, only where `level is null`,
and `guessLevelFromAttributes` never returns `simple`, because "this page named
no metal" is not evidence the item has none. So a drawing can strengthen a
suggestion and can never be used by a person to SET one: the drawings review
screen carries no level control at all. The only places a level can be set are
the record screen, the drafts blocker's inline picker, and the BOQ review's own
Level column.

That means today a level decided at the moment it is actually knowable — the
reviewer has the page open and can see the brass leg — has to be recorded
somewhere else, one record at a time.

Three things a plan has to carry, all already written down elsewhere:

- **The level guess rules are this repo's judgement and Matthew has not seen
  them.** Nothing in the 17 cheat sheets defines simple / complex / hero;
  `src/lib/level-guess.ts` encodes the BWS boilerplate split. (1) is the same
  conversation and the same person — put it in front of him together.
- **Nothing infers a level onto `spec_records.level`, ever.** 0025 keeps the
  guess in `level_suggested` where no gate can read it. Whatever goes on the
  drawings screen writes `level` only on a person's action, and the run-wide
  `acceptSuggestedLevels` is the precedent for doing that in one change set
  rather than 59 visits.
- **A pre-filled select cannot be the accept control.** The screenshot shows
  every row's select already reading `Simple`, so choosing Simple fires no
  change event and the one action recording the reviewer's agreement does
  nothing. Whatever is built for drawings must not repeat it.

### A confidently routed email still waits for somebody to press Assign

**Status: open. This one is a CHANGE ASKED FOR, not a fault** — the app is
behaving as designed and the design is what is being changed. Read the whole
entry before planning it: it moves one of the hard approval gates.

Seen on the Inbox screen (screenshot), `Not on a project (17)`. Asked for at
the same time, and stated as project-wide: **whenever a document is uploaded it
should be read and assigned automatically, and only genuine doubt should be
flagged for a person.**

What the screen shows is that routing had already decided, and nothing acted on
it. `Ashcombe House — OT-401 bed end ottoman, fabric` reads *addressed to the
project inbox — addressed to ashcombe.specs@example.com*, which is
`recipient_is_inbox`, the second-strongest signal there is. It sits in the
unassigned list with a dropdown offering *Assign and read (one charged call)*.
Several others read *the sender is a contact on one project*. Two of the
seventeen — `FW: client comments - armchairs`, `Statement of account — August` —
correctly say nothing names a project.

**Most of the asked-for rule is already true, and the exception is email.**
Specification documents uploaded through intake have been read automatically
since 2026-09-15: registration opens an attempt per document, and the human
decision moved to the upload screen, which states the document count and the
charge before anything uploads. So "uploaded means read" is the existing
behaviour everywhere except the inbox.

**What stands in the way is a stated gate, not a missing feature.** `CLAUDE.md`
lists under *Hard approval gates*: *"Placing an INBOUND email on a project. It
is what starts the charged read, and nothing is ever auto-assigned from an
ambiguous routing outcome."* Changing it is Max's call and he has now asked for
it — but it is a deliberate amendment to that list, in the same commit as the
code, not something to slip in as a bug fix.

**The flag path the request asks for already exists.** `email-routing.ts`
returns three outcomes, not two: `assigned` (one project, with the signal and
the evidence that decided it), `ambiguous` (two projects match equally well)
and `unassigned` (nothing names a project). The asked-for rule maps onto them
exactly — act on `assigned`, hold the other two — so nothing about routing has
to become cleverer, and `assignMessage` staying the ONLY thing that puts a
message on a project should survive the change rather than be worked around.

Four things a plan has to settle rather than assume:

- **Assignment is the spend point.** Auto-assigning means auto-charging. The
  precedent from 2026-09-15 is that consent moved UP to where the volume is
  visible and was stated in numbers; the inbox equivalent of that statement
  does not exist yet.
- **Nothing limits how many model calls start at once** — already recorded as
  an M8 outstanding note for packs. A morning's mail arriving at once is the
  same problem with no upload step to stagger it.
- **A wrong auto-assignment costs twice** — the call, and a staged run on the
  wrong project. `unassignMessage` exists and the mailbox copy is kept as the
  arrival record, so it is reversible; whether the reviewer can tell it happened
  is the open half.
- **How confident is confident.** Whether `sender_is_contact` — the weakest
  signal, and the one behind most of the seventeen — is strong enough to spend
  money on its own is the actual judgement in this change.

### The item picture does not line up with the card beside it

**Status: FIXED, 2026-09-18**, by the record screen's rebuild against
`#record-screen`. The picture is no longer a track
beside `RecordDetails`; it HEADS its own sticky column on the Specs tab, and
the left column now starts with a `Card`. Both columns therefore begin with a
box at the same top edge, which is what `items-start` needed and did not have.
The 3D view sitting off-centre in its own crop is untouched, as the entry says
it should be.

Seen on the record screen (screenshot),
`DEMO-TEST-01-006 · Armchair, lounge @ suite living area`.

The picture panel's top edge sits **higher than everything in the left column**
— above the details card AND above the `THIS ITEM` heading itself — so the two
columns of the grid visibly do not start on the same line. The `Edit` button,
which is on the card, ends up level with the middle of the picture rather than
with anything in the picture's own box.

**This is not the float bug coming back**, and whoever picks it up should not
start by re-doing that fix. The picture was `float-right` and landed clipped
across the top of the details card; it was made a real sticky grid column
earlier the SAME DAY (2026-09-18, the long comment above the grid in
`src/app/dashboard/records/[id]/page.tsx:606`). The grid already carries
`items-start`. What is left is that the left column's own top — the `THIS ITEM`
label inside `RecordDetails` — is not where the right column's box top is, so
`items-start` aligns two things that do not begin at the same place.

**It is the COLUMN, confirmed by Max on the day.** Asked whether he meant the
column or the crop, the answer was the column. The 3D view also sits off-centre
in its box with a sliver of the neighbouring view down the left edge — that is
a confirmed crop being what it is, it is NOT what was reported here, and
changing it is not part of this.

### A gate's count folds "nowhere to record it" into "outstanding"

**Status: FIXED, 2026-09-18**, by the record screen's Gates tab rebuilt against
`#record-gates`. A gate in play now shows up to TWO chips — `n to answer` in
red and `n nowhere to record` in dashed slate — and they are never added
together. The board's Chase button counts only the first, because chasing
somebody about a field this app has nowhere to store is asking them to fix our
migration. `src/lib/gates.ts` was not touched: `unanswerable` still counts
against the gate, which was never the fault. Checked against the record the
entry names — it reads `1 to answer` and `1 nowhere to record`, and the list
under it is Spec notes and Product code.

Seen on a record screen (screenshot), Armchair, lounge @ suite
living area — `Uph · Armchairs Benches Stools Sofas`, level Simple.

The pill reads **`TGQ 2 outstanding`**. Reading the list underneath it, exactly
one row is work anybody can do:

| Row | Badge |
|---|---|
| Product code | Nowhere to record it |
| Spec notes | Outstanding |
| Swivel mechanism | N/A |
| the other nine TGQ rows | Settled |

So the 2 is **Spec notes + Product code**, and a reviewer looking for two
questions to answer finds one.

**N/A is NOT the cause**, and this is worth stating because it was the first
suspicion. `outstanding()` in `src/components/records/GatePanel.tsx` is
`counts.blocking + counts.unknown + counts.unanswerable` — `not_applicable` is
already excluded, and Swivel mechanism is correctly contributing nothing.

What is happening is that `unanswerable` — *the app has nowhere to record this,
the fix is a seed or a migration and no reviewer can help* — is counted in the
same number as `blocking`, under the same word. The panel ALREADY breaks that
split out in words, but **only for a predecessor gate**: the "TG0 · TGQ first"
line renders "n to answer" beside "n nowhere to record" (`GatePanel.tsx`, the
comment at the `c.unanswerable > 0` branch). The gate whose turn it actually is
gets the folded number.

`src/lib/gates.ts` is not wrong here and should not be the first place anybody
looks: `unanswerable` counting against a gate is deliberate and documented —
folding it into `satisfied` would pass a gate over fields nobody can record.
The question is what the COUNT ON THE PILL says, not whether the gate is met.

Related and not the same thing: `Product code` is `unanswerable` on all 179
sandbox records that have a matrix view, so this reads on nearly every record,
not just this one.

### There is nowhere to record Product code

**Status: open.** The same screenshot, first row of TGQ: *"On Matthew's matrix
with no BWS field and no home in this app yet."*

One of the ten id-less rows in Matthew's matrix of 2026-09-17. Because the gates
chain, a TGQ nobody can satisfy means **no record in the sandbox can reach TG0
or TG1** — measured 2026-09-18, all 179 records with a matrix view. Every gate
tick in the sandbox is gone, correctly.

Asked for directly on 2026-09-18: **build the Product code field in the app.**

**2026-09-19, and this is now the live disagreement.** Max, answering for
Matthew: *"I'm pretty sure that is the code on the client's spec document, on
the BOQ document that they give."* **The seed says otherwise, in Matthew's own
words** — `db/seed/0006_spec_field_gates.sql` row 1 is `capture = 'auto'` with
his note *"Boilerplate derived automatically: if MF1 or MF2 is populated ->
with-Metalwork variant; otherwise Simple"*. If Max's reading is taken, every
record satisfies the row from `spec_record_refs.boq_code` while the BWS product
code stays underivable — a gate reporting satisfied on a different fact from
the one it names. **Do not build either reading until Matthew has been shown his
own note.**

Two things a later plan has to settle rather than assume, both already written
down elsewhere:

- Matthew's own matrix says the product code is *"derived automatically: if MF1
  or MF2 is populated"* — the with-Metalwork / Simple pair — which is why
  `spec_field_gates` carries no palette key for it. Whether it is a field
  somebody answers, or a derivation off `bws_boilerplates` (0031) that the gate
  reads, is the actual decision.
- `src/lib/quote-lines.ts` already derives a boilerplate and **deliberately
  derives nothing when the code is ambiguous** — our
  `armchairs-benches-stools-sofas` is one sheet receiving three of Matthew's
  nine codes. Whatever records a product code has to behave the same way there.

Do NOT close this by weakening the gate chain to get the ticks back.
