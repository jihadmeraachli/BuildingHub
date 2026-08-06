// Full local snapshot of the database — the safety net before a destructive
// operation, and usable on the free plan where Supabase gives you no backups.
//
// Reads EVERY table PostgREST exposes (it asks the API for the list, so a table
// added later is picked up without editing this file), plus the auth users, and
// writes one JSON file per table into a timestamped folder.
//
// Usage:  node scripts/dump-db.mjs
//
// Needs the SECRET key, because the point is to read past RLS — a dump taken
// through the anon key would silently save only what one user can see, which is
// the worst kind of backup: the kind that looks fine until you need it.
//
//   Add to .env.local (gitignored, NEVER committed):
//     SUPABASE_SERVICE_KEY=<Project Settings → API → service_role / secret key>
//
// The dump lands in db-dumps/<timestamp>/ which is gitignored — it contains
// every resident's data, so keep it off the repo and off shared drives.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
  console.error('Get the secret key from Supabase → Project Settings → API → service_role.');
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = `db-dumps/${stamp}`;
mkdirSync(dir, { recursive: true });

// PostgREST's root document lists every table it serves — no hardcoded list to
// go stale the next time someone adds a migration.
const spec = await (await fetch(`${URL_}/rest/v1/`, { headers: H })).json();
const tables = Object.keys(spec.definitions ?? spec.paths ?? {})
  .map((k) => k.replace(/^\//, ''))
  .filter((k) => k && !k.startsWith('rpc/') && !k.includes('{'));

let grand = 0;
const summary = [];

for (const table of [...new Set(tables)].sort()) {
  const rows = [];
  // paginate: PostgREST caps a response, and a silently truncated dump is
  // worse than no dump
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${URL_}/rest/v1/${table}?select=*`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) { console.warn(`  skip ${table}: ${res.status}`); break; }
    const page = await res.json();
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  writeFileSync(`${dir}/${table}.json`, JSON.stringify(rows, null, 2));
  summary.push({ table, rows: rows.length });
  grand += rows.length;
  console.log(`  ${table.padEnd(28)} ${rows.length}`);
}

// Auth users live outside PostgREST — without these a restore has data but
// nobody who can log in to it.
const users = [];
for (let page = 1; ; page++) {
  const res = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
  if (!res.ok) { console.warn(`  skip auth users: ${res.status}`); break; }
  const body = await res.json();
  const batch = body.users ?? [];
  users.push(...batch);
  if (batch.length < 200) break;
}
writeFileSync(`${dir}/_auth_users.json`, JSON.stringify(users, null, 2));
summary.push({ table: '_auth_users', rows: users.length });
grand += users.length;
console.log(`  ${'_auth_users'.padEnd(28)} ${users.length}`);

writeFileSync(`${dir}/_manifest.json`, JSON.stringify({ taken: new Date().toISOString(), url: URL_, summary }, null, 2));
console.log(`\nDump complete: ${grand} rows across ${summary.length} tables → ${dir}`);
console.log('Password hashes are NOT exported by the admin API — a restore needs password resets.');
