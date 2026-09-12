// The app's only spinner. Before this, every wait was a line of static text,
// which is fine for something that takes a moment and useless for something
// that takes four minutes.
//
// role="status" with an sr-only label so a screen reader announces the wait
// rather than silently showing nothing.
export default function Spinner({ size = 16, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="animate-spin text-neutral-400"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
