"use client";

// The app chrome: a dark bar, and everything under it.
//
// ============================================================================
// THE SHELL OWNS NO WIDTH.
//
// `<main>` used to be `max-w-7xl mx-auto px-4 py-6`, and every page then
// constrained itself again to something different inside it. Two components
// deciding one width is how the app ended up with five. The shell is now
// `flex-1 w-full` and the page decides, through `PageBody` and `PageHeader` —
// which is what lets a header band be full-bleed white across the viewport with
// its own contents held at 1100.
//
// The bar is dark because it is chrome and the work is not: a white bar over a
// white header band over a white card gives the eye no edge to find, and the
// approved mock-ups draw the separation this way.
// ============================================================================
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { TONE } from "./tone";

// The app's top-level sections. Keep this list short — it is a workflow, not
// a sitemap, and it should read in the order the work happens.
const NAV: { href: string; label: string }[] = [
  { href: "/dashboard/projects", label: "Projects" },
  // The inbox is project-less by nature: an email that could not be placed
  // belongs to no project screen, and is invisible unless it has its own way in.
  { href: "/dashboard/inbox", label: "Inbox" },
];

// LOG OUT IS A BUTTON ON A DARK BAR, AND `Button` HAS NO DARK VARIANT.
//
// `quiet` is the right EMPHASIS for it — a real action, offered low — but its
// classes are built for a light ground: `text-neutral-600` on `#171717` is
// unreadable and its hover paints a white box. So the classes live here, once,
// scoped to the one surface that needs them.
//
// Not a fifth `Button` variant, deliberately. The four variants grade an
// action's CONSEQUENCE — primary, secondary, danger, quiet — and "sits on the
// dark bar" is not a consequence, it is a location. A `dark` variant would be
// reachable from every screen in the app and would mean nothing on any of them,
// which is exactly the drift the four-variant rule exists to prevent.
const DARK_BUTTON =
  "inline-flex items-center gap-1 rounded-[5px] border border-transparent px-2.5 py-1 text-[13px] text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-50";

export default function NavShell({
  envChip,
  children,
}: {
  /**
   * The environment marker, rendered by the server layout and passed in as an
   * element.
   *
   * It has to arrive this way: `EnvironmentChip` reads `APP_ENV` on the server
   * so an UNSET value fails toward SHOWING the marker, and this is a client
   * component that cannot import it. Fetching it from the client instead would
   * fail toward HIDING it — a network blip on the staging deployment would
   * render the bar clean, which is the one failure this marker exists to
   * prevent.
   */
  envChip?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [unplaced, setUnplaced] = useState<number | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // Once, on mount. A bubble that is a few minutes stale is a prompt to look,
  // not a figure anybody acts on, and polling the chrome on every screen buys
  // nothing worth a query per tab per minute. A failure leaves it null and the
  // bubble simply does not render — the inbox is still one click away, and an
  // invented zero would be a claim.
  useEffect(() => {
    let live = true;
    void apiFetch<{ unplaced: number }>("/api/email-messages/count").then((res) => {
      if (!live) return;
      if (res.ok && typeof res.data.unplaced === "number") setUnplaced(res.data.unplaced);
    });
    return () => {
      live = false;
    };
  }, []);

  async function logout() {
    const res = await apiFetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) {
      setLogoutError(`Could not sign you out — your session may still be active. ${res.error}`);
      return;
    }
    setLogoutError(null);
    router.push("/login");
  }

  const linkClass = (href: string) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 py-1 text-[13px] no-underline ${
      pathname?.startsWith(href) ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/10"
    }`;

  return (
    <div className="flex min-h-screen flex-col">
      <header>
        <div className="flex items-center gap-4 bg-neutral-900 px-5 py-2 text-[13px] text-white">
          <Link className="shrink-0 font-semibold text-white no-underline" href="/dashboard">
            Project Spec Builder
          </Link>
          {envChip}
          <nav className="flex min-w-0 gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link key={item.href} className={linkClass(item.href)} href={item.href}>
                {item.label}
                {item.href === "/dashboard/inbox" && unplaced !== null && unplaced > 0 && (
                  <span
                    // Red, because an email nobody has placed is the one thing
                    // here that stops a quotation going out.
                    className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${TONE.danger.bubble}`}
                    title={`${unplaced} email${unplaced === 1 ? "" : "s"} nobody has placed on a project`}
                  >
                    {unplaced}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <span className="flex-1" />
          <button type="button" onClick={logout} className={DARK_BUTTON}>
            Log out
          </button>
        </div>
        {logoutError && (
          <p className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700" role="alert">
            {logoutError}
          </p>
        )}
      </header>
      <main className="w-full flex-1">{children}</main>
    </div>
  );
}
