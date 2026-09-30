import { Fragment } from "react";

/**
 * A CLIENT REF NEVER BREAKS INSIDE ITSELF. A browser may wrap at a hyphen, so
 * in a squeezed column `GR-FUR-10` came out as three lines of `GR-` / `FUR-`
 * / `10` — which reads as three codes, and as a dash that is not the bill's.
 * Each ref is its own no-wrap run, printed exactly as the bill wrote it (the
 * cell is the stored `ref_value`, ASCII hyphens and all — nothing on the way
 * rewrites a dash); a list of several still wraps BETWEEN them, at the comma.
 */
export function ClientRefs({ code }: { code: string }) {
  const parts = code.split(", ");
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 && ", "}
          {/* No break INSIDE a word of the ref, where the hyphens are; a ref
              the bill wrote with spaces in it (`GR-FAB-13 (GR / MUR-FUR-04)`)
              may still wrap at those spaces. A whole long ref kept on one
              line held the column at 250px and pushed TG1 off the screen. */}
          {part.split(/(\s+)/).map((token, at) =>
            /^\s+$/.test(token) || token === "" ? (
              token
            ) : (
              <span key={at} className="whitespace-nowrap">
                {token}
              </span>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}
