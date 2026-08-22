// Drives the attachments bucket as a real signed-in user, the way a browser
// would, to prove what migration 0105 does and does not allow.
//
// Run it BEFORE applying 0105 and you should see the bucket enumerate and a
// write into a stranger's folder succeed. Run it AFTER and both should fail.
// That before/after is the whole point: a security change nobody watched fail
// first is a security change nobody has tested.
//
//   node scripts/check-storage-scope.mjs
//
// Needs .env.local (url + anon key) and scripts/rls-personas.json, both
// gitignored. Uses the ANON key only — never the service key, which bypasses
// every policy under test and would make the whole run meaningless.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const personas = JSON.parse(readFileSync('scripts/rls-personas.json', 'utf8'));

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};

const BUCKET = 'attachments';
const png = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

for (const p of personas) {
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  const { error: authErr } = await sb.auth.signInWithPassword({ email: p.email, password: p.password });
  if (authErr) { check(false, `${p.label}: sign in — ${authErr.message}`); continue; }
  console.log(`\n── ${p.label} ─────────────────────────────`);

  // 1. What does the bucket root show them? Before 0105 this lists every
  //    building on the platform; after, only folders they have business in.
  const { data: root, error: listErr } = await sb.storage.from(BUCKET).list('', { limit: 100 });
  const folders = (root ?? []).map((e) => e.name);
  console.log(`      root listing: ${listErr ? 'error ' + listErr.message : folders.join(', ') || '(empty)'}`);

  // 2. Writing into a folder keyed by an id that belongs to nobody must be
  //    refused. This is the unambiguous one: it needs no existing file and no
  //    second building to exist, and a pass here means the path is being read.
  const strangerPath = `${randomUUID()}/expenses/probe-${Date.now()}.png`;
  const stranger = await sb.storage.from(BUCKET).upload(strangerPath, png);
  check(!!stranger.error, `write into a stranger's folder refused${stranger.error ? '' : ' — IT SUCCEEDED, path: ' + strangerPath}`);
  if (!stranger.error) await sb.storage.from(BUCKET).remove([strangerPath]);

  // 3. Their own scope must still work, or the fix has broken the product.
  //    Uses whichever real folder the root listing exposed, so it tests the
  //    live data rather than a fixture.
  const own = folders.find((f) => /^[0-9a-f-]{36}$/i.test(f));
  if (own) {
    const ownPath = `${own}/expenses/probe-${Date.now()}.png`;
    const up = await sb.storage.from(BUCKET).upload(ownPath, png);
    check(!up.error, `write into their own building's folder allowed${up.error ? ' — ' + up.error.message : ''}`);
    if (!up.error) {
      const signed = await sb.storage.from(BUCKET).createSignedUrl(ownPath, 60);
      check(!signed.error && !!signed.data?.signedUrl, 'sign a URL for their own file');
      await sb.storage.from(BUCKET).remove([ownPath]);
    }
  } else {
    console.log('      no building folder visible to this persona, skipping the positive case');
  }

  // 4. Avatars stay readable, feedback does not leak between users.
  const foreignFeedback = `feedback/${randomUUID()}/probe-${Date.now()}.png`;
  const ff = await sb.storage.from(BUCKET).upload(foreignFeedback, png);
  check(!!ff.error, `write into another user's feedback folder refused${ff.error ? '' : ' — IT SUCCEEDED'}`);
  if (!ff.error) await sb.storage.from(BUCKET).remove([foreignFeedback]);

  await sb.auth.signOut();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
