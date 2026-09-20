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
// grouping lives today: `requirements.section` is seed data and this is one
// reading of it, not a second vocabulary. Step 2 of the plan would make it a
// column (`scope = 'project'`) and answer it once for the whole project — it
// is deliberately NOT built, because folding the section is what Matthew asked
// to see first and a fan-out is a data model change nobody has agreed.
//
// It lives in a leaf module rather than beside the screen so a PURE test can
// hold it against the seed without importing a React component: the day the
// seed renames the section, the fold silently stops folding and nothing else
// would say so.
// ============================================================================

/** The `requirements.section` the seed writes for the project-wide questions. */
export const PROJECT_WIDE_SECTION = "Project / commercial";
