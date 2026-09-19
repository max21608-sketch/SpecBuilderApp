import type { Metadata } from "next";
import "./globals.css";
import { currentEnvLabel } from "@/lib/env";

// The [STAGING] suffix is not decoration. It is how someone with several tabs
// open tells, from the tab title alone, which one is real before they type
// into it. On the pilot build it reads [PILOT], from the SAME function the
// chip reads: a tab saying [STAGING] beside a chip saying PILOT is a
// screenshot that names two builds.
const marker = currentEnvLabel();

export const metadata: Metadata = {
  title: marker
    ? `Ben Whistler — Project Spec Builder [${marker}]`
    : "Ben Whistler — Project Spec Builder",
  description: "Structured, auditable project specification records from tender to delivery.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* The size, the colour and the ground are all in `globals.css`'s base
          layer now, so this element carries layout and nothing else. */}
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
