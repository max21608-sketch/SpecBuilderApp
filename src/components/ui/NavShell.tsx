"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

type Me = {
  authed: boolean;
  environment?: { appEnv: string; databaseEnvironment: string };
};

// The app's top-level sections. Keep this list short — it is a workflow, not
// a sitemap, and it should read in the order the work happens. Deliberately
// empty until M1 ships a screen: an empty nav is honest, a nav of dead links
// is not.
const NAV: { href: string; label: string }[] = [];

export default function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ authed: false }));
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
    `shrink-0 whitespace-nowrap px-3 py-1.5 rounded text-sm font-medium ${
      pathname?.startsWith(href) ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link className="font-semibold text-neutral-900 shrink-0 hover:text-neutral-600" href="/dashboard">
              Project Spec Builder
            </Link>
            {/* A second environment marker beside the banner: the banner scrolls
                away, this does not. */}
            {me?.environment && me.environment.appEnv !== "production" && (
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-400 rounded px-1.5 py-0.5">
                {me.environment.appEnv}
              </span>
            )}
            <nav className="flex gap-0.5 ml-4 overflow-x-auto min-w-0">
              {NAV.map((item) => (
                <Link key={item.href} className={linkClass(item.href)} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-neutral-600">
            <button onClick={logout} className="px-2 py-1 rounded hover:bg-neutral-200">
              Log out
            </button>
          </div>
        </div>
        {logoutError && (
          <p className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{logoutError}</p>
        )}
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
