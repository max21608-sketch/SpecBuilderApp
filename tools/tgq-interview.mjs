// ==========================================================================
// tools/tgq-interview.mjs -- build the TGQ interview pack Matthew talks to.
//
// The workbook (tools/tgq-checklist.mjs) asks for 1,368 ticks, because it
// asks per CATEGORY. But 728 requirements are only 62 distinct QUESTIONS: the
// same "Stitching spec" appears on fifteen cheat sheets, and whether it gates
// a quote is one decision, not fifteen. Asked once per question, with named
// exceptions where a category really differs, the whole matrix is 62 spoken
// answers.
//
// So this emits paste-into-Claude briefs. Matthew starts a voice chat, pastes
// one file, talks through it, and Claude returns a TSV block that
// tools/tgq-answers.mjs expands back over all 728 rows.
//
// Two rules drive the wording of the brief, and both come from this repo:
//   - never silently replace a human decision with automation. The
//     interviewer asks; it does not infer, lead, or fill a gap from a sister
//     question. Unsure is a recordable answer ("?"), not a prompt to guess.
//   - a question with no answer must stay visibly unanswered, which is why
//     the chunk footer makes the model account for every id it was given.
//
// Every file is SELF-CONTAINED -- the rules and the output format are
// repeated on each one -- because a voice session may be started fresh, or
// lose the top of its context, and a chunk answered under half the rules is
// worse than a chunk not answered.
//
//   node tools/tgq-interview.mjs [--out <dir>]
// ==========================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  repoRoot,
  SHARED_SECTION,
  readSpecFields,
  readCategories,
  readRequirements,
  assertSharedBlockIdentical,
  distinctQuestions,
  questionFingerprint,
  bwsFieldLabel,
} from './lib/requirement-seed.mjs'

const specFields = readSpecFields()
const categories = readCategories()
const requirements = readRequirements()
assertSharedBlockIdentical(requirements, categories)

const questions = distinctQuestions(requirements)
const categoryName = new Map(categories.map((c) => [c.slug, c.name]))
const PACK = `${new Date().toISOString().slice(0, 10)}-${questionFingerprint(questions)}`

// -- how the 62 are split into sittings ------------------------------------
//
// The sections come from the cheat sheets. "Build details" is 36 questions,
// which is too long to hold in one conversation, so it is split into three by
// what a person is thinking about -- upholstery, cabinetry, then the site the
// piece lands in. That grouping is for the CONVERSATION only: no question
// moves section, changes id, or leaves the pack, and the answer sheet is
// keyed on the id either way.

const BUILD_GROUPS = [
  {
    key: 'upholstery',
    title: 'Build details — upholstery',
    blurb: 'Fabric, fill, stitch and mechanism. Mostly the nine upholstery categories.',
    prompts: [
      'COM 1',
      'COM 2',
      'COM 3',
      'Stitching spec',
      'Stud spec',
      'Fabric quantities',
      'Fabric with pattern? Direction?',
      'Interliner required?',
      'Fluted, Deep buttons & pleats specs',
      'Seat upholstery build — loose or fixed?',
      'Back upholstery build — loose or fixed?',
      'Storm covers needed?',
      'Swivel Mechanism 360 or 180 (return or non return also)?',
      'Sofa mech spec',
      'Mattress type / And if In-set or Sit-on',
    ],
  },
  {
    key: 'cabinetry',
    title: 'Build details — cabinetry and hardware',
    blurb: 'Carcass, moving parts and ironmongery. Mostly the eight cabinetry categories.',
    prompts: [
      'Runners',
      'Door Hinges',
      'Drawer Liner',
      'BW Standard felt or COM/BOM?',
      'Any Specialist Hardware required?',
      'Handles spec, etc',
      'Make client aware of BW standard lid stays',
      'Has client been advised of BW Standards?',
    ],
  },
  {
    key: 'site',
    title: 'Build details — the site it lands in',
    blurb: 'Environment, fit, services, and what surrounds the piece.',
    prompts: [
      'Needs split? Where?',
      'Indoor/ Outdoor / Humid environment',
      'Is fully outdoor or partially protected?',
      'Floor type',
      'Wall build',
      'Wall mounted?',
      'Is skirting present?',
      'Any Specialist Lighting/ Power Required?',
      'Do we need to have access for wires through the table?',
      "Is it sitting alongside sofa's tables BW need to be aware of?",
      'Has the client provided details (heights, SH, etc.) of the chairs?',
      'Has the client provided details (heights, top thickness, base design) of the tables?',
      'What is the bar height the pieces sit infront of?',
    ],
  },
]

function chunkQuestions() {
  const chunks = []
  const commercial = questions.filter((q) => q.section === SHARED_SECTION)
  chunks.push({
    key: 'commercial',
    title: 'The commercial questions',
    blurb:
      'Everything the cheat sheets ask about the project rather than the piece. Word-for-word identical on all 17 sheets, ' +
      'so each one is asked once here.',
    questions: commercial,
  })

  const theItem = questions.filter((q) =>
    ['Design intent', 'Dimensions', 'Material, finish, substrate', 'Glass and mirror', 'Stone', 'Metalwork'].includes(q.section),
  )
  chunks.push({
    key: 'the-item',
    title: 'The item itself',
    blurb: 'Design intent, size, material, finish and metal. The questions that describe what is being made.',
    questions: theItem,
  })

  const build = questions.filter((q) => q.section === 'Build details')
  const placed = new Set()
  for (const group of BUILD_GROUPS) {
    const picked = group.prompts.map((p) => {
      const q = build.find((b) => b.prompt === p)
      if (!q) throw new Error(`build group "${group.key}" names a question that is not in the seed: ${JSON.stringify(p)}`)
      placed.add(q.id)
      return q
    })
    chunks.push({ key: group.key, title: group.title, blurb: group.blurb, questions: picked })
  }
  const orphans = build.filter((q) => !placed.has(q.id))
  if (orphans.length) {
    throw new Error(
      `the build groups do not cover every Build details question. Missing: ${orphans
        .map((q) => `${q.id} ${JSON.stringify(q.prompt)}`)
        .join('; ')}. Add each to a group in BUILD_GROUPS -- dropping one would lose it from the interview silently.`,
    )
  }
  return chunks
}

const chunks = chunkQuestions()

const covered = new Set(chunks.flatMap((c) => c.questions.map((q) => q.id)))
if (covered.size !== questions.length) {
  throw new Error(`the pack covers ${covered.size} of ${questions.length} questions`)
}

// -- the pieces every file repeats -----------------------------------------

const RULES = `## How to run this

You are interviewing **Matthew**, who runs design and specification at Ben
Whistler. He is speaking, probably on a phone, probably between other things.
Ask; do not lecture.

**The one question, for every item below:** what has to be known before we can
put a **price** on this — not before we can build it. Everything else can still
be TBC at quote stage.

**Ask about each of the three levels**, which are the levels Matthew uses:

| | |
|---|---|
| **Simple** | the plain version of the item |
| **Complex** | the awkward one — typically with metalwork |
| **Hero** | the showpiece — intricate stitching, special finishes, the lot |

Accept shorthand and move on. "All three", "hero only", "not for simple",
"none of them", "skip" are all complete answers. Do not ask him to repeat an
answer in a different form.

### Rules you must not break

1. **Never infer an answer he did not give.** Not from a similar question, not
   from what the category "obviously" needs, not from an earlier chunk. A
   question he did not reach stays unanswered.
2. **"Not sure" is an answer.** Record \`?\`. Do not push him to commit, and do
   not pick the safer-sounding option for him.
3. **Read the question wording as printed.** It is his own team's wording,
   typos included. Do not improve it — he will recognise it.
4. Read the guidance line only if he asks, or if he hesitates.
5. **Do not batch more than about five questions before confirming.** Read back
   the five you just recorded, briefly, and correct anything he objects to.
6. If he starts explaining WHY, capture it in the note. The reasons are worth
   as much as the ticks.
7. If he wants to add a question the sheets never ask, record it in the
   additions block. Do not talk him out of it.

### Answers

- **Yes** — cannot quote this level without it
- **No** — can quote without it; still needed later
- **N/A** — this question does not belong on that category's sheet at all
- **?** — unsure, or worth a conversation

### Exceptions

Most questions are asked by several categories, listed under each one. The
default answer covers all of them. Only if Matthew says a particular category
differs — "yes generally, but never for mirrors" — record an exception row for
that category. **Do not invent exceptions**, and do not go through the
categories one by one asking him to confirm each.`

function outputBlock(chunkKey, ids) {
  return `## What to output at the end

When the chunk is done — or when he stops — output **one fenced code block**,
exactly this shape, and nothing else inside it. Tab-separated. He will copy it
straight out.

\`\`\`
TGQ-ANSWERS pack=${PACK} chunk=${chunkKey}
id	simple	complex	hero	scope	note
${ids[0]}	No	Yes	Yes	all	only matters once there is metal
${ids[0]}	N/A	N/A	N/A	mirrors	never applies to a mirror
\`\`\`

- One row with \`scope\` = \`all\` for **every** question id in this chunk. If he
  did not reach one, still emit its row with \`-\` in all three level columns —
  an unanswered question must be visibly unanswered, never guessed and never
  quietly dropped.
- Extra rows only for exceptions, with the **category slug** in \`scope\`
  (several slugs separated by commas). An exception row overrides the \`all\`
  row for those categories.
- Level values: \`Yes\`, \`No\`, \`N/A\`, \`?\` or \`-\`. The note is free text, no
  tabs, and may be empty.
- The ids in this chunk are: ${ids.join(', ')}.

If he raised questions the cheat sheets do not ask, add a second block:

\`\`\`
TGQ-ADDITIONS pack=${PACK} chunk=${chunkKey}
categories	levels	question	why it is needed to quote
all	hero	<the question he wants added>	<his reason>
\`\`\`

Then stop. Do not summarise, and do not offer next steps — he is going to paste
the next file.`
}

function renderQuestion(q) {
  const lines = []
  lines.push(`### ${q.id}. ${q.prompt}`)
  lines.push('')

  const askedBy =
    q.slugs.length === categories.length
      ? '**Asked by:** all 17 categories'
      : `**Asked by:** ${q.slugs.length} of 17 — ${q.slugs.map((s) => categoryName.get(s)).join(', ')}`
  lines.push(askedBy)

  const variants = [...q.guidance.entries()].filter(([text]) => text !== '')
  if (variants.length === 1 && q.guidance.size === 1) {
    lines.push('')
    lines.push(`**Guidance on the sheet:** ${variants[0][0]}`)
  } else if (variants.length >= 1) {
    lines.push('')
    lines.push('**Guidance on the sheet** — the sheets word it differently:')
    for (const [text, slugs] of variants) {
      lines.push(`- ${text}  *(${slugs.map((s) => categoryName.get(s)).join(', ')})*`)
    }
  }

  const field = bwsFieldLabel(specFields, q.jsonId)
  lines.push('')
  lines.push(
    field
      ? `**Where the answer goes:** BWS ${field}. *Context only — the mapping is not what is being asked here.*`
      : '**Where the answer goes:** nowhere in BWS — this one is readiness, tracked in the tool only.',
  )
  lines.push('')
  return lines.join('\n')
}

function renderChunk(chunk, position) {
  const ids = chunk.questions.map((q) => q.id)
  return `# TGQ interview ${position} of ${chunks.length} — ${chunk.title}

*Paste this whole file into Claude, then start a voice chat. ${chunk.questions.length} questions. Pack ${PACK}.*

${chunk.blurb}

${RULES}

---

# The questions

${chunk.questions.map((q) => renderQuestion(q)).join('\n')}

---

${outputBlock(chunk.key, ids)}
`
}

// -- the brief -------------------------------------------------------------

const levelNameRows = categories.map((c) => `| ${c.name} | ${c.family} | | | |`).join('\n')

const brief = `# TGQ — read this first

*Pack ${PACK}. ${questions.length} questions, in ${chunks.length} files. Budget 20–30 minutes a file; they can be done on different days.*

## What is being asked

**TGQ is the point where we know enough to put a price on an item.** Not enough
to build it — enough to **quote** it. Everything else can still be TBC.

The Spec Builder already holds all 728 questions from the 17 cheat sheets, in
your own wording. What it does not know is which of them actually gate a quote.
That is the only thing being asked here.

## Why it is 62 questions and not 728

The 17 cheat sheets repeat each other. "Stitching spec" is on fifteen of them;
the whole commercial block is word-for-word identical on all seventeen. Asked
once per question, the entire matrix is **${questions.length} decisions**, and
the tool expands each answer back across every category that asks it.

Where one category genuinely differs, say so in passing — "yes, but never for
mirrors" — and that is recorded as an exception. You are not asked to walk the
categories one by one.

## How to do it

1. Open a new chat with Claude and turn on voice.
2. Paste **one** of the numbered files.
3. Talk through it. Shorthand is fine: "all three", "hero only", "none".
4. At the end Claude prints a block of text. Copy it and keep it — one per file.
5. Send the blocks back to Max. He runs them in and the tool is configured.

Each file repeats the rules, so you can do them in any order, on any day, in
separate chats. Nothing carries between them.

## The three levels

| | |
|---|---|
| **Simple** | the plain version of the item |
| **Complex** | the awkward one — typically with metalwork |
| **Hero** | the showpiece |

These are the names you used, and BWS already uses them too: the boilerplate
product codes come in \`, Simple\` / \`, with Metalwork\` pairs across upholstery
and \`Hero\` variants across cabinetry.

**If a category's three are called something else, fill this in** — or just say
so out loud in the first chat and Claude will record it.

| Category | Family | Level 1 | Level 2 | Level 3 |
|---|---|---|---|---|
${levelNameRows}

## The four answers

- **Yes** — we cannot quote that level without it
- **No** — we can quote without it; it is still needed later
- **N/A** — this question does not belong on that category's sheet at all
- **?** — unsure, or worth a conversation

**N/A is worth using.** Several questions sit on sheets they do not belong on —
the Consoles sheet asks for stitching and stud spec — and saying so here prunes
the checklist at the same time.

## What is NOT being asked

**Which BWS column an answer lands in.** Each question shows that, greyed, for
context. It is this repo's guess and reviewing it is a separate note — please
do not do it here, it turns a conversation into an audit.

**TG0 / TG1 / TG2.** Out of scope until the Panther export is judged correct.

## The files

${chunks.map((c, i) => `${i + 1}. **${String(i + 1).padStart(2, '0')}-${c.key}.md** — ${c.title}, ${c.questions.length} questions`).join('\n')}

## If something is missing

If quoting an item needs something none of these ${questions.length} questions
asks, say so when it comes up. Claude records it in a separate block. A question
that does not exist is worse than one asked at the wrong level.
`

// -- write -----------------------------------------------------------------

const outFlag = process.argv.indexOf('--out')
const outDir = outFlag !== -1 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : resolve(repoRoot, 'out', 'tgq-interview')
mkdirSync(outDir, { recursive: true })

writeFileSync(resolve(outDir, '00-read-this-first.md'), brief)
chunks.forEach((chunk, i) => {
  writeFileSync(resolve(outDir, `${String(i + 1).padStart(2, '0')}-${chunk.key}.md`), renderChunk(chunk, i + 1))
})

console.log(`questions      ${questions.length} distinct, from ${requirements.length} requirement rows`)
for (const [i, c] of chunks.entries()) {
  console.log(`  ${String(i + 1).padStart(2, '0')}-${c.key.padEnd(12)} ${String(c.questions.length).padStart(2)} questions`)
}
console.log(`\nwrote ${chunks.length + 1} files to ${outDir}`)
