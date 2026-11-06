// What a chase draft's status is called in a sentence the server sends.
//
// A leaf, with no imports, for the reason `intake-status.ts` is one: the four
// draft routes each printed `This draft is ${status}` and so told a person
// their draft "is superseded" or "is voided" -- the CHECK's own words
// (0005), which nobody on a screen ever chose. Audit 2026-11-06, G15; the
// vocabulary guard refuses a status printed any other way.
//
// `superseded` is the interesting one: regenerating keeps the old row and
// marks it, so a second screen still showing it gets a refusal it can act on
// (0005's header). The next step is therefore the newest draft.

/** The clause: "This draft <words>". */
export function draftStateWords(status: string): string {
  switch (status) {
    case "draft":
      return "has not been recorded as sent";
    case "sent":
      return "has been recorded as sent";
    case "voided":
      return "had its send confirmation withdrawn";
    case "superseded":
      return "was replaced by a newer draft for the same contact";
    default:
      return "is no longer open";
  }
}
