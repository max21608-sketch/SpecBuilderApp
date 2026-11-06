// The version a review screen would send with a bill confirm.
//
// A bill confirm must name the version of the staged bill it read (audit R2,
// 2026-11-06): a confirm with none used to skip the lock and confirm whatever
// the bill held by then. A fixture that stages a bill and confirms it reads the
// version back here, the way the screen reads it off the GET.
export async function stagedVersion(
  client: { query: (text: string, values: unknown[]) => Promise<{ rows: { version: number }[] }> },
  runId: string,
): Promise<number> {
  const rows = (await client.query(`select version from intake_runs where id = $1`, [runId])).rows;
  if (!rows[0]) throw new Error(`no intake run ${runId}`);
  return Number(rows[0].version);
}
