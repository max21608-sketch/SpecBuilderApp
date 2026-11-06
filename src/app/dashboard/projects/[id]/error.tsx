"use client";
// The project screen's error boundary (audit G4). The way back is the
// project's own page with no tab, because a tab is the likeliest thing to have
// thrown (a phase table, the finishes library) and the overview reads the
// least.
import { useParams } from "next/navigation";
import ScreenError, { type ScreenErrorProps } from "@/components/layout/ScreenError";

export default function ProjectError(props: ScreenErrorProps) {
  const { id } = useParams<{ id: string }>();
  return <ScreenError {...props} back={{ href: `/dashboard/projects/${id}`, label: "Open the project page" }} />;
}
