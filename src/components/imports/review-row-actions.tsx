"use client";

// What a row on a drawings card can ask the REVIEW SCREEN to do, without every
// card in between carrying a prop for it.
//
// ============================================================================
// Plan any-bill, step 4. A cross-page clash is decided on the ROW (its
// `RowNotes` panel), but what it writes reaches two rows on two pages, and a
// swatch crop the screen holds keyed by observation. Those live in the review
// screen — `DrawingsReview` and `PackDrawingsReview` — three card components
// away. A context is how the row reaches them; the default is null, so a card
// rendered without a screen around it (the component tier, the design page)
// shows the clash's sentence and no buttons, exactly as before.
//
// THE HELD SWATCH is here for the same reason. A crop carried from an ignored
// row onto the kept one is re-keyed in the screen's own map; the kept row's
// picker has to SHOW it, or a reviewer crops it a second time believing the
// first was lost. `epoch` moves whenever a crop is re-keyed, so a picker reads
// the map again.
// ============================================================================
import { createContext, useContext } from "react";
import type { ClashChoice } from "@/lib/clash-resolution";
import type { CroppedImage } from "@/lib/pdf-crop";

export type ReviewRowActions = {
  resolveClash: (choice: ClashChoice) => void;
  busy: boolean;
  /** The crop the screen holds for a row, or null. */
  heldSwatch: (observationId: string) => CroppedImage | null;
  /** Moves when a held crop is re-keyed. */
  swatchEpoch: number;
};

export const ReviewRowActionsContext = createContext<ReviewRowActions | null>(null);

export const useReviewRowActions = () => useContext(ReviewRowActionsContext);
