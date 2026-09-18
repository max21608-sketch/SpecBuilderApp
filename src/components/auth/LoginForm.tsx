"use client";

// The sign-in form. Client-side because it posts and redirects; nothing else
// about this page is.
//
// It is split out from `page.tsx` so that page can be a SERVER component and
// render `EnvironmentChip` — which reads `APP_ENV` on the server, so an unset
// value fails toward showing the marker. "Which one am I on" is a question
// people get wrong BEFORE they sign in, not after, so the marker has to be on
// this page and it has to fail the safe way.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import Button from "@/components/ui/Button";

const LABEL = "block text-[11px] font-medium uppercase tracking-wider text-neutral-500";
const INPUT = "mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-[13px]";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/dashboard");
    } finally {
      // Always, so a response that is not JSON cannot leave the button dead.
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-[10px] border border-neutral-200 bg-white p-6">
      <label className={LABEL}>
        Email
        <input
          type="email"
          required
          autoComplete="username"
          placeholder="you@benwhistler.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT}
        />
      </label>
      <label className={`${LABEL} mt-3.5`}>
        Password
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] text-red-700">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" disabled={loading} className="mt-4 w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
