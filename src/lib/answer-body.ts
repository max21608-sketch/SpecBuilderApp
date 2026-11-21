// What a screen sends to answer one checklist question, read once.
//
// Two routes take it: `PATCH /api/answers/[id]` (the row exists) and
// `POST /api/records/[id]/answers` (the question has no row yet, review 1,
// finding 1). One reader, so the two cannot come to disagree about what a
// confirmed answer needs or what an attachment may be.
import { z } from "zod";
import { isAnswerState, type AnswerState } from "@/lib/spec-vocab";

export const AnswerEvidence = z
  .object({
    pathname: z.string().min(1).max(1024),
    filename: z.string().max(300).nullable().optional(),
    contentType: z.string().max(200).nullable().optional(),
    size: z.number().int().nonnegative().max(32 * 1024 * 1024).nullable().optional(),
  })
  .strict()
  .nullable();

export type AnswerBody = {
  value: string | null;
  /** Undefined leaves the placement alone; null clears it. */
  qualifier: string | null | undefined;
  state: AnswerState;
  reason: string | null;
  /** Not yet checked against the store: the route calls `verifyEvidence`. */
  evidence: z.infer<typeof AnswerEvidence>;
};

/** The body, or the sentence a 400 carries. */
export function readAnswerBody(body: Record<string, unknown>): { ok: true; answer: AnswerBody } | { ok: false; error: string } {
  if (!isAnswerState(body.state)) return { ok: false, error: "A state of confirmed, tbc, missing or na is required." };
  const state: AnswerState = body.state;

  const raw = typeof body.value === "string" ? body.value.trim() : "";
  const value = raw === "" ? null : raw;
  // Absent leaves the placement alone; an empty string clears it. A screen that
  // sends only the value must not silently drop a qualifier somebody typed.
  const qualifier =
    body.qualifier === undefined
      ? undefined
      : typeof body.qualifier === "string" && body.qualifier.trim()
        ? body.qualifier.trim()
        : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;

  const evidence = AnswerEvidence.safeParse(body.evidence ?? null);
  if (!evidence.success) return { ok: false, error: "That attachment is not valid." };

  // The database refuses `confirmed` without a value and an actor, and refuses
  // a value on `na`. Saying so here gives the reviewer a sentence rather than a
  // constraint violation.
  if (state === "confirmed" && !value) return { ok: false, error: "Confirmed needs a value. Use TBC if it is not decided yet." };
  if (state === "na" && value) return { ok: false, error: "N/A cannot carry a value." };

  return { ok: true, answer: { value, qualifier, state, reason, evidence: evidence.data } };
}
