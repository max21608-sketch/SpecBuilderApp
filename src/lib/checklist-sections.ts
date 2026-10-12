// Which checklist section is about the PROJECT rather than about the item.
//
// ============================================================================
// Matthew, 2026-09-18, on the fourth record he opened: *"you do that once for
// the project presumably?"* The TOE agreement, the sales folder, the client
// contact list, the COM payment plan and fifteen more are asked of every
// category, so reading them again on every record buries the four questions
// that are about the item in front of you.
//
// The section is matched by the SEED's exact string, because that is where the
// grouping lives: `requirements.section` is seed data and this is one reading
// of it, not a second vocabulary.
//
// ---- STEP 2 IS BUILT (Max's ruling, 2026-10-12) ---------------------------
//
// Folding the section (step 1) was what Matthew asked to see first, and step
// 2 waited because a fan-out had not been agreed. Max agreed it after the walk
// of pilot found 450 of 1,509 TGQ questions on one project were these fifteen
// repeated on thirty items. So, everywhere this constant is read:
//
//   * these questions NEVER count in an item's own TGQ (`inItemTgq`,
//     chase-grouping.ts, and its SQL twin in project-summary.ts);
//   * they still block every quote, and are counted ONCE per project as
//     distinct questions (`projectWideTgqKeys`);
//   * they are answered ONCE, on the overview's Project-wide card, and the
//     answer FANS OUT to one `spec_answers` row per record that asks it
//     (`src/lib/project-wide.ts`). There is deliberately no project-level
//     answers table: the export, the gates, chase coverage and history all
//     read the per-record row, and a second home is one they would have to
//     learn about. The `scope = 'project'` column the plan once named is NOT
//     built for the same reason.
//
// It lives in a leaf module rather than beside the screen so a PURE test can
// hold it against the seed without importing a React component: the day the
// seed renames the section, the fold silently stops folding and nothing else
// would say so.
// ============================================================================

/** The `requirements.section` the seed writes for the project-wide questions. */
export const PROJECT_WIDE_SECTION = "Project / commercial";
