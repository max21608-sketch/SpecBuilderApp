"use client";
// The dashboard's error boundary (audit G4): a screen that throws while it
// renders shows a Note inside the shell instead of a white page. Rendered
// inside `layout.tsx`, so the nav bar stays. See `ScreenError`.
import ScreenError, { type ScreenErrorProps } from "@/components/layout/ScreenError";

export default function DashboardError(props: ScreenErrorProps) {
  return <ScreenError {...props} back={{ href: "/dashboard/projects", label: "Open the projects list" }} />;
}
