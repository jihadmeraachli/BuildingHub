// Demo dataset seeder — fills the test building with an "ideal use" picture:
// 20 units, named owners/tenants, 8 months of expenses/charges/payments,
// contracts, inspections, meetings, issues, full license coverage.
//
// Runs AS the admin account through the normal API (RLS enforced), like the app.
// Order matters: existing memberships are ended and finance history inserted
// BEFORE dummy memberships are created, so charge/payment webhooks find no
// recipients and no notification storm goes out.
//
// Usage: node seed-demo.mjs <admin_email> <admin_password> [alias_inbox]
//   alias_inbox: gmail address that receives the +alias invite emails
//                (default jihad.meraachli@gmail.com)

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [email, password, aliasInbox = 'jihad.meraachli@gmail.com'] = process.argv.slice(2);
if (!email || !password) { console.error('usage: node seed-demo.mjs <email> <password>'); process.exit(1); }

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const die = (msg, err) => { console.error('FATAL:', msg, err?.message ?? err ?? ''); process.exit(1); };
const ok = (label, error) => { if (error) console.warn(`  warn [${label}]:`, error.message); };

// ── Sign in ─────────────────────────────────────────────────────────────────
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
if (authErr) die('sign-in', authErr);
const me = auth.user;
console.log('signed in as', me.email, me.id);

// ── Discover scope ──────────────────────────────────────────────────────────
const { data: grants } = await supabase.from('grants').select('*').eq('user_id', me.id);
const buildingIds = new Set((grants ?? []).filter(g => g.building_id).map(g => g.building_id));
const compoundIds = (grants ?? []).filter(g => g.compound_id).map(g => g.compound_id);
if (compoundIds.length) {
  const { data: blocks } = await supabase.from('buildings').select('id').in('compound_id', compoundIds);
  for (const b of blocks ?? []) buildingIds.add(b.id);
}
if (!buildingIds.size) die('no buildings in scope for this account');
const { data: bldgs } = await supabase.from('buildings').select('*').in('id', [...buildingIds]);
// Prefer the block with the most units already (his main test block)
const { data: unitCounts } = await supabase.from('units').select('id, building_id').in('building_id', [...buildingIds]);
const countBy = {};
for (const u of unitCounts ?? []) countBy[u.building_id] = (countBy[u.building_id] ?? 0) + 1;
const B = [...bldgs].sort((a, b) => (countBy[b.id] ?? 0) - (countBy[a.id] ?? 0))[0];
console.log('target building:', B.name, B.id, `(existing units: ${countBy[B.id] ?? 0})`);

// ── 1. End existing memberships (no recipients during the finance backfill) ──
const { data: existingUnits } = await supabase.from('units').select('*').eq('building_id', B.id).order('created_at');
const unitIdsNow = (existingUnits ?? []).map(u => u.id);
if (unitIdsNow.length) {
  const { data: mems } = await supabase.from('memberships').select('id, user_id, unit_id').in('unit_id', unitIdsNow).is('ended_at', null);
  for (const m of mems ?? []) {
    const { error } = await supabase.from('memberships').update({ ended_at: new Date().toISOString() }).eq('id', m.id);
    ok('end membership', error);
  }
  console.log(`ended ${(mems ?? []).length} existing membership(s)`);
}

// ── 2. Void old finance rows, clear old operational test rows ───────────────
if (unitIdsNow.length) {
  const voidStamp = { voided_at: new Date().toISOString(), voided_by: me.id, void_reason: 'Reset for demo dataset' };
  const { error: vc } = await supabase.from('charges').update(voidStamp).in('unit_id', unitIdsNow).is('voided_at', null);
  ok('void charges', vc);
  const { error: vp } = await supabase.from('payments').update(voidStamp).in('unit_id', unitIdsNow).is('voided_at', null);
  ok('void payments', vp);
  const { error: va } = await supabase.from('adjustments').update(voidStamp).in('unit_id', unitIdsNow).is('voided_at', null);
  ok('void adjustments', va);
}
for (const tbl of ['meetings', 'issues', 'inspections', 'service_contracts']) {
  const { error } = await supabase.from(tbl).delete().eq('building_id', B.id);
  ok(`clear ${tbl}`, error);
}
console.log('old finance voided, old meetings/issues/inspections/contracts cleared');

// ── 3. Units: rename existing into the pattern, create the rest (20 total) ──
const LABELS = [];
for (let f = 1; f <= 5; f++) for (let n = 1; n <= 4; n++) LABELS.push(`${f}0${n}`);

const units = []; // aligned with LABELS
const leftovers = (existingUnits ?? []).filter(u => !LABELS.includes(u.label));
for (const [i, label] of LABELS.entries()) {
  const existing = (existingUnits ?? []).find(u => u.label === label);
  if (existing) { units[i] = existing; continue; }
  const reuse = leftovers.shift();
  if (reuse) {
    const { data, error } = await supabase.from('units')
      .update({ label, share_weight: 1, occupancy: 'occupied' }).eq('id', reuse.id).select().single();
    if (error) die(`rename unit ${reuse.label} -> ${label}`, error);
    units[i] = data;
  } else {
    const { data, error } = await supabase.from('units')
      .insert({ building_id: B.id, label, share_weight: 1 }).select().single();
    if (error) die(`create unit ${label}`, error);
    units[i] = data;
  }
}
console.log('units ready:', units.map(u => u.label).join(' '));

// Occupancy notes: two vacant investor units, one owner abroad
await supabase.from('units').update({ occupancy: 'vacant' }).in('id', [units[16].id, units[17].id]);
await supabase.from('units').update({ occupancy: 'abroad' }).eq('id', units[8].id);

// ── 4. Licenses: cover all 20 units ─────────────────────────────────────────
{
  let sub = null;
  const { data: s1 } = await supabase.from('subscriptions').select('*').eq('building_id', B.id);
  sub = (s1 ?? [])[0] ?? null;
  if (!sub && B.compound_id) {
    const { data: s2 } = await supabase.from('subscriptions').select('*').eq('compound_id', B.compound_id);
    sub = (s2 ?? [])[0] ?? null;
  }
  if (!sub) console.warn('  warn: no subscription found — licenses skipped');
  else {
    if (sub.license_count < 20) {
      const { error } = await supabase.from('subscriptions').update({ license_count: 20 }).eq('id', sub.id);
      ok('license_count -> 20', error);
      await supabase.from('subscription_events').insert({
        subscription_id: sub.id, event_type: 'licenses_added', actor_id: me.id,
        metadata: { added: 20 - sub.license_count, new_total: 20, note: 'demo dataset' },
      });
    }
    const { data: assigned } = await supabase.from('license_assignments')
      .select('unit_id').eq('subscription_id', sub.id).is('unassigned_at', null);
    const covered = new Set((assigned ?? []).map(a => a.unit_id));
    const missing = units.filter(u => !covered.has(u.id))
      .map(u => ({ subscription_id: sub.id, unit_id: u.id, assigned_by: me.id }));
    if (missing.length) {
      const { error } = await supabase.from('license_assignments').insert(missing);
      ok('assign licenses', error);
    }
    console.log(`licenses: ${covered.size} already assigned, ${missing.length} newly assigned`);
  }
}

// ── 5. Finance history: Dec 2025 – Jul 2026 ────────────────────────────────
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const RECURRING = [
  { day: 3,  category: 'contracts',       description: 'Cleaning service, monthly',        amount: 260 },
  { day: 5,  category: 'electricity',     description: 'Generator diesel and maintenance', amount: 340 },
  { day: 7,  category: 'contracts',       description: 'Elevator maintenance contract',    amount: 110 },
  { day: 10, category: 'electricity',     description: 'Common electricity (EDL)',         amount: 95 },
  { day: 12, category: 'water',           description: 'Water refill, common tanks',       amount: 80 },
  { day: 28, category: 'common_expenses', description: 'Concierge salary',                 amount: 400 },
];
const ONE_OFFS = {
  '2026-02': { day: 16, category: 'projects', description: 'Water pump replacement',            amount: 1150 },
  '2026-04': { day: 20, category: 'projects', description: 'Lobby and stairwell repainting',    amount: 1800 },
  '2026-06': { day: 18, category: 'other',    description: 'Fire extinguisher refill and tags', amount: 240 },
};

const monthTotalPerUnit = {}; // month -> per-unit charge total
let billedTotal = 0;
for (const month of MONTHS) {
  const items = [...RECURRING, ...(ONE_OFFS[month] ? [ONE_OFFS[month]] : [])];
  let perUnit = 0;
  for (const item of items) {
    const date = `${month}-${String(item.day).padStart(2, '0')}`;
    const { data: exp, error: expErr } = await supabase.from('expenses').insert({
      building_id: B.id, category: item.category, description: item.description,
      amount_usd: item.amount, expense_date: date, scope_type: 'block', method: 'equal',
      created_by: me.id,
    }).select('id').single();
    if (expErr) die(`expense ${item.description} ${month}`, expErr);
    const share = Math.round((item.amount / 20) * 100) / 100;
    perUnit += share;
    const rows = units.map(u => ({
      expense_id: exp.id, unit_id: u.id, building_id: B.id, category: item.category,
      description: item.description, amount_usd: share, charge_date: date,
      billed_to: 'owner', created_by: me.id,
    }));
    const { error: chErr } = await supabase.from('charges').insert(rows);
    if (chErr) die(`charges ${item.description} ${month}`, chErr);
    billedTotal += share * 20;
  }
  monthTotalPerUnit[month] = Math.round(perUnit * 100) / 100;
  console.log(`month ${month}: ${items.length} expenses, per-unit $${perUnit.toFixed(2)}`);
}

// Payments: most units pay monthly; two rented units pay quarterly lumps;
// two vacant investor units are 2 months behind; one owner pays ahead.
const METHODS = ['bank_transfer', 'cash', 'bank_transfer', 'cash', 'cheque'];
const payRows = [];
let collectedTotal = 0;
const addPay = (unit, amount, paid_on, method, note = null) => {
  payRows.push({
    unit_id: unit.id, building_id: B.id, amount_usd: Math.round(amount * 100) / 100,
    method, paid_on, note, recorded_by: me.id,
  });
  collectedTotal += Math.round(amount * 100) / 100;
};
for (const [i, unit] of units.entries()) {
  const method = METHODS[i % METHODS.length];
  if (i === 14 || i === 15) {
    // rented units: tenant settles quarterly
    for (let q = 0; q < MONTHS.length; q += 3) {
      const chunk = MONTHS.slice(q, q + 3);
      const total = chunk.reduce((s, m) => s + monthTotalPerUnit[m], 0);
      const last = chunk[chunk.length - 1];
      addPay(unit, total, `${last}-${String(10 + i).padStart(2, '0')}`, 'bank_transfer',
        `Covers ${chunk[0]} to ${last}`);
    }
  } else if (i === 16 || i === 17) {
    // vacant investor units: behind since June
    for (const m of MONTHS.slice(0, 6)) addPay(unit, monthTotalPerUnit[m], `${m}-${String(8 + (i % 9)).padStart(2, '0')}`, method);
  } else {
    for (const [mi, m] of MONTHS.entries()) addPay(unit, monthTotalPerUnit[m], `${m}-${String(4 + ((i * 7 + mi * 3) % 14)).padStart(2, '0')}`, method);
    if (i === 18) addPay(unit, 750, '2026-07-21', 'bank_transfer', 'Advance for Aug to Oct');
  }
}
{
  const { error } = await supabase.from('payments').insert(payRows);
  if (error) die('payments insert', error);
}
console.log(`finance: billed $${billedTotal.toFixed(2)}, collected $${collectedTotal.toFixed(2)}, fund $${(collectedTotal - billedTotal).toFixed(2)}`);

// ── 6. Contracts, inspections, meetings, issues ─────────────────────────────
const contracts = [
  { service: 'elevator',  provider_name: 'LiftTec Middle East',  contact_name: 'Joseph Sassine', contact_phone: '+961 3 123 456', start_date: '2026-01-01', end_date: '2026-12-31', amount_usd: 110, billing_cycle: 'monthly',   notes: 'Includes 24/7 breakdown callout' },
  { service: 'cleaning',  provider_name: 'CleanPro Services',    contact_name: 'Abir Mansour',   contact_phone: '+961 70 234 567', start_date: '2025-11-01', end_date: '2026-10-31', amount_usd: 260, billing_cycle: 'monthly',   notes: 'Three visits per week, common areas and glass' },
  { service: 'generator', provider_name: 'PowerGen s.a.r.l.',    contact_name: 'Marwan Dib',     contact_phone: '+961 71 345 678', start_date: '2026-01-01', end_date: '2026-12-31', amount_usd: 340, billing_cycle: 'monthly',   notes: 'Diesel supply plus quarterly service' },
  { service: 'water',     provider_name: 'Aqua Delivery Co',     contact_name: 'Nabil Chidiac',  contact_phone: '+961 76 456 789', start_date: '2026-02-01', end_date: '2027-01-31', amount_usd: 240, billing_cycle: 'quarterly', notes: 'Tank refills on call, 48h notice' },
].map(c => ({ ...c, building_id: B.id, created_by: me.id }));
ok('contracts', (await supabase.from('service_contracts').insert(contracts)).error);

const inspections = [
  { category: 'elevator',    title: 'Annual elevator safety inspection',     inspector: 'Bureau Veritas Liban', inspection_date: '2026-03-10', status: 'passed', outcome: 'All safety checks passed, brake pads replaced as preventive measure.', next_due_date: '2027-03-10' },
  { category: 'generator',   title: 'Generator service and load test',       inspector: 'PowerGen s.a.r.l.',    inspection_date: '2026-06-02', status: 'passed', outcome: 'Oil and filters changed, load test at 80% for 30 minutes, no faults.', next_due_date: '2026-12-02' },
  { category: 'fire_safety', title: 'Fire extinguisher refill and tagging',  inspector: 'SafeFire Lebanon',     inspection_date: '2026-06-18', status: 'passed', outcome: '12 extinguishers refilled and tagged, 2 replaced.', next_due_date: '2027-06-18' },
  { category: 'water_tank',  title: 'Roof tank cleaning and chlorination',   inspector: 'Aqua Delivery Co',     inspection_date: '2026-04-22', status: 'passed', outcome: 'Both tanks drained, cleaned and chlorinated. Water sample sent for testing, results clear.', next_due_date: '2026-10-22' },
].map(x => ({ ...x, building_id: B.id, created_by: me.id }));
ok('inspections', (await supabase.from('inspections').insert(inspections)).error);

const meetings = [
  { title: 'Annual general assembly 2026', meeting_date: '2026-02-14', meeting_time: '19:00', meeting_type: 'past',
    summary: 'Budget for 2026 approved unanimously. Voted to replace the water pump (approved, 14 for, 2 abstained). Cleaning contract renewed with CleanPro. Committee re-elected: Georges Khoury (president), Sarah Haddad (treasurer), Karim Nassar (secretary).',
    attendees: ['Georges Khoury', 'Sarah Haddad', 'Ali Hamdan', 'Maya Sleiman', 'Karim Nassar', 'Rita Aoun', 'Hassan Fakhoury', 'Nour Chami', 'Lara Gerges', 'Omar Itani', 'Joelle Saab', 'Zeina Karam'] },
  { title: 'Committee meeting: repainting and pump follow-up', meeting_date: '2026-05-20', meeting_time: '18:30', meeting_type: 'past',
    summary: 'Reviewed repainting quotes and awarded the lobby and stairwell work. Pump replacement closed out, warranty filed. Agreed to collect vacant-unit arrears before September.',
    attendees: ['Georges Khoury', 'Sarah Haddad', 'Karim Nassar', 'Rita Aoun', 'Elie Rahme'] },
  { title: 'Committee meeting: generator contract renewal', meeting_date: '2026-08-14', meeting_time: '19:00', meeting_type: 'scheduled',
    summary: 'Agenda: compare PowerGen renewal against two new quotes, review summer diesel spend, plan the October tank cleaning.',
    attendees: ['Georges Khoury', 'Sarah Haddad', 'Karim Nassar'] },
].map(x => ({ ...x, building_id: B.id, created_by: me.id }));
ok('meetings', (await supabase.from('meetings').insert(meetings)).error);

const issues = [
  { title: 'Water leak in parking ceiling', description: 'Dripping from the ceiling near spot 7 after the pump ran. Getting worse.', location: 'Parking level -1', priority: 'urgent', status: 'resolved', resolution_notes: 'Joint on the new pump line resealed by the plumber. Monitored for a week, dry.', resolved_at: '2026-02-25T10:00:00Z', created_at_hint: '2026-02-19' },
  { title: 'Lobby lights flickering', description: 'The two spots above the mailboxes flicker in the evening.', location: 'Lobby', priority: 'low', status: 'resolved', resolution_notes: 'Ballast replaced, both spots swapped to LED.', resolved_at: '2026-03-30T14:00:00Z', created_at_hint: '2026-03-22' },
  { title: 'Intercom not ringing in unit 302', description: 'Visitors press 302 and nothing rings upstairs. Handset seems dead.', location: 'Unit 302', priority: 'medium', status: 'in_progress', resolution_notes: null, resolved_at: null, created_at_hint: '2026-07-18' },
  { title: 'Elevator door slow to close', description: 'Door takes 10+ seconds to close on the ground floor, fine on other floors.', location: 'Elevator, ground floor', priority: 'medium', status: 'open', resolution_notes: null, resolved_at: null, created_at_hint: '2026-07-27' },
];
for (const it of issues) {
  const { created_at_hint, ...row } = it;
  const { error } = await supabase.from('issues').insert({ ...row, building_id: B.id, reported_by: me.id });
  ok(`issue ${row.title}`, error);
}
console.log('contracts, inspections, meetings, issues inserted');

// ── 7. People: invite dummy users (emails go to +aliases of the real inbox) ──
const [inboxUser, inboxDomain] = aliasInbox.split('@');
const OWNERS = ['Georges Khoury', 'Sarah Haddad', 'Ali Hamdan', 'Maya Sleiman', 'Karim Nassar', 'Rita Aoun', 'Hassan Fakhoury', 'Nour Chami', 'Elie Rahme', 'Lara Gerges', 'Omar Itani', 'Joelle Saab', 'Tony Abou Jaoude', 'Zeina Karam'];
const TENANTS = ['Rami Douaihy', 'Cynthia Matar'];
const people = {}; // name -> user_id
for (const [i, name] of [...OWNERS, ...TENANTS].entries()) {
  const addr = `${inboxUser}+demo${String(i + 1).padStart(2, '0')}@${inboxDomain}`;
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: { email: addr, full_name: name, building_id: B.id, mode: 'import' },
  });
  if (error || !data?.user_id) { console.warn(`  warn invite ${name} (${addr}):`, error?.message ?? JSON.stringify(data)); continue; }
  people[name] = data.user_id;
  console.log(`invited ${name} -> ${addr}${data.existing ? ' (existing)' : ''}`);
}

// ── 8. Memberships (LAST — from here on, notifications have recipients) ─────
// units 0-13: each owner lives in their unit. 14/15: second units of Georges
// and Karim, rented out. 16/17: vacant second units of Sarah and Ali.
// 18/19: second units of Maya (pays ahead) and Rita.
const memberships = [];
OWNERS.forEach((name, i) => memberships.push({ name, unit: units[i], tenure: 'owner' }));
memberships.push({ name: 'Georges Khoury', unit: units[14], tenure: 'owner' });
memberships.push({ name: 'Karim Nassar',   unit: units[15], tenure: 'owner' });
memberships.push({ name: 'Rami Douaihy',   unit: units[14], tenure: 'tenant' });
memberships.push({ name: 'Cynthia Matar',  unit: units[15], tenure: 'tenant' });
memberships.push({ name: 'Sarah Haddad',   unit: units[16], tenure: 'owner' });
memberships.push({ name: 'Ali Hamdan',     unit: units[17], tenure: 'owner' });
memberships.push({ name: 'Maya Sleiman',   unit: units[18], tenure: 'owner' });
memberships.push({ name: 'Rita Aoun',      unit: units[19], tenure: 'owner' });
let memCount = 0;
for (const m of memberships) {
  const user_id = people[m.name];
  if (!user_id) continue;
  const { error } = await supabase.from('memberships').insert({ user_id, unit_id: m.unit.id, tenure: m.tenure });
  if (error) console.warn(`  warn membership ${m.name} -> ${m.unit.label}:`, error.message);
  else memCount++;
}
console.log(`memberships created: ${memCount}`);

// A couple of pending invites so the Invitations tab has life in it
for (const [name, unit, tenure, n] of [['Nadim Barakat', units[16], 'tenant', 17], ['Carla Sfeir', units[17], 'tenant', 18]]) {
  const addr = `${inboxUser}+demo${n}@${inboxDomain}`;
  const { data } = await supabase.functions.invoke('invite-user', {
    body: { email: addr, full_name: name, building_id: B.id, mode: 'import' },
  });
  if (data?.user_id) {
    const { error } = await supabase.from('membership_invites').insert({
      unit_id: unit.id, user_id: data.user_id, tenure, invited_by: me.id,
    });
    if (error) console.warn(`  warn pending invite ${name}:`, error.message);
    else console.log(`pending invite: ${name} -> unit ${unit.label} (${tenure})`);
  }
}

// ── 9. Tidy: mark the admin's own notification backlog read ─────────────────
await supabase.from('notifications').update({ is_read: true }).eq('user_id', me.id).eq('is_read', false);

console.log('\nDONE.');
console.log(`Building "${B.name}": 20 units, ${Object.keys(people).length} people.`);
console.log(`Billed $${billedTotal.toFixed(2)} | collected $${collectedTotal.toFixed(2)} | fund $${(collectedTotal - billedTotal).toFixed(2)}`);
