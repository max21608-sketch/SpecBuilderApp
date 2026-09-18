// A real `<table>`, with the two DOM traps this app has already paid for.
//
// ============================================================================
// THE WRAPPER IS NEVER `overflow-hidden`.
//
// It is the obvious way to make a rounded border clip the first and last rows,
// and it makes the wrapper the sticky scroll container. The column header then
// offsets down from the top of the TABLE rather than the viewport and sits on
// top of a furniture line — a row nobody would know to look for, because it is
// covered by the thing you are reading. Found on the chase screen; the
// rounding is worth less than the row.
//
// So `scroll` is opt-in and it is `overflow-x-auto`, for the tables that
// genuinely cannot drop a column. A table that fits does not get a scroll
// container at all.
//
// THERE IS NO `divide-y` ANYWHERE, and that is the second trap. A spanning
// panel — the drawings card's replace acknowledgement, the review row's run
// list — is its OWN `<tr>`, never an extra `<td colSpan>` beside the data
// cells: a row with seven data cells and two `colSpan={7}` panels is 21 column
// slots wide, and the browser finds room for the panels BESIDE the data,
// squeezing the control that decides whether a confirmed spec is destroyed into
// a 100px ribbon. Once the panel is its own row, `divide-y` on the tbody draws
// a divider between a value and its own panel. `Td` carries its own bottom
// border instead, so a panel row can leave it off.
// ============================================================================
import type { ComponentProps } from "react";
import { TONE, type Tone } from "./tone";

export function Table({
  scroll = false,
  className = "",
  children,
}: {
  /** Wrap in `overflow-x-auto`. Only for a table that cannot drop a column. */
  scroll?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const table = <table className={`w-full border-collapse text-cell ${className}`.trim()}>{children}</table>;
  return scroll ? <div className="overflow-x-auto">{table}</div> : table;
}

export function Th({
  num = false,
  className = "",
  children,
  ...rest
}: ComponentProps<"th"> & { num?: boolean; className?: string }) {
  return (
    <th
      className={`border-b border-neutral-200 bg-[#fcfcfc] px-4 py-2 text-th font-semibold uppercase tracking-wider text-neutral-500 ${
        num ? "text-right tabular-nums" : "text-left"
      } ${className}`.trim()}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  num = false,
  mono = false,
  muted = false,
  className = "",
  children,
  ...rest
}: ComponentProps<"td"> & { num?: boolean; mono?: boolean; muted?: boolean; className?: string }) {
  return (
    <td
      className={`border-b border-neutral-100 px-4 py-2.5 align-top ${num ? "text-right tabular-nums" : ""} ${
        mono ? "font-mono" : ""
      } ${muted ? "text-neutral-500" : ""} ${className}`.trim()}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({
  tone = "plain",
  className = "",
  children,
  ...rest
}: ComponentProps<"tr"> & { tone?: Tone; className?: string }) {
  return (
    <tr className={`hover:bg-[#fcfcfc] ${TONE[tone].row} ${className}`.trim()} {...rest}>
      {children}
    </tr>
  );
}

/**
 * A heading row inside the body — a section, a group, a bill line.
 *
 * `aside` is in normal case beside the uppercase label, for the half-sentence
 * that says what the group MEANS ("these are the ones nothing can be suggested
 * for"). Uppercase tracking turns that into something to decipher.
 */
export function GroupRow({
  span,
  aside,
  children,
}: {
  span: number;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={span}
        className="bg-neutral-50 px-4 py-1.5 text-th font-bold uppercase tracking-wider text-neutral-500"
      >
        {children}
        {aside && <span className="ml-2 font-medium normal-case tracking-normal">{aside}</span>}
      </td>
    </tr>
  );
}
