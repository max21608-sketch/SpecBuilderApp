"use client";
// A document review's error boundary (audit G4). The document's project is in
// the data that failed, not in the URL, so the way back is the projects list.
import ScreenError, { type ScreenErrorProps } from "@/components/layout/ScreenError";

export default function ImportError(props: ScreenErrorProps) {
  return <ScreenError {...props} back={{ href: "/dashboard/projects", label: "Open the projects list" }} />;
}
