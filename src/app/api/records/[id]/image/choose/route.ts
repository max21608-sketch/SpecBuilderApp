// A person chooses which of an item's pictures is its picture.
//
// The record screen offers ONE other picture beside the current one — the
// drawings' crop beside a bill's photograph, or the bill's photograph beside a
// crop that replaced it — and this is the button under it. A drawing never
// displaces a photograph on its own (Max, 2026-10-05: "we always prefer a
// picture over a drawing"), so swapping one in is a person's decision, written
// under a change set and a version of the record. The rules live in
// `chooseItemPicture` (`src/lib/item-image-write.ts`).
//
// The body names the picture to use by ATTACHMENT ID, looked up among this
// record's own picture rows — never a pathname — and the id of the picture the
// person was looking at, which is the optimistic check: nothing that changes a
// picture bumps the record's version, so the version could not see a crop
// confirmed a second ago. Writer roles only, by the middleware's allowlist.
import { z } from "zod";
import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { chooseItemPicture } from "@/lib/item-image-write";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    attachmentId: z.string().uuid(),
    currentAttachmentId: z.string().uuid().nullable(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return json({ ok: false, error: "No such item." }, 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "Say which picture to use, and which picture the item had when you chose." }, 400);
  }

  try {
    const result = await withTransaction((txn) =>
      chooseItemPicture(txn, {
        recordId: id,
        attachmentId: parsed.data.attachmentId,
        currentAttachmentId: parsed.data.currentAttachmentId,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
