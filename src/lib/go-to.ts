// Scroll to an element by id and light it for a moment (2026-10-15).
//
// The "needs you" list's links land here. The target may not exist yet — a
// bill sheet's tab has to be switched to, a folded row unfolded — so this
// waits a few frames for it rather than failing on the first. A target that
// never appears does nothing: the list still says the words, and a link that
// cannot scroll is no worse than the sentence it replaced.
const FLASH = "data-needs-you-flash";
const FLASH_MS = 2600;
const MAX_FRAMES = 40;

export function goToAndFlash(id: string): void {
  if (typeof window === "undefined") return;
  let frames = 0;
  const attempt = () => {
    const element = document.getElementById(id);
    if (!element) {
      frames += 1;
      if (frames < MAX_FRAMES) window.requestAnimationFrame(attempt);
      return;
    }
    if (typeof element.scrollIntoView === "function") element.scrollIntoView({ behavior: "smooth", block: "center" });
    // Re-set, so a second press on the same link lights it again.
    element.removeAttribute(FLASH);
    void element.offsetWidth;
    element.setAttribute(FLASH, "");
    window.setTimeout(() => element.removeAttribute(FLASH), FLASH_MS);
    // NOTHING IS FOCUSED. The first control in a bill's Columns panel is
    // "Ask the model to read the columns", which is charged: a link that put
    // the keyboard on it would make Enter spend money.
  };
  attempt();
}
