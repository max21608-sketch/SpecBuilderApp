import { z } from "zod";
import { json } from "@/lib/db";
import { makeSessionToken } from "@/lib/auth";
import { verifyCredentials } from "@/lib/auth-node";
import { setSessionCookie } from "@/lib/session";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "email and password required" }, 400);

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) return json({ ok: false, error: "incorrect email or password" }, 401);

  const token = await makeSessionToken(user);
  await setSessionCookie(token);
  return json({ ok: true, user });
}
