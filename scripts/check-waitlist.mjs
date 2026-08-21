// Drives the waitlist table exactly as a logged-out visitor's browser would:
// the anon key, no session. Proves the RLS in 0104 does what its comments say.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const addr = `waitlist-check-${process.argv[2] ?? 'x'}@example.com`;
const line = (ok, msg) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
let failures = 0;
const check = (ok, msg) => { line(ok, msg); if (!ok) failures++; };

// 1. anon may insert
const ins = await sb.from('waitlist').insert({ email: addr, locale: 'en', source: 'gate' });
check(!ins.error, `anon insert accepted${ins.error ? ` — ${ins.error.code} ${ins.error.message}` : ''}`);

// 2. anon may NOT read the list back
const sel = await sb.from('waitlist').select('email');
check(!sel.error && (sel.data?.length ?? 0) === 0,
  `anon select returns nothing (got ${sel.data?.length ?? 'error: ' + sel.error?.code} rows)`);

// 3. the same address twice is one row, not two
const dupe = await sb.from('waitlist').insert({ email: addr.toUpperCase(), source: 'gate' });
check(dupe.error?.code === '23505',
  `duplicate address rejected as 23505 (got ${dupe.error?.code ?? 'no error'})`);

// 4. a malformed address is refused by the DATABASE, not just the form
const bad = await sb.from('waitlist').insert({ email: 'not-an-email', source: 'gate' });
check(bad.error?.code === '23514',
  `malformed address rejected as 23514 (got ${bad.error?.code ?? 'no error'})`);

// 5. anon may not delete what it left.
//    A blocked DELETE does not necessarily error: with no row visible to anon,
//    PostgREST deletes nothing and returns 204, which looks identical to
//    success. So prove the row SURVIVED instead of trusting the response —
//    re-inserting the same address must still collide on the unique index.
//    (anon cannot SELECT, by design, so this is the only way to look.)
const del = await sb.from('waitlist').delete().eq('email', addr);
const probe = await sb.from('waitlist').insert({ email: addr, source: 'gate' });
check(probe.error?.code === '23505',
  `anon delete left the row in place — re-insert still collides `
  + `(delete said ${del.error ? del.error.code : 'no error'}, re-insert said ${probe.error?.code ?? 'accepted, ROW WAS DELETED'})`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
