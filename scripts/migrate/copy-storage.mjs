// Frankfurt migration, Phase 2.1 — copy every storage object from the old
// (Seoul) project to the new (Frankfurt) one, same buckets, same paths.
//
//   node scripts/migrate/copy-storage.mjs           # copy everything
//   node scripts/migrate/copy-storage.mjs --dry     # just list what would move
//
// Reads scripts/migration.env (gitignored): OLD_SERVICE_ROLE_KEY, NEW_REF,
// NEW_SERVICE_ROLE_KEY. Idempotent — uploads use x-upsert, rerunning is safe.
// Total volume today is ~1 MB, so this runs in seconds.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OLD_REF = 'miyrsnlpftybmudiuhbi';
const BUCKETS = ['attachments', 'avatars', 'buildings', 'invoices', 'issue-photos'];
const DRY = process.argv.includes('--dry');

// -- env ---------------------------------------------------------------
// Strict KEY=VALUE lines only (uppercase keys), so the multi-line .p8 block
// can never be mis-parsed as keys.
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'migration.env');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const need = (k) => {
  if (!env[k]) { console.error(`missing ${k} in scripts/migration.env`); process.exit(1); }
  return env[k];
};
const OLD_KEY = need('OLD_SERVICE_ROLE_KEY');
const NEW_REF = need('NEW_REF');
const NEW_KEY = need('NEW_SERVICE_ROLE_KEY');
const oldBase = `https://${OLD_REF}.supabase.co/storage/v1`;
const newBase = `https://${NEW_REF}.supabase.co/storage/v1`;
const auth = (key) => ({ Authorization: `Bearer ${key}`, apikey: key });

// -- walk a bucket (folders come back with id === null; recurse into them) --
async function listAll(bucket, prefix = '') {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${oldBase}/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...auth(OLD_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
    const entries = await res.json();
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...await listAll(bucket, path));         // folder
      else out.push({ path, contentType: e.metadata?.mimetype ?? 'application/octet-stream', size: e.metadata?.size ?? 0 });
    }
    if (entries.length < 100) break;
    offset += 100;
  }
  return out;
}

async function copyOne(bucket, obj) {
  const dl = await fetch(`${oldBase}/object/${bucket}/${obj.path}`, { headers: auth(OLD_KEY) });
  if (!dl.ok) throw new Error(`download ${bucket}/${obj.path}: ${dl.status}`);
  const body = Buffer.from(await dl.arrayBuffer());
  const up = await fetch(`${newBase}/object/${bucket}/${obj.path}`, {
    method: 'POST',
    headers: { ...auth(NEW_KEY), 'Content-Type': obj.contentType, 'x-upsert': 'true' },
    body,
  });
  if (!up.ok) throw new Error(`upload ${bucket}/${obj.path}: ${up.status} ${await up.text()}`);
  return body.length;
}

let files = 0, bytes = 0;
for (const bucket of BUCKETS) {
  const objects = await listAll(bucket);
  console.log(`${bucket}: ${objects.length} object(s)`);
  for (const obj of objects) {
    if (DRY) { console.log(`  would copy ${obj.path} (${obj.size} B)`); continue; }
    const n = await copyOne(bucket, obj);
    files += 1; bytes += n;
    console.log(`  copied ${obj.path} (${n} B)`);
  }
}
console.log(DRY ? 'dry run complete' : `done: ${files} file(s), ${(bytes / 1024).toFixed(1)} KiB`);
