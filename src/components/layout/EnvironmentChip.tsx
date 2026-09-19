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
//
// PILOT IS A DIFFERENT COLOUR, and that is the point of the value existing
// (2026-09-19, plan 1.16). Matthew reports by screenshot; staging is pushed to
// hourly and pilot is not, so a screenshot that cannot say which build it came
// from sends somebody looking for a defect in the wrong code. The colour comes
// from `tone.ts` — `live`, SKY, the ordinary working state — because a class
// string written anywhere else is one Tailwind's JIT may not read, and an
// unstyled chip is the one that says nothing.
import { currentEnvLabel } from "@/lib/env";
import { TONE } from "@/components/ui/tone";

// STAGING and DEV keep the mock-up's own solid yellow verbatim; only PILOT is
// new, so only PILOT needs a tone.
const COLOUR: Record<"DEV" | "STAGING" | "PILOT", string> = {
  DEV: "bg-yellow-400 text-black",
  STAGING: "bg-yellow-400 text-black",
  PILOT: TONE.live.bubble,
};

export default function EnvironmentChip() {
  const label = currentEnvLabel();
  if (!label) return null;
  return (
    <span
      className={`inline-block rounded-[3px] px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wider ${COLOUR[label]}`}
      title={
        label === "PILOT"
          ? "The pilot build. Its own database — not staging, and not the production system."
          : "Not the production system. Test data lives here."
      }
    >
      {label}
    </span>
  );
}
