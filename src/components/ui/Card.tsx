// A titled box. One section of a screen, that you can deal with separately
// from the ones above and below it.
//
// The heading is small, uppercase and grey rather than large and black, which
// looks backwards until you count them: a project screen has eight sections,
// and eight black headings compete with the h1 and with each other. The
// heading's job is to let you FIND the section, not to be read; what is inside
// it is the content.
//
// `flush` drops the body padding, for a section whose whole content is a table
// — the cells carry their own padding, and a table inset by 16px inside a
// bordered box reads as a box inside a box.
export default function Card({
  title,
  actions,
  flush = false,
  className = "",
  children,
}: {
  title?: React.ReactNode;
  /** Pushed to the right of the heading. The action that belongs to this box. */
  actions?: React.ReactNode;
  /** No body padding, for a table. */
  flush?: boolean;
  /** Layout only. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-4 rounded-[10px] border border-neutral-200 bg-white ${className}`.trim()}>
      {title && (
        <h2 className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-3 text-th font-bold uppercase tracking-wider text-neutral-500">
          {title}
          {actions && (
            <>
              <span className="flex-1" />
              <span className="flex items-center gap-2">{actions}</span>
            </>
          )}
        </h2>
      )}
      <div className={flush ? "p-0" : "p-4"}>{children}</div>
    </section>
  );
}

/**
 * A muted aside inside a card heading — "12 of 43 here", "read 14 Sept".
 *
 * It exists so the count beside a heading does not inherit the heading's
 * uppercase tracking, which turns a short phrase into something that has to be
 * deciphered rather than read.
 */
export function CardHeadingNote({ children }: { children: React.ReactNode }) {
  return <span className="font-medium normal-case tracking-normal text-neutral-500">{children}</span>;
}
