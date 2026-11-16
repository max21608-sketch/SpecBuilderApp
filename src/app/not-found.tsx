// An address outside /dashboard that leads nowhere (review 3.4, 2026-11-16).
// Rendered in the root layout, so there is no nav bar here; the link back is
// the way into the app, through the sign-in if the session has gone.
import NotFoundScreen from "@/components/layout/NotFoundScreen";

export default function NotFound() {
  return <NotFoundScreen />;
}
