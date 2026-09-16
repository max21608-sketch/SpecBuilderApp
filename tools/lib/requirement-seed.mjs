// ==========================================================================
// tools/lib/requirement-seed.mjs -- read the requirement matrix out of the
// seed files, for the tools that build things for a human to fill in.
//
// The seed is the source of truth for the matrix (CLAUDE.md, "the requirement
// matrix is seed data, not code"), so a tool that reads it needs no
// DATABASE_URL and cannot be affected by the state of any environment. One
// copy of the parsing, because two would drift and the two tools have to
// agree on question identity or an answer lands on the wrong question.
//
// Row shape is asserted, not assumed: the regexes below track the seed's
// literal formatting, so a re-formatted seed must fail loudly rather than
// silently parse half the rows.
// ==========================================================================

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(resolve(repoRoot, p), 'utf8')
const unquote = (s) => (s === 'NULL' ? null : s.slice(1, -1).replace(/''/g, "'"))

export const SHARED_SECTION = 'Project / commercial'

// The order the cheat sheets themselves use, and the order every tool renders.
export const SECTION_ORDER = [
  'Project / commercial',
  'Design intent',
  'Dimensions',
  'Material, finish, substrate',
  'Glass and mirror',
  'Stone',
  'Metalwork',
  'Build details',
]

export function readSpecFields() {
  const re = /\((\d+), '([A-Z]{1,2})', '((?:[^']|'')*)', '(?:[^']|'')*', '((?:[^']|'')*)', \d+, 'seed', 'seed'\)/g
  const fields = new Map()
  const sql = read('db/seed/0001_spec_fields.sql')
  let m
  while ((m = re.exec(sql))) {
    fields.set(Number(m[1]), { jsonId: Number(m[1]), column: m[2], name: m[3].replace(/''/g, "'").trim(), family: m[4] })
  }
  if (fields.size !== 56) throw new Error(`expected 56 BWS spec fields, parsed ${fields.size}`)
  return fields
}

export function readCategories() {
  const re = /\('([a-z0-9-]+)', '(cabinetry|upholstery)', '((?:[^']|'')*)', (true|false), (\d+), 'seed', 'seed'\)/g
  const cats = []
  const sql = read('db/seed/0002_item_categories.sql')
  let m
  while ((m = re.exec(sql))) cats.push({ slug: m[1], family: m[2], name: m[3].replace(/''/g, "'"), sort: Number(m[5]) })
  if (cats.length !== 17) throw new Error(`expected 17 item categories, parsed ${cats.length}`)
  return cats.sort((a, b) => a.sort - b.sort)
}

export function readRequirements() {
  const re =
    /\(\(select id from item_categories where slug = '([^']+)'\), '(spec_field|readiness)', (?:NULL|\(select id from spec_fields where json_id = (\d+)\)), ('(?:[^']|'')*'), ('(?:[^']|'')*'|NULL), ('(?:[^']|'')*'), (\d+), 'seed', 'seed'\)/g
  const rows = []
  const sql = read('db/seed/0003_requirements.sql')
  let m
  while ((m = re.exec(sql))) {
    rows.push({
      slug: m[1],
      kind: m[2],
      jsonId: m[3] ? Number(m[3]) : null,
      prompt: unquote(m[4]),
      help: unquote(m[5]),
      section: unquote(m[6]),
      sort: Number(m[7]),
    })
  }
  if (rows.length !== 728) throw new Error(`expected 728 requirements, parsed ${rows.length} -- the seed's row shape changed`)
  return rows
}

// The hoist and the interview both rest on the commercial block being the same
// everywhere. Checked, never assumed: a cheat sheet revision that makes one
// category differ must stop the build rather than quietly lose the difference.
export function assertSharedBlockIdentical(requirements, categories) {
  const signature = (rows) => JSON.stringify(rows.map((r) => [r.prompt, r.help, r.jsonId]))
  const blocks = categories.map((c) => ({
    slug: c.slug,
    rows: requirements.filter((r) => r.slug === c.slug && r.section === SHARED_SECTION),
  }))
  const reference = blocks[0].rows
  const divergent = blocks.filter((b) => signature(b.rows) !== signature(reference))
  if (divergent.length) {
    throw new Error(
      `the "${SHARED_SECTION}" block is no longer identical across categories (${divergent
        .map((b) => b.slug)
        .join(', ')}). Treating it as shared would hide a real difference -- fix the tools before shipping.`,
    )
  }
  return reference
}

// 728 rows are 62 distinct QUESTIONS asked by between 1 and 17 categories.
// That collapse is the whole point of the interview: a question asked of 17
// categories is one decision, not seventeen. Ids are assigned in section
// order then first-appearance order, and every consumer re-derives them from
// the same seed, so an answer sheet is checked against the pack it came from
// rather than trusted.
export function distinctQuestions(requirements) {
  const byKey = new Map()
  for (const r of requirements) {
    const key = `${r.section}␟${r.prompt}`
    if (!byKey.has(key)) {
      byKey.set(key, { section: r.section, prompt: r.prompt, jsonId: r.jsonId, slugs: [], guidance: new Map() })
    }
    const q = byKey.get(key)
    q.slugs.push(r.slug)
    if (r.jsonId !== q.jsonId) {
      throw new Error(`"${r.prompt}" maps to more than one BWS field (${q.jsonId} and ${r.jsonId})`)
    }
    const help = r.help ?? ''
    if (!q.guidance.has(help)) q.guidance.set(help, [])
    q.guidance.get(help).push(r.slug)
  }
  const ordered = [...byKey.values()].sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
    return s !== 0 ? s : 0
  })
  return ordered.map((q, i) => ({ ...q, id: `Q${String(i + 1).padStart(2, '0')}` }))
}

export function bwsFieldLabel(specFields, jsonId) {
  if (jsonId == null) return null
  const f = specFields.get(jsonId)
  return f ? `${f.name} (column ${f.column})` : `field ${jsonId}, not in the register`
}

// The interview pack addresses questions by a POSITIONAL id (Q01..Q62). If the
// seed is revised between handing the pack out and reading the answers back,
// those ids shift and every answer after the change lands on the wrong
// question -- silently, and in the direction of a wrong gate rather than a
// missing one. So the pack carries a fingerprint of the exact question list it
// was built from, and the reader refuses an answer sheet that does not match.
export function questionFingerprint(questions) {
  const canonical = questions.map((q) => [q.id, q.section, q.prompt, q.slugs.join(',')])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 8)
}
