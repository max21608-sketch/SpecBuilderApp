// The record checklist's save, for a question with NO answer row yet (review
// 1, finding 1, 2026-11-21). It stopped at "Set the category again to add the
// newer questions", which did nothing; the first answer now creates the row,
// through POST /api/records/[id]/answers with the question's requirement id.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useChecklistSave } from "@/components/records/ChecklistTab";
import type { Answer } from "@/components/records/record-payload";

const apiFetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

beforeEach(() => apiFetch.mockReset());

const question = (over: Partial<Answer>): Answer =>
  ({
    requirement_id: "req-9",
    kind: "readiness",
    prompt: "Stone top or stone parts?",
    help_text: null,
    section: "Construction",
    answer_id: null,
    value: null,
    qualifier: null,
    state: "missing",
    version: 0,
    ...over,
  }) as Answer;

function hook() {
  const reloadThen = vi.fn(async () => {});
  const setError = vi.fn();
  const { result } = renderHook(() => useChecklistSave({ recordId: "rec-1", answers: [], reloadThen, setError }));
  return { result, reloadThen, setError };
}

describe("saving a checklist answer", () => {
  it("creates the row with the first answer where the question has none", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 201, data: { ok: true } });
    const { result, reloadThen, setError } = hook();
    await act(() => result.current.save(question({}), "Yes", "confirmed"));
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/records/rec-1/answers",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(apiFetch.mock.calls[0]![1].body);
    expect(body).toMatchObject({ requirementId: "req-9", value: "Yes", state: "confirmed" });
    expect(body.version).toBeUndefined();
    expect(setError).not.toHaveBeenCalledWith(expect.stringMatching(/Set the category again/));
    expect(reloadThen).toHaveBeenCalledWith(null);
  });

  it("still PATCHes the row where there is one", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    const { result } = hook();
    await act(() => result.current.save(question({ answer_id: "ans-1", version: 3 }), "No", "confirmed"));
    expect(apiFetch).toHaveBeenCalledWith("/api/answers/ans-1", expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(apiFetch.mock.calls[0]![1].body)).toMatchObject({ value: "No", version: 3 });
  });

  it("shows a refusal of a new row on the screen, and reloads", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 409,
      error: "“Stone top or stone parts?” changed since this screen loaded.",
      data: { code: "answer_version_stale" },
    });
    const { result, reloadThen } = hook();
    await act(() => result.current.save(question({}), "Yes", "confirmed"));
    expect(reloadThen).toHaveBeenCalledWith("“Stone top or stone parts?” changed since this screen loaded.");
    expect(result.current.refusals["q:req-9"]).toBe(1);
  });
});
