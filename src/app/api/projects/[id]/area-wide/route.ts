// The project's AREA questions: one card per area, answered once for it
// (decision C of 2026-11-20, `requirements.answer_scope = 'area'`).
//
// GET   every area question an item in the export's scope asks, one card per
//       (area, question), the area folded by case and space only. An item with
//       no area is on no card: it is asked on its own.
// POST  one answer, fanned out to every item in that area that asks it — one
//       change set, one version per record, refused WHOLE if the set moved.
//       The rules are the project-wide card's, in src/lib/project-wide.ts.
import { json, sql } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { applyAreaWide, loadAreaWide } from "@/lib/project-wide";
import { loadPalettes } from "@/lib/palette-load";
import { paletteFromRow, type Palette } from "@/lib/palettes";
import { requireUuid, requireWriter } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id: projectId } = await context.params;
  const badId = requireUuid(projectId);
  if (badId) return badId;

  const exists = await sql`select id from projects where id = ${projectId}`;
  if (!exists[0]) return json({ ok: false, error: "No such project." }, 404);

  const [questions, register] = await Promise.all([loadAreaWide(sql, projectId), loadPalettes(sql)]);

  // WHICH PALETTE A QUESTION OFFERS, resolved here the way the record screen
  // resolves it — by local key, then by BWS field — so the card's control
  // offers the same list and the same Other… as the checklist.
  const byKey = new Map(register.palettes.map((row) => [row.key, row]));
  const paletteFor = (jsonId: number | null, localKey: string | null): Palette | null => {
    const link =
      (localKey ? register.paletteByQuestion.find((row) => row.local_key === localKey) : undefined) ??
      (jsonId !== null ? register.paletteByQuestion.find((row) => Number(row.json_id) === jsonId) : undefined);
    const row = link ? byKey.get(link.palette_key) : undefined;
    return row ? paletteFromRow(row) : null;
  };

  return json({
    ok: true,
    questions: questions.map((question) => ({ ...question, palette: paletteFor(question.jsonId, question.localKey) })),
  });
}

const Body = z
  .object({
    key: z.string().min(1).max(600),
    value: z.string().max(4000).nullable().optional(),
    state: z.enum(["confirmed", "tbc"]),
    seen: z
      .array(
        z
          .object({
            recordId: z.string().uuid(),
            requirementId: z.string().uuid(),
            answerId: z.string().uuid().nullable(),
            version: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
    overrides: z.array(z.string().uuid()).max(2000).optional(),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const denied = requireWriter(user);
  if (denied) return denied;
  const { id: projectId } = await context.params;
  const badId = requireUuid(projectId);
  if (badId) return badId;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "That request is not valid." }, 400);

  const trimmed = typeof parsed.data.value === "string" ? parsed.data.value.trim() : "";
  const value = trimmed === "" ? null : trimmed;
  if (parsed.data.state === "confirmed" && !value) {
    return json({ ok: false, error: "Confirmed needs a value. Use TBC if it is not decided yet." }, 400);
  }

  try {
    const result = await withTransaction((txn) =>
      applyAreaWide(txn, {
        projectId,
        key: parsed.data.key,
        value,
        state: parsed.data.state,
        seen: parsed.data.seen,
        overrides: parsed.data.overrides ?? [],
        reason: parsed.data.reason?.trim() || null,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
