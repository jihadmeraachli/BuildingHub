// Snapshot of everything the test plan touches, as one persona, with a diff
// against the previous snapshot. Run after each step of the plan:
//
//   node scripts/test-snapshot.mjs            # as persona "tester"
//   node scripts/test-snapshot.mjs collector  # as another persona label
//
// READ ONLY. Signs in with a persona from scripts/rls-personas.json (gitignored),
// reads through RLS exactly as that user would, writes the snapshot under
// .snapshots/ (gitignored) and prints what changed since the last one.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const label = process.argv[2] ?? 'tester';
const personas = JSON.parse(readFileSync('scripts/rls-personas.json', 'utf8'));
const p = personas.find((x) => x.label === label);
if (!p) { console.error(`No persona labelled "${label}" in scripts/rls-personas.json`); process.exit(1); }

const auth = await (await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: p.email, password: p.password }),
})).json();
if (!auth.access_token) { console.error('sign-in failed for', p.email); process.exit(1); }
const H = { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' };
// PostgREST silently caps a plain read at 1000 rows — a real building has more
// charges than that, and a truncated read blames innocent expenses. Page.
const get = async (path) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    if (!r.ok && r.status !== 206) return out;
    const rows = await r.json();
    if (!Array.isArray(rows)) return out;
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
};
const rpc = async (fn, body) => { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) }); return r.ok ? r.json() : null; };
const r2 = (n) => Math.round(Number(n) * 100) / 100;

// ── read ────────────────────────────────────────────────────────────────────
const buildings = await get('buildings?select=id,name,compound_id,billing_mode&order=name');
const ids = buildings.map((b) => b.id);
const [units, expenses, charges, payments, adjustments, funds, entries, projects, amenities,
  inspections, contracts, issues, grants, history, reminders, notifications] = await Promise.all([
  get('units?select=id,label,building_id,share_weight&order=label'),
  get('expenses?select=id,description,amount_usd,expense_date,funded_by_fund_usd,project_id,amenity_id,building_id,compound_id,method,is_extraordinary&order=expense_date.desc'),
  get('charges?select=id,expense_id,unit_id,amount_usd,billed_to,voided_at'),
  get('payments?select=id,unit_id,amount_usd,paid_on,method,paid_by,recorded_by,voided_at,receipt_url&order=paid_on.desc'),
  get('adjustments?select=id,unit_id,kind,amount_usd,voided_at'),
  get('funds?select=*'),
  get('fund_entries?select=id,kind,amount_usd,entry_date,description,voided_at'),
  get('projects?select=id,title,status,estimate_usd,building_id,compound_id'),
  get('amenities?select=id,name,kind,install_date,expected_life_years,cost_usd,active'),
  get('inspections?select=id,title,amenity_id,next_due_date,status'),
  get('service_contracts?select=id,provider_name,amenity_id,end_date'),
  get('issues?select=id,title,amenity_id,status'),
  get('grants?select=id,user_id,role,scope_type,building_id,compound_id,expires_at,expiry_notified_on'),
  get('grant_history?select=id,user_id,role,reason,ended_at,ended_by,expires_at&order=ended_at.desc'),
  get('reminders_sent?select=unit_id,sent_on,amount_usd,party,source&order=sent_on.desc&limit=30'),
  get('notifications?select=type,title,created_at&order=created_at.desc&limit=15'),
]);
const fund = ids.length ? (await rpc('fund_position', { p_building_ids: ids }))?.[0] ?? null : null;

// ── derive ──────────────────────────────────────────────────────────────────
const unitLabel = Object.fromEntries(units.map((u) => [u.id, u.label]));
const billedBy = {};
for (const c of charges) if (c.expense_id && !c.voided_at) billedBy[c.expense_id] = r2((billedBy[c.expense_id] ?? 0) + Number(c.amount_usd));
const projTitle = Object.fromEntries(projects.map((x) => [x.id, x.title]));
const amenName = Object.fromEntries(amenities.map((a) => [a.id, a.name]));

const snap = {
  persona: label, at: new Date().toISOString(),
  buildings: buildings.map((b) => `${b.name} (${b.billing_mode})`),
  fund,
  expenses: expenses.map((e) => ({
    desc: e.description, amount: r2(e.amount_usd), billed: billedBy[e.id] ?? 0, fund_part: r2(e.funded_by_fund_usd ?? 0),
    gap: r2(Number(e.amount_usd) - (billedBy[e.id] ?? 0) - Number(e.funded_by_fund_usd ?? 0)),
    project: e.project_id ? projTitle[e.project_id] ?? '?' : null, amenity: e.amenity_id ? amenName[e.amenity_id] ?? '?' : null,
    date: e.expense_date, method: e.method,
  })),
  projects: projects.map((x) => ({
    title: x.title, status: x.status, estimate: x.estimate_usd == null ? null : r2(x.estimate_usd),
    actual: r2(expenses.filter((e) => e.project_id === x.id).reduce((s, e) => s + Number(e.amount_usd), 0)),
  })),
  amenities: amenities.map((a) => ({
    name: a.name, kind: a.kind, active: a.active, installed: a.install_date, life: a.expected_life_years,
    replace: a.install_date && a.expected_life_years ? new Date(a.install_date).getFullYear() + a.expected_life_years : null,
    contracts: contracts.filter((c) => c.amenity_id === a.id).length,
    inspections: inspections.filter((i) => i.amenity_id === a.id).length,
    expenses: expenses.filter((e) => e.amenity_id === a.id).length,
    issues: issues.filter((i) => i.amenity_id === a.id).length,
  })),
  unit_balances: units.map((u) => {
    const paid = payments.filter((x) => x.unit_id === u.id && !x.voided_at).reduce((s, x) => s + Number(x.amount_usd), 0);
    const billed = charges.filter((x) => x.unit_id === u.id && !x.voided_at).reduce((s, x) => s + Number(x.amount_usd), 0);
    return { unit: u.label, paid: r2(paid), billed: r2(billed), balance: r2(paid - billed) };
  }),
  payments_by_recorder: Object.entries(payments.filter((x) => !x.voided_at).reduce((m, x) => {
    const k = x.recorded_by ?? 'unknown'; (m[k] ??= { count: 0, total: 0, with_receipt: 0 });
    m[k].count++; m[k].total = r2(m[k].total + Number(x.amount_usd)); if (x.receipt_url) m[k].with_receipt++; return m;
  }, {})).map(([who, v]) => ({ recorded_by: who.slice(0, 8), ...v })),
  grants: grants.map((g) => ({ role: g.role, user: g.user_id.slice(0, 8), expires: g.expires_at, notified: g.expiry_notified_on })),
  grant_history: history.map((h) => ({ role: h.role, user: h.user_id.slice(0, 8), reason: h.reason, ended: h.ended_at.slice(0, 16), by: h.ended_by?.slice(0, 8) ?? null })),
  fund_entries: entries.filter((e) => !e.voided_at).map((e) => ({ kind: e.kind, amount: r2(e.amount_usd), date: e.entry_date, desc: e.description })),
  funds: funds.map((f) => ({ opening: r2(f.opening_balance_usd), date: f.opening_date })),
  reminders: reminders.map((x) => ({ unit: unitLabel[x.unit_id] ?? x.unit_id.slice(0, 8), on: x.sent_on, amount: r2(x.amount_usd), party: x.party, source: x.source })),
  notifications: notifications.map((n) => `${n.created_at.slice(5, 16)} ${n.type}: ${n.title}`),
  adjustments: adjustments.filter((a) => !a.voided_at).map((a) => ({ unit: unitLabel[a.unit_id], kind: a.kind, amount: r2(a.amount_usd) })),
};

// ── checks the plan cares about ─────────────────────────────────────────────
const checks = [];
if (fund) {
  const identity = Math.abs(Number(fund.reserve) - (Number(fund.cash) - (Number(fund.credits) - Number(fund.arrears)))) < 0.005;
  checks.push(`${identity ? 'OK ' : 'BAD'} fund identity reserve = cash - (credits - arrears)`);
  checks.push(`${Number(fund.unreconciled) === 0 ? 'OK ' : 'BAD'} unreconciled expenses = ${fund.unreconciled}`);
}
const gaps = snap.expenses.filter((e) => Math.abs(e.gap) > 0.005);
checks.push(`${gaps.length === 0 ? 'OK ' : 'BAD'} every expense = charges + fund part (${gaps.length} off)`);
for (const x of snap.projects) if (x.estimate != null && x.actual > x.estimate) checks.push(`NOTE project "${x.title}" over estimate by ${r2(x.actual - x.estimate)}`);
const expired = snap.grants.filter((g) => g.expires && g.expires < new Date().toISOString().slice(0, 10));
if (expired.length) checks.push(`NOTE ${expired.length} expired grant(s) still in grants (inert; swept by the morning cron)`);

// ── save + diff ─────────────────────────────────────────────────────────────
mkdirSync('.snapshots', { recursive: true });
const prevFiles = readdirSync('.snapshots').filter((f) => f.startsWith(`${label}-`)).sort();
const prev = prevFiles.length ? JSON.parse(readFileSync(`.snapshots/${prevFiles.at(-1)}`, 'utf8')) : null;
const file = `.snapshots/${label}-${snap.at.replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(snap, null, 2));

const show = (title, v) => { console.log(`\n== ${title}`); console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\{ /g, '{').replace(/ \}/g, '}')); };
console.log(`snapshot as "${label}" · ${snap.at} · buildings: ${snap.buildings.join(', ') || '(none)'}`);
show('fund', fund ? { cash: fund.cash, credits: fund.credits, arrears: fund.arrears, available: fund.available, reserve: fund.reserve, fund_paid: fund.fund_paid, unreconciled: fund.unreconciled } : '(no fund_position — no visible building or migration missing)');
show('checks', checks.join('\n'));

if (prev) {
  console.log(`\n== changes since ${prevFiles.at(-1)}`);
  const keys = ['expenses', 'projects', 'amenities', 'unit_balances', 'payments_by_recorder', 'grants', 'grant_history', 'fund_entries', 'funds', 'reminders', 'adjustments'];
  let any = false;
  for (const k of keys) {
    const a = JSON.stringify(prev[k] ?? null), b = JSON.stringify(snap[k] ?? null);
    if (a !== b) { any = true; show(`${k} (was → now)`, `${a}\n→ ${b}`); }
  }
  if (prev.fund && fund) {
    const d = {}; for (const k of ['cash', 'credits', 'arrears', 'available', 'reserve', 'fund_paid', 'unreconciled']) if (prev.fund[k] !== fund[k]) d[k] = `${prev.fund[k]} → ${fund[k]}`;
    if (Object.keys(d).length) { any = true; show('fund movement', d); }
  }
  const newNotif = snap.notifications.filter((n) => !prev.notifications.includes(n));
  if (newNotif.length) { any = true; show('new notifications', newNotif.join('\n')); }
  if (!any) console.log('(nothing changed)');
} else {
  show('expenses', snap.expenses); show('projects', snap.projects); show('amenities', snap.amenities);
  show('unit balances', snap.unit_balances); show('grants', snap.grants); show('grant_history', snap.grant_history);
}
console.log(`\nsaved ${file}`);
