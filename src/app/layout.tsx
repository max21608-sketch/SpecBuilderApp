import type { Metadata } from "next";
import "./globals.css";
import { currentAppEnvIsProduction } from "@/lib/env";

// The [STAGING] suffix is not decoration. It is how someone with several tabs
// open tells, from the tab title alone, which one is real before they type
// into it.
export const metadata: Metadata = {
  title: currentAppEnvIsProduction()
    ? "Ben Whistler — Project Spec Builder"
    : "Ben Whistler — Project Spec Builder [STAGING]",
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
