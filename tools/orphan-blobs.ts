#!/usr/bin/env tsx
// READ ONLY: the stored files nothing in the database names (audit 5.4 A10).
//
//   npx tsx --env-file=.env.localstack.local tools/orphan-blobs.ts      the local stack
//   npx tsx --env-file-if-exists=.env.local tools/orphan-blobs.ts       the sandbox store
//
// No --apply, because nothing here writes: no row, no file. Deleting what it
// lists is a later decision (src/lib/orphan-blobs.ts says why files are left
// behind and why that is the lesser failure). It prints the resolved database
// host first, through the one guard.
//
// THE STORE IS LISTED TWO WAYS. The local stack's fake Blob server has no
// `list`, so with LOCAL_BLOB_DIR set this walks `<dir>/files/`, where that
// server keeps the bytes by pathname (tools/localstack/blob-server.mjs).
// Otherwise it pages through `@vercel/blob`'s `list` under each app prefix.
import { readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { list } from "@vercel/blob";
import { requireScriptEnvironment } from "../db/script-env.mjs";
import { APP_PREFIXES, findOrphans } from "../src/lib/orphan-blobs";

const { databaseUrl } = requireScriptEnvironment("../tools/orphan-blobs.ts", [
  "npx tsx --env-file=.env.localstack.local tools/orphan-blobs.ts   (the local stack)",
]);

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

async function storedPaths(): Promise<{ paths: string[]; from: string }> {
  const local = process.env.LOCAL_BLOB_DIR;
  if (local) {
    const files = path.join(local, "files");
    return { paths: await walk(files, files), from: `the local store at ${files}` };
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("BLOB_READ_WRITE_TOKEN is not set, so the store cannot be listed.");
    process.exit(1);
  }
  const paths: string[] = [];
  for (const prefix of APP_PREFIXES) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, token, limit: 1000 });
      paths.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  return { paths, from: "the Blob store" };
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const named = (
    await client.query<{ path: string }>(
      `select storage_path as path from attachments where storage_path is not null
       union all
       select mailbox_storage_path from email_messages where mailbox_storage_path is not null
       union all
       -- A STAGED document names files too: a bill's row pictures are written
       -- at registration and named only inside the run's staged JSON until the
       -- confirm files them. Every string in it under projects/ counts.
       select distinct v #>> '{}' from intake_runs r, jsonb_path_query(r.parsed, 'strict $.**') v
        where r.parsed is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') like 'projects/%'`,
    )
  ).rows.map((row) => row.path);
  const projectIds = (await client.query<{ id: string }>(`select id from projects`)).rows.map((row) => row.id);
  const { paths, from } = await storedPaths();
  const { orphans, checked } = findOrphans({ stored: paths, named, projectIds });

  console.log(`\n${checked} file(s) under ${APP_PREFIXES.join(" and ")} in ${from}; ${named.length} path(s) named in the database.`);
  const byWhy = new Map<string, string[]>();
  for (const orphan of orphans) byWhy.set(orphan.why, [...(byWhy.get(orphan.why) ?? []), orphan.path]);
  if (orphans.length === 0) console.log("No orphaned file.");
  for (const [why, list] of byWhy) {
    console.log(`\n${list.length} file(s): ${why}`);
    for (const pathname of list) console.log(`  ${pathname}`);
  }
  console.log("\nREAD ONLY: nothing was deleted.");
} finally {
  await client.end();
}
