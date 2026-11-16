// Every /dashboard address no other route claims (review 3.4, 2026-11-16).
// A catch-all ranks below every static and dynamic route, so it never shadows
// a real screen; it exists so the dashboard's own `not-found.tsx` renders
// inside the shell instead of the root one outside it.
import { notFound } from "next/navigation";

export default function MissingDashboardPage(): never {
  notFound();
}
