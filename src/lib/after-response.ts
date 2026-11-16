import { after } from "next/server";

/**
 * Work that may finish AFTER the response has gone, registered with the
 * runtime so the function is not frozen before it lands.
 *
 * `after` throws when it is called outside a request scope — which is every
 * caller that invokes a route handler directly: the database-tier tests, a
 * script. The work still has to run there, so this falls back to the bare
 * promise `after` replaced. `work` must do its own error handling: nothing
 * here awaits it, and a rejection would otherwise be unhandled.
 */
export function afterResponse(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}
