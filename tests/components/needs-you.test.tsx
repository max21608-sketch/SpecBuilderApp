// ONE LIST OF WHAT STOPS A CONFIRM, EACH ITEM A LINK TO ITS PLACE (2026-10-15).
//
// Both Ronnie Scott's calls stalled on blockers the screen knew about and
// said somewhere else: a hover title, a banner scrolled away, a "Checked"
// button that read as a word. Max: "we don't know what the next step is."
// These hold the list's three promises — short words, a link that lands and
// lights its place, and the full sentences kept one click away.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NeedsYou from "@/components/ui/NeedsYou";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, figure, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingItem } from "@/lib/drawing-document";
import { COMPONENT_TIMEOUT_MS } from "./tier-timeout";

vi.setConfig({ testTimeout: COMPONENT_TIMEOUT_MS });

describe("the needs-you list", () => {
  it("renders nothing when nothing needs anybody", () => {
    const { container } = render(<NeedsYou id="needs-you-x" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("goes to its place: runs onGo first, then lights the target", async () => {
    const onGo = vi.fn();
    render(
      <>
        <NeedsYou
          id="needs-you-x"
          items={[{ key: "a", words: "Choose a unit", target: "row-1", why: "These drawings do not print their units." }]}
          onGo={onGo}
        />
        <div id="row-1">the row</div>
      </>,
    );
    const link = screen.getByRole("link", { name: "Choose a unit" });
    expect(link).toHaveAttribute("href", "#row-1");
    await userEvent.click(link);
    expect(onGo).toHaveBeenCalledWith(expect.objectContaining({ key: "a" }));
    expect(document.getElementById("row-1")).toHaveAttribute("data-needs-you-flash");
  });

  it("keeps the full sentence behind Why, never deleted", async () => {
    render(
      <NeedsYou
        id="needs-you-x"
        items={[{ key: "a", words: "Choose a unit", target: null, why: "These drawings do not print their units." }]}
      />,
    );
    expect(screen.queryByText("These drawings do not print their units.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Why" }));
    expect(screen.getByText("These drawings do not print their units.")).toBeInTheDocument();
  });
});

describe("the drawing card lists what holds it, at the top", () => {
  function renderCard(staged: DrawingItem, over: Parameters<typeof resolution>[0] = {}) {
    const spies = { ...callbacks(), onSaveItem: vi.fn(async () => undefined) };
    render(
      <ItemCard
        item={staged}
        importId="import-1"
        resolution={resolution(over)}
        specFields={specFields}
        records={records}
        drafts={{}}
        setDrafts={() => undefined}
        busy={false}
        onSaveObservation={spies.onSaveObservation}
        onSaveTargets={spies.onSaveTargets}
        onSetBulkUnit={spies.onSetBulkUnit}
        onReview={spies.onReview}
        onImage={spies.onImage}
        onSwatch={spies.onSwatch}
        onSetLevel={spies.onSetLevel}
        onSaveItem={spies.onSaveItem}
      />,
    );
    return spies;
  }

  // TB-08 (part 2, 50:26 and 1:04:07): the confirm waited on a "Checked"
  // nobody could see, and on a width the bill already held.
  function tb08() {
    resetIds();
    return item({
      itemCodeRaw: "TB-08",
      observations: [
        figure("Width", "3500", { attrGroup: "dimension", dimensionSlot: "W", unit: "mm", isOverall: true }),
        figure("Height", "710", { attrGroup: "dimension", dimensionSlot: "H", unit: "mm", isOverall: true }),
      ],
      uncertain: [{ about: "width", why: "The sheet labels 3500MM as Length and 900MM as Width." }],
    });
  }

  it("names each thing in a few words, each a link to its place", () => {
    const staged = tb08();
    const width = staged.observations[0]!;
    renderCard(staged, {
      blockers: [
        {
          code: "uncertain_unchecked",
          index: 0,
          message: "The read was unsure of the width: … Check the width against the drawing — correct it, or press Mark checked on the notice.",
        },
        {
          code: "dimension_slot_taken",
          observationId: width.id,
          recordId: "rec-main",
          message: "This item already has a width from the bill. Tick “Use this drawing's” to replace it, or make this row a note.",
        },
      ],
    });
    const list = screen.getByRole("region", { name: "What needs you" });
    expect(within(list).getByText(/2 things need you/)).toBeInTheDocument();
    const check = within(list).getByRole("link", { name: /Check the width — then press “Mark checked”/ });
    expect(check).toHaveAttribute("href", `#uncertain-${staged.id}-0`);
    // The notice it points at exists, and its button is a bordered "Mark checked".
    expect(document.getElementById(`uncertain-${staged.id}-0`)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Mark checked" })).toBeInTheDocument();
    const replace = within(list).getByRole("link", { name: /Width: already held — use this drawing's, or ignore the row/ });
    expect(replace).toHaveAttribute("href", `#replace-${width.id}`);
    // The row it is about carries the id the link points at.
    expect(document.getElementById(`row-${width.id}`)).not.toBeNull();
  });

  it("says beside Confirm that things need you, and links to the list, not a paragraph", () => {
    const staged = tb08();
    renderCard(staged, {
      blockers: [{ code: "uncertain_unchecked", index: 0, message: "The read was unsure of the width: a long sentence." }],
    });
    expect(screen.getByRole("button", { name: /Confirm 2 specs/ })).toBeDisabled();
    const footer = screen.getByRole("link", { name: /One thing needs you — listed at the top of this card/ });
    expect(footer).toHaveAttribute("href", `#needs-you-${staged.id}`);
    expect(screen.queryByText("The read was unsure of the width: a long sentence.")).toBeNull();
  });

  it("shows no list on a card nothing holds", () => {
    renderCard(tb08(), { blockers: [] });
    expect(screen.queryByRole("region", { name: "What needs you" })).toBeNull();
  });
});
