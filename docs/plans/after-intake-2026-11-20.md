# After intake: filling in, chasing, and changing what is known — suggestions (2026-11-20)

Max, 2026-11-20, during the production-readiness pass: *"We're not just
looking for issues with the code … missing features, things that aren't quite
working … the intake screen is just really hard to use, clunky … make
suggestions."* And then: *"I am open to making changes in terms of how stuff
that's getting filled in once it's already in the system, how information gets
changed … the kind of filling ourselves and chase and all of that just needs a
little work, a little refining, a little more thought."*

This is that thought. It is a set of **suggestions, not decisions**. Nothing
here is built, except the four small fixes listed at the end of §10. One
suggestion, 3a (one place to fill in), is the item-review screen Matthew and
Claudia are designing (CLAUDE.md: "do not build it ahead of their design"). It
is offered as input to their design, not as a proposal to build. Several
others need Matthew's answer about what a question means, and those are
marked with his name.

**How it was looked at.** The production build of `prod-ready` on the local
stack, at 1440×900, on the worked rehearsal project `T20120` (an invented
29-line pack, every document confirmed, a designer set on one phase, a chase
drafted). A second reviewer who had never seen the app walked a new project
cold, with only the users' help file (section 9). Screenshots are in
`~/dev/localstack/shots/ux-max/` and `~/dev/localstack/shots/ux-fresh/`. The
test material is invented, so the screenshots can go to anybody.

---

## 1. The short version

Intake is now the strongest part of the app. Everything after it is
**correct but not yet shaped around the people doing the work**. It was
built to make sure nothing is missed, and it does that. It does not yet help
anybody decide what to do about what is missing. Five things would change
how it feels most:

1. **Ask fewer, better questions.** A 29-line tender opens with 1,194
   outstanding questions, 283 of them "blocking the quote". The first chase
   it drafts asks a designer 54 questions, including stitching and COM fabric
   on a side table and a swivel mechanism on a three-seat sofa. Until the
   number is believable, people will stop reading it. (§2)
2. **One place to fill in.** The same fact can be entered in six places,
   under three names: a spec, an answer, a BWS field. Make the fill-in screen
   the place where work is done. The record page becomes the place to see
   evidence and history. (§3)
3. **Give the CAM hand-off a shape.** The workflow is PM, then CAM, then
   client. The app has no CAM in it: no owner, no "questions for the CAM",
   nothing to hand over. (§4)
4. **Make the chase a two-way sheet, not a one-way email.** Attach a
   spreadsheet the designer fills in. Reading it back costs nothing, needs no
   model, and lands every answer on the right line by its ID. (§5)
5. **Make changing things feel light, and make "what changed since we quoted"
   one click.** The trail is excellent. Getting into it is heavy, and nothing
   collects the changes that matter commercially. (§6)

A sixth came from the second walk: **let what the documents say count.**
- A drawing's "SWIVEL: No" does not answer the swivel question.
- "Railroaded" on a fabric the bill already named is not kept.
- A finishes schedule's "colour" against the bill's "col." is flagged as a
  different finish. (§9)

The ranked order to do them in is §10.

Sizes are rough: **tweak** (hours), **a day**, **days** (a few), **a
project** (a week or more, and a design conversation first).

---

## 2. Fewer, better questions

**What happens today** (T20120, 29 lines; `05-t20120-overview.jpg`,
`06-t20120-infill.jpg`, `20-chase.jpg`):

- **The numbers are large.** The overview says 283 TGQ questions on the
  items, 18 project-wide and 771 more "also outstanding". The projects list
  heads the page with **5,694**. A sofa's record says "Checklist 48 open"
  beside "3 TGQ".
- **Categories without a model ask everything.** Nine of the 26 categorised
  items are in a category with no gate model yet. For those, every unanswered
  field counts as blocking the quote, so a side table carries 30 TGQ and a
  writing desk 31. The first draft chase asks the designer, for one side
  table:
  - Substrate, Runners, Door Hinges;
  - COM 1, COM 2 and COM 3, Stitching spec, Stud spec;
  - Interliner, Drawer liner, Wall build and more.
- **Category groups ask across their members.** "Armchairs Benches Stools
  Sofas" asks a three-seat sofa about a swivel mechanism.
- **Project facts are asked item by item.** "Indoor / Outdoor / Humid
  environment" goes out once per item, eight times in the first chase.
- **Some questions ask about things we already have.** They are shown as
  "MTL-01; Brushed brass, lacquered" in the "asked as" column. That is
  correct when the value is TBC, but the email does not say "please confirm".
- **Uncategorised items show a green dot** on the phase table
  (`22-phase-table.jpg`). Green reads as "done". These three items are not
  done; there is just nothing to measure them against.

**Why it matters.** The chase email is the app's face to the client. A
designer who is asked about stitching on a side table stops trusting the next
question. Internally, a number nobody can act on gets ignored, and the real
blockers get ignored with it.

**Suggestions**

| | Suggestion | Size | Whose call |
|---|---|---|---|
| 2a | A category with no gate model **chases nothing by default**. Its questions show as "also outstanding", not TGQ, until Matthew writes its model. Today it is the reverse, by design ("the placeholder — every outstanding question counts as blocking"). | a day | Matthew |
| 2b | **"Doesn't apply" in one press** on a question, with "…to every item in this category on this project" beside it. N/A exists as a state, but nobody will set it fifty times. | a day | — |
| 2c | **Project and area facts asked once.** "Indoor/outdoor", fire standard and site access are properties of an area or the project, not of a chair. Ask once for the project, apply to every item, and allow exceptions per item. The project-wide mechanism already exists; this moves more questions into it and adds "per area". | days | Matthew (which questions) |
| 2d | **Default every list to "TGQ only".** "Also outstanding" (771 here) belongs after the order. Show it behind one switch, and make the headline numbers TGQ only. | tweak | — |
| 2e | **Measure progress in items, not questions.** "4 of 29 items ready to quote" is a number a person can move. "283 to answer" is not. The tiles already count items; lead with them, and drop the 5,694. | tweak | — |
| 2f | **Uncategorised is never green.** Use grey or amber with "no category — nothing measured". | tweak | — |
| 2g | **A question on a value we hold says "please confirm".** "Metal finish: we have MTL-01 brushed brass, lacquered — please confirm", instead of the bare field name. | tweak | — |
| 2h | **Group a repeated question in the email.** "Indoor or outdoor? Applies to: three-seat sofa, desk chair, both headboards (Guest Room Type A/B)" — one line, not eight. | a day | — |

---

## 3. One place to fill in

**What happens today.** To record that the sofa's fabric is Pierre Frey
Teddy, a person can use any of these:

| Where | Under what name |
|---|---|
| Record › Specs captured › "Add a spec by hand" (`32-add-spec.jpg`) — six fields: Group, Label, Value, Where on the item, BWS field, State | a spec |
| Record › Specs captured › "Edit value" on the existing fabric (`30-edit-value.jpg`) | a correction |
| Record › Checklist › the "COM 1" question | an answer |
| Fill in what we know › By item › the sofa | an answer |
| Fill in what we know › By question › "COM 1" | an answer |
| Chase › "Fill in ourselves" | the same screen as the fill-in |

They are wired together correctly: a spec fills its answer, and an answer
shows on the record. But a person has to understand specs, answers and BWS
fields to know which one to use. Each place also behaves differently:
- the checklist saves on change;
- "Edit value" asks why, and keeps the old value;
- "This item" (description, area, quantity, designer) is a separate form at
  the foot of the record.

The record page has 20 spec rows, each with an "Edit value" button and a
"Retire" button: forty buttons before the first question.

On the fill-in screen, expanding the sofa lists the project-level questions
first ("TOE agreement", "Expedited project confirmed by Jason?", "Sales folder
– folder selection"…), each with an input. The sofa's own questions come
after them (`10-infill-expanded.jpg`). The page header says those same
questions are "answered once on the project".

**Suggestions**

| | Suggestion | Size | Whose call |
|---|---|---|---|
| 3a | **The fill-in screen is where work is done.** The record page keeps the evidence (specs captured, the page each came from, versions) and links to "fill in this item". The checklist tab's inputs become read-only with a "fill in" link. This is the item-review screen's territory, so it is **input for Matthew and Claudia's design**, not a build. | a project | Matthew & Claudia |
| 3b | **By question is the default view** for a CAM. Answer "Indoor" once and tick the 25 items it applies to. The view already exists and "Select all shown" works; it is the second tab and should be the first. | tweak | — |
| 3c | **Project-level questions are never listed under an item.** Show one line, "+2 project-wide — answer on the project", as the item header already does. | tweak | — |
| 3d | **Keyboard-first entry, as in Excel.** Enter saves and moves to the next answer (Enter saving landed today). Tab moves across. Pasting a column of values fills a column of items. | days | — |
| 3e | **A typed answer is offered to the same item elsewhere.** The same code in "Public Areas – VE Option" is a separate record. Drawings already fan out across phases, and a spec typed on a linked twin is offered to the twin. A typed checklist answer is offered to neither: `twin-lines-2026-11-06.md` §4 decided that answers follow only through specs. So a CAM answers the VE bar stool again by hand. Answering one should offer, ticked, "also on HH-BS-01 in VE Option" and on its twins, as the spec form already does. | a day | Max (revisits twin §4) |
| 3f | **Edit in place on the record.** Clicking a value turns it into the input. "Why" is optional, with presets (client email / phone call / our mistake). One small "⋯" menu holds Retire. That replaces the forty buttons. | days | — |

---

## 4. The hand-off to the CAM

CLAUDE.md (2026-09-18): *"The PROJECT MANAGER loads the pack and reviews it,
then takes the summary of what is outstanding to the CAM, who fills in what
they know, and only then does anybody go to the client."*

**What happens today.** Nothing in the app knows there is a CAM:
- there is no owner on a project, and no "assigned to";
- no question is marked as one for the CAM rather than for the client;
- there is no list to hand over except the screen itself.

The "summary of what is outstanding" is the fill-in screen. It opens on
"Everything outstanding", which is 1,194 questions on T20120.

**Suggestions**

| | Suggestion | Size | Whose call |
|---|---|---|---|
| 4a | **Who answers this: in-house, CAM, or client.** A default per question in the seed: "Sales folder", "BWS project page set up" and "COM payment plan" are in-house; "Client sign-off visit" is for the CAM; fabric, finish and sizes are for the client or designer. The fill-in screen and the chase each filter on it. The PM, CAM, client sequence then becomes three filters on one list, not three screens. | days | Matthew (the defaults) |
| 4b | **"I don't know — ask the client"** as an answer. The CAM's "don't know" moves the question to the chase list, so nothing is lost between the CAM and the chase. | a day | — |
| 4c | **A project owner and a CAM on the project**, shown on the projects list, with a "Mine" filter. This is a column and a picker, not a permissions system; it does not touch D1. | a day | Max |
| 4d | **"Send to the CAM"**: a draft email, the same `.eml` mechanism as the chase, with a link to the fill-in screen filtered to the CAM's questions, and a printable sheet for a meeting. | a day | — |

---

## 5. The chase as a two-way sheet

**What happens today.** The draft is a well-made email: a table of record,
question, BWS field and "asked as", then the same questions grouped by
question in the body. It is opened in Outlook and sent by hand, then
recorded with "Yes, I sent it". The reply comes back as prose. Someone
uploads it, the model reads it (a charged read), and a reviewer confirms
each statement it placed. That works, as the rehearsal proved. But it is the
long way round for an answer we asked for by ID.

The chase page itself is **9,222 px tall** at 1440: the tiles, the contact
picker, the item list, "nobody assigned" (18 rows), "cannot be chased", then
the draft and the whole email.

**Suggestions**

| | Suggestion | Size | Whose call |
|---|---|---|---|
| 5a | **Attach a returnable spreadsheet to every chase.** One row per question, with the item, its code, what we hold, and an answer column; dropdowns where the field has a palette. The question's ID goes in a hidden column. The returned file is uploaded like any document and becomes a **staged** set of answers, reviewed and confirmed by a person (the gate is unchanged). There is **no model read**, so it is free and exact. A designer who replies in prose still can. | days | Max |
| 5b | **Cap and order the email.** Questions that block the quote come first, grouped (2h), at most about 25 a round, with "the other 29 next round". A designer answers 25; nobody answers 54. | a day | — |
| 5c | **Age the waiting.** Show "asked 6 days ago" on each waiting question, and a "draft a follow-up" button that re-asks only what is still open. The projects list's "waiting on a reply" tile then means something. | a day | — |
| 5d | **Split the chase page.** "Who and what" (pick a contact, tick questions) on one screen; the draft on its own page. Move the 18-row "nobody assigned" table to a one-line warning with a link. | a day | — |

---

## 6. Changing what is already known

**What is right today, and must not be lost:**
- every change keeps the old value and the page it came from;
- "Versions" shows a v2→v3 diff and the record **as BWS would receive it**;
- "Start a change" ties a set of edits to an email or a call;
- named points can be compared.

This is better than anything the spreadsheets did.

**What is heavy:**
- **"Start a change" is a box to open before editing**, and nothing on any
  later page shows that you are inside one. People will forget it, and their
  edits are then filed as "Edited by hand".
- **The question a PM gets asked most has no button.** "What has changed
  since we quoted?" is answered only by naming a point by hand beforehand
  and comparing two points.
- **A small change can need three screens.** A client's phone call that
  changes a fabric is: start a change, open the record, edit the value
  (which may fan out through the finishes library).

**Suggestions**

| | Suggestion | Size | Whose call |
|---|---|---|---|
| 6a | **A banner while a change is open:** "Recording changes for 'Call with NPI, 21 Nov' · 3 edits so far · Finish". It shows on every page of the project until finished. | a day | — |
| 6b | **Name a point automatically whenever the quote file or the BWS file is downloaded** ("Quote issued 21 Nov"). Add "Changes since the last quote" on the overview: one list of every change since, by item. This is the variation list a PM sends with a revised price. | days | — |
| 6c | **The change itself as a document.** A client email that changes things is already uploaded and confirmed. Do the same for "a call": a short typed note goes through the same confirm, so typed changes and emailed changes look the same in the trail. | days | Max |

---

## 7. Intake, at 300 lines

*Another session is reworking how intake identifies and routes files
(`open-intake-2026-11-20.md`, on branch `intake-2026-11-20`, built on
`prod-ready`). This section and 9f/9g are **input to that plan**, not
separate work. Read them against it before building any of them.*

An invented 300-line bill (`T20131`, `~/dev/localstack/synthetic-hhh/out-300/`)
through the upload and the bill review on the production build:

- **A held file looks chosen when it is not** (`42-after-upload.jpg`). The
  name says "Bill of Quantities" and the model said "FF&E schedule", so the
  file is held. That part is correct; it is the K1 fix from today. But:
  - the select already reads "Bill of quantities (creates the records)";
  - the button says "Read the 0 you have named";
  - ticking the row does nothing.

  Only pressing the small "Bill of quantities?" chip counts. **Being fixed
  now (F6):** the select will show "— say which —" until a person chooses.
- **A held file is lost if you leave the page.** The file was stored and a
  small charged call identified it. On reload the Documents tab says
  "Nothing imported yet", so the person uploads it again and pays for the
  identify call again. *Suggestion:* a held upload is kept as a row on the
  Documents tab ("waiting for you to say what it is") until it is read or
  removed. **days**
- **The review is one table 48,000 px tall** (`51-bill-review-full.jpg`:
  320 rows, 1,567 buttons, about 53 screens). It loads in 2.8 s and stays
  responsive, but:
  - the page says "amber is what needs a look", and the only way to find
    the amber is to scroll all 53 screens;
  - every row repeats its level reasoning ("the bill names no metalwork and
    nothing calls it a hero piece").

  *Suggestions:*
  - **a filter: "Needs a look (n) · Suggestions (n) · Everything";**
  - the level reason shown once in the header, not on 300 rows;
  - a row's details collapsed to one line when nothing on it is amber.

  **a day**
- **Confirm is live while suggestions are undecided.** On this bill, one
  press would have created the 20 section headings as records. The label
  helps: it changed from "creates 320" to "creates 300" once the headings
  were accepted. *Suggestion:* while suggestions are undecided, Confirm says
  so ("20 suggestions not decided") and asks once. This is the open decision
  in CLAUDE.md, "whether the bill's Confirm names unaccepted category
  suggestions", widened to every suggestion. **tweak**
- **After the confirm, everything holds up** (local timings, production
  build):

  | Step or screen | Time | Height |
  |---|---|---|
  | Accept headings / categories / levels | 1.7 / 1.6 / 7.1 s | |
  | Confirm 300 records | 6.1 s | |
  | Overview | 3.9 s | 3,130 px |
  | Phase table | 3.9 s | 31,080 px |
  | Fill-in | 3.9 s | 18,640 px |
  | Chase | 3.8 s | 14,990 px |

  Expect pilot to be slower; Neon is further away than a local database.

## 8. Smaller things seen on the way

- **Header.** It shows no name or role, so a viewer cannot tell they are
  view-only until a save is refused (V1). There is no Help link; the users'
  help file exists, but only for people who know it does. "Drafts" is not in
  the navigation.
- **Project header: eleven controls in two rows.** The four outputs
  (`.xlsx`/`.csv` × four) are there from day one, when nobody needs them.
  Put them under one "Outputs" button or tab. "Review the bill" and "Fill in
  ourselves" are the steps people actually take.
- **The project overview is 3,846 px tall.** A "Next step" card at the top
  would make the rest optional reading: "Rev B of the bill is waiting for
  review", or "3 items need a category", or "18 project-wide questions block
  every quote".
- **Words that are ours, not theirs.**
  - "unlooked" (the overview tile).
  - "9 of these 26 items are in a category Matthew has not written a gate
    model for". Users other than Matthew will not know what that means. Say
    "9 items use a provisional checklist".
  - "placeholder".
  - "TGQ" is fine; everyone in the pilot says it.
- **The projects list is red from top to bottom.** Every TGQ figure is red,
  so none of them stands out. Red should mean overdue or blocked-and-asked,
  not "has questions". Add the owner (4c) and "next date".
- **Numbers that argue.** The record header says "3 TGQ"; the button says
  "Chase the 2". The third TGQ is "Spec notes", a field on the item that a
  chase cannot ask. Say "3 TGQ (1 is ours to write)".

---

## 9. The fresh-eyes walk

A second reviewer, who had never seen the app, walked a new invented
project, `T20130` ("Harbour House"), as the PM, the CAM, the chase and the
outputs. It used only the users' help file, and read nothing of the code or
the plans. Its notes are `~/dev/localstack/ux-fresh/notes.md` (380 lines)
and its screenshots are in `~/dev/localstack/shots/ux-fresh/`. Its one-line
verdict: *"The reading of documents is very good. … the chase email — as it
stands, I wouldn't let a client see it."*

**It arrived independently at the same core problems as §2–§6:**
- the chase asks questions an item does not have (a stone-topped side table
  asked about COM 1–3, stitching, studs and hinges);
- there is no hand-off to the CAM;
- the screens show four different "outstanding" numbers within two clicks
  (295, 299, 111, 237);
- an uncategorised item gets a green dot;
- the view-only account shows edit buttons.

**What it found that the rest of this document does not cover:**

| | Seen | Suggestion | Size |
|---|---|---|---|
| 9a | **The chase sends internal and BWS words to the client.** "Project sold with metal finish or metal paint effect?" is BW's own question. "Outdoor", "Swivel Mechs" and "COM 1" are BWS field names. The VE phase's duplicate items are asked twice. The email ends "Many thanks," with no name. | The audience column (4a) keeps internal questions out of the chase. The client sees the question, never the BWS field. A code on two phases is asked once (2h). **The missing name is being fixed now (G3).** | days |
| 9b | **"COM 1" is shown for a fabric BW supplies**, on screens and in the client-facing quote lines ("COM: …"). To a designer, COM means *customer's own material*. | Screens say "Fabric 1" and give the BWS field second. The quote file prints "FABRIC:" unless the fabric really is COM. **Matthew and Tim** (the quote's labels). | a day |
| 9c | **Facts a drawing states don't answer the checklist.** SWIVEL: No and FIRE: BS 7176 are kept as notes, so the sofa still says "1 of 50 captured" after 16 specs were confirmed off its drawing. | Map the labels documents actually use to checklist questions through `requirement_aliases`. `npm run vocab:gap` already lists them, and its near misses show what a looser rule would get wrong. **Matthew** (which labels answer which question). | days |
| 9d | **A drawing's extra words on a code the bill already named are not kept.** The bill says "FAB-01 Kvadrat Hallingdal 65, col. 130 — to sofas"; the sofa sheet says "… colour 130, RAILROADED" and "120mm TAPERED" legs. The card says "Already recorded from the bill — the same finish, FAB-01, so nothing new is written there", so "railroaded", which the upholsterer and the metreage depend on, is not on the record. This is **deliberate** (`alreadyRecorded` in `drawing-document.ts`: the same code means the same finish, because the library holds the words). But what it drops is about the item, not the fabric. | Where the code matches and the words differ, keep the drawing's words as a NOTE on the item, beside the finish, and say so on the card. **Max**: it changes what a confirm writes. | a day |
| 9e | **Finishes schedule: wording-only differences flagged red.** "col." against "colour" shows as DIFFERENT, and the only choice is to throw away the schedule's wording. Confirming 14 finishes on the library is Edit → State → reason → Save each time: about 56 presses. The help file's finishes section did not get the reviewer through. | Fold abbreviations before comparing, as `sameFinishWords` already folds word order. Offer "use the schedule's wording". Add "Confirm all N on the library", with one reason. This is **D12** in the production-readiness plan. | a day |
| 9f | **Bill review defaults.** Pressing Confirm straight away gives "creates 43 records" for 29 items: headings, finish lines and a "Subtotal" row are included. Getting to 29 took ~23 presses (six bulk-accept buttons per tab, a unit, categories). The first item row starts below the fold at 1440×900. | One "Accept every suggestion on this tab (n)" button. It is still a person's acceptance of what is on screen, so the gate holds; suggestions are never applied unseen. Confirm names what is undecided (§7). Move the two explanation banners behind a "?" so the first row is above the fold. | a day |
| 9g | **The upload panel.** "Upload the pack" only switched tabs (**being fixed now, G4**). Status lines contradicted each other ("6 identified" beside "5 not identified"). Files that failed to read disappeared on reload, as held files do (§7). An email already filed on another project was refused, with no "attach here too". | Persist held and failed files as rows (§7). One status line computed in one place. "Also attach to this project" for an email that belongs to two (rare, but it is the client's answer). | days |
| 9h | **The outputs.** Every file is per phase, with no whole-project file. All four are offered from minute one, including on an empty project, and "Export" sits on every row of the projects list. The check sheet is 902 rows for 11 items. | An "Outputs" tab, shown once a bill is confirmed. A whole-project download that zips the per-phase files (the BWS import stays one file per phase; it is a replacement). The check sheet filtered to fields with a value or a doubt. | a day |
| 9i | **The Versions diff** lists a new spec six times (value, label, group, state, file, page). | One line per spec: "+ Glides: Felt glides — from the sofa sheet, p1". | a day |
| 9j | **A project cannot be deleted**, so a mistyped number is permanent. Deletion is by script only, deliberately (Max, 2026-11-06). | Let the project NUMBER be edited while nothing has been exported, which is the common mistake. Archiving already hides the rest. | tweak |

**What it said must not be lost:**
- the reading accuracy, and its honesty: guesses are labelled, and real
  doubts block Confirm;
- the preamble screen ("the best screen in the app");
- the pack page's "order these are read in";
- every spec traces back to its document and page;
- "nothing is charged until you press";
- the chase is a real Outlook draft and nothing is sent;
- fill-in by question;
- the costing sheet with the drawing crops;
- speed: no wait over 6 s; the cost is presses and reading.

**Its press counts.**

| Job | Presses |
|---|---|
| Load and confirm the pack | ~45 |
| Confirm the finishes on the library | ~56 more |
| From "pack confirmed" to "chase drafted" | ~19, plus 14 to set a designer by hand across three phases |

The drafted email still needed rewriting in Outlook. These are the numbers
to beat.

---

## 10. Ranked

If only five are done, in this order. The first three need no design
conversation:

1. **Make the chase sendable (§2 + 9a):**
   - placeholder categories stop blocking and chasing (2a, Matthew's yes);
   - "doesn't apply" in one press (2b);
   - project and area facts are asked once (2c);
   - repeated questions are grouped, and a code on two phases is asked once
     (2h);
   - internal questions stay internal (4a);
   - the client reads questions, not BWS field names.

   Both walks put this first. Without it the PM rewrites every chase in
   Outlook.
2. **Give the CAM hand-off a shape (§4):**
   - a "with" person on the project and the projects list (4c);
   - who answers each question (4a);
   - "ask the client" as an answer (4b);
   - progress counted in items, and the next step shown on the list instead
     of 5,694 (2e).
3. **Let what the documents say count (9c, 9d, 9e):** drawing facts answer
   the checklist; a drawing's extra words are kept; the schedule's wording
   can be used; finishes are confirmed in one press.
4. **The returnable chase sheet (5a):** the biggest saving in time and in
   model spend, and it keeps the confirm gate.
5. **Changes since the last quote (6b).**

3a (one place to fill in) is the largest and the most valuable. It belongs
in Matthew and Claudia's item-review design, and this document is offered to
them as input.

**Being fixed now, before the push** (small, and defects by anyone's
measure; coder G):
- developer voice off user screens and files;
- a neutral dot on uncategorised items;
- the chase email's sign-off carries the sender's name;
- "Upload the pack" opens the uploader in one press.
