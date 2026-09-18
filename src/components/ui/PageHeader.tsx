// The white band at the top of a screen: where you are, what it is, and what
// you came here to do.
//
// ============================================================================
// THE ONE h1, AND IT IS ALWAYS 1100 WIDE.
//
// Screens had a heading, a subtitle and their actions arranged differently on
// every one, and two of them had two `<h1>`s. A reader arriving on a page has
// three questions in a fixed order — where am I, what is this, what can I do —
// and the band answers them in that order so the answer is in the same place
// every time.
//
// The band itself is full-bleed white across the viewport; its CONTENTS are
// held at 1100 even when the body under it is `wide`. That is deliberate and it
// is the mock-up's own measurement: the crumb, the title and the actions are
// read as a sentence, and a sentence 1400px long is a worse one. The spec table
// under it still gets its 1400, because a grid somebody works across is not a
// sentence.
//
// Tabs live INSIDE the band, below the row, because a tab strip belongs to the
// page's identity rather than to its content — the content is what changes when
// you press one.
// ============================================================================
import Link from "next/link";

export default function PageHeader({
  crumbs,
  title,
  titleAside,
  subtitle,
  actions,
  tabs,
}: {
  /** Where this screen sits. The first gets a `←`, because it is the way back. */
  crumbs?: { label: React.ReactNode; href?: string }[];
  title: React.ReactNode;
  /** A pill or a chip beside the title — a state, never an action. */
  titleAside?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Buttons at the right. At most one `primary`. */
  actions?: React.ReactNode;
  /** A `<Tabs>`, rendered below the row inside the same 1100. */
  tabs?: React.ReactNode;
}) {
  return (
    <div className={`border-b border-neutral-200 bg-white pt-4 ${tabs ? "" : "pb-4"}`}>
      <div className="mx-auto max-w-[1100px] px-5">
        <div className="flex items-start gap-3.5">
          <div className="min-w-0">
            {crumbs && crumbs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                {crumbs.map((crumb, index) => (
                  <span key={index} className="inline-flex items-center gap-1.5">
                    {index > 0 && <span aria-hidden>·</span>}
                    {crumb.href ? (
                      <Link href={crumb.href} className="no-underline hover:underline">
                        {index === 0 && <span aria-hidden>← </span>}
                        {crumb.label}
                      </Link>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            <h1 className="mt-0.5 text-h1 font-semibold tracking-tight text-neutral-900">
              {title}
              {titleAside && <span className="ml-1.5 align-middle">{titleAside}</span>}
            </h1>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-neutral-500">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {tabs && <div className="mt-3.5">{tabs}</div>}
      </div>
    </div>
  );
}
