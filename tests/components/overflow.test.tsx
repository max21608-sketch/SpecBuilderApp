// The one overflow detector, over a DOM (audit H4: `overflow.ts` had no
// direct test, and `OverflowWatch` and `tools/overflow-audit.mjs` both trust
// it).
//
// jsdom lays nothing out, so every width here is set by hand on the element
// the rule reads it from: `clientWidth` and `scrollWidth` for a box, the
// bounding rectangle for a table, `innerWidth` and the root's `scrollWidth`
// for the page. What is under test is the RULE: which boxes count, which are
// excepted, and how far over each is said to be.
import { afterEach, describe, expect, it } from "vitest";
import { findOverflows } from "@/lib/overflow";

function widths(el: Element, { client, scroll }: { client: number; scroll: number }): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: client });
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scroll });
}

/** A box that clips or scrolls sideways, `over` pixels narrower than its content. */
function scroller(html: string, over: number, style = "overflow-x: auto"): HTMLElement {
  const box = document.createElement("div");
  box.setAttribute("style", style);
  box.className = "rounded border p-2 extra";
  box.innerHTML = html;
  document.body.appendChild(box);
  widths(box, { client: 300, scroll: 300 + over });
  return box;
}

afterEach(() => {
  document.body.innerHTML = "";
  delete (document.documentElement as unknown as { scrollWidth?: number }).scrollWidth;
});

describe("findOverflows", () => {
  it("names a box that scrolls sideways, by its table's headings, and says how far over", () => {
    scroller("<table><thead><tr><th>Code</th><th>Item</th><th>TG1</th></tr></thead></table>", 256);
    const [found, ...rest] = findOverflows(document);
    expect(rest).toEqual([]);
    expect(found).toEqual({ where: "<div.rounded.border.p-2> table [Code | Item | TG1]", overBy: 256 });
  });

  it("names a box without a table by its first words", () => {
    scroller("<p>An example sentence that runs on</p>", 40, "overflow-x: hidden");
    expect(findOverflows(document)[0]?.where).toBe('<div.rounded.border.p-2> "An example sentence that runs on"');
  });

  it("does not count a box that neither clips nor scrolls: its content is visible", () => {
    scroller("<p>spills, and can be seen</p>", 80, "overflow-x: visible");
    expect(findOverflows(document)).toEqual([]);
  });

  it("allows a pixel of slack, and no more", () => {
    scroller("<p>one pixel</p>", 1);
    expect(findOverflows(document)).toEqual([]);
    document.body.innerHTML = "";
    scroller("<p>two pixels</p>", 2);
    expect(findOverflows(document).map((entry) => entry.overBy)).toEqual([2]);
  });

  it("excepts form controls, an ellipsis, a 1px box, and anything inside data-overflow-ok", () => {
    const input = document.createElement("input");
    input.setAttribute("style", "overflow-x: auto");
    document.body.appendChild(input);
    widths(input, { client: 100, scroll: 900 });
    scroller("<p>truncated on purpose</p>", 120, "overflow-x: hidden; text-overflow: ellipsis");
    scroller("<p>screen reader only</p>", 120, "overflow-x: hidden");
    const srOnly = document.body.lastElementChild!;
    widths(srOnly, { client: 1, scroll: 121 });
    const allowed = document.createElement("section");
    allowed.setAttribute("data-overflow-ok", "a wide preview, meant to scroll");
    document.body.appendChild(allowed);
    const inner = document.createElement("div");
    inner.setAttribute("style", "overflow-x: auto");
    allowed.appendChild(inner);
    widths(inner, { client: 300, scroll: 900 });
    expect(findOverflows(document)).toEqual([]);
  });

  it("counts a table wider than a box that does NOT clip, against the box's content width", () => {
    const card = document.createElement("div");
    card.setAttribute("style", "padding-left: 10px; padding-right: 10px");
    card.innerHTML = "<table><thead><tr><th>Spec</th><th>Value</th></tr></thead></table>";
    document.body.appendChild(card);
    widths(card, { client: 500, scroll: 500 });
    const table = card.querySelector("table")!;
    widths(table, { client: 519, scroll: 519 });
    table.getBoundingClientRect = () => ({ width: 519 }) as DOMRect;
    // 500 wide, 20 of padding: 480 of room, and the table is 39 over it.
    expect(findOverflows(document)).toEqual([{ where: "<table> table [Spec | Value]", overBy: 39 }]);
  });

  it("leaves a table inside a scroller to the scroller's own test", () => {
    const box = scroller("<table><thead><tr><th>Wide</th></tr></thead></table>", 200);
    const table = box.querySelector("table")!;
    widths(table, { client: 500, scroll: 500 });
    table.getBoundingClientRect = () => ({ width: 500 }) as DOMRect;
    expect(findOverflows(document).map((entry) => entry.overBy)).toEqual([200]);
  });

  it("counts the page itself, and lists the widest first", () => {
    Object.defineProperty(document.documentElement, "scrollWidth", { configurable: true, value: window.innerWidth + 30 });
    scroller("<p>small</p>", 10);
    scroller("<p>large</p>", 90);
    expect(findOverflows(document)).toEqual([
      { where: '<div.rounded.border.p-2> "large"', overBy: 90 },
      { where: "the page itself (a sideways scroll bar)", overBy: 30 },
      { where: '<div.rounded.border.p-2> "small"', overBy: 10 },
    ]);
  });

  it("finds nothing in a document with no window", () => {
    expect(findOverflows(document.implementation.createHTMLDocument("detached"))).toEqual([]);
  });
});
