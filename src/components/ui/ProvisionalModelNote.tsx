// A gate model nobody has confirmed, said where its numbers are shown.
//
// ============================================================================
// THE WORDS ARE THE SEED'S, NEVER THIS FILE'S (0061, seed 0014).
//
// `spec_matrix_categories.provisional_note` carries the sentence ("Provisional
// cabinetry gate model, drafted by AI on 20 Nov 2026, not yet confirmed by
// Matthew"), and every screen that shows a gate view or a TGQ count from such
// a type prints it through this component. Nothing here decides WHETHER a
// model is provisional — no row-number test, no family test — and nothing
// here holds the sentence, so the day Matthew confirms the model is a re-seed
// setting the column null, and every label goes with it.
//
// Amber, because it needs a person (Matthew's confirmation), and it is not
// an error. Conditional on the data, so it is a Note and not a Tip: a reader
// who never hovers would otherwise take an AI draft for his rules.
// ============================================================================
import Note from "./Note";

export default function ProvisionalModelNote({
  notes,
  suffix,
  className = "",
}: {
  /** The seed's sentences, as loaded. Empty or null renders nothing. */
  notes: readonly (string | null | undefined)[] | string | null | undefined;
  /** What the note covers on this screen, e.g. "3 items on this phase". */
  suffix?: React.ReactNode;
  className?: string;
}) {
  const list = (Array.isArray(notes) ? notes : [notes]).filter((note): note is string => Boolean(note && note.trim()));
  const distinct = [...new Set(list)];
  if (distinct.length === 0) return null;
  return (
    <Note tone="warn" className={className}>
      {distinct.join(". ")}
      {suffix ? <> — {suffix}</> : null}.
    </Note>
  );
}
