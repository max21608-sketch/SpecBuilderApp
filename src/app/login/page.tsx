"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";

export default function LoginPage() {
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
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-start justify-center bg-neutral-50 px-4 pt-[12vh]">
      <div className="w-full max-w-sm">
        {/* The name above the card rather than inside it, so the card is the
            form and nothing else. The environment banner is already in the root
            layout and therefore already on this page — which is the point:
            "which one am I on" is a question people get wrong BEFORE they sign
            in, not after. */}
        <div className="mb-5 text-center">
          <h1 className="text-lg font-semibold text-neutral-900">Project Spec Builder</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Ben Whistler</p>
        </div>
      <form onSubmit={onSubmit} className="bg-white border border-neutral-200 rounded-lg p-8 w-full shadow-sm">
        <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-neutral-300 rounded px-3 py-2 mb-4 text-sm"
        />
        <label className="block text-sm font-medium text-neutral-700 mb-1">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-neutral-300 rounded px-3 py-2 mb-4 text-sm"
        />
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-neutral-900 text-white rounded py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
        {/* There is no self-signup and there is no password reset, so somebody
            who cannot get in has to be told who can let them in rather than
            hunting for a link that does not exist. `npm run create-user`. */}
        <p className="mt-4 text-center text-xs text-neutral-500">
          There is no self-signup. Ask an administrator for an account.
        </p>
      </div>
    </div>
  );
}
