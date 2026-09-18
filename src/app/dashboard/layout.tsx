// The environment marker is read HERE, on the server, and handed to the shell.
//
// `NavShell` is a client component and cannot import a server one, so the chip
// arrives as an element. That is the whole point: `EnvironmentChip` reads
// `APP_ENV` directly, so an unset value fails toward SHOWING the marker, where
// a client-side fetch would fail toward hiding it.
import NavShell from "@/components/ui/NavShell";
import EnvironmentChip from "@/components/layout/EnvironmentChip";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <NavShell envChip={<EnvironmentChip />}>{children}</NavShell>;
}
