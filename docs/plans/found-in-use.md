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
