import { json } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getEnvironment } from "@/lib/env";

export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  const environment = getEnvironment();
  return json(user ? { authed: true, user, environment } : { authed: false, environment });
}
