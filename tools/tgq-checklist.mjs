// ==========================================================================
// tools/tgq-checklist.mjs -- build the TGQ checklist workbook for Matthew.
//
// TGQ is the pre-sale gate: "we know enough to quote". Nobody has authored it.
// `requirements.required_at_gate` is null on all 728 rows and there is no
// gates table, so this workbook is how the assignment gets made -- by the one
// person who can make it -- and then seeded back.
//
// It reads the SEED FILES, not the database, on purpose: the seed is the
// source of truth for the requirement matrix (CLAUDE.md, "the requirement
// matrix is seed data, not code"), it needs no DATABASE_URL, and the `Key`
// column it emits is `<category slug>:<sort_order>`, which is exactly the
// pair the re-seed keys on. A row's identity therefore survives Matthew
// sorting, filtering or re-ordering the sheet.
//
// The 17 "Project / commercial" questions are byte-identical in all 17
// categories -- asserted below, not assumed -- so they are hoisted onto their
// own sheet and answered once instead of seventeen times. That is the only
// editorial decision this script makes, and it is stated on the first sheet
// for Matthew to overturn.
//
//   node tools/tgq-checklist.mjs [--out <path.xlsx>]
// ==========================================================================

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import {
  repoRoot,
  SHARED_SECTION,
  readSpecFields,
  readCategories,
  readRequirements,
  assertSharedBlockIdentical,
  bwsFieldLabel as bwsField,
} from './lib/requirement-seed.mjs'

const specFields = readSpecFields()
const categories = readCategories()
const requirements = readRequirements()
const sharedReference = assertSharedBlockIdentical(requirements, categories)

const itemRows = requirements.filter((r) => r.section !== SHARED_SECTION)

// -- look and feel --------------------------------------------------------

const INK = 'FF1F2937'
const MUTED = 'FF6B7280'
const RULE = 'FFD1D5DB'
const HEADER_BG = 'FF1F2937'
const BAND_BG = 'FFF7F7F5'
const TICK_BG = 'FFFFFDF5'

const ANSWERS = ['Yes', 'No', 'N/A', '?']
const TICK_COLUMNS = ['Simple', 'Complex', 'Hero']

const titleStyle = { font: { name: 'Calibri', size: 16, bold: true, color: { argb: INK } } }
const noteStyle = { font: { name: 'Calibri', size: 11, color: { argb: MUTED } }, alignment: { wrapText: true, vertical: 'top' } }

function headerRow(sheet, rowNumber) {
  const row = sheet.getRow(rowNumber)
  row.height = 30
  row.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: RULE } } }
  })
}

// The workbook wants the short form -- `Dimensions (AH)` -- in a narrow grey
// column, where the shared helper spells "column" out for prose.
function bwsFieldLabel(jsonId) {
  const label = bwsField(specFields, jsonId)
  return label ? label.replace(' (column ', ' (') : ''
}

// The three tick cells on one row: colour by answer, and a fill that marks
// them as the part to touch. The dropdown is added ONCE per sheet, over the
// whole block -- see addAnswerDropdown.
function decorateTicks(sheet, rowNumber, firstCol, lastCol) {
  for (let c = firstCol; c <= lastCol; c += 1) {
    const cell = sheet.getRow(rowNumber).getCell(c)
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TICK_BG } }
    cell.border = { left: { style: 'hair', color: { argb: RULE } }, right: { style: 'hair', color: { argb: RULE } } }
  }
}

// Assigning `cell.dataValidation` per cell makes exceljs emit two OVERLAPPING
// sqref ranges for the same block, which Excel can treat as damage and offer
// to repair. One range, added once, emits one element.
function addValidation(sheet, range, validation) {
  sheet.dataValidations.add(range, validation)
}

function addAnswerDropdown(sheet, range) {
  addValidation(sheet, range, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${ANSWERS.join(',')}"`],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Not one of the four',
    error: 'Use Yes, No, N/A or ? — or leave it blank if you have not decided yet.',
  })
}

// cellIs/equal rather than containsText: Excel's containsText compiles to
// SEARCH(), where "?" is a single-character WILDCARD -- the "?" rule would
// then paint every answered cell amber.
function tickConditionalFormatting(sheet, range) {
  const rule = (answer, bg, fg, priority) => ({
    type: 'cellIs',
    operator: 'equal',
    formulae: [`"${answer}"`],
    priority,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: bg } }, font: { color: { argb: fg }, bold: true } },
  })
  sheet.addConditionalFormatting({
    ref: range,
    rules: [
      rule('Yes', 'FFD8F0DC', 'FF14532D', 1),
      rule('N/A', 'FFEDEDED', 'FF6B7280', 2),
      rule('?', 'FFFDF0CE', 'FF92400E', 3),
      rule('No', 'FFFFFFFF', 'FF9CA3AF', 4),
    ],
  })
}

const workbook = new ExcelJS.Workbook()
workbook.creator = 'Spec Builder — tools/tgq-checklist.mjs'
workbook.created = new Date()

// ==========================================================================
// Sheet 1 — Start here
// ==========================================================================

const intro = workbook.addWorksheet('Start here', { properties: { defaultRowHeight: 16 } })
intro.getColumn(1).width = 4
intro.getColumn(2).width = 104

const para = (text, style = {}) => {
  const row = intro.addRow(['', text])
  const cell = row.getCell(2)
  cell.alignment = { wrapText: true, vertical: 'top' }
  cell.font = { name: 'Calibri', size: 11, color: { argb: INK }, ...(style.font ?? {}) }
  if (style.height) row.height = style.height
  return row
}
const heading = (text) => {
  intro.addRow([])
  const row = intro.addRow(['', text])
  row.getCell(2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: INK } }
  return row
}

intro.addRow([])
const titleRow = intro.addRow(['', 'TGQ checklist — what do we need in order to quote?'])
titleRow.getCell(2).style = titleStyle
titleRow.height = 24
para('For Matthew. Generated from the 17 cheat sheets, ' + new Date().toISOString().slice(0, 10) + '.', { font: { color: { argb: MUTED } } })

heading('What we are asking')
para(
  'TGQ is the point where we know enough to put a price on an item. Not enough to build it — enough to quote it. ' +
    'Everything else can still be TBC at that point.',
)
para(
  'The Spec Builder already holds all 728 cheat-sheet questions, in your sheets’ own wording. What it does not know is ' +
    'which of them actually gate a quote. Ticking that in is this workbook.',
)

heading('The three levels')
para(
  'You described a three-level system per category — simple sofa / complex sofa / hero sofa, or simple table / table with ' +
    'metalwork / hero table. Each question therefore gets three ticks, one per level. A hero item needs more known before ' +
    'we can price it; a simple one needs less.',
)
para(
  'The level names are on the "Level names" sheet, pre-filled with Simple / Complex / Hero and, where BWS has its own ' +
    'boilerplate variants for that category, those names beside them. Correct them — the names are yours, not ours.',
)

heading('How to fill it in')
para('Work on the "Checklist" sheet. Filter the Category column to one category and work down it. Four answers:')
para('Yes  —  we cannot quote this level without it', { font: { bold: true, color: { argb: 'FF14532D' } } })
para('No  —  we can quote without it; it is still needed later', { font: { bold: true, color: { argb: 'FF6B7280' } } })
para('N/A  —  this question does not belong on this category’s sheet at all', { font: { bold: true, color: { argb: 'FF6B7280' } } })
para('?  —  unsure, or worth a conversation', { font: { bold: true, color: { argb: 'FF92400E' } } })
para('Blank means not looked at yet, which is why blank and "No" are different. The Notes column is free text and we read it.')

heading('Two things to know before you start')
para(
  '1. The 17 commercial questions are on their own sheet. TOE agreement, client contact list, floor plans, deposit, FSC, ' +
    'prototype, access check and the rest are word-for-word identical on all 17 cheat sheets, so asking you seventeen times ' +
    'would be ceremony. They are on "Every category", answered once, and they still get the three level ticks. If any of them ' +
    'genuinely does vary by category, say so in its Notes and we will split it back out.',
)
para(
  '2. Which BWS column an answer lands in is our guess, not yours. The "BWS field" column shows where each answer would be ' +
    'written at export. It is shown for context only — you are not being asked to check it here. That is the separate ' +
    'four-question note.',
)

heading('If a question is missing')
para(
  'The last sheet is empty and yours. If quoting a hero item needs something no cheat sheet asks for, write it there. ' +
    'A question that does not exist is worse than one that is asked at the wrong level.',
)

heading('What happens next')
para(
  'Your ticks are seeded straight back into the tool, keyed on the Key column. The Spec Builder then shows, for any item, ' +
    'what is still outstanding before it can be quoted — instead of the flat confirmed / TBC / missing count it shows today.',
)

heading('Progress')
const progressHeader = intro.addRow(['', 'Sheet', 'Rows', 'Simple', 'Complex', 'Hero'])
const progressHeaderRow = progressHeader.number
;['', 'Sheet', 'Rows', 'Simple', 'Complex', 'Hero'].forEach((_, i) => {
  if (i === 0) return
  const cell = intro.getRow(progressHeaderRow).getCell(i + 1)
  cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } }
  cell.border = { bottom: { style: 'thin', color: { argb: RULE } } }
})
intro.getColumn(2).width = 104
for (const col of [3, 4, 5, 6]) intro.getColumn(col).width = 11

// filled in after the sheets exist, below

// ==========================================================================
// Sheet 2 — Every category (the hoisted commercial block)
// ==========================================================================

const shared = workbook.addWorksheet('Every category', {
  views: [{ state: 'frozen', ySplit: 4 }],
  properties: { defaultRowHeight: 16 },
})

shared.columns = [
  { key: 'key', width: 10 },
  { key: 'section', width: 20 },
  { key: 'question', width: 60 },
  { key: 'guidance', width: 34 },
  { key: 'bws', width: 24 },
  { key: 'simple', width: 11 },
  { key: 'complex', width: 11 },
  { key: 'hero', width: 11 },
  { key: 'notes', width: 46 },
]

shared.getCell('A1').value = 'Every category — the commercial questions'
shared.getCell('A1').style = titleStyle
shared.getRow(1).height = 24
shared.mergeCells('A2:I2')
shared.getCell('A2').value =
  'These 17 questions are word-for-word identical on all 17 cheat sheets, so they are asked once here rather than 17 times ' +
  'on the Checklist sheet. If one of them does vary by category, say which in its Notes and we will split it back out.'
shared.getCell('A2').style = noteStyle
shared.getRow(2).height = 32

shared.addRow([])
shared.addRow(['Key', 'Section', 'Question', 'Guidance on the sheet', 'BWS field', 'Simple', 'Complex', 'Hero', 'Notes'])
headerRow(shared, 4)

sharedReference.forEach((r, i) => {
  const row = shared.addRow([
    `ALL:${r.sort}`,
    r.section,
    r.prompt,
    r.help ?? '',
    bwsFieldLabel(r.jsonId),
    '',
    '',
    '',
    '',
  ])
  row.getCell(1).font = { name: 'Calibri', size: 9, color: { argb: MUTED } }
  row.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
  row.getCell(3).font = { name: 'Calibri', size: 11, color: { argb: INK } }
  row.getCell(4).font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
  row.getCell(5).font = { name: 'Calibri', size: 9, color: { argb: MUTED } }
  for (const c of [2, 3, 4, 5, 9]) row.getCell(c).alignment = { wrapText: true, vertical: 'top' }
  if (i % 2 === 1) {
    for (const c of [1, 2, 3, 4, 5, 9]) {
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } }
    }
  }
  decorateTicks(shared, row.number, 6, 8)
})

const sharedLast = shared.rowCount
shared.autoFilter = { from: { row: 4, column: 1 }, to: { row: sharedLast, column: 9 } }
addAnswerDropdown(shared, `F5:H${sharedLast}`)
tickConditionalFormatting(shared, `F5:H${sharedLast}`)

// ==========================================================================
// Sheet 3 — Checklist (the 439 item-level questions)
// ==========================================================================

const checklist = workbook.addWorksheet('Checklist', {
  views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }],
  properties: { defaultRowHeight: 16 },
})

checklist.columns = [
  { key: 'key', width: 26 },
  { key: 'category', width: 26 },
  { key: 'family', width: 12 },
  { key: 'section', width: 20 },
  { key: 'question', width: 58 },
  { key: 'guidance', width: 34 },
  { key: 'bws', width: 24 },
  { key: 'simple', width: 11 },
  { key: 'complex', width: 11 },
  { key: 'hero', width: 11 },
  { key: 'notes', width: 46 },
]

checklist.getCell('A1').value = 'Checklist — is this needed before we can quote?'
checklist.getCell('A1').style = titleStyle
checklist.getRow(1).height = 24
checklist.mergeCells('A2:K2')
checklist.getCell('A2').value =
  'Filter Category to one category and work down it. Yes = cannot quote without it · No = can quote without it · ' +
  'N/A = does not apply to this category · ? = unsure. Blank means not looked at yet.'
checklist.getCell('A2').style = noteStyle
checklist.getRow(2).height = 28

checklist.addRow([])
checklist.addRow([
  'Key',
  'Category',
  'Family',
  'Section',
  'Question',
  'Guidance on the sheet',
  'BWS field',
  'Simple',
  'Complex',
  'Hero',
  'Notes',
])
headerRow(checklist, 4)

let band = 0
for (const cat of categories) {
  const rows = itemRows.filter((r) => r.slug === cat.slug).sort((a, b) => a.sort - b.sort)
  band += 1
  for (const r of rows) {
    const row = checklist.addRow([
      `${r.slug}:${r.sort}`,
      cat.name,
      cat.family,
      r.section,
      r.prompt,
      r.help ?? '',
      bwsFieldLabel(r.jsonId),
      '',
      '',
      '',
      '',
    ])
    row.getCell(1).font = { name: 'Calibri', size: 9, color: { argb: MUTED } }
    row.getCell(2).font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } }
    row.getCell(3).font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
    row.getCell(4).font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
    row.getCell(5).font = { name: 'Calibri', size: 11, color: { argb: INK } }
    row.getCell(6).font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
    row.getCell(7).font = { name: 'Calibri', size: 9, color: { argb: MUTED } }
    for (const c of [2, 4, 5, 6, 7, 11]) row.getCell(c).alignment = { wrapText: true, vertical: 'top' }
    if (band % 2 === 0) {
      for (const c of [1, 2, 3, 4, 5, 6, 7, 11]) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } }
      }
    }
    decorateTicks(checklist, row.number, 8, 10)
  }
}

const checklistLast = checklist.rowCount
checklist.autoFilter = { from: { row: 4, column: 1 }, to: { row: checklistLast, column: 11 } }
addAnswerDropdown(checklist, `H5:J${checklistLast}`)
tickConditionalFormatting(checklist, `H5:J${checklistLast}`)

// ==========================================================================
// Sheet 4 — Level names
// ==========================================================================

// BWS's own boilerplate variants, captured read-only on 2026-09-14. Shown as
// EVIDENCE of the vocabulary BWS already uses, not as an answer: matching a
// boilerplate to a cheat-sheet category is a judgement, and where this script
// is unsure it says nothing rather than guessing.
const BOILERPLATE_VARIANTS = {
  'consoles-desks-dressing-tables': 'BWS has: Consoles · Consoles, Hero · Desks and Dressing Tables · Desks and Dressing Tables, Hero',
  'dining-tables': 'BWS has: Dining Tables (no variants)',
  'drinks-cabinets-service-stations': 'BWS has: Drinks Cabinets and Service Stations (no variants)',
  mirrors: 'BWS has: Mirrors · Mirrors, Hero',
  'shelves-bookcase': 'BWS has: Shelves and Wardrobes (no variants)',
  'side-coffee-bedside-tables': 'BWS has: Bedside Tables · Bedside Tables, Hero · Coffee Tables · Coffee Tables, Hero · Side Tables',
  'sideboards-dressers': 'BWS has: Sideboards and Dressers, Simple · Sideboards and Dressers, Hero',
  wardrobes: 'BWS has: Shelves and Wardrobes (no variants)',
  'armchairs-benches-stools-sofas':
    'BWS has: Armchair and Occasional Chairs Simple / with Metalwork · Benches Simple / with Metalwork · Stools Simple / with Metalwork · Sofa Simple / with Metalwork',
  banquettes: 'BWS has: Banquettes, Simple · Banquettes, with Metalwork',
  'bar-counter-stools': 'BWS has: Bar Stools, Simple · Bar Stools, with Metalwork',
  'beds-bedbases': 'BWS has: Beds and Headboards, Simple · Beds and Headboards, with Metalwork',
  'desk-chair-cinema-chair': 'BWS has: Dining and Desk Chairs Simple / with Metal · Cinema Chairs and Sofas',
  'dining-chair': 'BWS has: Dining and Desk Chairs, Simple · Dining and Desk Chairs, with Metal',
  'headboards-wall-fixed': 'BWS has: Beds and Headboards, Simple · Beds and Headboards, with Metalwork',
  'ottomans-storage-boxes': 'BWS has: Ottomans and Storage Boxes, Simple · Ottomans and Storage Boxes, with Metalwork',
  'sofas-bed-daybeds': 'BWS has: Sofa Simple / with Metalwork · Daybed Simple / with Metal',
}

const levels = workbook.addWorksheet('Level names', { views: [{ state: 'frozen', ySplit: 4 }] })
levels.columns = [
  { key: 'category', width: 32 },
  { key: 'family', width: 12 },
  { key: 'l1', width: 20 },
  { key: 'l2', width: 24 },
  { key: 'l3', width: 20 },
  { key: 'bws', width: 62 },
  { key: 'notes', width: 40 },
]

levels.getCell('A1').value = 'Level names — what are the three called, per category?'
levels.getCell('A1').style = titleStyle
levels.getRow(1).height = 24
levels.mergeCells('A2:G2')
levels.getCell('A2').value =
  'Pre-filled with Simple / Complex / Hero. Overwrite them with what you actually call these. The right-hand column shows ' +
  'the variants BWS itself already has for that category, read-only, on 2026-09-14 — shown as evidence of the existing ' +
  'vocabulary, not as an answer. Where a category has only two real levels, delete the third name and we will drop the column.'
levels.getCell('A2').style = noteStyle
levels.getRow(2).height = 40

levels.addRow([])
levels.addRow(['Category', 'Family', 'Level 1', 'Level 2', 'Level 3', 'What BWS calls them today', 'Notes'])
headerRow(levels, 4)

categories.forEach((cat, i) => {
  const row = levels.addRow([cat.name, cat.family, 'Simple', 'Complex', 'Hero', BOILERPLATE_VARIANTS[cat.slug] ?? '', ''])
  row.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK } }
  row.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: MUTED } }
  for (const c of [3, 4, 5]) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TICK_BG } }
    row.getCell(c).alignment = { horizontal: 'center' }
  }
  row.getCell(6).font = { name: 'Calibri', size: 9, color: { argb: MUTED } }
  for (const c of [1, 6, 7]) row.getCell(c).alignment = { wrapText: true, vertical: 'top' }
  if (i % 2 === 1) {
    for (const c of [1, 2, 6, 7]) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } }
  }
})

// ==========================================================================
// Sheet 5 — Anything missing
// ==========================================================================

const missing = workbook.addWorksheet('Anything missing', { views: [{ state: 'frozen', ySplit: 4 }] })
missing.columns = [
  { key: 'category', width: 30 },
  { key: 'level', width: 22 },
  { key: 'question', width: 60 },
  { key: 'why', width: 60 },
  { key: 'bws', width: 30 },
]

missing.getCell('A1').value = 'Anything missing — questions no cheat sheet asks'
missing.getCell('A1').style = titleStyle
missing.getRow(1).height = 24
missing.mergeCells('A2:E2')
missing.getCell('A2').value =
  'Empty on purpose. If quoting an item needs something the 728 questions never ask, write it here. One row per question. ' +
  'If it applies to every category, write "all" in the Category column.'
missing.getCell('A2').style = noteStyle
missing.getRow(2).height = 28

missing.addRow([])
missing.addRow(['Category', 'Which levels', 'The question to add', 'Why it is needed to quote', 'Where the answer belongs in BWS, if you know'])
headerRow(missing, 4)

const categoryNames = categories.map((c) => c.name)
addValidation(missing, 'A5:A44', {
  type: 'list',
  allowBlank: true,
  formulae: [`"all,${categoryNames.join(',')}"`],
  showErrorMessage: false,
})
for (let i = 5; i <= 44; i += 1) {
  const row = missing.getRow(i)
  for (const c of [1, 2, 3, 4, 5]) {
    row.getCell(c).alignment = { wrapText: true, vertical: 'top' }
    row.getCell(c).border = { bottom: { style: 'hair', color: { argb: RULE } } }
    if (i % 2 === 0) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } }
  }
  row.commit()
}

// ==========================================================================
// Back-fill the progress table on Start here
// ==========================================================================

const progressRows = [
  { label: 'Every category', sheet: 'Every category', first: 5, last: sharedLast, cols: ['F', 'G', 'H'] },
  { label: 'Checklist', sheet: 'Checklist', first: 5, last: checklistLast, cols: ['H', 'I', 'J'] },
]
for (const p of progressRows) {
  const total = p.last - p.first + 1
  const row = intro.addRow(['', p.label, total])
  p.cols.forEach((col, i) => {
    row.getCell(4 + i).value = {
      formula: `COUNTA('${p.sheet}'!${col}${p.first}:${col}${p.last})`,
    }
  })
  row.getCell(2).font = { name: 'Calibri', size: 11, color: { argb: INK } }
  for (let c = 3; c <= 6; c += 1) {
    row.getCell(c).alignment = { horizontal: 'center' }
    row.getCell(c).font = { name: 'Calibri', size: 11, color: { argb: MUTED } }
  }
}
intro.addRow([])
const progressNote = intro.addRow(['', 'Answered counts refresh when the file is opened in Excel.'])
progressNote.getCell(2).style = noteStyle

// ==========================================================================

const outFlagIndex = process.argv.indexOf('--out')
const outPath =
  outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
    ? resolve(process.argv[outFlagIndex + 1])
    : resolve(repoRoot, 'out', `TGQ-checklist-${new Date().toISOString().slice(0, 10)}.xlsx`)

mkdirSync(dirname(outPath), { recursive: true })
await workbook.xlsx.writeFile(outPath)

console.log(`categories      ${categories.length}`)
console.log(`questions       ${requirements.length} total`)
console.log(`  hoisted       ${sharedReference.length} commercial questions, identical in all 17 categories`)
console.log(`  on Checklist  ${itemRows.length} item-level rows`)
console.log(`tick decisions  ${(sharedReference.length + itemRows.length) * TICK_COLUMNS.length}`)
console.log(`\nwrote ${outPath}`)
