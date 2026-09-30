// The record screen's h1: its short label and the item's name, cut to one line.
//
// The name is the bill's own words, and a bill can print a long one
// (`Bedframe & Headboard - TWIN (X18 = BED BASES - X1 HEADBOARD PER X2 BED
// BASES)`); before the name was split from the rest of its cell the h1 was the
// WHOLE description, finishes and sizes included, and stood four lines tall
// above the tabs. Cut as a STRING with `clampText`, never with CSS
// `line-clamp` (docs/design-language.md, the DOM rules): the full text is the
// title attribute and the Description on the record itself, so nothing is
// hidden that cannot be read one hover away.
import { clampText } from "@/lib/shout";

/** How much of a name the h1 carries before it is cut. */
export const RECORD_TITLE_CHARS = 80;

export default function RecordTitle({ label, name }: { label: string; name: string }) {
  const { clamped, wasClamped } = clampText(name, 1, RECORD_TITLE_CHARS);
  return (
    <span title={wasClamped ? name : undefined}>
      {label} · {clamped}
    </span>
  );
}
