// An address under /dashboard that leads nowhere (review 3.4, 2026-11-16),
// shown INSIDE the shell, nav bar and all. Next renders a segment's
// not-found only for `notFound()` thrown beneath it, never for an unmatched
// URL — that goes to the root one — so `[...missing]/page.tsx` beside this
// file catches every address no other dashboard route claims and throws it.
import NotFoundScreen from "@/components/layout/NotFoundScreen";

export default function DashboardNotFound() {
  return <NotFoundScreen />;
}
