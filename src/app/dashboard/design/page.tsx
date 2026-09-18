// The design language, rendered with the real primitives.
//
// `docs/design-language.md` says why each rule exists; this page shows what
// each rule looks like, built from the same components every screen uses — so
// it cannot drift from the app the way a static mock-up does. It carries no
// project data and reads nothing: everything on it is a fixed example.
//
// It sits behind the same session check as every dashboard page. It is a
// reference for the people who build and use the app, not a public style guide.
import PageHeader from "@/components/ui/PageHeader";
import PageBody from "@/components/ui/PageBody";
import DesignShowcase from "@/components/design/DesignShowcase";

export default function DesignPage() {
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Projects", href: "/dashboard/projects" }]}
        title="The design language"
        subtitle="The rules every screen inherits, rendered with the components that carry them. The reasons are in docs/design-language.md."
      />
      <PageBody>
        <DesignShowcase />
      </PageBody>
    </>
  );
}
