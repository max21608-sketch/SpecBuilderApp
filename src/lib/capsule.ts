// Capsule CRM, read-only.
//
// ============================================================================
// THERE IS NO WRITE VERB IN THIS MODULE, AND THERE MAY NOT BE ONE
//
// Company systems are read-only for this app. Capsule is where the business
// keeps its people, and this module SEARCHES and READS it so a project contact
// can be a modelled party rather than a name somebody typed.
//
// The whole module goes through ONE helper, `capsuleGet`, which hard-codes
// `method: "GET"`. There is no post/patch/delete helper and none may be added:
// "we only ever call GET" is a habit that erodes, and an absent function is a
// fact that does not. `tests/lib/capsule.test.ts` asserts the export surface so
// adding one fails a test rather than a code review.
//
// ---- IT FAILS CLOSED, AND IT IS NOT A RUNTIME DEPENDENCY -----------------
//
// With no token the module throws `CapsuleNotConfiguredError` BEFORE any
// fetch, and the routes turn that into a 503 saying so. Contact name, email
// and organisation are cached on `project_contacts`, so a Capsule outage stops
// somebody LINKING a contact and never stops them chasing one.
//
// Responses are untrusted input like any other external API: parsed with Zod,
// and an upstream error body is never forwarded to the client.
// ============================================================================
import { z } from "zod";

const BASE = "https://api.capsulecrm.com/api/v2";
const TIMEOUT_MS = 8000;

export class CapsuleNotConfiguredError extends Error {
  constructor() {
    super(
      "Capsule is not connected on this deployment (CAPSULE_API_TOKEN is not set). Add the contact by hand for now.",
    );
    this.name = "CapsuleNotConfiguredError";
  }
}

export class CapsuleUpstreamError extends Error {
  status: number;
  constructor(status: number) {
    // The upstream body is deliberately NOT included: it can carry account
    // detail that has no business reaching this app's client.
    super(`Capsule answered ${status}. Try again shortly, or add the contact by hand.`);
    this.name = "CapsuleUpstreamError";
    this.status = status;
  }
}

/** Read lazily, so `next build`, CI and every route that never calls Capsule work with no token. */
export function isCapsuleConfigured(): boolean {
  return Boolean(process.env.CAPSULE_API_TOKEN);
}

const EmailAddress = z.object({ type: z.string().nullish(), address: z.string() });

const Party = z.object({
  id: z.number(),
  type: z.enum(["person", "organisation"]),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  name: z.string().nullish(),
  jobTitle: z.string().nullish(),
  organisation: z.object({ id: z.number(), name: z.string().nullish() }).nullish(),
  emailAddresses: z.array(EmailAddress).nullish(),
  updatedAt: z.string().nullish(),
});

export type CapsuleParty = {
  id: number;
  type: "person" | "organisation";
  name: string;
  jobTitle: string | null;
  organisation: { id: number; name: string } | null;
  emails: string[];
  updatedAt: string | null;
};

function toParty(raw: z.infer<typeof Party>): CapsuleParty {
  const name =
    raw.type === "person"
      ? [raw.firstName, raw.lastName].filter(Boolean).join(" ").trim() || (raw.name ?? "").trim()
      : (raw.name ?? "").trim();
  return {
    id: raw.id,
    type: raw.type,
    name: name || `Capsule party ${raw.id}`,
    jobTitle: raw.jobTitle?.trim() || null,
    organisation: raw.organisation?.id
      ? { id: raw.organisation.id, name: (raw.organisation.name ?? "").trim() }
      : null,
    emails: (raw.emailAddresses ?? []).map((e) => e.address.trim().toLowerCase()).filter(Boolean),
    updatedAt: raw.updatedAt ?? null,
  };
}

/**
 * THE only HTTP call in this module, and it is a GET.
 *
 * Every path is built here from a literal plus encoded parameters: nothing a
 * caller supplies becomes part of the host or the route.
 */
async function capsuleGet(path: string): Promise<unknown> {
  const token = process.env.CAPSULE_API_TOKEN;
  if (!token) throw new CapsuleNotConfiguredError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new CapsuleUpstreamError(response.status);
    return await response.json();
  } catch (cause) {
    if (cause instanceof CapsuleUpstreamError || cause instanceof CapsuleNotConfiguredError) throw cause;
    // A timeout or a socket failure. Same shape as an upstream error so the
    // route says one thing rather than leaking an fetch error's wording.
    throw new CapsuleUpstreamError(504);
  } finally {
    clearTimeout(timer);
  }
}

const SearchResponse = z.object({ parties: z.array(Party).nullish() });
const PartyResponse = z.object({ party: Party.nullish() });

export async function searchParties(term: string): Promise<CapsuleParty[]> {
  const body = await capsuleGet(`/parties/search?q=${encodeURIComponent(term)}&perPage=20`);
  if (body === null) return [];
  const parsed = SearchResponse.safeParse(body);
  if (!parsed.success) throw new CapsuleUpstreamError(502);
  return (parsed.data.parties ?? []).map(toParty);
}

export async function getParty(id: number): Promise<CapsuleParty | null> {
  const body = await capsuleGet(`/parties/${encodeURIComponent(String(id))}`);
  if (body === null) return null;
  const parsed = PartyResponse.safeParse(body);
  if (!parsed.success) throw new CapsuleUpstreamError(502);
  return parsed.data.party ? toParty(parsed.data.party) : null;
}
