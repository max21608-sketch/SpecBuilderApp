// A project's "ask the client" routes (0062, decision D), loaded once and
// applied per question — the ONE reading every screen shares.
//
// The chase (`chase-drafts.ts`), the record's gate rows (`gate-load.ts`) and
// the record payload (`/api/records/[id]`) all read a question's audience. Read
// in two of them from the seed alone, the record's "Why" and the chase could
// disagree about who answers a question a person had moved (chase review A5,
// 2026-11-21). One loader and one lookup, keyed by `questionGroupKey`, so a
// move covers the question on every cheat sheet that asks it.
import type { Row } from "@/lib/db";
import { questionGroupKey } from "@/lib/chase-grouping";
import { isQuestionAudience, normaliseQuestionAudience, type QuestionAudience } from "@/lib/spec-vocab";

type Exec = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

/** `project_question_routes`, per project, keyed by `questionGroupKey`. */
export type QuestionRoutes = Map<string, Map<string, QuestionAudience>>;

/**
 * Each project's "ask the client" (0062): one question moved to another
 * audience for that project alone. Read ONCE per load and applied per row by
 * the question's own key.
 */
export async function loadQuestionRoutes(exec: Exec, projectIds: string[]): Promise<QuestionRoutes> {
  const routes: QuestionRoutes = new Map();
  if (projectIds.length === 0) return routes;
  const rows = await exec`
    select project_id, question_key, audience from project_question_routes
     where project_id = any(${projectIds}::uuid[])
  `;
  for (const row of rows) {
    if (!isQuestionAudience(row.audience)) continue;
    const key = String(row.project_id);
    const byKey = routes.get(key) ?? new Map<string, QuestionAudience>();
    byKey.set(String(row.question_key), row.audience);
    routes.set(key, byKey);
  }
  return routes;
}

/** The seed's audience, and the project's route over it where there is one. */
export function routedAudience(
  routes: QuestionRoutes,
  projectId: string | null | undefined,
  question: { requirementId: string; prompt: string; jsonId: number | null; localKey: string | null; audience: unknown },
): { audience: QuestionAudience; seedAudience: QuestionAudience } {
  const seedAudience = normaliseQuestionAudience(question.audience);
  if (!projectId) return { audience: seedAudience, seedAudience };
  const key = questionGroupKey(question);
  return { audience: routes.get(projectId)?.get(key) ?? seedAudience, seedAudience };
}
