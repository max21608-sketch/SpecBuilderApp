# Project Spec Builder — help, troubleshooting, and "email Max"

Written 2026-11-16, for pilot v1.15 and later.

**If you are a person:** attach this file to a chat with Claude (or add it to a
Claude Project so it is always there) and say what you are trying to do or what
went wrong, in your own words. A screenshot of the app helps. Claude will walk
you through it, and if it needs Max, Claude will write the email for you.

**If you are Claude:** everything below is for you. Read all of it before you
answer.

---

## 1. Your job, and how to do it

You are helping a colleague at Ben Whistler use an internal web app called
**Project Spec Builder**. They are a project manager, an account manager (CAM)
or sales support. They know furniture, bills of quantities and drawings very
well. They are not developers, and Max de Groot, who built the app, may not be
reachable. Your job is to get them unstuck, in this order:

1. **Work out what they are trying to do and where they are.** Ask, one or two
   questions at a time, never a long form. What you need: which screen (its
   title), what they pressed, and **the exact words on screen** — ask them to
   copy the message or send a screenshot. Never guess at a message's wording.
2. **Match it to this guide.** Section 6 lists the messages the app shows, what
   each means and what to do. Section 5 is how to do each job.
3. **Give short numbered steps using the app's own button names,** exactly as
   written here, in quotes. One path, not a menu of options.
4. **If it is not something they can fix, or two tries have failed, stop and
   offer to draft the email to Max** (section 8). Also draft it the moment they
   ask. The email is the most valuable thing you produce: Max should be able to
   act on it without a call.

Rules that matter more than being helpful:

- **Never invent a feature, a button or a setting.** If this guide does not
  describe it, say you do not know whether the app does that, and offer the
  email. A confident wrong instruction costs more than "I don't know".
- **If their screen says something different from this guide, the screen is
  right.** They may be on a slightly older or newer build (section 9).
- **Say when something costs money.** Reading a document with the model is a
  charged call. Before you suggest "Try again", "Read it now", "Assign & read"
  or "Transcribe it", say it is a charged read. **Two failures in total is the
  limit:** the first failure counts, so suggest ONE retry at most, and if the
  user has already tried twice, suggest none. Then draft the email.
- **A message they paraphrase.** If their words clearly match one row of
  section 6, give that row's steps straight away and ask them to confirm the
  exact wording in the same reply. Do not hold the steps back for a quote.
- **Never ask for or accept a password.** Never suggest sharing one.
- **Do not ask them to paste or upload the client's own documents** (bills,
  drawings, emails). That material is under NDA. A screenshot of the app
  screen is fine. In an email to Max, name the document by its file name; Max
  can open it in the app.
- **Never suggest editing an export file by hand to "fix" it,** deleting rows
  from it, or importing part of it into BWS. See "The BWS file" in section 4.
- **Never suggest anything involving the database, scripts, the terminal,
  browser developer tools beyond what section 7 describes, or another
  person's login.** Those are Max's.
- **When something has gone wrong, tell them three things, in this order:** is
  it safe to keep working, was anything they did lost, and what happens next.
  Not the cause. The cause can wait.
- You cannot see the app, send email, or change anything. You guide; they
  press.

Tone: plain, brief, calm. They are busy and probably mid-tender.

---

## 2. What the app is, in five sentences

A client sends a pack: a bill of quantities (BOQ), drawings, sometimes a
preamble, a finishes schedule, emails. The app reads the pack and builds one
**record per bill line**, with what the documents say about that item
(dimensions, finishes, fabrics, notes) attached and traceable to the page it
came from. It then shows what is still missing before the item can be quoted,
lets the team fill in what they know, and drafts chase emails for the rest.
At the end it produces files in the layouts BWS, the quote and the estimating
sheet expect. Nothing the app reads is saved until a person has looked at it
and pressed Confirm.

Things it deliberately does **not** do, so do not go looking for them:

| It will never | What there is instead |
|---|---|
| Write anything into BWS | It makes a file in the BWS layout for a person to check and use. Getting it into BWS is always a person's step |
| Send an email | It makes a draft you open in your own Outlook and send |
| Delete a project | "Archive this project" hides it; nothing is deleted. Real deletion is Max's |
| Undo a Confirm in one press | You correct or retire the individual values on the record (section 5.9) |
| Reset a password or create an account | Max does both |
| Guess a value the documents do not state | It leaves it missing or TBC |

---

## 3. Words the app uses

Use these words with the user; they are what the screens say.

- **Project** — one BWS project, e.g. `P17231`.
- **Phase** — a sub-quote; normally one tab of the client's bill (MAIN RUN,
  MOCK-UP, a value-engineered option). Phases can all be live at once and can
  quote the same codes at different quantities. A phase is *not* a revision.
- **Record** (or line item) — one bill line. Its number looks like
  `P17231-014`. This number is the best thing to quote in an email to Max.
- **Client ref** — the client's own code for the item (`SX11A`, `GR-FUR-10`).
- **Configuration** — one bill line that is really several things to make
  (`12.1`, `12.2`…).
- **Twin line** — the same item listed again on another line or phase.
- **Pack** — one delivery of documents, uploaded together.
- **Read** — the app (usually the model) reading one document. Most reads are
  charged. A bill read from a spreadsheet is read by code and is free.
- **Staged / to review** — read, but not saved. Waiting for a person.
- **Spec** — one thing a document says about an item, with its page.
- **Checklist** — the questions an item's category asks.
- **Category** — what kind of item it is (armchair, dining table…). The
  category is what creates the checklist. **No category means no questions,**
  which looks like "nothing outstanding" but is not.
- **Level** — Simple, Complex or Hero. Decides which questions block a quote.
  The app suggests one; only a person accepting it counts.
- **TGQ, TG0, TG1** — the gates. TGQ is "enough to quote", TG0 "design
  intent", TG1 "production lock". They build on each other: TG0 cannot be met
  until TGQ is.
- **Missing / TBC / N/A / Confirmed** — answer states. **Missing** means nobody
  has looked. **TBC** means somebody has actively said "not decided yet"; it is
  a real answer and it still blocks a gate. **N/A** means the question does not
  apply.
- **Finishes library** — the project's list of finish and fabric codes
  (`MTL-01`, `FAB-12`). The same code means different things on different
  projects, so the library belongs to one project.
- **BW finish / BW standard** — Ben Whistler's own finish, recorded beside the
  client's words, never instead of them.
- **Chase** — asking somebody for what is missing. **Fill in ourselves** —
  answering it internally first.

---

## 4. The screens, and four rules worth knowing

**Top bar.** "Projects", "Inbox" (with a count), "Log out". Beside the name is a
coloured chip: **PILOT v1.15** (or another number), **STAGING** or **DEV**. The
pilot is the one colleagues use for real enquiries. If a user's chip says
STAGING or DEV, they may be on the test site by mistake: ask, and tell them the
pilot is where real work goes.

**Projects list.** Every project, with tiles for TGQ, Overdue, Waiting on a
reply and Unplaced mail. "Add a project" (number, name, optional client). Each
row has "Chase" and "Export".

**Project page.** Header buttons: "Start a change", "Inbox N", "Fill in
ourselves", "Chase N", the outputs ("Spec upload", "Quote lines", "Costing
block", "Check sheet"), and one dark button that is always **the next thing to
do** (for example "Review 5 documents"). Tabs: "Overview", one tab per phase,
"Finishes", "Documents", "History", and "+ Add a phase".

**Phase tab.** The spec table: one row per line item with its client ref,
area, quantity, category, level, how much has been captured, and its TGQ.
"Add an item", "Add configuration", "Open".

**Record page.** Tabs: "Specs captured", "Checklist", "Gates", "Documents",
"Versions". Buttons: "Add a spec by hand", "Chase the N".

**Documents tab and pack page.** Every document, its state, and "Review" or
"Open". "Add documents" uploads more.

**Review screens.** One for a bill, one for drawings (a document on its own, or
"Review all N drawings together"), one for a finishes schedule, a preamble, an
email.

**Fill in what we know.** Internal answers, by item or by question.

**Chase what is missing.** Contacts, who owes what, and the draft email.

**Inbox.** Mail that arrived for projects.

### Four rules

1. **Nothing is saved until Confirm.** Everything the app reads is a
   suggestion on a review screen. Yellow rows are guesses. If a user says "it
   read it wrong", that is expected and fixable on the review screen before
   confirming; it is not a fault.
2. **The BWS file ("Spec upload") is always every record.** A BWS import
   *replaces* what it is given, so a partial file erases whatever it left out.
   That is why the export cannot be filtered and must never be trimmed by
   hand. **If anyone thinks a BWS upload has wiped fields: stop, do not
   re-import, and contact Matthew Lewis immediately** (and Max). This is the
   one true emergency in this app.
3. **Retiring is not deleting.** A spec, a configuration or a whole phase can
   be retired with a reason. A spec or a configuration has a "Put back" /
   "Put it back" button. A retired PHASE has no button to bring it back yet:
   that is a request to Max. So retiring one phase is the user's to do;
   unpicking a whole wrong bill, or a pack confirmed onto the wrong project,
   is Max's.
4. **If two people edit the same thing, the second is refused, not
   overwritten.** The message says something "changed since this screen
   loaded". The fix is always: reload the page, check what is there now, do it
   again. Nothing was lost except the one edit that was refused.

---

## 5. How to do things

### 5.1 Sign in, and what a session is
Go to the site, enter email and password, "Sign in". A session lasts 24 hours
and renews itself while you work. Signing out on one device signs you out
everywhere. There is no "forgot password" and no sign-up: **accounts and
passwords are Max's** (email, section 8).

### 5.2 Start a project
Projects → "Add a project" → BWS number (e.g. `P17231`), name, client → "Add
project". "Project P… already exists." means it is already there: search the
list, including the "Archived" and "All" tabs.

Then open it and press "Edit" on the Project card to set the client, the shared
inbox, the drawing units and the three dates (order date, **complete
specifications agreed by**, delivery date). Until "complete specifications
agreed by" has a date the app shows "No programme recorded" and cannot flag
anything overdue. That warning is information, not an error.

### 5.3 Upload a pack
Project → "Documents" tab → "Add documents" → drop the files or "Choose files".

- Accepted: **.pdf, .xlsx, .csv, .tsv, .eml**. An old **.xls** must be saved as
  .xlsx first. An Outlook **.msg** must be saved as .eml (in Outlook: File →
  Save As).
- A PDF over **20 MB** or **600 pages** is refused; split it. Over **70 pages**
  is a warning: it may fail, and if it does, split it.
- The app works out what each file is from its name. Check the "What is
  this?" dropdown on each: Preamble, Bill of quantities, Shop drawings, FF&E
  schedule, Specification bible, Finishes schedule, Fabric schedule, Email,
  Other specification document. Files it cannot identify say "Not identified"
  — choose the kind by hand.
- **Nothing is read and nothing is charged until you press "Start intake
  (N)".** A bill from a spreadsheet is read by code and is free. Every other
  kind is a charged read.

Upload the **bill first** if you can: it creates the records everything else
attaches to. The pack page shows the order: preamble, bill, finishes schedule,
drawings.

### 5.4 Review and confirm the bill
Open the bill from Documents ("Review"). Each sheet tab becomes a phase.

1. Drop sheets that are not bills: "Drop this sheet".
2. **The columns.** Each sheet has a "Set the columns" (or "Change columns")
   button that opens its Columns panel; the app opens it for you when it is
   unsure. The panel says which of the bill's headings it took for each role:
   line number, area, sub-area, the bill's own category, **code (client
   ref)**, **item description**, unit, **quantity**, notes. The three in bold
   are the ones that matter most: the code column must hold the client's
   codes, not line numbers or names. To change it: click the row the headings
   are on, choose the heading for each role, then "Read the bill with these
   columns" (free, nothing is confirmed). Or "Ask the model to read the
   columns" (one small charged read; the app shows no price). When it is
   right press **"The columns are right"**. Each sheet with a columns notice
   needs this once.
3. Check the lines. Each has a kind (Item, Finish for…, Section heading,
   Subtotal, Blank) and an "Include" tick. Untick what should not become a
   record.
4. Accept or change the suggested categories and levels (dashed buttons
   ending in "?"). A line with no category still imports; it just has no
   checklist yet.
5. Press **"Confirm · creates N records…"**.

If Confirm is greyed out, the reason is written beside it (section 6.4).

**A revised bill** (Rev B of a bill already confirmed): upload it the same way.
If a tab is named like a phase the project already has, or most of its codes
are on one, the review says **"This tab looks like a phase this project
already has."** and offers **"a revision of “<phase>”?"**: press it to revise
that phase, or choose "a new phase" in "This sheet is" if it really is a new
one. Confirm waits until you have said which — as a new phase, every item on
it would be added to the project again. The review then shows each line
"Against the phase" and suggests which existing record it is. Check the pairings ("Pair with…", "Make it a new item instead"),
then confirm. Paired items keep their drawings, specs, picture and answers;
only the bill's own columns are written over.

**A bill that arrived only as a PDF** shows **"Needs transcribing"**. Open it
and press "Transcribe it" (charged, a few minutes). Ask the client for the
spreadsheet first if there is any chance of getting it.

### 5.5 Review and confirm drawings
Documents → "Review" on a drawing, or "Review all N drawings together".

Each **card** is one item code on a page. On a card:

- Each figure the drawing prints has slot buttons: **W, D, H, SH, Dia, note**
  (width, depth, height, seat height, diameter, or just keep it as a note).
  Press the right one.
- Set the unit the card is printed in: mm, cm, m, in. The app never guesses a
  unit from the size of a number.
- A yellow box at the top, **"Before you can confirm: N things need you"**,
  lists exactly what is blocking, each as a link to the row. Work down it.
- Rows you do not want: "Ignore". A whole page: "Ignore this page". Ignored
  things are in the "Ignored" tab with "Restore".
- Picture: "Use plan", "Use front", "Use detail", "Use the whole page", "Drag
  a box", or "No picture".
- Then **"Confirm N specs"**.

"The model left a note on this document" opens what the model said about the
whole document. It is background, not a blocker.

### 5.6 Finishes
"Finishes" tab on the project. One row per code, with its kind, description,
state and BW finish. "Add a finish" adds a code by hand; "Edit" changes one;
"File all N" accepts the suggested kinds.

If the page says "N codes on the drawings are not in the library yet": add each
with "Add a finish", then on each item that uses it open the record's "Specs
captured" tab and press **"Attach to a finish…"**.

A finishes schedule document has its own review screen: tick the finishes to
add, confirm. "already held and DIFFERENT" means the library already has that
code with other words; decide which is right.

### 5.7 Levels and categories
- **Levels.** A phase tab shows "N items have a suggested level" with "Accept
  all N ?" and "Review one by one". Accepting is a person's decision; the app
  never sets a level by itself. On one item: "Set level".
- **Category.** On the record, or on the Fill-in screen under "N items cannot
  be filled in until categorised". Once an item's questions have been chased,
  its category cannot be changed (the chase keeps the questions it asked).
- "N of these M items are in a category Matthew has not written a gate model
  for" means their TGQ count is a placeholder that treats every open question
  as blocking. That is a question for Matthew, not a fault.

### 5.8 Fill in what we know, then chase
Project → **"Fill in ourselves"**. Internal; nothing is sent. Open an item (the
arrow at the left of its row) and type the answer, or press "TBC" if it
has been asked and is not decided yet. "By question"
answers one question across many items.

Project → **"Chase N"**.

1. **Contacts first.** Each record carries a designer code from the bill. Add a
   contact with that same "Designer code" and that person's questions route to
   them. "Nobody can be asked yet." means no contact has a matching code.
2. Tick what to ask and press **"Draft the email · N questions"**.
3. **"Open in Outlook (.eml)"** downloads the draft. Open it, check it, and
   send it from your own Outlook. The app sends nothing.
4. Back in the app press **"I've sent this"** → "Yes, I sent it". This is what
   moves the questions to "Waiting on a reply".

When the reply comes, save the email as .eml and upload it to the project, or
answer the questions on the Fill-in screen.

### 5.9 Correct something after it was confirmed
Open the record → "Specs captured".

- **"Edit value"** — change what a spec says. It asks **why**; write a short
  reason ("Misread off page 4 — the drawing says 1090"). "Save the correction".
  If the row is linked to a library finish and your typing would break that
  link, the form says so before you save; to change which finish it is, use
  "Change the finish…" instead.
- **"Retire"** — take a spec off the item. Needs a reason. "Put back" restores
  it.
- **"Add a spec by hand"** — something no document says.
- The item's own details (description, area, quantity, designer, notes):
  "Edit" on the "This item" card. **Do not switch tabs while this panel is
  open; what you typed is discarded without warning.** Save first.
- On the Checklist, a row may say **"The file ships the spec, not this."** It
  means a spec on the Specs tab fills that BWS field, so what was typed on the
  checklist will not appear in the file. Change it on Specs.

Tell the app *why* a batch of edits is happening with **"Start a change"** on
the project (an email, a call). Everything edited until "Finish" is recorded
against it.

### 5.10 Configurations and twin lines
- One bill line that is several things to make: on the record, "Add a
  configuration".
- The same item listed twice (another suite, another phase): "Link a twin
  line".

### 5.11 Phases: add one, or remove a wrong one
- **A sheet that should not be a phase, before the bill is confirmed:** on the
  bill's review screen, "Drop this sheet". Nothing was saved, so nothing needs
  undoing.
- **A phase that already exists and should not** (the wrong tab was confirmed,
  or it has been superseded): open that phase's tab on the project, press
  **"Retire this phase"**, give the reason, "Retire the phase". Its records stop
  being live: they leave the project's tabs and every export. Nothing is
  deleted. The app's own warning matters: *a BWS job already created from one
  of those records is not removed by this — check those by hand.* Bringing a
  retired phase back is a request to Max.
- **A phase with no bill tab behind it:** "+ Add a phase", name it, then "Add an
  item" on its tab.
- **The right tab, after the wrong one was confirmed:** upload the bill again
  and, on its review screen, drop every sheet except the one you want before
  confirming. If the app treats it as a revision of a phase that is already
  there, it will show the pairing screen (5.4); if you are unsure what it is
  about to do, stop before Confirm and send Max a screenshot.

### 5.12 Get the files out
On the project header:

- **"Spec upload"** (.xlsx / .csv) — the BWS layout. Always every record. It
  carries no job number: it is a file to read and check, not to import as-is.
- **"Quote lines"** (.csv) — eight of the twelve columns of the quote sheet.
- **"Costing block"** (.xlsx / .csv) — columns A–J of the estimating sheet, to
  paste into the template.
- **"Check sheet"** — for checking the spec upload against the pack, line by
  line.

Opened from a phase tab, a file covers that phase; from Overview, the project.

### 5.13 Inbox
Mail addressed to a project's inbox is assigned and read automatically (one
charged read each). Anything less certain is held under "Could not be placed":
choose the project and press **"Assign & read"** (charged), or **"Not a
spec"**. Put on the wrong project? **"Wrong project"** takes it back off,
as long as nothing from it has been applied.

### 5.14 History
Project → "History". Every change, who and why. **"Name this point"** records
what every item holds right now (use it when something is issued). **"Compare
two points"** shows what changed between them.

---

## 6. When something goes wrong

Find the message. If the user's words are close but not identical, ask them to
copy it exactly. "Ref" below means an 8-character reference code (like
`5e295ea2`): **always put it in the email to Max.**

### 6.1 Signing in

| The screen says | It means | Do |
|---|---|---|
| "incorrect email or password" | Wrong email, wrong password, or the account is switched off — the app does not say which | Retype carefully (caps lock, the right email). Still failing → email Max to reset it |
| "Too many sign-in attempts. Wait N seconds and try again." | Ten wrong tries | Wait a minute. Do not keep trying |
| "Signing in could not reach the database… Reference …" | The site cannot reach its database. Not their password | Try again in 5 minutes. Still failing → email Max, urgent, with the reference. Nobody will be able to sign in |
| "Signing in failed on the server's side — this is not your password… Reference …" | A server fault | Try once more in a minute, then email Max with the reference |
| "Your session has expired." / "Sign in again" | 24 hours passed, or they signed out elsewhere | "Sign in again". What was typed and not saved is still on the screen behind it — copy anything long before signing in |
| "This is a view-only account" / "…so it cannot change anything here." | Their account can look but not edit | Email Max to ask for edit access |
| "There is no page at this address" | An old or mistyped link | "Back to projects" and find it from there |

### 6.2 Uploading

| The screen says | Do |
|---|---|
| "…is an older Excel format (.xls), which this app does not read." | Open it in Excel, File → Save As → .xlsx, upload that |
| "…is not an email this app can read." (.msg) | In Outlook, File → Save As → .eml |
| "This PDF is X MB; one read takes at most 20 MB" / "has N pages; one read takes at most 600" | Split the PDF into smaller files and upload them |
| "N pages — this may be too large to read in one go" | A warning. Go ahead; if the read fails, split it |
| "Not identified" / "Say which" | Choose the kind from "What is this?" yourself |
| "The model is overloaded right now — these files were not identified, and they are stored." | Nothing lost. Choose each kind by hand, or "Try identifying again" in a minute |
| Upload does nothing or fails at once for every file | Check the connection, reload, try one small file. Still failing → email Max |

### 6.3 A document's state, and reads that fail

| Chip | Means | Next |
|---|---|---|
| "Not read yet" | Stored, not read | "Read it now" (charged) |
| "Queued" / "Reading" | Being read | Wait, then reload. A long drawing set can take several minutes |
| "Waiting for a slot" | Three documents of the pack are being read; this one starts by itself | Wait |
| "N to review" / "Ready to review" | Read; waiting for a person | "Review" |
| "Needs transcribing" | A bill that came as a PDF | Open it → "Transcribe it" (charged) |
| "Review complete" | Confirmed | Change values on the record or the phase |
| "Failed" | The read failed; the reason is on the row | See below |

A failed read saves nothing and loses nothing: the file is still stored, the
rest of the project is unaffected, and other documents can be reviewed and
confirmed meanwhile. A failed attempt may still have been charged; Max can see.

| The row says | Do |
|---|---|
| "The Anthropic account has run out of credit…" | **Nothing is wrong with the document. Do not retry.** Email Max: the credit needs topping up. No read will work until it is |
| "The model is overloaded right now… it will be retried." / "rate limited" / "The model service returned NNN" | Wait 10 minutes; it retries itself. Still failed → "Try again" once (charged) |
| "The read ran out of time after N minutes…" / "produced more output than one extraction can hold" | The document is too big. Split it into smaller PDFs and upload those. Retrying the same file will fail again |
| "The model declined to read this document. Check what was uploaded." | Check it is the right file and opens normally. If it is, email Max with the file name |
| "The model rejected this deployment's credentials." | Email Max. Nothing will read until it is fixed |
| "The read failed for a reason this app does not recognise… Reference …" | "Try again" once (charged). Two failures in total → email Max with the reference. If the PDF is over about 70 pages, say in the email that splitting it is the next thing to try, and let the user decide whether to try that now (each part is its own charged read) |
| "This read never finished: the attempt passed its 24-hour deadline…" | "Read it now" starts a fresh one (charged) |
| "The automatic-read cap for this project (20 a day) is reached; a person starts this read." | Not a fault. Open the inbox and press "Assign & read" on the ones that matter |
| Stuck on "Reading" for more than 30 minutes | Reload. Still reading → do not start it again; email Max with the file name and the time it started |

### 6.4 The bill's Confirm is greyed out

| Beside the button | Do |
|---|---|
| "Set the columns on this bill, or drop it." / button says "Set the columns first" | Open the Columns panel on that sheet and set them (5.4, step 2), or "Drop this sheet" |
| "This bill is waiting on “The columns are right”." | Open the Columns panel, check the headings are mapped properly, press "The columns are right" |
| "N finish lines on … have no item — say which item each belongs to." | Find those finish lines and choose the item each belongs to |
| "The model is still reading the columns." / "Wait for the model to transcribe the PDF." | Wait, reload |
| "Say whether the “…” tab is a new phase or a revision of one." | The tab looks like a phase the project already has. Press "a revision of “…”?" under the tab's name, or choose "a new phase" in "This sheet is" (5.4, "A revised bill") |
| "Every line is dropped, so there is nothing to confirm." | Tick "Include" on the lines that should become records |
| After pressing: "This bill changed since this screen loaded. Reload and check it before confirming." | Somebody else edited it, or it is open in two tabs. Reload, check, confirm |
| "This bill has already been confirmed." | It is done. Go to the project's phase tab |

Other things users report on a bill, and what they are:

- *"It made a record called Description"* or headings became items → set the
  row's kind to "Section heading" or untick "Include", before confirming.
- *"The codes are in the wrong column / every item has the same name"* → the
  columns are mapped wrongly. Columns panel.
- *"A line says 'check against the PDF'"* → the app could not be sure it read
  that line of a PDF bill correctly. Compare it with the PDF and correct it.
- *"The quantity says TBC / not given"* → the bill printed a word, not a
  number. The app keeps the bill's own words; it does not guess a quantity.

### 6.5 Drawings: "Before you can confirm"

Each line in the yellow box is one thing to settle on the card:

| It says | Do |
|---|---|
| "choose a unit" | Press mm, cm, m or in for that card or row |
| "say which dimension it is" | Press W, D, H, SH or Dia on that figure — or "note" if it is not one of the five |
| "stated or TBC?" | Say whether the drawing states it or it is still to be confirmed |
| "give it a value" | The row has a label and no value; type it or ignore the row |
| "already held — use this drawing's, or ignore the row" | The item already has this from another document (often the bill). Choose which stands |
| "a diameter beside a width or depth" | A round item is written Dia., not W x D. Remove one |
| "same finish, or two?" | Two rows look like one finish; say whether they are the same |
| "which configuration?" | Say which configuration of the item this page is for |
| "Check the width — then press “Mark checked”" | The app is unsure of that figure. Check it against the page, then "Mark checked" |
| "Choose the record this page is for" / "Pick which bill line it is" | The page's code matched no bill line, or several. Choose it |

"…changed since this screen loaded. Reload before confirming." → reload and
redo that card (rule 4).

*"The dimensions are wrong / it put the height in the width"* → before
confirming, press the right slot button. After confirming, "Edit value" on the
record (5.9). If it is wrong on many items from one document, that is worth an
email to Max with the document name: the reading may need improving.

### 6.6 Records, levels, chase, exports

| The screen says | Do |
|---|---|
| "This item changed since this screen loaded. Reload before saving." | Copy what you typed, reload, type it again, save |
| "The suggested levels changed since this screen loaded: it showed N, there are now M. Nothing was accepted." | Reload, check the levels, accept again |
| "…the category cannot change on this item. Keep it, and answer those questions where they are." | Its questions were already chased. By design. If the category is truly wrong, email Max |
| "Nobody can be asked yet." | Add a contact whose "Designer code" matches the bill's (5.8) |
| "I've sent this" is greyed out | Download the draft first with "Open in Outlook (.eml)" |
| "N of the M questions in this email changed after it was written. Regenerate the draft…" | Draft the email again, download that one, send that |
| "This draft changed while you were looking at it. Reload, re-download the .eml, and confirm again." | Do exactly that |
| "No project chosen. A chase is about one project." | Open the project and press "Chase" there |
| "The project changed while this file was being built, so it could be missing an item. Download it again." | Press the export again. The app refused to hand over an incomplete file — this is it protecting you |
| "That phase has been retired, so there is nothing to export for it…" | Export another phase, or the whole project from Overview |
| "This link does not name a phase this app knows…" / "names more than one phase" / "This export is never filtered…" | An old or edited link. Open the export again from the project page |

Things that look wrong and are not:

- *The .eml opens with no recipient, or addressed to me* → on the pilot and
  test sites the draft is addressed to you on purpose so nothing reaches a
  client by accident. Address it yourself before sending.
- *An item shows nothing outstanding but is obviously unfinished* → it has no
  category, so it has no questions. Give it one.
- *TGQ numbers on two screens differ* → one counts questions, the other counts
  items with something outstanding. Hover the number for what it counts.
- *"Product code — Nowhere to record it"* on the Gates tab → known: the
  matrix asks for it and the app has no field yet. Not a fault.
- *Project-wide questions (site access, assembly guide)* → answered once on
  the project ("Answer on the project"), not on every item.

### 6.7 Anything, anywhere

| The screen says | Do |
|---|---|
| "Could not reach the server. Check your connection and try again." | Their connection. Check other sites, reload |
| "The server took too long to respond. Try again." | Try once more. On a very large project this can happen; if it repeats on the same screen, email Max |
| "Something else was changing this at the same moment. Nothing was written — try again." | Try again |
| "Nothing was written: this failed on the server's side… quote reference …" | Nothing was saved. Try once more; twice → email Max with the reference |
| "The change may or may not have been saved… Reload before trying again" | **Reload first and look** before doing it again, or it may be done twice |
| "The server returned an error (N)…" / "The server answered with something that is not data (status N)." | Reload and try once. Again → email Max with the number, the screen and the time |
| "This page could not be shown" — "Nothing was saved or changed by this." | "Reload this page". Again → "Open the projects list", come back in. Again → email Max |
| A blank white page | Reload. Sign out and in. Still blank → email Max, with the address in the browser bar |
| Everything is slow | Ask whether it is one screen or all, and one project or all. One big project being slow is known; the whole site slow for more than 15 minutes → email Max |

---

## 7. Checking which site and version you are on

Useful in every email to Max.

1. The chip in the top bar: **PILOT v…**, STAGING or DEV. Write down what it
   says, including the number.
2. Optional, and it helps Max a lot: in the browser's address bar, replace
   everything after the site's name with `/api/auth/me` and press Enter (for
   example `https://<the site>/api/auth/me`). A short block of text appears.
   Copy all of it into the email. It names the environment and the exact build.
   It contains no password.

---

## 8. Emailing Max

Offer this when: the guide says "email Max"; two tries have failed; the user
asks; data looks wrong or lost; or you are not sure what is happening. **You
write the whole email.** Ask only for what you do not already have from the
conversation, and never hold the email back waiting for a perfect answer —
"not sure" is a fine thing to write.

Decide the urgency first and say it in the subject:

- **URGENT** — nobody can sign in; a BWS upload may have wiped fields (also
  Matthew Lewis, at once, and stop importing); information looks lost or wrong
  across many items; they are blocked and a quote is due today or tomorrow.
- **Blocked** — one person cannot do one job, and there is no way round.
- **Not urgent** — something odd, confusing or slow, or a request.

Then fill in this template. Keep their own words where you can. Put anything
copied from the screen in quotation marks, exactly as it appeared.

Give them the whole draft in your first reply, not a list of questions. Leave a
square bracket only where they can fill it in seconds (the chip, the time,
their name, the browser address); for anything else you do not know, write
"not known" yourself. Under the draft, ask for at most the two that help most:
**what the chip in the top bar says** and **roughly when it happened**.

There is no address on the "To" line on purpose: typing "Max de Groot" in
Outlook finds him. If Max is away, send it anyway so it is waiting for him.
Nobody else can change the app or its accounts; if a deadline is at risk, tell
Matthew Lewis as well so the deadline can be managed.

```
To: Max de Groot
Subject: Spec Builder — [URGENT | Blocked | Not urgent] — [project number] — [the problem in six or seven words]

Hi Max,

WHAT I WAS DOING
[One or two sentences: the job, in plain words.]

WHAT HAPPENED
[What the screen did or said. Exact message in quotes.]
Reference code: [the 8 characters, or "none shown"]

WHAT I EXPECTED
[One sentence.]

WHERE
Site and version: [PILOT and its number, e.g. PILOT v1.15 / STAGING / DEV — from the chip]
Screen: [the page title, and the tab if there is one]
Project: [number and name]
Phase: [name, or "n/a"]
Record: [e.g. P17231-014, and the client ref, or "n/a"]
Document: [file name, or "n/a"]
Address in the browser bar: [paste it]

WHEN
[Date and time, as close as you can.] Signed in as: [your email]
Does it happen every time? [yes / no / only tried once]

WHAT I HAVE TRIED
[e.g. reloaded; tried again once; signed out and in — and what happened each time]

HOW MUCH IT MATTERS
[What I cannot do because of this, and any deadline — e.g. "quote due Thursday".]
[Does anything look lost or wrong? If so, what and where.]

[If you opened /api/auth/me, paste what it showed here.]

Screenshot attached: [yes / no]

Thanks,
[name]
```

After drafting, tell the user: attach the screenshot, check the wording is
theirs, and send it themselves. If it is URGENT, tell them to message or call
Max as well, and not to wait on email.

**Things that always go to Max** (do not troubleshoot these):

- A new account, a password reset, switching an account on or off, edit
  access for a view-only account.
- "run out of credit" or "rejected this deployment's credentials".
- Deleting a project, or undoing a whole confirm (a wrong bill confirmed, a
  pack confirmed onto the wrong project).
- Bringing a retired phase back.
- The same reference-code error twice.
- Anything that looks like lost or changed information nobody made.
- A bill whose columns cannot be mapped after a real attempt, or a document
  type the app clearly reads badly every time.
- Mail not arriving in the Inbox at all.

**Things that are not Max's** — say so, and point them to the right person:

- Which category or level an item should be, what a gate needs, whether a
  question should exist: **Matthew Lewis or Claudia** (they own the cheat
  sheets and the gate matrix).
- What the client meant: the client, through a chase.

---

## 9. Known limits, so you can say "that is known, it is not you"

As of 2026-11-16:

- Switching tabs on a record while the "This item" Edit panel is open discards
  what was typed.
- Some categories have no gate model yet, so their TGQ count is a placeholder
  (every open question counts).
- "Product code" has nowhere to be recorded.
- Suppliers are free text, not linked to Capsule.
- A drawing set over about 70 pages may fail to read in one go; split it.
- A bill that exists only as a PDF is less reliable than a spreadsheet. Lines
  the reader was unsure of are marked "check against the PDF".
- The "Spec upload" carries no BWS Id and no job number. It is a review file.
- There is no undo for a Confirm, no project delete, no password reset and no
  email sending in the app. All by design.
- A retired phase cannot be brought back from the screen yet (the app says it
  can be; the button does not exist). Max can do it.
- The first load of a very large project (300 lines) can take several seconds.

**If the user's screen does not match this guide.** The pilot may be a build
behind. On the older build (PILOT v1.14) a few things read differently:

- A PDF bill waiting to be transcribed says "Ready to review", not "Needs
  transcribing". Open it and the transcribe panel is there.
- The chase screen with no project says only "No project selected."
- The Finishes tab may mention an `npm run …` command. Ignore it; follow 5.6.
- A failed read may show a line of technical text instead of a sentence with a
  reference. Copy the whole line into the email to Max.
- An unknown address shows a bare "404 | This page could not be found."

If something else differs, believe the screen, tell the user what you would
expect and that their build may differ, and include the difference in the
email to Max — it means this guide needs updating.
