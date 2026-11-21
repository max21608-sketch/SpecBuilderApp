// What a BWS field is called on a screen, with BWS's own name small beside it
// where the two differ (decision F of 2026-11-20).
//
// "COM" is the customer's own material and most fabric BW supplies itself, so
// COM 1/2/3 read "Fabric 1/2/3"; Main timber/metal finish read "Timber/Metal
// finish 1" (2026-10-15). The BWS name stays in reach, small, because it is
// the word on the BWS screen and in the file's header. One map decides both
// (`spec-field-label.ts`); this only lays them out.
//
// A leaf with no hooks, so a server or client screen can use it.
import { bwsNameIfDifferent, fieldDisplayName } from "@/lib/spec-field-label";

const fold = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export default function FieldName({
  name,
  jsonId,
  className,
}: {
  name: string;
  jsonId?: number | null;
  className?: string;
}) {
  const bws = bwsNameIfDifferent(name, jsonId);
  return (
    <span className={className}>
      {fieldDisplayName(name, jsonId)}
      {bws && <span className="ml-1.5 text-[11px] font-normal text-neutral-500">BWS: {bws}</span>}
    </span>
  );
}

/**
 * A checklist question and the BWS field it fills, in two lines: the prompt
 * as a person reads it, then "BWS: <field>" where that adds anything. A prompt
 * that IS a BWS name ("COM 1") already carries its BWS name beside it, so the
 * second line is not printed again — and it is always BWS's OWN name, never
 * ours behind a "BWS:" label.
 */
export function QuestionName({
  prompt,
  fieldLabel,
  className = "block text-[11px] text-neutral-500",
}: {
  prompt: string;
  fieldLabel: string | null;
  className?: string;
}) {
  const promptBws = bwsNameIfDifferent(prompt);
  const showField = Boolean(fieldLabel) && fold(fieldLabel) !== fold(promptBws) && fold(fieldLabel) !== fold(prompt);
  return (
    <>
      <FieldName name={prompt} className="text-neutral-900" />
      {showField && <span className={className}>BWS: {fieldLabel!.trim()}</span>}
    </>
  );
}
