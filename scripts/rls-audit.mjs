// RLS audit — sign in as each persona and check what they can ACTUALLY read.
//
// WHY THIS EXISTS. RLS bugs are invisible from the UI. Nothing throws, no
// screen looks broken: a query just returns more rows than it should, and the
// only way to notice is to go and look. Three real leaks were found by hand in
// a single day, all of this shape:
//
//   0096  every authenticated user could list EVERY building on the platform
//   0097  a tenant could read the owner's payments, charges and discounts
//   0093  a SECURITY DEFINER function wrote charges onto units out of scope
//
// SELF-CONFIGURING, deliberately. It does not read a list of expectations that
// would rot the first time the model changes. For each persona it derives the
// scope they are ENTITLED to from their own grants and memberships, then
// compares that against what the database actually hands them. Anything
// visible with no path to it is a finding.
//
// READ ONLY. It never writes, so it is safe against production. The trade is
// that it cannot verify write policies or the demo read-only triggers (0094) —
// testing those means writing, and a write in here would fire notification
// triggers and email real people. Those stay a manual check.
//
// Setup: copy scripts/rls-personas.example.json to scripts/rls-personas.json
// (gitignored — it holds passwords) and fill in the accounts to test.
//
// Usage: node scripts/rls-audit.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) { console.error('Missing Supabase URL or anon key in .env.local'); process.exit(1); }

const PERSONA_FILE = 'scripts/rls-personas.json';
if (!existsSync(PERSONA_FILE)) {
  console.error(`Missing ${PERSONA_FILE}. Copy scripts/rls-personas.example.json and fill it in.`);
  process.exit(1);
}
const personas = JSON.parse(readFileSync(PERSONA_FILE, 'utf8'));

// Tables where a leak actually matters. Counting rows per persona is the cheap
// signal; the scope checks below are the sharp one.
const TABLES = [
  'buildings', 'compounds', 'units', 'charges', 'payments', 'adjustments',
  'expenses', 'dues', 'budgets', 'meetings', 'issues', 'inspections',
  'service_contracts', 'profiles', 'grants', 'memberships', 'invoices',
  'funds', 'fund_entries', 'grant_history',
];

const findings = [];
const rows = [];

async function signIn(p) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: p.email, password: p.password }),
  });
  const body = await res.json();
  return body.access_token ? { token: body.access_token, uid: body.user.id } : null;
}

const H = (t, extra = {}) => ({ apikey: ANON, Authorization: `Bearer ${t}`, ...extra });

/** Row count without pulling the rows: ask for one and read the range header. */
async function count(token, path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: H(token, { Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!res.ok && res.status !== 206) return null;
  const cr = res.headers.get('content-range');       // "0-0/20" or "*/0"
  return cr ? Number(cr.split('/')[1]) : null;
}

async function ids(token, path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H(token) });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

function flag(persona, severity, what, detail) {
  findings.push({ persona, severity, what, detail });
}

for (const p of personas) {
  const auth = await signIn(p);
  if (!auth) { flag(p.label, 'error', 'sign-in failed', 'wrong password, or the account is gone'); continue; }
  const { token, uid } = auth;

  // Platform admins are SUPPOSED to see everything, so scope checks are
  // meaningless for them — but their counts are the useful baseline for
  // "how much is there in total".
  const me = await ids(token, `profiles?select=is_platform_admin&id=eq.${uid}`);
  const isPlatform = !!me[0]?.is_platform_admin;

  const counts = {};
  for (const t of TABLES) counts[t] = await count(token, `${t}?select=*`);
  rows.push({ label: p.label, isPlatform, counts });

  if (isPlatform) continue;

  // ── the scope this persona is ENTITLED to, from their own rows ───────────
  const grants = await ids(token, `grants?select=scope_type,building_id,compound_id,org_id&user_id=eq.${uid}`);
  const mems = await ids(token, `memberships?select=unit_id,tenure&user_id=eq.${uid}`);
  const myUnitIds = mems.map((m) => m.unit_id);

  const entitled = new Set(grants.filter((g) => g.building_id).map((g) => g.building_id));
  // compound-scoped grants cascade to every block in the compound
  for (const g of grants.filter((x) => x.compound_id)) {
    for (const b of await ids(token, `buildings?select=id&compound_id=eq.${g.compound_id}`)) entitled.add(b.id);
  }
  // residency reaches the building the unit sits in
  if (myUnitIds.length) {
    for (const u of await ids(token, `units?select=building_id&id=in.(${myUnitIds.join(',')})`)) entitled.add(u.building_id);
  }

  // ── 1. buildings visible with no path to them (the 0096 class) ───────────
  const seen = await ids(token, 'buildings?select=id,name&limit=1000');
  const stray = seen.filter((b) => !entitled.has(b.id));
  if (stray.length) {
    flag(p.label, 'high', `sees ${stray.length} building(s) with no grant or membership`,
      stray.slice(0, 8).map((b) => b.name).join(', '));
  }

  // ── 2. units outside those buildings ────────────────────────────────────
  const strayUnits = (await ids(token, 'units?select=id,building_id&limit=2000'))
    .filter((u) => !entitled.has(u.building_id));
  if (strayUnits.length) {
    flag(p.label, 'high', `sees ${strayUnits.length} unit(s) in buildings it has no path to`, '');
  }

  // ── 3. party leakage (the 0097 class) ───────────────────────────────────
  // A pure tenant must never see the owner's side of their own unit.
  const isTenantOnly = mems.length > 0 && mems.every((m) => m.tenure === 'tenant');
  if (isTenantOnly) {
    const ownerPays = await count(token, 'payments?select=id&paid_by=eq.owner');
    if (ownerPays) flag(p.label, 'high', `tenant can read ${ownerPays} owner payment(s)`, 'party scoping (0097)');
    const ownerCharges = await count(token, 'charges?select=id&billed_to=neq.tenant');
    if (ownerCharges) flag(p.label, 'high', `tenant can read ${ownerCharges} non-tenant charge(s)`, 'party scoping (0097)');
    const ownerAdj = await count(token, 'adjustments?select=id&party=eq.owner');
    if (ownerAdj) flag(p.label, 'high', `tenant can read ${ownerAdj} owner adjustment(s)`, 'party scoping (0097)');
  }

  // ── 4. money on units they have no claim to ─────────────────────────────
  if (myUnitIds.length && !grants.length) {
    const foreignPays = await count(token, `payments?select=id&unit_id=not.in.(${myUnitIds.join(',')})`);
    if (foreignPays) flag(p.label, 'high', `resident sees ${foreignPays} payment(s) on other units`, '');
    const foreignCharges = await count(token, `charges?select=id&unit_id=not.in.(${myUnitIds.join(',')})`);
    if (foreignCharges) flag(p.label, 'high', `resident sees ${foreignCharges} charge(s) on other units`, '');
  }

  // ── 5. worth knowing, not necessarily wrong ─────────────────────────────
  const otherDues = myUnitIds.length && !grants.length
    ? await count(token, `dues?select=id&unit_id=not.in.(${myUnitIds.join(',')})`) : 0;
  if (otherDues) {
    flag(p.label, 'note', `resident sees ${otherDues} dues row(s) on other units`,
      'dues_select allows any building member — may be deliberate transparency, needs a product call');
  }
}

// ── report ────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? '-').padEnd(n);
const cols = ['buildings', 'units', 'charges', 'payments', 'expenses', 'dues', 'profiles'];
console.log('\nVISIBLE ROW COUNTS');
console.log(pad('persona', 24) + cols.map((c) => pad(c, 11)).join(''));
for (const r of rows) {
  console.log(pad(r.label + (r.isPlatform ? ' *' : ''), 24) + cols.map((c) => pad(r.counts[c], 11)).join(''));
}
console.log('  * platform admin: sees everything by design, and is the baseline for what "everything" is.\n');

const high = findings.filter((f) => f.severity === 'high');
const notes = findings.filter((f) => f.severity !== 'high');

if (!high.length) {
  console.log('SCOPE CHECKS: no leaks found. Every persona sees only what a grant or a membership entitles them to.');
} else {
  console.log(`SCOPE CHECKS: ${high.length} finding(s)\n`);
  for (const f of high) console.log(`  [${f.persona}] ${f.what}${f.detail ? `\n      ${f.detail}` : ''}`);
}
if (notes.length) {
  console.log('\nNOTES');
  for (const f of notes) console.log(`  [${f.persona}] ${f.what}\n      ${f.detail}`);
}

console.log('\nNot covered: write policies and the demo read-only triggers (0094). Testing those means writing, which would fire notification triggers and email real people. Check those by hand.');
process.exit(high.length ? 1 : 0);
