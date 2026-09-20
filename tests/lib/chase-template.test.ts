// Pure unit tests for the chase email template. No DB, no clock, no network.
//
// This is the tier that matters most for this file: the db tier silently skips
// without DATABASE_URL (and CI has none), so anything that must not go
// untested belongs here.
import { describe, expect, it } from "vitest";
import {
  buildChaseEmail,
  buildChaseSubject,
  defaultIntro,
  escapeHtml,
  londonGreeting,
  type ChaseGroup,
} from "@/lib/chase-template";

function question(overrides: Partial<ChaseGroup["questions"][number]> = {}) {
  return {
    recordId: "r1",
    requirementId: "q1",
    recordLabel: "P17231-007",
    refs: "SX11A",
    itemDescription: "Armchair",
    area: "Signature Suite",
    categoryName: "Armchairs, Benches, Stools, Sofas",
    prompt: "Seat height (SH)?",
    fieldLabel: "Dimensions",
    state: "missing" as const,
    currentValue: null,
    tier: "to_quote" as const,
    ...overrides,
  };
}

function group(overrides: Partial<ChaseGroup> = {}): ChaseGroup {
  return {
    recordId: "r1",
    recordLabel: "P17231-007",
    refs: "SX11A",
    itemDescription: "Armchair",
    area: "Signature Suite",
    categoryName: "Armchairs, Benches, Stools, Sofas",
    tier: "to_quote" as const,
    questions: [question()],
    ...overrides,
  };
}

const base = {
  projectLabel: "P17231 Maybourne Paris",
  contactName: "Tristan Auer",
  intro: "Intro line.",
  closing: "Many thanks,",
  groups: [group()],
  now: new Date("2026-09-13T09:00:00Z"),
};

describe("londonGreeting", () => {
  // Vercel runs UTC and the reader is in London. During BST those are
  // different days, let alone different halves of the day.
  it("uses the London hour, not the UTC hour, across BST", () => {
    // 23:30 UTC in June is 00:30 the NEXT DAY in London.
    expect(londonGreeting(new Date("2026-06-15T23:30:00Z"))).toBe("Good morning");
    // 11:30 UTC in June is 12:30 in London — afternoon, not morning.
    expect(londonGreeting(new Date("2026-06-15T11:30:00Z"))).toBe("Good afternoon");
  });

  it("matches UTC in winter, when London is GMT", () => {
    expect(londonGreeting(new Date("2026-01-15T09:00:00Z"))).toBe("Good morning");
    expect(londonGreeting(new Date("2026-01-15T14:00:00Z"))).toBe("Good afternoon");
    expect(londonGreeting(new Date("2026-01-15T19:00:00Z"))).toBe("Good evening");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that can break out of markup", () => {
    expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("escapes & before the others, so entities are not double-encoded wrongly", () => {
    expect(escapeHtml("Rock & Roll <tag>")).toBe("Rock &amp; Roll &lt;tag&gt;");
  });
});

describe("buildChaseSubject", () => {
  it("counts questions and records separately", () => {
    const subject = buildChaseSubject({
      projectLabel: "P17231 Maybourne Paris",
      groups: [
        group({ questions: [question(), question({ requirementId: "q2" })] }),
        group({ recordId: "r2", recordLabel: "P17231-008", questions: [question({ recordId: "r2" })] }),
      ],
    });
    expect(subject).toBe(
      "P17231 Maybourne Paris — outstanding specification information (3 needed to quote across 2 items)",
    );
  });

  it("singularises one item", () => {
    expect(buildChaseSubject({ projectLabel: "P17231", groups: [group()] })).toContain(
      "(1 needed to quote across 1 item)",
    );
  });

  // The subject is what decides whether the message is opened today or on
  // Friday, so what is BLOCKING goes in it, not just a total.
  it("reports the two tiers separately when both are present", () => {
    const subject = buildChaseSubject({
      projectLabel: "P17231",
      groups: [
        group({ questions: [question(), question({ requirementId: "q2" })] }),
        group({
          recordId: "r2",
          recordLabel: "P17231-008",
          tier: "later",
          questions: [question({ recordId: "r2", tier: "later" })],
        }),
      ],
    });
    expect(subject).toBe(
      "P17231 — outstanding specification information (2 needed to quote, 1 further question, across 2 items)",
    );
  });

  it("says so plainly when nothing is holding up the quote", () => {
    const subject = buildChaseSubject({
      projectLabel: "P17231",
      groups: [group({ tier: "later", questions: [question({ tier: "later" })] })],
    });
    expect(subject).toBe(
      "P17231 — outstanding specification information (1 question across 1 item — none holding up the quote)",
    );
  });

  // A record with questions in both halves is two groups and one item.
  it("counts a record appearing in both sections once", () => {
    const subject = buildChaseSubject({
      projectLabel: "P17231",
      groups: [
        group({ questions: [question()] }),
        group({ tier: "later", questions: [question({ requirementId: "q2", tier: "later" })] }),
      ],
    });
    expect(subject).toContain("across 1 item");
  });

  // A draft downloaded from staging must be obviously not the real thing, at
  // the moment someone is looking at it in Outlook.
  it("carries the environment prefix when one is given", () => {
    const subject = buildChaseSubject({ projectLabel: "P17231", groups: [group()], environmentPrefix: "[STAGING]" });
    expect(subject.startsWith("[STAGING] P17231")).toBe(true);
  });
});

describe("buildChaseEmail", () => {
  it("greets the contact by name", () => {
    expect(buildChaseEmail(base).body).toContain("Good morning Tristan Auer,");
  });

  it("renders one heading and one table per QUESTION, with the items under it", () => {
    // The defect this closes: two items outstanding on the same question used
    // to be two tables asking the same thing twice.
    const { body } = buildChaseEmail({
      ...base,
      groups: [
        group(),
        group({
          recordId: "r2",
          recordLabel: "P17231-008",
          questions: [
            question({ recordId: "r2", recordLabel: "P17231-008", refs: "SX12", itemDescription: "Sofa" }),
          ],
        }),
      ],
    });
    // ONE question table, plus the one-cell banner above it.
    expect(body.match(/<table/g)).toHaveLength(2);
    expect(body.match(/Seat height \(SH\)\?/g)).toHaveLength(1);
    expect(body).toContain("P17231-007 · SX11A · Armchair");
    expect(body).toContain("P17231-008 · SX12 · Sofa");
  });

  // TBC is an answer that blocks a gate; missing means nobody looked. If the
  // email flattens them the reader cannot tell which they already told us.
  it("renders TBC in loud red and missing in muted grey, distinguishably", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [
        group({
          questions: [
            question({ state: "tbc", prompt: "Timber finish?" }),
            question({ requirementId: "q2", state: "missing", prompt: "Arm height?" }),
          ],
        }),
      ],
    });
    expect(body).toMatch(/color:#b91c1c;font-weight:bold[^>]*>TBC</);
    expect(body).toMatch(/color:#6b7280[^>]*>Missing</);
  });

  // "we think so-and-so said you want it in polished steel" — the value the
  // record already holds, offered back for confirmation rather than asked for
  // blind.
  it("offers what the record holds as our understanding", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [group({ questions: [question({ currentValue: "450mm" })] })],
    });
    expect(body).toContain(">our understanding: 450mm<");
    expect(body).not.toContain(">Missing<");
  });

  it("keeps a TBC loud and still prints the words beside it", () => {
    // The drawings say `TBC - Yarn Collective Tessarae` all the time: the
    // state is what blocks, the words are what is being checked.
    const { body } = buildChaseEmail({
      ...base,
      groups: [
        group({ questions: [question({ state: "tbc", currentValue: "Yarn Collective Tessarae" })] }),
      ],
    });
    expect(body).toMatch(/color:#b91c1c;font-weight:bold[^>]*>TBC — our understanding: Yarn Collective Tessarae</);
  });

  it("names the BWS field in the question heading, and omits it where there is none", () => {
    const withField = buildChaseEmail(base).body;
    expect(withField).toContain("(BWS: Dimensions)");

    const without = buildChaseEmail({
      ...base,
      groups: [group({ questions: [question({ fieldLabel: null })] })],
    }).body;
    expect(without).not.toContain("(BWS:");
  });

  // Every style must be inline and on the cell: Outlook on Windows renders
  // with the Word engine, which ignores <style> blocks, classes, and borders
  // declared on <table>.
  it("puts a border on every cell and uses no classes or style blocks", () => {
    const { body } = buildChaseEmail(base);
    expect(body).not.toContain("<style");
    expect(body).not.toContain("class=");
    const cells = body.match(/<t[dh] /g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    // A border ON THE CELL, whichever border it is — the banner's is thicker
    // and red, and a table border would not render at all.
    for (const match of body.match(/<t[dh] [^>]*>/g) ?? []) {
      expect(match).toMatch(/style="[^"]*border:\d+px solid/);
    }
  });

  describe("escaping", () => {
    it("escapes author prose rather than trusting it as HTML", () => {
      const { body } = buildChaseEmail({
        ...base,
        intro: "<script>alert(1)</script> & more",
      });
      expect(body).not.toContain("<script>");
      expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    });

    it("escapes document-derived values — a prompt, a ref, a description", () => {
      const { body } = buildChaseEmail({
        ...base,
        groups: [
          group({
            refs: "<img src=x onerror=1>",
            itemDescription: "Chair & Stool",
            questions: [
              question({
                refs: "<img src=x onerror=1>",
                itemDescription: "Chair & Stool",
                prompt: "Width <W>?",
              }),
            ],
          }),
        ],
      });
      expect(body).not.toContain("<img");
      expect(body).toContain("&lt;img src=x onerror=1&gt;");
      expect(body).toContain("Chair &amp; Stool");
      expect(body).toContain("Width &lt;W&gt;?");
    });

    it("escapes the contact name in the greeting", () => {
      const { body } = buildChaseEmail({ ...base, contactName: "<b>Tristan</b>" });
      expect(body).toContain("&lt;b&gt;Tristan&lt;/b&gt;");
      expect(body).not.toContain("<b>Tristan</b>");
    });
  });

  describe("prose formatting", () => {
    it("turns blank lines into paragraphs and single newlines into breaks", () => {
      const { body } = buildChaseEmail({ ...base, intro: "One.\n\nTwo.\nStill two." });
      expect(body).toContain(">One.</p>");
      expect(body).toContain(">Two.<br>Still two.</p>");
    });

    it("omits empty prose entirely rather than emitting a blank paragraph", () => {
      const { body } = buildChaseEmail({ ...base, intro: "   ", closing: "" });
      expect(body).not.toContain("<p style=\"margin:0 0 1em;font-family:Arial,Helvetica,sans-serif;font-size:13px\"></p>");
    });
  });

  it("is deterministic — the same input twice gives byte-identical output", () => {
    expect(buildChaseEmail(base)).toEqual(buildChaseEmail(base));
  });
});

describe("buildChaseEmail — the two tiers", () => {
  const blocking = group({
    questions: [question({ prompt: "Dimensions?", tier: "to_quote" })],
  });
  const later = group({
    recordId: "r2",
    recordLabel: "P17231-008",
    tier: "later",
    questions: [question({ recordId: "r2", prompt: "Stitching spec?", tier: "later" })],
  });

  it("prints everything blocking the quote before everything else", () => {
    const { body } = buildChaseEmail({ ...base, groups: [later, blocking] });
    const blockingAt = body.indexOf("Needed before we can quote");
    const laterAt = body.indexOf("Also outstanding");
    expect(blockingAt).toBeGreaterThan(-1);
    expect(laterAt).toBeGreaterThan(-1);
    // Given to the builder in the wrong order, and still printed in the right
    // one: the section order is the template's, not the caller's.
    expect(blockingAt).toBeLessThan(laterAt);
    expect(body.indexOf("Dimensions?")).toBeLessThan(body.indexOf("Stitching spec?"));
  });

  it("counts the questions in each banner", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [group({ questions: [question(), question({ requirementId: "q2" })] }), later],
    });
    expect(body).toContain("Needed before we can quote — 2 questions");
    expect(body).toContain("Also outstanding — not holding up the quote — 1 question");
  });

  it("omits a section with nothing in it rather than printing an empty heading", () => {
    const { body } = buildChaseEmail({ ...base, groups: [blocking] });
    expect(body).toContain("Needed before we can quote");
    expect(body).not.toContain("Also outstanding");
  });

  // Word's renderer drops borders and backgrounds on a <p> and keeps them on a
  // <td>. The banner carries the whole point of the message, so it is the last
  // thing that may degrade to plain text.
  it("draws each banner as a one-cell table, not a bordered paragraph", () => {
    const { body } = buildChaseEmail({ ...base, groups: [blocking, later] });
    const banner = body.slice(body.indexOf("<table"), body.indexOf("Needed before we can quote"));
    expect(banner).toContain("border:2px solid #b91c1c");
    expect(banner).toContain("<td");
    expect(body).not.toMatch(/<p[^>]*border:[^>]*>[^<]*Needed before we can quote/);
  });
});

describe("defaultIntro", () => {
  it("keeps the singular readable when only one point is outstanding", () => {
    // "1 further point that are outstanding" is the kind of sentence that
    // makes a client wonder whether a person read the email before sending it.
    expect(defaultIntro("P17231", { toQuote: 2, later: 1 })).toContain("1 further point that is outstanding");
  });

  it("names both counts when the email carries both halves", () => {
    const intro = defaultIntro("P17231 Maybourne Paris", { toQuote: 4, later: 9 });
    expect(intro).toContain("4 details we need from you before we can put a price");
    expect(intro).toContain("9 further points that are outstanding");
  });

  it("asks only for the quote when nothing else is outstanding", () => {
    const intro = defaultIntro("P17231", { toQuote: 1, later: 0 });
    expect(intro).toContain("We need from you the 1 detail below before we can put a price");
    expect(intro).not.toContain("further");
  });

  it("says nothing is holding up the quote when nothing is", () => {
    const intro = defaultIntro("P17231", { toQuote: 0, later: 3 });
    expect(intro).toContain("Nothing below is holding up the quote");
  });
});

// ===========================================================================
// THE BODY IS A LIST OF QUESTIONS, NOT A LIST OF ITEMS
//
// The strongest product criticism of the 2026-09-18 meeting. Matthew, twice,
// for Jay: "we end up repeating the question on ten lines", and what he wanted
// instead was "for the dressing area, we don't have a metalwork finish".
//
// The screen stays per item — a person works item by item, and Matthew drove
// that screen happily. A CLIENT answers question by question, by area.
// ===========================================================================
describe("buildChaseEmail — question, then area, then the items", () => {
  const item = (n: number, area: string | null, prompt = "Metalwork finish?") =>
    question({
      recordId: `r${n}`,
      // Keyed on the prompt, but NOT by its text: the ids are rendered into
      // `data-requirement`, and a regex counting the prompt would count them.
      requirementId: `q${prompt.length}`,
      recordLabel: `P17231-${String(n).padStart(3, "0")}`,
      refs: `S-${100 + n}`,
      itemDescription: `Item ${n}`,
      area,
      prompt,
      fieldLabel: "Metal finish 1",
    });

  const asGroups = (questions: ReturnType<typeof item>[]): ChaseGroup[] =>
    questions.map((q) => ({
      recordId: q.recordId,
      recordLabel: q.recordLabel,
      refs: q.refs,
      itemDescription: q.itemDescription,
      area: q.area,
      categoryName: q.categoryName,
      tier: q.tier,
      questions: [q],
    }));

  it("asks a question ONCE however many items carry it", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: asGroups([item(1, "Dressing area"), item(2, "Dressing area"), item(3, "Living area")]),
    });
    expect(body.match(/Metalwork finish\?/g)).toHaveLength(1);
    // One question table, plus the banner.
    expect(body.match(/<table/g)).toHaveLength(2);
    expect(body).toContain("— 3 items");
  });

  it("groups the items under their area, as the document spelled it", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: asGroups([item(1, "Dressing area"), item(2, "dressing  AREA"), item(3, "Living area")]),
    });
    // Two area rows, not three: `Dressing area` and `dressing  AREA` are one
    // room, and the first spelling is the one printed.
    expect(body.match(/Dressing area</g)).toHaveLength(1);
    expect(body).not.toContain("dressing  AREA");
    expect(body).toContain("Living area<");
    expect(body.indexOf("Dressing area<")).toBeLessThan(body.indexOf("Living area<"));
  });

  it("puts the items nobody has placed under No area given, last", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: asGroups([item(1, null), item(2, "Living area")]),
    });
    expect(body).toContain("No area given");
    // Last, because it is not an area: among them it would read as a room.
    expect(body.indexOf("Living area<")).toBeLessThan(body.indexOf("No area given"));
    // And never dropped.
    expect(body).toContain("P17231-001 · S-101 · Item 1");
  });

  it("prints a question outstanding on ONE item as one line, with no area heading", () => {
    const { body } = buildChaseEmail({ ...base, groups: asGroups([item(1, "Dressing area")]) });
    expect(body).toContain("P17231-001 · S-101 · Item 1");
    expect(body).toContain("— 1 item");
    // The area heading would say nothing the single line does not.
    expect(body).not.toContain("Dressing area<");
  });

  it("holds 40 items across 12 areas in ONE table", () => {
    // The 300-line shape. Before this the same question was asked forty times.
    const many = Array.from({ length: 40 }, (_, index) =>
      item(index + 1, `Area ${String(index % 12).padStart(2, "0")}`),
    );
    const { body } = buildChaseEmail({ ...base, groups: asGroups(many) });
    expect(body.match(/<table/g)).toHaveLength(2);
    expect(body.match(/Metalwork finish\?/g)).toHaveLength(1);
    expect(body.match(/colspan="2"/g)).toHaveLength(12);
    expect(body.match(/<tr data-record=/g)).toHaveLength(40);
  });

  // =========================================================================
  // THE GUARANTEE THE SEND GATE RESTS ON
  //
  // `email_draft_items` is one row per record × question, and "the email says
  // exactly what the coverage says" is what makes confirming a send safe. The
  // regrouping happens entirely inside the renderer, so the property is
  // checkable: pull every (record, requirement) pair back out of the HTML and
  // compare it with what went in.
  // =========================================================================
  it("renders exactly the coverage set — no pair added, none lost", () => {
    const questions = [
      item(1, "Dressing area", "Metalwork finish?"),
      item(2, "Dressing area", "Metalwork finish?"),
      item(2, null, "Stitching spec?"),
      item(3, "Living area", "Metalwork finish?"),
      { ...item(4, "Living area", "Delivery week?"), tier: "later" as const },
    ];
    const groups = asGroups(questions);
    const { body } = buildChaseEmail({ ...base, groups });

    const rendered = new Set(
      [...body.matchAll(/data-record="([^"]+)" data-requirement="([^"]+)"/g)].map(
        (match) => `${match[1]}:${match[2]}`,
      ),
    );
    const coverage = new Set(
      groups.flatMap((g) => g.questions.map((q) => `${q.recordId}:${q.requirementId}`)),
    );
    expect(rendered).toEqual(coverage);
    expect(rendered.size).toBe(5);
  });

  it("still prints everything blocking the quote first", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [
        ...asGroups([{ ...item(4, "Living area", "Delivery week?"), tier: "later" as const }]),
        ...asGroups([item(1, "Dressing area", "Metalwork finish?")]),
      ],
    });
    expect(body.indexOf("Needed before we can quote")).toBeLessThan(body.indexOf("Also outstanding"));
    expect(body.indexOf("Metalwork finish?")).toBeLessThan(body.indexOf("Delivery week?"));
  });

  it("escapes an area, because it is free text off a bill", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: asGroups([item(1, "<b>Suite</b>"), item(2, "Lobby")]),
    });
    expect(body).not.toContain("<b>Suite</b>");
    expect(body).toContain("&lt;b&gt;Suite&lt;/b&gt;");
  });
});

describe("a chase to a colleague", () => {
  // Matthew, 2026-09-18: "You can send it to the CAM or to the sales system or
  // to production… It doesn't have to be an external e-mail." Asking a
  // colleague to confirm details "from you" reads as though the app thinks
  // they are the client.
  it("never says from you", () => {
    const counts = { toQuote: 4, later: 9 };
    const external = buildChaseEmail({ ...base, intro: defaultIntro("P17231", counts) }).body;
    const internal = buildChaseEmail({
      ...base,
      intro: defaultIntro("P17231", counts, { internal: true }),
    }).body;
    expect(external).toContain("from you");
    expect(internal).not.toContain("from you");
    expect(internal).toContain("we still need");
  });

  it("drops the from-you wording in every shape of the intro", () => {
    for (const counts of [
      { toQuote: 4, later: 9 },
      { toQuote: 1, later: 0 },
      { toQuote: 0, later: 3 },
    ]) {
      const intro = defaultIntro("P17231", counts, { internal: true });
      expect(intro).not.toContain("from you");
      expect(intro.toLowerCase()).toContain("we still need");
    }
  });

  it("leaves the questions, the tiers and the tables exactly as they are", () => {
    // Only the wording changes. A colleague is asked the same things.
    const counts = { toQuote: 1, later: 0 };
    const external = buildChaseEmail({ ...base, intro: defaultIntro("P17231", counts) });
    const internal = buildChaseEmail({
      ...base,
      intro: defaultIntro("P17231", counts, { internal: true }),
    });
    expect(internal.subject).toBe(external.subject);
    const tables = (body: string) => body.slice(body.indexOf("<table"));
    expect(tables(internal.body)).toBe(tables(external.body));
  });
});
