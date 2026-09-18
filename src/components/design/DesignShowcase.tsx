"use client";

// Every primitive, once, with the rule beside it. See the page that mounts it.
import { useState } from "react";
import Button, { buttonClass } from "@/components/ui/Button";
import Card, { CardHeadingNote } from "@/components/ui/Card";
import Chip from "@/components/ui/Chip";
import Note from "@/components/ui/Note";
import Pill from "@/components/ui/Pill";
import StatTile from "@/components/ui/StatTile";
import SuggestButton from "@/components/ui/SuggestButton";
import Tabs from "@/components/ui/Tabs";
import Tip from "@/components/ui/Tip";
import { GroupRow, Table, Td, Th, Tr } from "@/components/ui/Table";
import { TONE, TONES, type Tone } from "@/components/ui/tone";

const MEANING: Record<Tone, string> = {
  danger: "blocks money going out — TGQ, a refused confirm, an export that would wipe fields",
  warn: "needs a person, not an error — TBC, no category, no level, a held email",
  info: "the app is suggesting — always with its reason, one click to accept",
  good: "settled — confirmed, N/A, review complete, a named baseline",
  guess: "a value the app filled in and nobody has confirmed — a whole row, never a chip",
  blocked: "nowhere to record it — a seed or a migration, not a question for the reader; never red",
  live: "the ordinary working state — an ACTIVE project, the letter A of a split line",
  plain: "a count with no judgement",
};

type DemoTab = "tgq" | "also" | "settled";

export default function DesignShowcase() {
  const [tab, setTab] = useState<DemoTab>("tgq");
  const [filter, setFilter] = useState<"tgq" | null>("tgq");
  const [accepted, setAccepted] = useState(false);

  return (
    <>
      <Card title="1 · Everything actionable is a link, and a number that blocks something carries its fix beside it">
        <p>
          A count, an item code, a finish code, a filename, a designer, a date, a run name — all of them go
          somewhere. <span className="text-red-700 font-semibold">312</span> TGQ is a link to the filtered table{" "}
          <em>and</em> has <a className={buttonClass("secondary", "xs")} href="#">Chase them</a> on the same row.
        </p>
      </Card>

      <Card title="2 · A summary tile is a filter">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <StatTile label="TGQ" value={312} meaning="across 38 items" action="showing these" tone="danger" active={filter === "tgq"} onPress={() => setFilter(filter === "tgq" ? null : "tgq")} />
          <StatTile label="Also outstanding" value={1587} meaning="not blocking a quote" action="filter to these" tone="warn" onPress={() => setFilter(null)} />
          <StatTile label="Settled" value={641} meaning="confirmed or N/A" action="filter to these" tone="good" onPress={() => setFilter(null)} />
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
          {filter && (
            <button type="button" onClick={() => setFilter(null)} className="inline-flex">
              <Chip tone="danger">TGQ ✕</Chip>
            </button>
          )}
          <span>The tile you are on is outlined; the filter is repeated as a chip you can remove. A filter narrows what is LISTED, never what is asked or what an edit touches.</span>
        </div>
      </Card>

      <Card title="3 · Do not explain in a paragraph what a hover can say">
        <p>
          Where a field carries a rule worth knowing it gets a
          <Tip>A 14px circle. Hover shows one or two sentences. Never more — if it needs a paragraph it belongs in the docs.</Tip>{" "}
          beside its label. What stays on the page in words: anything whose absence would look identical to
          everything being fine — <span className="text-neutral-500">no programme recorded — nothing can be flagged overdue</span>.
        </p>
      </Card>

      <Card title="4 · Colour means one thing each" flush>
        <Table>
          <thead>
            <tr>
              <Th>Tone</Th>
              <Th>Chip</Th>
              <Th>Pill</Th>
              <Th>Means</Th>
            </tr>
          </thead>
          <tbody>
            {TONES.map((tone) => (
              <Tr key={tone} tone={tone === "guess" ? "guess" : "plain"}>
                <Td mono>{tone}</Td>
                <Td>
                  <Chip tone={tone} dot>
                    {tone}
                  </Chip>
                </Td>
                <Td>
                  <Pill tone={tone}>{tone}</Pill>
                </Td>
                <Td>{MEANING[tone]}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="px-4 py-3 text-xs text-neutral-500">
          Yellow and amber mean different things and a row can be both: the yellow row above is a guess; an amber
          edge beside it would mean it cannot commit as it stands. The vocabulary is <code className="font-mono">src/components/ui/tone.ts</code>.
        </p>
      </Card>

      <Card title="5 · A guess is one click from a decision, and never wears its authority">
        <div className="flex flex-wrap items-center gap-4">
          {accepted ? (
            <Chip>Timber</Chip>
          ) : (
            <SuggestButton value="Timber" evidence={<>the code <span className="font-mono">WD</span> says so</>} onAccept={() => setAccepted(true)} />
          )}
          <SuggestButton value="Accept 7 suggested levels" evidence="one button for all of them — 59 records must not mean 59 visits" onAccept={() => undefined} size="sm" />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Never a pre-selected dropdown: a select already reading “Simple” fires no change event when somebody chooses Simple.
        </p>
      </Card>

      <Card title="6 · A version is not a change" flush>
        <div className="flex items-center gap-2.5 border-y border-green-200 bg-green-50 px-4 py-2">
          <Pill tone="good">Baseline</Pill>
          <span className="text-[13px] font-semibold text-green-900">Rev B issued to Maybourne</span>
          <span className="ml-auto text-xs text-green-800">17 Sept · 45 items fixed</span>
        </div>
        <div className="flex items-start gap-2.5 border-b border-neutral-100 px-4 py-2 text-[13px]">
          <Chip>Edited by hand</Chip>
          <span>AP364c-021 · Sofa — Width 760 → 790</span>
          <span className="ml-auto text-xs text-neutral-500">17 Sept, 18:34</span>
        </div>
        <div className="flex items-center gap-2.5 border-y border-violet-200 bg-violet-50 px-4 py-2">
          <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-violet-700">Key date</span>
          <span className="text-[13px] font-semibold text-violet-900">Complete specifications agreed by — 14 Oct 2026</span>
          <span className="ml-auto text-xs text-violet-700">26 days away</span>
        </div>
      </Card>

      <Card title="7 · Layout, type and rhythm">
        <p className="mb-3">
          Three bands on every page: the identity bar, tabs with counts, content with the numbers first. The header
          band is always 1100px; the body is <span className="font-mono">std</span> (1100) or <span className="font-mono">wide</span> (1400) for dense tables. A list of more than six things is a table.
        </p>
        <Tabs
          label="Example tabs"
          value={tab}
          onChange={setTab}
          items={[
            { id: "tgq", label: "TGQ", count: 9, tone: "danger" },
            { id: "also", label: "Also outstanding", count: 28 },
            { id: "settled", label: "Settled", count: 6, tone: "good" },
          ]}
        />
        <div className="mt-4 grid grid-cols-[150px_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <div className="text-neutral-500">Page title</div><div className="text-h1 font-semibold">20px / semibold</div>
          <div className="text-neutral-500">Card heading</div><div className="text-th font-bold uppercase tracking-wider text-neutral-500">11px / bold / uppercase</div>
          <div className="text-neutral-500">Body</div><div>14px — read all day</div>
          <div className="text-neutral-500">Values and codes</div><div className="font-mono">monospace, always — W1900 x D790mm · UPH-07 · AP364c-021</div>
          <div className="text-neutral-500">Spacing</div><div>a 4px scale; cards 16px apart</div>
        </div>
      </Card>

      <Card title="8 · A link goes somewhere; a button does something">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="quiet">Quiet</Button>
          <SuggestButton value="Suggested · one click" evidence="its evidence" onAccept={() => undefined} size="sm" />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Four variants and no more. The suggestion is not a fifth: the four grade an action&rsquo;s consequence, and a
          suggestion is a different thing whose rule is “it says so”.
        </p>
      </Card>

      <Card title={<>Tables <CardHeadingNote>— the shape every list over six long takes</CardHeadingNote></>} flush>
        <Table>
          <thead>
            <tr>
              <Th>Label</Th>
              <Th>Value</Th>
              <Th num>Qty</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            <GroupRow span={4} aside="— the four that compose the cell">Dimensions</GroupRow>
            <Tr>
              <Td>Width</Td>
              <Td mono>190 cm</Td>
              <Td num>14</Td>
              <Td><Chip tone="good">Confirmed</Chip></Td>
            </Tr>
            <Tr tone="guess">
              <Td>Seat height</Td>
              <Td mono>44 cm</Td>
              <Td num>14</Td>
              <Td><Chip tone="guess">guessed</Chip></Td>
            </Tr>
            <Tr tone="warn">
              <Td>COM 1</Td>
              <Td>TBC – Yarn Collective</Td>
              <Td num muted>—</Td>
              <Td><Chip tone="warn">TBC</Chip></Td>
            </Tr>
          </tbody>
        </Table>
      </Card>

      <Note tone="info" title="Notes are conditional." actions={<Button size="xs">An action</Button>}>
        A banner appears because of the data and goes when the data changes. Standing explanation is a Tip or nothing.
      </Note>
      <Note tone="danger" title="Red is the one colour that must never be ignored.">
        Which is why a gate that cannot start yet is slate, not red.
      </Note>
      <p className="mt-6 text-xs text-neutral-500">
        The measure of a screen: the blocking number is the first thing you see, a guess is still obviously a guess,
        and you can get from any number to the place you change it without going via a menu. Palette source: {TONES.length} tones in{" "}
        <span className="font-mono">tone.ts</span>; class strings such as <span className="font-mono">{TONE.danger.text}</span> are literal.
      </p>
    </>
  );
}
