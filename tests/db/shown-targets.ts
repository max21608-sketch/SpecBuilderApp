// The records a drawings card SHOWS, read the way the screen reads them: the
// real review GET's `resolution[].targets` (audit D3, 2026-11-06). The
// drawings confirm now requires them as `shownTargets`, so a db-tier test that
// confirms a card asks this first, at the moment its "reviewer" would have the
// page open. A test file using it mocks `@/lib/session` as for any route.
import { GET as reviewRoute } from "@/app/api/imports/[id]/route";

export async function shownTargets(runId: string, itemId: string): Promise<string[]> {
  const response = await reviewRoute(new Request("http://localhost/test"), { params: Promise.resolve({ id: runId }) });
  const body = (await response.json()) as { resolution?: { id: string; targets: string[] }[] };
  return body.resolution?.find((entry) => entry.id === itemId)?.targets ?? [];
}

/**
 * A drawings confirm body with `shownTargets` filled from the review GET, for
 * a test whose subject is something else. A body that already names them, or
 * that is not a drawings confirm, is returned unchanged.
 */
export async function withShownTargets(runId: string, body: unknown): Promise<unknown> {
  if (!body || typeof body !== "object") return body;
  const fields = body as Record<string, unknown>;
  if (fields.shownTargets !== undefined || typeof fields.itemId !== "string") return body;
  if ((fields.action ?? "confirm") !== "confirm") return body;
  return { ...fields, shownTargets: await shownTargets(runId, fields.itemId) };
}

type RoutePost = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

/**
 * The confirm route, sending what the card shows: every drawings confirm the
 * wrapped route receives without `shownTargets` gets them from the review GET
 * at that moment. For tests about something other than D3; the D3 tests send
 * their own.
 */
export function confirmingAsShown(post: RoutePost): RoutePost {
  return async (request, context) => {
    const { id } = await context.params;
    const text = await request.clone().text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return post(request, { params: Promise.resolve({ id }) });
    }
    const filled = await withShownTargets(id, body);
    return post(
      new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(filled) }),
      { params: Promise.resolve({ id }) },
    );
  };
}
