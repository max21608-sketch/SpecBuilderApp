// NOTHING ON A SCREEN IS WIDER THAN ITS BOX — the one detector.
//
// ============================================================================
// WHY A RULE AND NOT A FIX PER SCREEN (Max, 2026-09-30: "can you set an app
// wide rule to prevent overflows in the future").
//
// The phase table on the real Aman bill ran 256px wider than its body at 1920
// AND 1440, so TG1 and every row's actions sat off the right-hand edge inside a
// scrolling wrapper with no scrollbar in view. Nothing said so: the four checks
// were green, the component test rendered in jsdom where nothing has a width,
// and the screenshot looked like a table that simply had fewer columns. An
// overflow is invisible to every check this repo had, so it gets its own.
//
// WHAT COUNTS. A box whose content is wider than it (`scrollWidth >
// clientWidth`) where the box CLIPS or SCROLLS horizontally — the page itself,
// and every element whose computed `overflow-x` is not `visible` — and any
// TABLE wider than the box it sits in, which spills visibly past a card's
// border even where nothing clips it. That is
// exactly the case a person cannot see: the rest of the content is there, one
// sideways scroll away. Three things are NOT overflows and are skipped:
//   * form controls (`input`, `textarea`, `select`), which scroll their own
//     text by design;
//   * an intentional ellipsis (`text-overflow: ellipsis`), which is the
//     truncation SAYING it truncated;
//   * anything inside `[data-overflow-ok]`, the explicit, reviewable
//     exception for a box that is MEANT to scroll sideways (a wide preview of
//     a spreadsheet, say). Grep for it: every use is a decision.
//
// ONE implementation, two callers: `OverflowWatch` (the dev-only shell
// component that reports on every page as it renders) and
// `tools/overflow-audit.mjs` (which walks the main screens at 1920 and 1440
// and fails), through `window.__specBuilderOverflows`. A second copy of the
// predicate in the audit is how the two would start disagreeing.
//
// Pure over a `Document`, with no imports, so it runs in any browser context.
// ============================================================================

export type Overflow = {
  /** Something a person can find the element by: tag, a class or two, its first words. */
  where: string;
  /** How many CSS pixels of content are beyond the box's right-hand edge. */
  overBy: number;
};

/** A pixel of slack, because sub-pixel layout rounds either way. */
const SLACK = 1;

const CLIPPING = new Set(["auto", "scroll", "hidden", "clip"]);
const SCROLLS_ITS_OWN_TEXT = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  // A table is named by its headings, which is how anybody would find it.
  const table = el.tagName === "TABLE" ? el : el.querySelector("table");
  const heads = table
    ? [...table.querySelectorAll("thead th")]
        .map((th) => (th.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" | ")
    : "";
  const words = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return `<${tag}${classes ? "." + classes : ""}> ${heads ? `table [${heads}]` : `"${words}"`}`;
}

/** Every box on the page whose content runs past its right-hand edge, widest first. */
export function findOverflows(doc: Document): Overflow[] {
  const win = doc.defaultView;
  if (!win) return [];
  const out: Overflow[] = [];

  const page = doc.documentElement;
  const pageOver = page.scrollWidth - win.innerWidth;
  if (pageOver > SLACK) out.push({ where: "the page itself (a sideways scroll bar)", overBy: pageOver });

  for (const el of doc.body ? [...doc.body.querySelectorAll("*")] : []) {
    if (!(el instanceof win.HTMLElement)) continue;
    if (SCROLLS_ITS_OWN_TEXT.has(el.tagName)) continue;
    if (el.closest("[data-overflow-ok]")) continue;
    // Not laid out (hidden, collapsed, display none), or a 1px screen-reader
    // box (`sr-only`), which clips its text by design and is never seen.
    if (el.clientWidth <= 1) continue;
    // A TABLE WIDER THAN ITS CONTAINER spills past the card it sits in even
    // where nothing clips it — the record's specs table ran 39px over its
    // card's border at 1440 and no clipping box saw it. Measured against the
    // parent's content box, so a table in a deliberate scroller is caught by
    // the clipping test below instead.
    if (el.tagName === "TABLE" && el.parentElement) {
      const parentStyle = win.getComputedStyle(el.parentElement);
      if (!CLIPPING.has(parentStyle.overflowX)) {
        const room =
          el.parentElement.clientWidth -
          parseFloat(parentStyle.paddingLeft || "0") -
          parseFloat(parentStyle.paddingRight || "0");
        const spill = Math.round(el.getBoundingClientRect().width - room);
        if (spill > SLACK) out.push({ where: describe(el), overBy: spill });
      }
    }
    const over = el.scrollWidth - el.clientWidth;
    if (over <= SLACK) continue;
    const style = win.getComputedStyle(el);
    if (!CLIPPING.has(style.overflowX)) continue;
    if (style.textOverflow === "ellipsis") continue;
    out.push({ where: describe(el), overBy: over });
  }
  return out.sort((a, b) => b.overBy - a.overBy);
}
