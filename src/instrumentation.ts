// Next.js instrumentation: loaded once per server instance, Node and edge.
//
// `onRequestError` (production hardening H4b, 2026-11-20) writes ONE
// structured line per uncaught server error. What the line may and may not
// carry is `src/lib/request-error.ts` — never the message, the stack or the
// request body, because this app's errors are thrown over client material.
import type { Instrumentation } from "next";
import { formatRequestError } from "@/lib/request-error";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(formatRequestError(error, request, context));
};
