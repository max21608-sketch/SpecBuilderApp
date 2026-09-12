// Postgres numeric/decimal columns come back as strings from the driver
// (node-postgres and @neondatabase/serverless both do this deliberately, to
// avoid silent float-precision loss on values JS numbers can't represent
// exactly) even though the schema and our TypeScript types describe them as
// numbers. Anywhere a value crosses from a DB row into JSON/UI code that does
// arithmetic or formatting (toFixed, sorting, etc.), it must go through this.
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}
