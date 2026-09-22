// Filing a finish the client gave no code for, on the drawings card (4a.1).
//
// ============================================================================
// WHY THIS TIER.
//
// `readUncodedFinish` decides what will happen and is pinned pure. What it
// cannot say is whether the reviewer is ASKED — and "the fabric was on the
// record, the library was empty, and nothing on any screen said so" is the
// whole of the defect this item closes. The three states this card can be in
// are three different sentences and three different controls, and every one of
// them is reachable only by rendering it.
//
// The component tier runs without a database and is scoped by PATH in
// vitest.config.ts, so there is no `@vitest-environment` docblock here.
// ============================================================================
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemCard from "@/components/imports/DrawingItemCard";
import { callbacks, callout, item, records, resetIds, resolution, specFields } from "./fixtures";
import type { DrawingObservation } from "@/lib/drawing-document";
import type { FinishFilingView } from "@/lib/drawing-resolution";

const AISSA = "Aissa Dione, ref. Losange raphia beige et écru";

function renderCard(observations: DrawingObservation[], finishFilings: Record<string, FinishFilingView>) {
  const spies = callbacks();
  render(
    <ItemCard
      item={item({ observations })}
      importId="import-1"
      resolution={resolution({ finishFilings })}
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
    />,
  );
  return spies;
}

/** One uncoded fabric row, the S-203 shape: a supplier and a reference, no code. */
function uncoded(): DrawingObservation[] {
  resetIds();
  return [callout("FABRIC REFERENCE", AISSA, null)];
}

/** What the card was asked to save for that row. */
function saved(spies: ReturnType<typeof callbacks>): Record<string, unknown> {
  const call = spies.of("onSaveObservation").at(-1);
  if (!call) throw new Error("Nothing was saved");
  return call.args[2] as Record<string, unknown>;
}

describe("a finish the client gave no code for", () => {
  const nothingFiled: FinishFilingView = {
    outcome: "none",
    finishId: null,
    code: null,
    why: null,
    suggestion: null,
  };

  it("asks, in words, and offers both answers", async () => {
    const rows = uncoded();
    renderCard(rows, { [rows[0]!.id]: nothingFiled });
    expect(screen.getByText(/Not in the finishes library/)).toBeTruthy();
    expect(screen.getByPlaceholderText("client's code")).toBeTruthy();
    expect(screen.getByRole("button", { name: "No code — file it internally" })).toBeTruthy();
  });

  it("saves the client's own code when one is typed", async () => {
    const rows = uncoded();
    const spies = renderCard(rows, { [rows[0]!.id]: nothingFiled });
    await userEvent.type(screen.getByPlaceholderText("client's code"), "CH-01.1");
    await userEvent.click(screen.getByRole("button", { name: "File" }));
    expect(saved(spies)).toEqual({ materialCode: "CH-01.1" });
  });

  it("records the DECISION, not a code, when there is none", async () => {
    // The number is minted at confirm under the project row lock. A code shown
    // here is one another reviewer's confirm may take first.
    const rows = uncoded();
    const spies = renderCard(rows, { [rows[0]!.id]: nothingFiled });
    await userEvent.click(screen.getByRole("button", { name: "No code — file it internally" }));
    expect(saved(spies)).toEqual({ finishFiling: { mode: "internal" } });
  });

  it("offers a near miss as a SUGGESTION, and pressing it files nothing new", async () => {
    const rows = uncoded();
    const spies = renderCard(rows, {
      [rows[0]!.id]: {
        outcome: "none",
        finishId: null,
        code: null,
        why: null,
        suggestion: { code: "BW-F-001", codeNorm: "BW-F-001", why: "Nearly the same wording as BW-F-001" },
      },
    });
    // A `SuggestButton`: dashed, with its evidence beside it, and a question
    // mark because the app has not decided.
    const offer = screen.getByRole("button", { name: /BW-F-001/ });
    expect(screen.getByText(/Nearly the same wording/)).toBeTruthy();
    // The two answers are STILL there: a suggestion never replaces the question.
    expect(screen.getByPlaceholderText("client's code")).toBeTruthy();
    await userEvent.click(offer);
    expect(saved(spies)).toEqual({ finishFiling: { mode: "link", codeNorm: "BW-F-001" } });
  });

  it("says which row it linked itself to, and offers the way out", async () => {
    // Max's approval 3: an exact wording match links on its own and says so.
    // The way out is the point — two fabrics can read identically and be
    // different, and this is the only automatic step in the item.
    const rows = uncoded();
    const spies = renderCard(rows, {
      [rows[0]!.id]: {
        outcome: "link",
        finishId: "fin-1",
        code: "BW-F-001",
        why: "Same wording as BW-F-001",
        suggestion: null,
      },
    });
    expect(screen.getByText(/BW-F-001 · ours/)).toBeTruthy();
    expect(screen.getByText(/Same wording as BW-F-001/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Not the same finish?" }));
    expect(saved(spies)).toEqual({ finishFiling: { mode: "apart" } });
  });

  it("says what a confirm will do once the decision is taken, and undoes it", async () => {
    const rows = uncoded();
    const spies = renderCard(rows, {
      [rows[0]!.id]: {
        outcome: "mint",
        finishId: null,
        code: null,
        why: "The client gave no code",
        suggestion: null,
      },
    });
    expect(screen.getByText(/ours — a code on confirm/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("client's code")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(saved(spies)).toEqual({ finishFiling: null });
  });

  it("asks NOTHING of a row that already carries a client code", async () => {
    // The code is the key wherever one exists, and stays the key. A row the
    // resolver left out of the map gets no control at all.
    resetIds();
    const rows = [callout("FABRIC", "Yarn Tessarae", "UPH-07")];
    renderCard(rows, {});
    expect(screen.queryByPlaceholderText("client's code")).toBeNull();
    expect(screen.queryByText(/Not in the finishes library/)).toBeNull();
  });

  it("asks nothing of a dimension", async () => {
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null, { attrGroup: "note" })];
    renderCard(rows, {});
    expect(screen.queryByRole("button", { name: /file it internally/ })).toBeNull();
  });
});

describe("the control sits on the row it is about", () => {
  it("renders inside that observation's own row, not beside the card", async () => {
    // A control that is not beside the thing it acts on is a control nobody
    // finds — which is half of why this defect stood: the record screen and
    // the library disagreed and neither said anything.
    resetIds();
    const rows = [callout("FABRIC REFERENCE", AISSA, null), callout("LEGS", "Dark tinted oak", "WD-05")];
    renderCard(rows, {
      [rows[0]!.id]: { outcome: "none", finishId: null, code: null, why: null, suggestion: null },
    });
    const row = screen
      .getAllByRole("row")
      .find((candidate) => within(candidate).queryByDisplayValue(AISSA) !== null);
    expect(row).toBeTruthy();
    expect(within(row!).getByPlaceholderText("client's code")).toBeTruthy();
  });
});
