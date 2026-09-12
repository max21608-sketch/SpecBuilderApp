import Link from "next/link";

export default function IssueLink({
  href,
  children = "Review and fix",
  className = "",
}: {
  href: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={`inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-75 ${className}`}
    >
      {children}
      <span aria-hidden="true">↗</span>
    </Link>
  );
}
