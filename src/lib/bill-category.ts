// A bill line's category: what the review OFFERS, and what the confirm WRITES.
//
// ============================================================================
// ONLY A PERSON'S CHOICE BECOMES THE RECORD'S CATEGORY (audit 2026-11-06, G8;
// Max's decision the same day: "follow the rule").
//
// The staging guesses a category from the line's name (`suggestCategory`) and
// stores it on the line as `suggested`. Until this file, the review pre-filled
// the select with that guess and the confirm wrote `categoryId` whatever the
// status said. Two consequences, both the level picker's trap:
//
//   - a reviewer could not AGREE with the guess: re-picking the option a
//     select already shows fires no change event, so the one act that would
//     have recorded their agreement did nothing;
//   - a guess nobody looked at became the record's category, and the category
//     is what creates the checklist (`spec_answers` rows) and decides which
//     cheat sheet the record is held to.
//
// So the guess is a `SuggestButton` with its evidence, the select is empty
// until somebody picks or accepts, and the confirm writes a category only
// where the status is `chosen`. A line nobody categorised confirms with none,
// exactly as an unsuggested line always has ("Category no longer blocks
// intake"): it can be set on the record afterwards, which creates its
// questions there.
//
// ONE function for each half, read by the screen's count and by the confirm,
// so "accepts 212 suggestions" is the number the confirm will then write.
// A leaf with no imports: the review is a client component.
// ============================================================================

export type BillLineCategory = {
  categoryId: string | null;
  categoryStatus?: string | null;
  ignored?: boolean;
};

/** The category the confirm writes into `spec_records.category_id`: a person's, or none. */
export function categoryToWrite(line: BillLineCategory): string | null {
  return line.categoryStatus === "chosen" ? line.categoryId : null;
}

/**
 * The app's guess, still waiting for a person: the line carries a category and
 * nobody chose it. `suggested`, and `confident` on a bill staged before that
 * word was settled, both land here; `ambiguous` and `none` carry no id.
 */
export function suggestedCategoryId(line: BillLineCategory): string | null {
  return line.categoryId && line.categoryStatus !== "chosen" ? line.categoryId : null;
}
