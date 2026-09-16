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

  it("renders one heading and one table per record", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [
        group(),
        group({ recordId: "r2", recordLabel: "P17231-008", refs: "SX12", itemDescription: "Sofa" }),
      ],
    });
    // Two record tables plus the one-cell banner above them.
    expect(body.match(/<table/g)).toHaveLength(3);
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

  it("shows a current value when the record holds one", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [group({ questions: [question({ currentValue: "450mm" })] })],
    });
    expect(body).toContain(">450mm<");
    expect(body).not.toContain(">Missing<");
  });

  it("shows an em dash when a question maps to no BWS field", () => {
    const { body } = buildChaseEmail({
      ...base,
      groups: [group({ questions: [question({ fieldLabel: null })] })],
    });
    expect(body).toContain(">—<");
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
            questions: [question({ prompt: "Width <W>?" })],
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
  it("names both counts when the email carries both halves", () => {
    const intro = defaultIntro("P17231 Maybourne Paris", { toQuote: 4, later: 9 });
    expect(intro).toContain("4 details we need before we can put a price");
    expect(intro).toContain("9 further points");
  });

  it("asks only for the quote when nothing else is outstanding", () => {
    const intro = defaultIntro("P17231", { toQuote: 1, later: 0 });
    expect(intro).toContain("1 detail below before we can put a price");
    expect(intro).not.toContain("further");
  });

  it("says nothing is holding up the quote when nothing is", () => {
    const intro = defaultIntro("P17231", { toQuote: 0, later: 3 });
    expect(intro).toContain("Nothing below is holding up the quote");
  });
});
