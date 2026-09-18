// The tab that lives in the URL, and the one rule that makes a deep link
// survive: it never writes on read.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUrlTab } from "@/lib/use-url-tab";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/dashboard/projects/abc",
  useRouter: () => ({ replace }),
}));

const KNOWN = ["overview", "finishes"];

function Screen() {
  const [tab, setTab] = useUrlTab<string>({
    fallback: "overview",
    resolve: (raw) => (raw && KNOWN.includes(raw) ? raw : null),
  });
  return (
    <div>
      <output>{tab}</output>
      <button type="button" onClick={() => setTab("finishes")}>
        Go
      </button>
    </div>
  );
}

describe("the tab in the URL", () => {
  beforeEach(() => {
    replace.mockClear();
    search = "";
  });

  it("renders what the URL says", () => {
    search = "tab=finishes";
    render(<Screen />);
    expect(screen.getByRole("status")).toHaveTextContent("finishes");
  });

  it("renders the fallback for a value it cannot resolve, and leaves the URL alone", () => {
    // This is the whole point. While a project's runs are still loading a run
    // id resolves to nothing — and correcting the URL there would destroy the
    // deep link a quarter of a second before it became valid.
    search = "tab=a-run-id-not-loaded-yet";
    render(<Screen />);
    expect(screen.getByRole("status")).toHaveTextContent("overview");
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces the URL on a change, keeping every other parameter and the scroll position", async () => {
    search = "projectId=P17726&focus=overdue";
    render(<Screen />);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(replace).toHaveBeenCalledTimes(1);
    const [url, options] = replace.mock.calls[0]!;
    const query = new URLSearchParams(String(url).split("?")[1]);
    expect(query.get("tab")).toBe("finishes");
    // A setter that rebuilt the query string from scratch would clear the spec
    // table's filters on every tab click.
    expect(query.get("projectId")).toBe("P17726");
    expect(query.get("focus")).toBe("overdue");
    // `replace`, so twenty tab clicks are not twenty presses of Back to leave
    // the page; `scroll: false`, so the thing just clicked stays on screen.
    expect(options).toEqual({ scroll: false });
  });
});
