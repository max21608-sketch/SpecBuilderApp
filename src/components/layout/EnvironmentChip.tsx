// The environment marker: which deployment this is, on every page including
// sign-in.
//
// Server component, reading APP_ENV directly with the non-throwing helper, so
// it never crashes a render and an UNSET value fails toward SHOWING the chip.
// It returns nothing at all in production, so there is no hidden-until-toggled
// state that could leak a sandbox marker onto the real site.
//
// This replaced the full-width amber banner on 2026-09-18, at Max's decision,
// to match the approved mock-ups. It is rendered by server layouts and passed
// INTO client components (`NavShell`, the login page) as an element, which is
// what keeps the fail-toward-showing property: a client-side fetch that failed
// would fail toward hiding it.
import { currentAppEnvIsProduction } from "@/lib/env";

export default function EnvironmentChip() {
  if (currentAppEnvIsProduction()) return null;
  const label = process.env.APP_ENV === "development" ? "DEV" : "STAGING";
  return (
    <span
      className="inline-block rounded-[3px] bg-yellow-400 px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wider text-black"
      title="Not the production system. Test data lives here."
    >
      {label}
    </span>
  );
}
