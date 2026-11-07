"use client";

// One line of the project overview's Specifications card. Moved out of
// src/app/dashboard/projects/[id]/page.tsx on 2026-11-07 (audit 5.3, cut B),
// because LevelsBanner renders one too.
import Link from "next/link";
import { Td, Tr } from "@/components/ui/Table";

/**
 * One line of the Specifications card: a count, what it means, and the control
 * that acts on it.
 *
 * THE FIGURE AND ITS FIX TRAVEL TOGETHER. A number with no action beside it
 * makes somebody go and find the screen it belongs to, which is the whole
 * complaint about this page — and the count itself is the link, so there are
 * two ways to the same place rather than one.
 *
 * A ROW WITH A COUNT OF ZERO STILL RENDERS, and that is the change worth
 * stating: every one of these is a CHECK, and a check that disappears when it
 * passes is a check nobody knows is being made. It renders plain instead —
 * no colour, no button — so the eye goes to the rows that want something.
 */
export default function SummaryRow({
  label,
  count,
  meaning,
  tone,
  action,
  href,
}: {
  label: string;
  count: number;
  meaning: React.ReactNode;
  tone: "danger" | "warn" | "info";
  /** The control beside the figure. Only rendered when there is something to do. */
  action?: React.ReactNode;
  href?: string | null;
}) {
  const live = count > 0;
  const colour =
    !live
      ? "text-neutral-400"
      : tone === "danger"
        ? "text-red-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-blue-700";
  return (
    <Tr>
      <Td className="w-[26%] align-top">
        {href && live ? (
          <Link href={href} className="font-semibold text-neutral-900 no-underline hover:underline">
            {label}
          </Link>
        ) : (
          <span className={`font-semibold ${live ? "text-neutral-900" : "text-neutral-500"}`}>{label}</span>
        )}
      </Td>
      <Td num className={`w-[10%] align-top text-[15px] font-semibold ${colour}`}>
        {href && live ? (
          <Link href={href} className="text-inherit no-underline hover:underline">
            {count.toLocaleString()}
          </Link>
        ) : (
          count.toLocaleString()
        )}
      </Td>
      <Td className={`align-top ${live ? "text-neutral-600" : "text-neutral-400"}`}>{meaning}</Td>
      <Td className="w-[24%] align-top">
        <div className="flex flex-wrap justify-end gap-1.5">{live ? action : null}</div>
      </Td>
    </Tr>
  );
}
