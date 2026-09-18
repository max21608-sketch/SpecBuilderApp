---
name: new-screen
description: Build or restyle a dashboard screen so it lands in the app's design language, and prove it against the approved mock-up.
---

# A new screen, or a changed one

Every screen in this app is built from the same primitives and reads as the
same three bands. A screen that is "inspired by" the design is the fault that
cost the first attempt: Max put the approved mock-up beside the built page and
they were not like for like. This skill is how a screen ends up like for like.

## Read first

- `docs/design-language.md` — the eight rules, the tone table, the primitives
  and the DOM traps. Ten minutes, and it says WHY each thing is so.
- `docs/design/spec-builder-mockups.html` — the approved reference. Open it in
  a browser; the `Design language` tab is the rules, the other tabs are the
  screens. If your screen is one of them, that tab is the spec.
- `/dashboard/design` on a running dev server — the real primitives rendered
  with the rule beside each.

## The three bands

1. **`PageHeader`** — crumbs, the ONE `h1`, a `Pill` beside it for a closed-set
   state, a one-line subtitle, page-level actions right-aligned, and the `Tabs`
   in its `tabs` slot. Always 1100px wide, whatever the body is.
2. **`Tabs`**, with counts. A strip anything links INTO keeps its tab in the URL
   (`useUrlTab`); a strip nested inside a review component keeps `useState`.
   A count is a number or a string like `2 of 3`; pass `null` where a number
   would claim something false (a gates count where no matrix covers the
   category; a versions count nobody has loaded).
3. **`PageBody`**, `std` (1100) or `wide` (1400). Wide is for dense tables —
   the spec table, the chase, the three review screens. There is no third width.

Inside the body: **numbers first** (`StatTile`s, each a filter or a link, with
the active one outlined and the filter repeated as a removable `Chip`), then a
filter row, then the content in `Card`s. A list over six long is a `Table`.

## Which primitive

| You want | Use | Not |
|---|---|---|
| a word in a box describing one cell | `Chip` (`mono` for a code) | a hand-rolled span |
| the row's state from a closed set | `Pill` | a Chip |
| a banner that exists because of the data | `Note` | a paragraph that is always there |
| one or two sentences of help | `Tip` | a caption — unless its absence would mislead, in which case it stays in WORDS |
| an app guess with its evidence | `SuggestButton` | a pre-selected select, which fires no change event when the shown value is chosen |
| an action | `Button` (four variants) or `buttonClass` on a download anchor | a raw `<button>`; a colour through `className` |
| a colour | a `Tone` from `tone.ts` | a Tailwind colour class typed at the site |
| a date | `formatDay` (`src/lib/format-day.ts`) on the `YYYY-MM-DD` string | `new Date(...)` — the TOE-dates trap |

Sizes are set inside the primitives. A page never states a font size.

## Colour is a meaning

Red blocks money going out. Amber needs a person. Blue is the app suggesting.
Green is settled. Yellow is a guess, on a whole row. Slate dashed is nowhere to
record it — never red. Sky is the working state. If none of those is what you
mean, the thing has no colour.

## DOM traps that survive a restyle

- A panel spanning a table row is its own `<tr>`, never a `<td colSpan>` beside
  the data cells.
- No `overflow-hidden` on a table wrapper whose header is sticky.
- `divide-y` on the data row, not the tbody, where rows carry panels.
- `clampText`, not CSS `line-clamp`. `softenShout` offers *As printed*.
- The drawings review renders no pdfjs canvas in a hidden browser tab.

## Data the mock-up shows is data the screen shows

If the approved screen carries a number and no API returns it, the answer is a
loader — never a different number that happened to be free. Reuse the existing
loader (`loadOutstanding`, `loadSentCoverage`, `gatesForRecord`,
`composeDimensionCell`, `describeChange`) rather than a SQL re-expression of its
rule; two implementations is how two screens come to disagree.

## Before calling it done

1. The four checks: `npm run lint && npm run typecheck && npm test && npm run build`.
2. A component-tier test for any behaviour the screen adds (`tests/components/`,
   jsdom by path — no docblock).
3. Drive it in a real browser against the sandbox (the `verify` skill), the
   mock-up tab open beside it. Check: the blocking number is the first thing on
   the page; a guess is visibly a guess; every number goes somewhere; the error
   path (a refused request) shows its message and does not freeze the screen.
4. The environment chip is in the top bar and `[STAGING]` is in the title.
5. Report it as built and verified, and human acceptance as OUTSTANDING until
   Max has compared the two side by side. "Looks right to me" is not sign-off.
