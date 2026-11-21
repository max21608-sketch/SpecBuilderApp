// Where a screen sends one checklist answer: the row's PATCH where the row
// exists, and the record's POST where the question has none yet (review 1,
// finding 1, 2026-11-21). The record screen's checklist and the fill-in
// screen both build their request here, so neither can be left behind
// telling people to "Set the category again" or "Open the item".
export type AnswerTarget = {
  recordId: string;
  requirementId: string;
  /** Null where the record has no answer row for this question yet. */
  answerId: string | null;
  /** The row's version as the screen read it; ignored where there is no row. */
  answerVersion: number | null;
};

export type AnswerInput = {
  value: string | null;
  state: string;
  reason?: string | null;
  evidence?: unknown;
  /** Undefined leaves the placement alone; the routes read it that way. */
  qualifier?: string | null;
};

export function answerRequest(target: AnswerTarget, input: AnswerInput): { url: string; init: RequestInit } {
  const common = {
    value: input.value,
    state: input.state,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.qualifier !== undefined ? { qualifier: input.qualifier } : {}),
  };
  if (target.answerId) {
    return {
      url: `/api/answers/${encodeURIComponent(target.answerId)}`,
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...common, version: target.answerVersion }),
      },
    };
  }
  return {
    url: `/api/records/${encodeURIComponent(target.recordId)}/answers`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...common, requirementId: target.requirementId }),
    },
  };
}
