// How wide a screen is, decided in one place.
//
// ============================================================================
// TWO WIDTHS, NOT FIVE.
//
// Every dashboard page constrained itself, and no two agreed: `max-w-6xl` on
// three files, `max-w-5xl` on the inbox, `max-w-4xl` on the record, `max-w-3xl`
// on the landing page, nothing at all on three more — all of them inside a
// `<main>` that was already `max-w-7xl`. A reader moving between screens sees
// the content jump in and out by a couple of hundred pixels with nothing about
// the work to explain it, and the CLAUDE.md sentence claiming every screen is
// `max-w-5xl` was describing none of them.
//
//   std   1100px — reading and deciding: a project, a record, a pack, a list.
//   wide  1400px — a grid somebody works ACROSS: the spec table, the chase
//                  screen, the three review screens. These earn the width by
//                  having columns that cannot be dropped, not by having more
//                  content.
//   full  no cap — nothing uses it yet. It is here so that a screen which
//                  genuinely needs the viewport says so, rather than inventing
//                  a sixth number.
//
// The HEADER band does not use this: `PageHeader` is fixed at 1100 even over a
// `wide` body, because the title, the crumb and the actions are read as a
// sentence and a sentence 1400px long is a worse one.
// ============================================================================

export type PageWidth = "std" | "wide" | "full";

const PAGE_WIDTH: Record<PageWidth, string> = {
  std: "max-w-[1100px]",
  wide: "max-w-[1400px]",
  full: "",
};

export default function PageBody({
  width = "std",
  className = "",
  children,
}: {
  width?: PageWidth;
  /** Layout only. A width here is the thing this component exists to stop. */
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`mx-auto w-full px-5 py-5 ${PAGE_WIDTH[width]} ${className}`.trim()}>{children}</div>;
}
