// ==========================================================================
// tools/tgq-answers.mjs -- read the blocks back from Matthew's voice chats.
//
// Input is whatever he pastes or forwards: one file containing the
// TGQ-ANSWERS blocks from any number of chunks, fences and chatter included.
// Output is the expanded grid -- one row per requirement per level -- and a
// summary a person can read before anything is seeded.
//
// This deliberately does NOT write to the database. Turning the answers into
// behaviour is a migration plus a re-seed, reviewed, like every other
// cheat-sheet revision; this step exists so that what Matthew said can be
// checked against what the tool understood, BEFORE either happens.
//
// What it refuses, and why each one matters:
//   - a pack fingerprint that is not this seed's. Question ids are positional,
//     so a revised seed shifts them and every later answer lands on the wrong
//     question -- in the direction of a wrong gate, not a missing one.
//   - an exception naming a category that does not ask that question. It means
//     the model invented the exception, or misheard which question was live.
//   - a value that is not one of the five. Blank is not "No".
//
// What it reports rather than refuses: questions nobody answered. An
// unanswered question must stay visibly unanswered -- that is the whole point
// of `-` -- so it is counted and named, and the grid simply has no row for it.
//
//   node tools/tgq-answers.mjs <file-with-the-blocks> [--out <dir>]
// ==========================================================================

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  repoRoot,
  readCategories,
  readRequirements,
  assertSharedBlockIdentical,
  distinctQuestions,
  questionFingerprint,
} from './lib/requirement-seed.mjs'

const categories = readCategories()
const requirements = readRequirements()
assertSharedBlockIdentical(requirements, categories)
const questions = distinctQuestions(requirements)
const fingerprint = questionFingerprint(questions)

const byId = new Map(questions.map((q) => [q.id, q]))
const categoryName = new Map(categories.map((c) => [c.slug, c.name]))
const LEVELS = ['simple', 'complex', 'hero']
const VALUES = new Map([
  ['yes', 'Yes'],
  ['no', 'No'],
  ['n/a', 'N/A'],
  ['na', 'N/A'],
  ['?', '?'],
  ['-', '-'],
  ['', '-'],
])

const inputPath = process.argv[2]
if (!inputPath || inputPath.startsWith('--')) {
  console.error('usage: node tools/tgq-answers.mjs <file-with-the-blocks> [--out <dir>]')
  process.exit(2)
}
const outFlag = process.argv.indexOf('--out')
const outDir = outFlag !== -1 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : resolve(repoRoot, 'out', 'tgq-answers')

const source = readFileSync(resolve(inputPath), 'utf8')

// -- parse -----------------------------------------------------------------
//
// A voice chat may return a clean TSV block or a markdown table, whatever the
// brief asked for. Both are accepted: refusing a legible answer on formatting
// would send Matthew back to re-run a conversation he has already had.

const problems = []
const answerRows = []
const additionRows = []

function splitCells(line) {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim())
  if (line.trim().startsWith('|')) {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((s) => s.trim())
  }
  return null
}

const lines = source.split(/\r?\n/)
let block = null
for (const [i, raw] of lines.entries()) {
  const line = raw.trim()
  const start = /^TGQ-(ANSWERS|ADDITIONS)\s+pack=(\S+)\s+chunk=(\S+)/.exec(line)
  if (start) {
    block = { kind: start[1], pack: start[2], chunk: start[3], line: i + 1, seenHeader: false }
    continue
  }
  if (!block) continue
  if (line === '```' || line === '') {
    if (line === '```') block = null
    continue
  }
  const cells = splitCells(raw)
  if (!cells) {
    block = null
    continue
  }
  if (/^-+$/.test(cells[0] ?? '')) continue // markdown table rule row
  if (!block.seenHeader && /^id$/i.test(cells[0] ?? '')) {
    block.seenHeader = true
    continue
  }
  if (!block.seenHeader && /^categor/i.test(cells[0] ?? '')) {
    block.seenHeader = true
    continue
  }
  if (block.kind === 'ANSWERS') {
    answerRows.push({ pack: block.pack, chunk: block.chunk, line: i + 1, cells })
  } else {
    additionRows.push({ pack: block.pack, chunk: block.chunk, line: i + 1, cells })
  }
}

if (!answerRows.length) {
  console.error(`no TGQ-ANSWERS rows found in ${inputPath}.`)
  console.error('Expected a line reading  TGQ-ANSWERS pack=<date>-<hash> chunk=<name>  followed by tab-separated rows.')
  process.exit(1)
}

// -- the fingerprint gate --------------------------------------------------

const packs = [...new Set(answerRows.map((r) => r.pack))]
const wrongPack = packs.filter((p) => !p.endsWith(`-${fingerprint}`))
if (wrongPack.length) {
  console.error(`REFUSED. These answers were given against a different question list: ${wrongPack.join(', ')}`)
  console.error(`This seed's fingerprint is ${fingerprint}.`)
  console.error('')
  console.error('Question ids are positional, so a revised seed shifts them and answers would land on the wrong')
  console.error('questions. Either check out the seed those packs were built from, or re-issue the pack.')
  process.exit(1)
}

// -- validate and collect --------------------------------------------------

/** questionId -> { default: [v,v,v], note, exceptions: Map<slug, {values, note}> } */
const answers = new Map()

for (const row of answerRows) {
  const [id, simple, complex, hero, scope = 'all', note = ''] = row.cells
  const q = byId.get((id ?? '').toUpperCase())
  if (!q) {
    problems.push(`line ${row.line}: unknown question id ${JSON.stringify(id)}`)
    continue
  }
  const values = [simple, complex, hero].map((v) => VALUES.get((v ?? '').trim().toLowerCase()))
  if (values.some((v) => v === undefined)) {
    problems.push(
      `line ${row.line} (${q.id}): ${JSON.stringify([simple, complex, hero].join(' / '))} is not four answers plus "-". ` +
        'Use Yes, No, N/A, ? or - .',
    )
    continue
  }
  if (!answers.has(q.id)) answers.set(q.id, { default: null, note: '', exceptions: new Map() })
  const entry = answers.get(q.id)
  const scopeText = (scope ?? 'all').trim().toLowerCase()

  if (scopeText === 'all' || scopeText === '') {
    if (entry.default) problems.push(`line ${row.line} (${q.id}): a second "all" row for the same question`)
    entry.default = values
    entry.note = note ?? ''
    continue
  }
  for (const slug of scopeText.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
    if (!categoryName.has(slug)) {
      problems.push(`line ${row.line} (${q.id}): ${JSON.stringify(slug)} is not a category slug`)
      continue
    }
    if (!q.slugs.includes(slug)) {
      problems.push(
        `line ${row.line} (${q.id}): ${categoryName.get(slug)} does not ask this question, so it cannot be an exception to it. ` +
          'This usually means the exception was invented rather than said.',
      )
      continue
    }
    entry.exceptions.set(slug, { values, note: note ?? '' })
  }
}

if (problems.length) {
  console.error(`REFUSED. ${problems.length} problem${problems.length === 1 ? '' : 's'} in ${inputPath}:\n`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nNothing was written. Fix the block, or ask for the chunk to be re-run, and try again.')
  process.exit(1)
}

// -- expand ----------------------------------------------------------------

const requirementIndex = new Map()
for (const r of requirements) requirementIndex.set(`${r.slug}␟${r.section}␟${r.prompt}`, r)

const grid = []
const unanswered = []

for (const q of questions) {
  const entry = answers.get(q.id)
  if (!entry || !entry.default) {
    unanswered.push({ q, reason: entry ? 'only exceptions were given, no general answer' : 'not in any block' })
    continue
  }
  if (entry.default.every((v) => v === '-')) {
    unanswered.push({ q, reason: 'answered "-" — not reached in the conversation' })
    continue
  }
  for (const slug of q.slugs) {
    const override = entry.exceptions.get(slug)
    const values = override ? override.values : entry.default
    const note = override ? override.note : entry.note
    const req = requirementIndex.get(`${slug}␟${q.section}␟${q.prompt}`)
    if (!req) throw new Error(`no requirement row for ${slug} / ${q.prompt}`)
    LEVELS.forEach((level, i) => {
      if (values[i] === '-') return
      grid.push({
        key: `${slug}:${req.sort}`,
        categorySlug: slug,
        category: categoryName.get(slug),
        sortOrder: req.sort,
        questionId: q.id,
        section: q.section,
        prompt: q.prompt,
        level,
        value: values[i],
        exception: override ? 'yes' : '',
        note,
      })
    })
  }
}

// -- write -----------------------------------------------------------------

mkdirSync(outDir, { recursive: true })

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const header = ['key', 'category_slug', 'category', 'sort_order', 'question_id', 'section', 'prompt', 'level', 'value', 'exception', 'note']
const csv = [header.join(','), ...grid.map((r) => header.map((h) => csvCell(r[h.replace(/_(.)/g, (_, c) => c.toUpperCase())] ?? r[h])).join(','))].join('\n')
writeFileSync(resolve(outDir, 'expanded.csv'), csv + '\n')

const required = (level) => grid.filter((r) => r.level === level && r.value === 'Yes')
const perCategory = categories.map((c) => ({
  name: c.name,
  simple: grid.filter((r) => r.categorySlug === c.slug && r.level === 'simple' && r.value === 'Yes').length,
  complex: grid.filter((r) => r.categorySlug === c.slug && r.level === 'complex' && r.value === 'Yes').length,
  hero: grid.filter((r) => r.categorySlug === c.slug && r.level === 'hero' && r.value === 'Yes').length,
  na: grid.filter((r) => r.categorySlug === c.slug && r.level === 'simple' && r.value === 'N/A').length,
}))

const exceptions = questions
  .filter((q) => answers.get(q.id)?.exceptions.size)
  .flatMap((q) =>
    [...answers.get(q.id).exceptions.entries()].map(
      ([slug, e]) => `| ${q.id} | ${q.prompt} | ${categoryName.get(slug)} | ${e.values.join(' / ')} | ${e.note} |`,
    ),
  )

const unsure = questions.filter((q) => answers.get(q.id)?.default?.includes('?'))

const summary = `# TGQ answers — what came back

*Read from \`${inputPath}\` on ${new Date().toISOString().slice(0, 10)}. Pack fingerprint \`${fingerprint}\`.*

Nothing has been seeded. This is the check before that happens.

## Coverage

| | |
|---|---|
| Questions in the pack | ${questions.length} |
| Answered | ${questions.length - unanswered.length} |
| **Outstanding** | **${unanswered.length}** |
| Rows produced | ${grid.length} of a possible ${requirements.length * LEVELS.length} |
| Required to quote — simple / complex / hero | ${required('simple').length} / ${required('complex').length} / ${required('hero').length} |
| Marked N/A | ${grid.filter((r) => r.value === 'N/A').length / LEVELS.length} questions × categories |

${
  unanswered.length
    ? `## Still outstanding\n\nThese have no answer and no row in the grid. They are not "No".\n\n${unanswered
        .map((u) => `- **${u.q.id}** ${u.q.prompt} — *${u.reason}*`)
        .join('\n')}\n`
    : '## Still outstanding\n\nNone — every question in the pack came back with an answer.\n'
}
${unsure.length ? `## Flagged unsure (\`?\`)\n\nWorth a conversation before these are seeded.\n\n${unsure.map((q) => `- **${q.id}** ${q.prompt}`).join('\n')}\n` : ''}
${
  exceptions.length
    ? `## Exceptions he named\n\n| Question | | Category | Simple / Complex / Hero | Note |\n|---|---|---|---|---|\n${exceptions.join('\n')}\n`
    : '## Exceptions he named\n\nNone — every answer applies to all the categories that ask it.\n'
}
## Per category — how many questions gate a quote

| Category | Simple | Complex | Hero | Marked N/A |
|---|---|---|---|---|
${perCategory.map((p) => `| ${p.name} | ${p.simple} | ${p.complex} | ${p.hero} | ${p.na} |`).join('\n')}

${
  additionRows.length
    ? `## Questions he wants added\n\nNot in the 728. Each needs a home in the matrix before it can be asked.\n\n| Categories | Levels | Question | Why |\n|---|---|---|---|\n${additionRows
        .map((r) => `| ${r.cells.slice(0, 4).join(' | ')} |`)
        .join('\n')}\n`
    : ''
}
## What happens next

1. Read the outstanding and unsure lists above with Matthew, if there are any.
2. A migration adds the level dimension to \`requirements\` — shape decided now
   the answers exist, not before.
3. A re-seed carries \`expanded.csv\`. No application logic moves.
4. An item's **level** still has to be settable on a record, the way a category
   is. Until it is, a TGQ rule has nothing to read.
`

writeFileSync(resolve(outDir, 'summary.md'), summary)

console.log(`read           ${answerRows.length} answer rows from ${inputPath}`)
console.log(`questions      ${questions.length - unanswered.length} of ${questions.length} answered`)
if (unanswered.length) console.log(`  outstanding  ${unanswered.map((u) => u.q.id).join(', ')}`)
if (unsure.length) console.log(`  unsure       ${unsure.map((q) => q.id).join(', ')}`)
console.log(`exceptions     ${exceptions.length}`)
console.log(`grid           ${grid.length} rows`)
console.log(`\nwrote ${resolve(outDir, 'expanded.csv')}`)
console.log(`      ${resolve(outDir, 'summary.md')}`)
