// Fuzzy matching of an extracted free-text name against an existing register.
// Pure functions, no DB or network — deliberately formalized here rather than
// living in a one-off import script, so every intake path shares the logic.
//
// The core rule, learned the hard way during a manual data import on the
// fabric-ordering app: NEVER silently resolve an ambiguous or unmatched name.
// A raw name like "Sanderson" can plausibly mean a standalone contact ("Ian
// Sanderson") or a distributor entry ("Sanderson Design Group"). Guessing
// wrong silently links a record to the wrong real-world business entity, and
// nothing downstream will ever question it. When more than one candidate ties
// for the best score, or nothing clears the confidence cutoff, the caller must
// leave the field blank for a human to resolve — never auto-pick.
//
// The three-state result IS the safety property. A boolean "did it match"
// collapses `ambiguous` into either a wrong guess or a silent miss; keep the
// distinction all the way to the UI, where ambiguity becomes clickable
// candidates rather than a blank.

export type MatchCandidate = { id: string; name: string };

export type MatchResult =
  | { status: "confident"; id: string; name: string }
  | { status: "ambiguous"; candidates: MatchCandidate[] }
  | { status: "none" };

const SCORE_CUTOFF = 0.8;

// Placeholder values that look like names but are not entities.
// Every register this company keeps accumulates these ("TBC", "for tender",
// the company's own name used as a sentinel). Matching one of them is always
// wrong, so they are refused before scoring rather than ranked badly.
// Note the scope: this is about matching an entity NAME (a supplier, a
// material) where "TBC" means "nobody filled this in". It is unrelated to
// spec_values.state, where `tbc` is a real, deliberate answer distinct from
// missing — see CLAUDE.md. Do not let the two meanings merge.
export const NAME_DENYLIST = new Set<string>(["tbc", "n a", ""]);

export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bc\/o\b.*$/i, "") // strip "c/o ..." agent/distributor suffixes
    .replace(/\blimited\b/gi, "ltd")
    .replace(/[&,.\-;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordSet(raw: string): Set<string> {
  return new Set(normaliseName(raw).split(" ").filter((w) => w.length > 1));
}

// Word overlap divided by the SMALLER of the two word counts, so a short raw
// name fully contained in a long register name still scores 1. Dividing by the
// candidate length alone would penalise every verbose register entry.
export function scoreMatch(rawWords: Set<string>, candidateWords: Set<string>): number {
  const overlap = [...candidateWords].filter((w) => rawWords.has(w)).length;
  const denom = Math.min(candidateWords.size, rawWords.size) || 1;
  return overlap / denom;
}

// Returns EVERY candidate tied at the best score, not the first one. The tie is
// the signal that the caller must not choose.
export function findBestMatches(raw: string, candidates: MatchCandidate[]): MatchCandidate[] {
  const norm = normaliseName(raw);
  const exact = candidates.find((c) => normaliseName(c.name) === norm);
  if (exact) return [exact];

  const rawWords = wordSet(raw);
  let bestScore = 0;
  let best: MatchCandidate[] = [];
  for (const c of candidates) {
    const score = scoreMatch(rawWords, wordSet(c.name));
    if (score > bestScore) {
      bestScore = score;
      best = [c];
    } else if (score === bestScore && score > 0) {
      best.push(c);
    }
  }
  return bestScore >= SCORE_CUTOFF ? best : [];
}

// The generic entry point. Wrap it per register when that register needs extra
// passes (e.g. a code-first exact match before the fuzzy name pass), but keep
// the three-state contract intact.
export function matchName(
  raw: string | null | undefined,
  candidates: MatchCandidate[],
  denylist: Set<string> = NAME_DENYLIST,
): MatchResult {
  if (!raw || !raw.trim()) return { status: "none" };
  if (denylist.has(normaliseName(raw))) return { status: "none" };

  const found = findBestMatches(raw, candidates);
  if (found.length === 1) {
    const match = found[0];
    if (match) return { status: "confident", id: match.id, name: match.name };
  }
  if (found.length > 1) return { status: "ambiguous", candidates: found };
  return { status: "none" };
}
