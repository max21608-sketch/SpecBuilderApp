// Sign in.
//
// A SERVER component, so it can render `EnvironmentChip` — which reads
// `APP_ENV` directly and therefore fails toward SHOWING the marker when the
// variable is unset. The form is the only part that needs a client, and it is
// `LoginForm` next door.
//
// The marker belongs on THIS page above all others: "which one am I on" is a
// question people get wrong before they sign in, not after, and until
// 2026-09-18 it was answered by the full-width banner in the root layout. That
// banner is gone, so the chip is placed here explicitly rather than inherited.
//
// AND IT IS WHERE A MISCONFIGURED DEPLOYMENT SAYS SO. The chip answers "which
// build is this"; it cannot answer "is this build pointed at the right
// database", and on 2026-09-19 a pilot deployment reading the sandbox printed
// a correct PILOT chip over a form that could not sign anybody in. Middleware
// now refuses a mismatched pair everywhere else, and it deliberately does not
// run here — protecting the way in locks everybody out — so this page asks the
// same non-throwing question itself. No database is touched either way.
import EnvironmentChip from "@/components/layout/EnvironmentChip";
import LoginForm from "@/components/auth/LoginForm";
import { environmentProblemMessage } from "@/lib/env";

export default function LoginPage() {
  const misconfigured = environmentProblemMessage();
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-[370px]">
        {/* The name above the card rather than inside it, so the card is the
            form and nothing else. */}
        <div className="mb-5 text-center">
          <div className="text-[17px] font-semibold text-neutral-900">Project Spec Builder</div>
          <div className="mt-0.5 text-xs text-neutral-500">Ben Whistler</div>
        </div>

        {/* ABOVE the form, not under it: the point is that nobody spends a
            minute on a password that was never going to be checked. */}
        {misconfigured && (
          <p className="mb-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] leading-snug text-red-800">
            {misconfigured}
          </p>
        )}

        <LoginForm />

        {/* There is no self-signup and there is no password reset, so somebody
            who cannot get in has to be told who can let them in rather than
            hunting for a link that does not exist. `npm run create-user`. */}
        <p className="mt-3.5 text-center text-[11.5px] text-neutral-500">
          There is no self-signup. Ask an administrator for an account.
        </p>
        <p className="mt-2.5 text-center">
          <EnvironmentChip />
        </p>
      </div>
    </div>
  );
}
