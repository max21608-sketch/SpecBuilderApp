// Searching Capsule for a person to make a project contact.
//
// A session is required and a writer role is not: this reads an external
// system and writes nothing anywhere. With no token configured it answers 503
// with the reason, so the contacts form can say why the search is unavailable
// and stay usable by hand.
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import {
  CapsuleNotConfiguredError,
  CapsuleUpstreamError,
  isCapsuleConfigured,
  searchParties,
} from "@/lib/capsule";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);

  const term = (new URL(request.url).searchParams.get("q") ?? "").trim();
  // Two characters is the shortest search worth spending a call on, and it
  // stops an empty field firing one on every keystroke.
  if (term.length < 2) {
    return json({ ok: false, error: "Type at least two characters to search Capsule." }, 400);
  }

  if (!isCapsuleConfigured()) {
    return json(
      { ok: false, code: "capsule_not_configured", error: new CapsuleNotConfiguredError().message },
      503,
    );
  }

  try {
    return json({ ok: true, parties: await searchParties(term) });
  } catch (cause) {
    if (cause instanceof CapsuleNotConfiguredError) {
      return json({ ok: false, code: "capsule_not_configured", error: cause.message }, 503);
    }
    if (cause instanceof CapsuleUpstreamError) {
      return json({ ok: false, code: "capsule_upstream", error: cause.message }, 502);
    }
    throw cause;
  }
}
