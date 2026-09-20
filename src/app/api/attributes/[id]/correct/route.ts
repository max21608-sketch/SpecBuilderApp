// Correcting one spec on a record.
//
// A REASON IS REQUIRED, as it is for retiring: a correction overrides
// something a document said, and it asserts a replacement under the same page
// reference on top of that. An OPEN change set satisfies it, as everywhere —
// a reviewer working through a call opens one change and every correction
// after it attaches to that.
//
// The guards live in `src/lib/attribute-correct.ts`, inside the transaction,
// where a check can still abort the write it is checking: the version, the
// occupant of the slot, and whether the corrected wording still matches what
// the finishes library says the code is.
import { json } from "@/lib/db";
import { z } from "zod";
import { getSessionUser } from "@/lib/session";
import { withTransaction, transactionErrorResponse } from "@/lib/db-transaction";
import { correctAttribute } from "@/lib/attribute-correct";
import { ATTRIBUTE_UNITS, DIMENSION_SLOTS } from "@/lib/spec-vocab";

const Body = z
  .object({
    // Null is only meaningful with `state: "tbc"` — 0007 refuses a confirmed
    // row with no value, and the message below says so rather than letting a
    // constraint violation reach the screen as "Nothing was written".
    value: z.string().max(4000).nullable(),
    unit: z.enum(ATTRIBUTE_UNITS).nullable(),
    // ABSENT means unchanged. The common correction is a mistyped figure or a
    // wrong unit, not a figure in the wrong slot.
    dimensionSlot: z.enum(DIMENSION_SLOTS).nullable().optional(),
    state: z.enum(["confirmed", "tbc"]),
    version: z.number().int().nonnegative(),
    reason: z.string().min(1).max(2000),
    evidence: z
      .object({
        pathname: z.string().min(1).max(1024),
        filename: z.string().max(300).nullable().optional(),
        contentType: z.string().max(200).nullable().optional(),
        size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const MESSAGES: Record<string, string> = {
  reason:
    "Say why this value is being corrected. The old one is kept as a record of what the document said, and the reason is what makes the change readable later.",
  value: "The corrected value is too long, or is not text.",
  unit: "A unit is one of mm, cm, m or in, or none at all.",
  dimensionSlot: "A dimension is one of W, D, H, SH or Dia.",
  state: "A spec is either confirmed or TBC.",
  version: "The version this correction was made against is missing.",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  // Middleware is the authorization boundary and already gates writer roles;
  // this is the session check every write route makes, and no more.
  if (!user) return json({ ok: false, error: "auth required" }, 401);
  const { id } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return json(
      {
        ok: false,
        error: (typeof field === "string" && MESSAGES[field]) || "That request is not valid.",
        field: issue?.path.join("."),
      },
      400,
    );
  }

  // 0007's own constraint, said in words before the database says it in a
  // sentence naming a constraint. A value nobody has decided is TBC, which is
  // a state and not an empty string.
  if (parsed.data.state === "confirmed" && !parsed.data.value?.trim()) {
    return json(
      {
        ok: false,
        error: "A confirmed spec has to carry a value. Record it as TBC if the client has not decided.",
        field: "value",
      },
      400,
    );
  }

  try {
    const result = await withTransaction((txn) =>
      correctAttribute(txn, {
        attributeId: id,
        expectedVersion: parsed.data.version,
        value: parsed.data.value,
        unit: parsed.data.unit,
        dimensionSlot: parsed.data.dimensionSlot,
        state: parsed.data.state,
        reason: parsed.data.reason,
        evidence: parsed.data.evidence ?? null,
        actor: user.email,
      }),
    );
    return json({ ok: true, ...result });
  } catch (cause) {
    return transactionErrorResponse(cause);
  }
}
