import type { Metadata } from "next";
import "./globals.css";
import { currentAppEnvIsProduction } from "@/lib/env";
import EnvironmentBanner from "@/components/layout/EnvironmentBanner";

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
      <body className="min-h-screen antialiased">
        <EnvironmentBanner />
        {children}
      </body>
    </html>
  );
}
