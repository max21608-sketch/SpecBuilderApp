import { json } from "@/lib/db";
import { clearSessionCookie } from "@/lib/session";

export async function POST(): Promise<Response> {
  await clearSessionCookie();
  return json({ ok: true });
}
