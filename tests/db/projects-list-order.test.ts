// Database tier — the projects list is ordered by when somebody last worked in
// a project, through the REAL route.
//
// Skips silently without DATABASE_URL. Run with:
//   REQUIRE_DB_TESTS=1 node --env-file=.env.local ./node_modules/.bin/vitest run tests/db/projects-list-order.test.ts
//
// IT GOES THROUGH `GET /api/projects` ON PURPOSE. The order is an ORDER BY in
// that route's own query and nothing else can carry it: `loadProjectSummaries`
// returns a Map joined back in memory, and the page's four tabs are pure
// client-side filters that preserve the array they were given. A test that
// re-expressed the clause here would be a second implementation of the sort,
// asserting itself.
//
// THE TRAP IT HOLDS is which column says "worked in". `projects.updated_at`
// moves only when the project ROW is written, so a rename would outrank a day
// of confirms; the key is `greatest(max(change_sets.created_at), p.created_at)`
// and `p.created_at` is the SECOND TERM of it, not a fallback — a project added
// this morning has no change set at all and must not sort last.
//
// Rows are prefixed `__QA ` and deleted FK-safe. A change set cannot be deleted
// directly (0014 refuses it while its project exists); deleting the project
// cascades, which is the whole of the teardown.
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeIfDb, qaNumber } from "./db-tier";
import pg from "pg";
import { GET } from "@/app/api/projects/route";

const databaseUrl = process.env.DATABASE_URL;

/** The fixture's project numbers. Alphabetical here; recency reorders them. */
const WORKED_10_DAYS_AGO = qaNumber("P00081");
const WORKED_A_MINUTE_AGO = qaNumber("P00082");
const ADDED_5_DAYS_AGO = qaNumber("P00083");
const UNTOUCHED_FIRST = qaNumber("P00084");
const UNTOUCHED_SECOND = qaNumber("P00085");
const ARCHIVED_WORKED_JUST_NOW = qaNumber("P00080");

describeIfDb("the projects list is ordered by most recently worked in", () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  const projectIds: string[] = [];

  const DAY = 24 * 60 * 60 * 1000;
  const startedAt = Date.now();
  /** A moment, stated absolutely so two rows can share one exactly. */
  const daysAgo = (days: number) => new Date(startedAt - days * DAY);

  /**
   * One fixture project. `created_at` is written explicitly because it is half
   * the sort key: leaving every row on its `now()` default would make the
   * second term of that key untestable, and two rows inserted a microsecond
   * apart cannot test the tiebreak.
   */
  async function addProject(number: string, createdAt: Date, options: { archived?: boolean } = {}): Promise<string> {
    const row = await client.query(
      `insert into projects (bws_project_number, name, status, archived_at, archived_by,
                             created_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, 'qa', 'qa') returning id`,
      [
        number,
        `__QA List order ${number}`,
        options.archived ? "archived" : "active",
        options.archived ? new Date(startedAt) : null,
        options.archived ? "qa" : null,
        createdAt,
      ],
    );
    const id = String(row.rows[0].id);
    projectIds.push(id);
    return id;
  }

  /** Somebody working in the project, at a stated moment. */
  async function addChangeSet(projectId: string, at: Date): Promise<void> {
    await client.query(
      `insert into change_sets (project_id, kind, actor, created_at, closed_at)
       values ($1, 'manual_edit', 'qa', $2, now())`,
      [projectId, at],
    );
  }

  /** The list as the route returns it, narrowed to this run's own fixtures. */
  async function listedNumbers(includeArchived = false): Promise<string[]> {
    const url = `http://localhost/api/projects${includeArchived ? "?includeArchived=true" : ""}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      projects: { bws_project_number: string }[];
    };
    expect(body.ok).toBe(true);
    const mine = new Set([
      WORKED_10_DAYS_AGO,
      WORKED_A_MINUTE_AGO,
      ADDED_5_DAYS_AGO,
      UNTOUCHED_FIRST,
      UNTOUCHED_SECOND,
      ARCHIVED_WORKED_JUST_NOW,
    ]);
    // Narrowed, never re-sorted: the assertion is about the order the route
    // handed back, and the sandbox's own projects sit between these rows.
    return body.projects.map((project) => project.bws_project_number).filter((number) => mine.has(number));
  }

  beforeAll(async () => {
    await client.connect();

    // Worked in ten days ago, and alphabetically FIRST of the two worked-in
    // projects — so under the old `bws_project_number` order it led.
    const older = await addProject(WORKED_10_DAYS_AGO, daysAgo(40));
    await addChangeSet(older, daysAgo(10));

    // Worked in a minute ago, alphabetically LATER. This is the pair that
    // proves recency beats the alphabet.
    const newer = await addProject(WORKED_A_MINUTE_AGO, daysAgo(40));
    await addChangeSet(newer, new Date(startedAt - 60_000));

    // Added five days ago and never worked in: no change set at all. It belongs
    // BETWEEN the two above, which is what makes `p.created_at` a term of the
    // key rather than a branch taken when the max is null.
    await addProject(ADDED_5_DAYS_AGO, daysAgo(5));

    // Two projects created at the SAME instant with nothing done in either, so
    // only the tiebreak can separate them.
    const sameInstant = daysAgo(90);
    await addProject(UNTOUCHED_FIRST, sameInstant);
    await addProject(UNTOUCHED_SECOND, sameInstant);

    // Archived, and worked in more recently than anything else here.
    const archived = await addProject(ARCHIVED_WORKED_JUST_NOW, daysAgo(40), { archived: true });
    await addChangeSet(archived, new Date(startedAt - 1_000));
  });

  afterAll(async () => {
    // GUARDED: a failed beforeAll leaves this empty, and reporting a second
    // unrelated error over the real one is its own defect (2026-09-21).
    if (projectIds.length > 0) {
      // change_sets cascade from the project; deleting one directly is refused.
      await client.query(`delete from projects where id = any($1)`, [projectIds]);
    }
    await client.end();
  });

  it("puts the most recently worked-in project first, whatever its number", async () => {
    const listed = await listedNumbers();
    expect(listed.indexOf(WORKED_A_MINUTE_AGO)).toBeLessThan(listed.indexOf(WORKED_10_DAYS_AGO));
    // And it is genuinely against the alphabet, which is what the list did
    // before: the recent one sorts LATER by number.
    expect(WORKED_A_MINUTE_AGO > WORKED_10_DAYS_AGO).toBe(true);
  });

  it("ranks a project nobody has worked in by when it was ADDED, not last", async () => {
    const listed = await listedNumbers();
    // Added 5 days ago, so it sits above a project last worked in 10 days ago
    // and below one worked in a minute ago. Ordering on the max alone would put
    // it at the bottom, which is the opposite of what was asked for.
    expect(listed.indexOf(WORKED_A_MINUTE_AGO)).toBeLessThan(listed.indexOf(ADDED_5_DAYS_AGO));
    expect(listed.indexOf(ADDED_5_DAYS_AGO)).toBeLessThan(listed.indexOf(WORKED_10_DAYS_AGO));
  });

  it("breaks a tie on the project number, so a reload is not a reshuffle", async () => {
    const listed = await listedNumbers();
    expect(listed.indexOf(UNTOUCHED_FIRST)).toBeLessThan(listed.indexOf(UNTOUCHED_SECOND));
    const again = await listedNumbers();
    expect(again).toEqual(listed);
  });

  it("keeps active above archived, however recently the archived one was worked in", async () => {
    const withoutArchived = await listedNumbers();
    expect(withoutArchived).not.toContain(ARCHIVED_WORKED_JUST_NOW);

    const listed = await listedNumbers(true);
    // It carries the newest change set of the whole fixture and still comes
    // last: archiving moves a project out of the way even for somebody looking
    // at everything, so recency replaces the SECOND term of the order.
    expect(listed[listed.length - 1]).toBe(ARCHIVED_WORKED_JUST_NOW);
  });
});
