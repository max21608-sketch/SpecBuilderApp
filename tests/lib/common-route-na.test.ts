// A common answer of N/A with a value is refused in words before the database
// sees it (audit E8, 2026-11-06).
//
// `spec_answers_na_has_no_value` refuses a value on `na`. The single answer
// route (`PATCH /api/answers/[id]`) has always said so first; the common route
// passed the value straight to `editAnswer` and the CHECK answered, as a 500
// reading "Nothing was written". The refusal must come BEFORE any transaction
// is opened, so this test fails if one is.
import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  getSessionUser: async () => ({ id: "u1", email: "__qa@example.test", name: "QA", role: "admin" }),
}));

vi.mock("@/lib/db-transaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-transaction")>();
  return { ...actual, withTransaction: transaction };
});

const LINE = "11111111-1111-4111-8111-111111111111";
const CONFIGURATIONS = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

function answer(value: string | null) {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      op: "answer",
      requirementId: "44444444-4444-4444-8444-444444444444",
      value,
      state: "na",
      configurations: CONFIGURATIONS,
      seen: [{ answerId: "55555555-5555-4555-8555-555555555555", version: 1 }],
    }),
  });
}

describe("POST /api/records/[id]/common, op answer, state N/A", () => {
  beforeEach(() => transaction.mockReset());

  it("refuses a value on N/A in words and opens no transaction", async () => {
    const { POST } = await import("@/app/api/records/[id]/common/route");
    const res = await POST(answer("Oak"), { params: Promise.resolve({ id: LINE }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/N\/A/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("lets N/A with no value through to the edit", async () => {
    transaction.mockResolvedValueOnce({ written: [] });
    const { POST } = await import("@/app/api/records/[id]/common/route");
    const res = await POST(answer(null), { params: Promise.resolve({ id: LINE }) });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("reads a value of only spaces as no value, rather than letting the CHECK refuse it", async () => {
    transaction.mockImplementationOnce(async (fn: (txn: unknown) => unknown) => fn(null));
    const seen: unknown[] = [];
    vi.doMock("@/lib/configuration-family", () => ({
      editCommonSpec: async (_txn: unknown, input: { edit: { value: unknown } }) => {
        seen.push(input.edit.value);
        return { written: [] };
      },
    }));
    vi.resetModules();
    const { POST } = await import("@/app/api/records/[id]/common/route");
    const res = await POST(answer("   "), { params: Promise.resolve({ id: LINE }) });
    expect(res.status).toBe(200);
    expect(seen).toEqual([null]);
    vi.doUnmock("@/lib/configuration-family");
  });
});
