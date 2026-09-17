// Setting a project's finishes library out at the start, from a pasted list.
//
// Two verbs on one route, and the split matters: POST with `preview` returns
// what creating the list WOULD do and writes nothing, POST with `create`
// writes. A paste box that silently created thirty rows — some of them
// duplicates of codes the project already holds — is the opposite of the
// finishes library's edit-once rule, where correcting one code corrects every
// item carrying it.
//
// See src/lib/finish-bulk.ts for why this is a paste box and not an
// extraction: the model's output shape has no field for a finish code, and
// parsing one out of prose is the inference that belongs on the other side of
// house/conventions.md §6.
import { sql, json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { openChangeSet } from "@/lib/change-sets";
import { createFinish } from "@/lib/finish-edit";
import { parseFinishList, previewFinishList } from "@/lib/finish-bulk";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    action: z.enum(["preview", "create"]),
    text: z.string().max(200_000),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "Paste a list of codes, one per line." }, 400);

  const held = (
    await sql`select code, code_norm from project_finishes where project_id = ${id} and status = 'active'`
  ).map((row) => ({ code: String(row.code), codeNorm: String(row.code_norm) }));

  const preview = previewFinishList(parseFinishList(parsed.data.text), held);
  if (parsed.data.action === "preview") return json({ ok: true, ...preview });

  if (preview.newCount === 0) {
    return json({ ok: true, created: 0, ...preview });
  }

  try {
    const created = await withTransaction(async (txn) => {
      await openChangeSet(txn, {
        projectId: id,
        kind: "finish_link",
        actor: user.email,
        reason: `Added ${preview.newCount} finish${preview.newCount === 1 ? "" : "es"} to the library from a pasted list.`,
      });
      let n = 0;
      for (const row of preview.rows) {
        if (row.status !== "new") continue;
        await createFinish(txn, {
          projectId: id,
          fields: {
            code: row.code,
            description: row.description,
            // `kind` IS NEVER INFERRED. The library's standing rule: nothing
            // guesses whether a code is a fabric or a timber, so a code
            // arrives filed as nothing and a person picks.
            state: "tbc",
          },
          actor: user.email,
        });
        n += 1;
      }
      return n;
    });
    return json({ ok: true, created, ...preview }, 201);
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
