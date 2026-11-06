"use client";
// The record screen's error boundary (audit G4). The record's project is in
// the data that failed, not in the URL, so the way back is the projects list.
import ScreenError, { type ScreenErrorProps } from "@/components/layout/ScreenError";

export default function RecordError(props: ScreenErrorProps) {
  return <ScreenError {...props} back={{ href: "/dashboard/projects", label: "Open the projects list" }} />;
}
