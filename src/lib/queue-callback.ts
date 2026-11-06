// What the queue consumer will accept as a delivery (audit R3, 2026-11-06).
//
// ============================================================================
// THE TRAP
//
// `handleCallback` from @vercel/queue (0.4.0) understands two callback shapes,
// and only one of them is checked with the queue service:
//
//   - STRUCTURED (v1beta), "routing-only" in the SDK's own types: the request
//     names a queue, a consumer group and a message id, and the SDK then
//     RECEIVES that message by id from the queue service, authenticated with
//     this deployment's OIDC token. The payload our consumer runs on is what
//     the service returned. A forged callback names a message the service
//     does not have (nothing runs) or one it does (and the service leases it
//     to us exactly as a real delivery would).
//   - BINARY (v2beta "small-body mode"): the ce-* headers carry a receipt
//     handle and the request's OWN BODY is deserialised as the payload and
//     handed to our consumer before the SDK speaks to the service at all.
//     Nothing in the request is signed. Measured by the route contracts on
//     2026-11-06: a forged one answered 200 {"status":"success"} and the
//     consumer ran. A forged `document-intake` naming a pending run with a free
//     claim would start a CHARGED read.
//
// Our trigger is `queue/v1beta` (vercel.json), and the SDK documents binary
// small-body callbacks as "produced by v2beta small-body mode". So this
// deployment's platform never sends one, and refusing them costs nothing and
// leaves only the shape the SDK verifies with the queue service. That is the
// strongest guard the SDK offers; the package has no signature to check and
// documents no platform header that would prove where a request came from.
//
// IF THE TRIGGER IS EVER MOVED TO `queue/v2beta`, every small message would
// arrive in the binary shape and this guard would refuse them all. Do not
// "fix" that by allowing the binary shape: the payload would again be the
// caller's. `tests/lib/queue-callback.test.ts` pins the trigger type beside
// this guard so the move cannot happen without reading this.
// ============================================================================
import { CLOUD_EVENT_TYPE_V1BETA, CLOUD_EVENT_TYPE_V2BETA } from "@vercel/queue";

/** The trigger type in vercel.json that this guard is written for. */
export const VERIFIED_TRIGGER_TYPE = "queue/v1beta";

/**
 * Null when the callback is the structured shape the SDK fetches from the
 * queue service; otherwise the reason it is refused. Reads headers only, so the
 * body is never consumed before the SDK sees it.
 */
export function unverifiableCallbackReason(headers: Headers): string | null {
  const ceType = headers.get("ce-type");
  // Exactly the SDK's branch (`ce-type === v2beta` selects the binary path),
  // and wider: any ce-type that is not the structured one, and any receipt
  // handle in a header, is refused, so a future SDK that trims or lower-cases
  // the header cannot reopen the binary path behind this check.
  if (ceType === CLOUD_EVENT_TYPE_V2BETA) return "binary-mode callback";
  if (ceType !== null && ceType !== CLOUD_EVENT_TYPE_V1BETA) return "unknown callback type";
  if (headers.has("ce-vqsreceipthandle")) return "receipt handle in the request";
  return null;
}
