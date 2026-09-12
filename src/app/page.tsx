// The root path has no content of its own. Middleware has already established
// that the request carries a session by the time this renders, so send it to
// the app proper rather than serving a second, emptier landing page.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
