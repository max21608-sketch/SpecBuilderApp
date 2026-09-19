---
name: meeting-recap
description: Turn a recorded meeting into a summary, an impact analysis against this repo, and a plan — then audit the instruction files the meeting made wrong.
---

# Turning a recording into a plan

A meeting where somebody uses the app, or decides its direction, is the highest
value input this project gets and the easiest to lose. The recording expires,
the transcript is machine-generated and wrong in places, and nobody watches two
hours twice.

The output is **one dated document in `docs/plans/`**, plus entries in the files
that already exist for each kind of thing, plus corrections to the instruction
files. Not a transcript. Not a bullet list of feature requests.

**The whole point is the second pass.** See *Go through it twice*.

---

## 1. Get the recording and the attendees

Ask for the link. Then find the calendar event, because it gives you the real
attendee list, the real start time and the organiser — the transcript's speaker
labels are unreliable and people join late.

```
outlook_calendar_search { query: "*", afterDateTime: "<day>", beforeDateTime: "<day+1>" }
```

Read the event for `meetingTranscriptUrl` and the attendee list.

**Record when the recording expires.** Stream shows it on the page ("Expires in
59 days"). Pull everything you need on the first sitting; there is no second
chance six weeks later.

## 2. Get the transcript

Three routes, in this order, and only the third works here:

1. **Graph.** `read_resource` on the event's `meetingTranscriptUrl`. One call,
   worth trying because it is free and would be clean. In this tenant it returns
   `GraphAccessToTranscriptsDisabled` — the scopes are granted and a **tenant
   policy** blocks it. Do not go hunting for a permissions fix.
2. **The player's transcript file.** Do not bother. It is served from
   `.../cdnmedia/transcripts?…kid=…` and is **encrypted**: the fetch succeeds,
   the length looks right, and the bytes are ciphertext. Failing loudly would be
   better than this, so know it in advance.
3. **Scrape the rendered panel.** `files/harvest-stream-transcript.js`, run
   through `javascript_tool` with the Transcript panel open. It handles the
   virtualised list, which is the part that is easy to get wrong — about 110 of
   1,800 rows exist in the DOM at once, so a naive `innerText` grab silently
   returns the first two minutes.

**Signing in is the user's job.** The recording is behind their Microsoft
account. Ask them to sign in to the browser pane and wait; never type their
credentials, and never offer to. Poll with `computer { action: "wait" }` batches
rather than asking repeatedly.

Pull the result off `window.__c` in ~25k-character slices. A two-hour meeting is
around 130k characters once the duplicated speaker/time prefixes are stripped —
perhaps 35k tokens, which is cheap enough to hold in context for the whole task.

## 3. Screenshots, if the meeting was a demo

Worth it when the screen being discussed tells you something the words do not —
a field list, an error, a number nobody read out.

```js
const v = document.querySelector('video');
v.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;background:#000;object-fit:contain';
v.currentTime = <seconds>;
```

Then `resize_window` to something large, wait 3s, `pause()`, screenshot.

**Frames come back black after repeated seeks**, and also genuinely black where
a screen share was mid-transition. Do not debug it: re-seek a few seconds either
side. If two attempts fail, move on — the transcript is the substance.

## 4. Separate DECISIONS from everything else

This is the structural judgement that makes the document usable.

A two-hour meeting produces five decisions and forty observations. Put the
decisions in a short table at the top with **who** decided and **where** in the
recording. Everything else is a request, an observation or an open question, and
goes in the walkthrough.

**A feature the customer described is not a feature they asked for now.** In the
2026-09-18 catchup the same person listed a dozen things and then said
*"don't feel like you need to get it all polished"* and *"some of what I briefed
you to do is probably not quite on the money"* — three separate times. A recap
that turned that into a backlog would have inverted the meeting.

## 5. Quote, with timestamps, and distrust the transcript

Every quotation carries its timestamp, so anybody can go back. Where a line is
too garbled to trust, do not quote it.

The transcript is machine-generated and mangles exactly the words this project
uses most:

| It writes | It means |
|---|---|
| EOQ, VIQ, BIQ | BOQ |
| PWS, DWS, BWF | BWS |
| TVC | TBC |
| cheques, cheque | checks, check |
| Claudia | Claude |
| draught | draft |

Say so at the top of the document. A reader who does not know this will think
the app has a "VIQ import".

## 6. Go through it twice

**Do not skip this.** On the 2026-09-18 catchup the first pass was thorough and
still missed four defects that were visible on screen, and recorded three facts
too weakly:

- a screen element the demonstrator himself said was useless;
- a state that meant "opened" while reading as "checked";
- two counts differing by one on the same screen that two people asked about;
- the user hunting for a control and not finding it — the single most
  informative thing in the meeting.

The second pass also caught that a vocabulary "could not be downloaded, only
scraped", that one answer belonged to a role the repo did not model, and that a
decision left three sub-questions open rather than one.

Re-read the whole thing against the draft. Not a skim for gaps — a read.

## 7. Check every claim against the repo before writing it down

Both directions, and both fire regularly.

- **An answer can be contradicted by the repo.** On 2026-09-19 a question about
  "Product code" was answered as the client's BOQ code. The gate seed carried
  the *same person's colleague's* transcribed note — `capture = 'auto'`,
  *"Boilerplate derived automatically: if MF1 or MF2 is populated"* — which
  makes it BWS's own boilerplate code and something the app already derives.
  Both readings were about ten lines to build; one would have made a gate pass
  on a different fact from the one it names.
- **A "new" thing can already exist.** "Substrate" was written up as a concept
  nothing models. It is `json_id` 192, column CF, already in the 56 seeded
  fields.
- **A feared change can be tiny.** "Levels must stop constraining fields" read
  like a model change. `tgq_levels` is read by `questionTier` and nowhere else
  that matters, and it returns a badge — nothing was ever filtered.

Say which it is in the document. An assumption presented as a finding is what
sends the fix to the wrong file.

## 8. New feedback that contradicts old feedback usually means two artefacts

Before recording a reversal, check whether the two statements are about
different things. *"The chase screen is a list of items, not questions"* (asked
for in September) and *"stop repeating the same question on ten lines"* (asked
for a day later) are both right: one is about the **screen**, where a person
works item by item, and one is about the **email**, where a client answers
question by question. Recording the second as overturning the first would have
thrown away a good screen.

## 9. Where it all lands

| What | Where | Why there |
|---|---|---|
| The recap, impact and plan | a new dated `docs/plans/<name>-<date>.md` | one document somebody can read end to end |
| Defects seen on screen | `docs/plans/found-in-use.md` | that file exists so fixes are not done one at a time out of order |
| Decisions, with their reasons | a dated section in `docs/plans/README.md` | the decision log |
| Answers given on somebody's behalf | `docs/plans/matrix-assumptions.md`, or a new file shaped like it | each entry says what was assumed, what it changed, and how to reverse it |
| Corrections | `CLAUDE.md` **and** `AGENTS.md` | see below |

In another repo the names differ; the shapes do not. What matters is that a
defect, a decision, an assumption and an instruction each have a home, and that
the recap links to them rather than duplicating them.

## 10. Audit the instruction files afterwards — this is half the value

A meeting that changes direction makes lines in `CLAUDE.md` wrong, and **a stale
instruction is followed confidently**, which is worse than an absent one. Go
looking, specifically for:

- **Statements about who the user is.** The 2026-09-18 catchup revealed a second
  role — a PM loading the pack and taking the outstanding summary to a CAM —
  where both `CLAUDE.md` and `docs/stack.md` named one.
- **Load-bearing sections that are now half-right.** "The chase screen is a list
  of ITEMS, not a list of questions" was correct and had become the exact wrong
  instruction for the email.
- **Gaps described as permanent that are now fixable.** "This app holds none of
  them" about the BWS palettes, after somebody showed where they live.
- **"Explicitly excluded" lists.** Two entries had been built or asked for.
- **Milestone headings that claim everything else waits**, when the order just
  changed.
- **Other docs contradicting `CLAUDE.md`.** `docs/stack.md` still said a
  register was "deliberately not built" two days after it was built.

Fix what is clearly wrong; list what needs the user's call rather than guessing.
Keep the *reason* when removing a rule — the reason usually still governs
something else.

`cmp -s CLAUDE.md AGENTS.md` before reporting completion, every time.

## 11. Report

Lead with the decisions, then the things that change what is written down, then
what you corrected. Name what you could not do and why. If an answer you were
given is contradicted by the repo, say so once, plainly, with the evidence — and
do not build either version until it is settled.

## Before calling it done

1. The recap document reads end to end without the transcript beside it.
2. Every quotation has a timestamp; nothing garbled is quoted as fact.
3. Decisions are separated from requests, and the plan is ordered by what
   unblocks the user rather than by what was said first.
4. Each defect, decision and assumption is in the file that exists for it.
5. `cmp -s CLAUDE.md AGENTS.md` succeeds.
6. Anything you assumed is labelled as an assumption, with how to reverse it.
7. Report human acceptance of the recap itself as outstanding — the person who
   was in the room is the only one who can confirm you heard it right.
