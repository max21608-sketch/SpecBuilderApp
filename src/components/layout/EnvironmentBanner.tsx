// Server component: reads APP_ENV directly (no client-side exposure needed)
// and renders nothing at all in production, so there is no "hidden until
// toggled" state that could leak a sandbox banner onto the real site. Uses
// the non-throwing env read (not getEnvironment()) so a misconfigured or
// unset APP_ENV fails toward SHOWING this banner, not toward crashing the
// page or silently hiding it.
import { currentAppEnvIsProduction } from "@/lib/env";

export default function EnvironmentBanner() {
  if (currentAppEnvIsProduction()) return null;

  return (
    <div className="bg-amber-100 border-b-2 border-amber-500 text-amber-900 text-sm text-center py-2 px-4 font-medium">
      SANDBOX / STAGING ENVIRONMENT — This website contains test data and is
      not the official production system.
    </div>
  );
}
