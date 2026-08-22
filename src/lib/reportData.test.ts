import { describe, it, expect } from 'vitest';
import {
  buildLedger, filterLedger, ledgerTotals, emptyLedgerFilters,
  buildBook, buildUnitBuckets, tenancyHelpers, tenantTitle,
  type LedgerRow, type TenancyRow,
} from '@/lib/reportData';
import type { Unit, Charge, Payment, Adjustment, Expense } from '@/types';

/**
 * These functions decide what a resident is told they owe. A silent arithmetic
 * change here surfaces as a wrong number on someone's statement, which nobody
 * reports as a bug because it looks like a number.
 *
 * So the tests assert BEHAVIOUR that has to stay true, not the shape of the
 * implementation: a voided payment is not money, a tenant never sees the
 * owner's ledger, an as-of date excludes what came after it. Each one is a
 * rule from docs/REPORTING_GUIDANCE.md or a bug that has already happened once.
 */

// ── fixtures ─────────────────────────────────────────────────────────────────
// Minimal but real: every field the builders actually read, nothing else.

const unit = (id: string, over: Partial<Unit> = {}): Unit => ({
  id,
  building_id: 'b1',
  label: id.toUpperCase(),
  share_weight: 1,
  occupancy: 'occupied',
  opening_balance: 0,
  opening_balance_date: null,
  created_at: '2026-01-01',
  ...over,
} as Unit);

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'c' + Math.random().toString(36).slice(2, 8),
  expense_id: null,
  unit_id: 'u1',
  building_id: 'b1',
  category: 'water',
  description: 'Water',
  amount_usd: 100,
  charge_date: '2026-03-01',
  billed_to: 'owner',
  created_by: null,
  created_at: '2026-03-01',
  ...over,
} as Charge);

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'p' + Math.random().toString(36).slice(2, 8),
  unit_id: 'u1',
  building_id: 'b1',
  amount_usd: 100,
  method: 'cash',
  paid_on: '2026-03-05',
  note: null,
  receipt_url: null,
  recorded_by: null,
  paid_by: 'owner',
  ...over,
} as Payment);

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e' + Math.random().toString(36).slice(2, 8),
  building_id: 'b1',
  compound_id: null,
  category: 'water',
  description: 'Water tank refill',
  amount_usd: 300,
  expense_date: '2026-03-02',
  scope_type: 'building',
  method: 'equal',
  invoice_url: null,
  created_by: null,
  created_at: '2026-03-02',
  ...over,
} as Expense);

const adjustment = (over: Partial<Adjustment> = {}): Adjustment => ({
  id: 'a' + Math.random().toString(36).slice(2, 8),
  unit_id: 'u1',
  building_id: 'b1',
  kind: 'credit',
  amount_usd: 50,
  party: 'owner',
  effective_date: '2026-03-03',
  note: null,
  created_by: null,
  created_at: '2026-03-03',
  ...over,
} as Adjustment);

const ledgerOpts = {
  typeName: (e: Expense) => (e.expense_type_id === 't-garden' ? 'Gardening' : 'Water'),
  unitLabel: (id: string) => id.toUpperCase(),
  payerLabel: (p: Payment) => (p.paid_by === 'tenant' ? 'Tenant' : 'Owner'),
  paymentWord: 'Payment',
};

const filters = (over: Partial<typeof emptyLedgerFilters> = {}) => ({ ...emptyLedgerFilters, ...over });

// ── buildLedger ──────────────────────────────────────────────────────────────

describe('buildLedger', () => {
  it('drops voided payments, because a voided payment is not money that moved', () => {
    const rows = buildLedger([], [
      payment({ id: 'live', amount_usd: 100 }),
      payment({ id: 'dead', amount_usd: 999, voided_at: '2026-03-06' }),
    ], ledgerOpts);
    expect(rows.map((r) => r.id)).toEqual(['live']);
  });

  it('sorts newest first across both kinds', () => {
    const rows = buildLedger(
      [expense({ id: 'old', expense_date: '2026-01-10' })],
      [payment({ id: 'new', paid_on: '2026-05-10' })],
      ledgerOpts,
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('names an expense from the catalog, never the legacy enum', () => {
    // REPORTING_GUIDANCE rule 5: a custom type must never print as "Other".
    const [row] = buildLedger([expense({ expense_type_id: 't-garden', category: 'other' })], [], ledgerOpts);
    expect(row.category).toBe('Gardening');
  });

  it('puts a tenant payment on the tenant sub-ledger and an owner payment on the owner one', () => {
    const rows = buildLedger([], [
      payment({ id: 'o', paid_by: 'owner' }),
      payment({ id: 't', paid_by: 'tenant' }),
    ], ledgerOpts);
    expect(rows.find((r) => r.id === 'o')!.party).toBe('owner');
    expect(rows.find((r) => r.id === 't')!.party).toBe('tenant');
  });

  it('leaves a building-wide expense unattached to any party or unit', () => {
    const [row] = buildLedger([expense()], [], ledgerOpts);
    expect(row.party).toBe('');
    expect(row.unit).toBe('');
  });

  it('reads the currency off the row rather than assuming dollars', () => {
    const rows = buildLedger([], [
      payment({ id: 'usd', amount_usd: 100 }),
      payment({ id: 'lbp', amount_usd: 100, amount_lbp: 8_950_000, lbp_rate: 89_500 }),
    ], ledgerOpts);
    expect(rows.find((r) => r.id === 'usd')!.currency).toBe('USD');
    expect(rows.find((r) => r.id === 'lbp')!.currency).not.toBe('USD');
  });
});

// ── filterLedger ─────────────────────────────────────────────────────────────

describe('filterLedger', () => {
  const rows: LedgerRow[] = buildLedger(
    [expense({ id: 'e1', expense_date: '2026-02-01', description: 'Water tank refill' })],
    [
      payment({ id: 'p1', paid_on: '2026-03-01', unit_id: 'u1', paid_by: 'owner', note: 'March water' }),
      payment({ id: 'p2', paid_on: '2026-04-01', unit_id: 'u2', paid_by: 'tenant', note: null }),
    ],
    ledgerOpts,
  );

  it('filters by kind', () => {
    expect(filterLedger(rows, filters({ kind: 'expense' })).map((r) => r.id)).toEqual(['e1']);
    expect(filterLedger(rows, filters({ kind: 'payment' })).map((r) => r.id).sort()).toEqual(['p1', 'p2']);
  });

  it('treats the date range as inclusive at both ends', () => {
    // An exclusive bound silently drops the first and last day of a month,
    // which is exactly where rent and dues land.
    const only = filterLedger(rows, filters({ from: '2026-03-01', to: '2026-03-01' }));
    expect(only.map((r) => r.id)).toEqual(['p1']);
  });

  it('filters by unit and by party independently', () => {
    expect(filterLedger(rows, filters({ unit: 'U2' })).map((r) => r.id)).toEqual(['p2']);
    expect(filterLedger(rows, filters({ party: 'tenant' })).map((r) => r.id)).toEqual(['p2']);
  });

  it('searches across category, description and unit at once', () => {
    // One box, not three: "water" must find the Water expense AND the payment
    // whose note mentions water.
    expect(filterLedger(rows, filters({ search: 'water' })).map((r) => r.id).sort()).toEqual(['e1', 'p1']);
  });

  it('ignores case and accents when searching', () => {
    const accented = buildLedger([expense({ id: 'acc', description: 'Réparation ascenseur' })], [], ledgerOpts);
    expect(filterLedger(accented, filters({ search: 'reparation' })).map((r) => r.id)).toEqual(['acc']);
    expect(filterLedger(accented, filters({ search: 'RÉPARATION' })).map((r) => r.id)).toEqual(['acc']);
  });

  it('combines filters rather than letting the last one win', () => {
    const out = filterLedger(rows, filters({ kind: 'payment', party: 'owner' }));
    expect(out.map((r) => r.id)).toEqual(['p1']);
  });

  it('returns everything when nothing is set', () => {
    expect(filterLedger(rows, filters())).toHaveLength(3);
  });
});

// ── ledgerTotals ─────────────────────────────────────────────────────────────

describe('ledgerTotals', () => {
  it('nets payments against expenses', () => {
    const rows = buildLedger(
      [expense({ amount_usd: 300 })],
      [payment({ amount_usd: 500 })],
      ledgerOpts,
    );
    expect(ledgerTotals(rows)).toMatchObject({ expenses: 300, payments: 500, net: 200, count: 2 });
  });

  it('goes negative when more went out than came in', () => {
    const rows = buildLedger([expense({ amount_usd: 900 })], [payment({ amount_usd: 100 })], ledgerOpts);
    expect(ledgerTotals(rows).net).toBe(-800);
  });

  it('rounds to cents instead of leaking float dust into a statement', () => {
    // 0.1 + 0.2 is the classic. A resident seeing $0.30000000000000004 has
    // every reason to distrust the rest of the page.
    const rows = buildLedger([], [payment({ amount_usd: 0.1 }), payment({ amount_usd: 0.2 })], ledgerOpts);
    expect(ledgerTotals(rows).payments).toBe(0.3);
  });

  it('rounds the expense side and the net too, not just payments', () => {
    // Every field on its own: rounding one and leaving another is exactly the
    // kind of half-fix that survives a passing suite.
    const rows = buildLedger(
      [expense({ amount_usd: 0.1 }), expense({ amount_usd: 0.2 })],
      [payment({ amount_usd: 0.7 })],
      ledgerOpts,
    );
    const t = ledgerTotals(rows);
    expect(t.expenses).toBe(0.3);
    expect(t.net).toBe(0.4);
  });

  it('totals the rows it is given, so a filtered view totals the filtered set', () => {
    const rows = buildLedger(
      [expense({ amount_usd: 300 })],
      [payment({ id: 'keep', amount_usd: 500 }), payment({ id: 'drop', amount_usd: 1000, unit_id: 'u9' })],
      ledgerOpts,
    );
    const shown = filterLedger(rows, filters({ unit: 'U1' }));
    expect(ledgerTotals(shown)).toMatchObject({ payments: 500, count: 1 });
  });

  it('is all zeros on an empty set rather than NaN', () => {
    expect(ledgerTotals([])).toEqual({ expenses: 0, payments: 0, net: 0, count: 0 });
  });
});

// ── buildBook ────────────────────────────────────────────────────────────────

const tenancy = (over: Partial<TenancyRow> = {}): TenancyRow => ({
  unit_id: 'u1',
  user_id: 'nadia',
  tenure: 'tenant',
  created_at: '2026-01-01',
  ended_at: null,
  profiles: { full_name: 'Nadia Salameh' },
  ...over,
});

describe('buildBook', () => {
  const u1 = unit('u1');

  it('keeps owner and tenant money on separate sides', () => {
    // REPORTING_GUIDANCE rule 3. Netting these is the bug the sub-ledger exists
    // to prevent: an owner in credit must never mask a tenant in arrears.
    const th = tenancyHelpers([tenancy()], [], [], []);
    const [row] = buildBook(
      [u1],
      [charge({ amount_usd: 100, billed_to: 'owner' }), charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })],
      [payment({ amount_usd: 60, paid_by: 'owner' }), payment({ amount_usd: 10, paid_by: 'tenant', tenant_id: 'nadia' })],
      [], null, th,
    );
    expect(row.ownerCharged).toBe(100);
    expect(row.ownerPaid).toBe(60);
    expect(row.tenantCharged).toBe(40);
    expect(row.tenantPaid).toBe(10);
    expect(row.charged).toBe(140);
    expect(row.paid).toBe(70);
  });

  it('excludes voided charges and payments from every total', () => {
    const th = tenancyHelpers([], [], [], []);
    const [row] = buildBook(
      [u1],
      [charge({ amount_usd: 100 }), charge({ amount_usd: 999, voided_at: '2026-03-02' })],
      [payment({ amount_usd: 50 }), payment({ amount_usd: 999, voided_at: '2026-03-06' })],
      [], null, th,
    );
    expect(row.charged).toBe(100);
    expect(row.paid).toBe(50);
  });

  it('honours the as-of date, counting nothing dated after it', () => {
    // The as-of figure is what a payment request is quoted against, so a row
    // leaking in from after the cutoff asks someone for money they do not owe.
    const th = tenancyHelpers([], [], [], []);
    const [row] = buildBook(
      [u1],
      [charge({ amount_usd: 100, charge_date: '2026-03-01' }), charge({ amount_usd: 500, charge_date: '2026-04-01' })],
      [payment({ amount_usd: 30, paid_on: '2026-03-05' }), payment({ amount_usd: 700, paid_on: '2026-04-05' })],
      [], '2026-03-31', th,
    );
    expect(row.charged).toBe(100);
    expect(row.paid).toBe(30);
  });

  it('counts a row dated exactly ON the as-of date', () => {
    // The boundary itself, not just either side of it. An exclusive bound here
    // drops the last day of the period, which is where dues and rent land.
    const th = tenancyHelpers([], [], [], []);
    const [row] = buildBook(
      [u1],
      [charge({ amount_usd: 100, charge_date: '2026-03-31' })],
      [payment({ amount_usd: 30, paid_on: '2026-03-31' })],
      [], '2026-03-31', th,
    );
    expect(row.charged).toBe(100);
    expect(row.paid).toBe(30);
  });

  it('separates the current tenant from a former one', () => {
    // A departed tenant's arrears must not appear as the new tenant's.
    const th = tenancyHelpers([
      tenancy({ user_id: 'nadia' }),
      tenancy({ user_id: 'rami', ended_at: '2026-02-01', profiles: { full_name: 'Rami Aoun' } }),
    ], [], [], []);
    const [row] = buildBook(
      [u1], [
        charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' }),
        charge({ amount_usd: 25, billed_to: 'tenant', tenant_id: 'rami' }),
      ], [], [], null, th,
    );
    expect(row.curTenantCharged).toBe(40);
    expect(row.fmrTenantCharged).toBe(25);
    expect(row.showFormer).toBe(true);
    expect(row.fmrTenantNames).toEqual(['Rami Aoun']);
  });

  it('applies an adjustment by its kind, not by its raw sign', () => {
    // amount_usd is always a positive magnitude; the direction lives in ,
    // so a penalty and a credit note of the same size must cancel out.
    const th = tenancyHelpers([], [], [], []);
    const [note] = buildBook([u1], [], [], [adjustment({ kind: 'credit_note', amount_usd: 50 })], null, th);
    const [penalty] = buildBook([u1], [], [], [adjustment({ kind: 'penalty', amount_usd: 50 })], null, th);
    expect(note.adj).toBe(50);
    expect(penalty.adj).toBe(-50);
  });

  it('does not split a unit that has never had a tenant', () => {
    const th = tenancyHelpers([], [], [], []);
    const [row] = buildBook([u1], [charge({ amount_usd: 100 })], [], [], null, th);
    expect(row.split).toBe(false);
  });
});

// ── buildUnitBuckets ─────────────────────────────────────────────────────────

describe('buildUnitBuckets', () => {
  const labels = { owner: 'Owner', tenant: 'Current tenant', formerTenant: 'Former tenant' };

  it('never puts owner money in a tenant bucket', () => {
    const th = tenancyHelpers([tenancy()], [], [], []);
    const { buckets } = buildUnitBuckets(
      unit('u1'),
      [charge({ amount_usd: 100, billed_to: 'owner' }), charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })],
      [payment({ amount_usd: 10, paid_by: 'tenant', tenant_id: 'nadia' })],
      [], th, labels,
    );
    const tenantBucket = buckets.find((b) => b.key === 'tenant:nadia')!;
    expect(tenantBucket.charges.map((c) => c.amount_usd)).toEqual([40]);
    expect(tenantBucket.balance).toBe(10 - 40);
  });

  it('qualifies a tenant as current or former, never bare', () => {
    const th = tenancyHelpers([
      tenancy({ user_id: 'nadia' }),
      tenancy({ user_id: 'rami', ended_at: '2026-02-01', profiles: { full_name: 'Rami Aoun' } }),
    ], [], [], []);
    const { buckets } = buildUnitBuckets(
      unit('u1'),
      [charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' }),
       charge({ amount_usd: 25, billed_to: 'tenant', tenant_id: 'rami' })],
      [], [], th, labels,
    );
    const titles = buckets.filter((b) => b.key.startsWith('tenant:')).map((b) => b.title);
    expect(titles).toContain('Current tenant: Nadia Salameh');
    expect(titles).toContain('Former tenant: Rami Aoun');
  });

  it('lists the current tenant before any former one', () => {
    const th = tenancyHelpers([
      tenancy({ user_id: 'nadia' }),
      tenancy({ user_id: 'rami', ended_at: '2026-02-01', profiles: { full_name: 'Rami Aoun' } }),
    ], [], [], []);
    const { buckets } = buildUnitBuckets(
      unit('u1'),
      [charge({ amount_usd: 25, billed_to: 'tenant', tenant_id: 'rami' }),
       charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })],
      [], [], th, labels,
    );
    const keys = buckets.filter((b) => b.key.startsWith('tenant:')).map((b) => b.key);
    expect(keys[0]).toBe('tenant:nadia');
  });

  it('omits an owner bucket that has nothing in it', () => {
    const th = tenancyHelpers([tenancy()], [], [], []);
    const { buckets } = buildUnitBuckets(
      unit('u1'),
      [charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })],
      [], [], th, labels,
    );
    expect(buckets.some((b) => b.key === 'owner')).toBe(false);
  });

  it('restricts to the requested buckets when asked', () => {
    // This is what makes a tenant's own PDF contain only their sub-ledger.
    const th = tenancyHelpers([tenancy()], [], [], []);
    const { buckets } = buildUnitBuckets(
      unit('u1', { opening_balance: 500 }),
      [charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })],
      [], [], th, labels, new Set(['nadia']),
    );
    expect(buckets.map((b) => b.key)).toEqual(['tenant:nadia']);
  });

  it('takes a BARE tenant id in , but the literal key for the owner', () => {
    // Asymmetric on purpose and easy to get wrong: the owner is selected by its
    // own key, a tenant by their raw id rather than the 'tenant:' key the
    // bucket comes back with. Finance.tsx builds the set that way; pinning it
    // here so a tidy-up cannot silently empty somebody's statement.
    const th = tenancyHelpers([tenancy()], [], [], []);
    const u = unit('u1', { opening_balance: 500 });
    const cs = [charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })];
    const byOwnerKey = buildUnitBuckets(u, cs, [], [], th, labels, new Set(['owner']));
    const byTenantKey = buildUnitBuckets(u, cs, [], [], th, labels, new Set(['tenant:nadia']));
    const byBareId = buildUnitBuckets(u, cs, [], [], th, labels, new Set(['nadia']));
    expect(byOwnerKey.buckets.map((x) => x.key)).toEqual(['owner']);
    expect(byBareId.buckets.map((x) => x.key)).toEqual(['tenant:nadia']);
    expect(byTenantKey.buckets).toHaveLength(0);
  });

  it('sums the buckets into the combined figure', () => {
    const th = tenancyHelpers([tenancy()], [], [], []);
    const { buckets, combined } = buildUnitBuckets(
      unit('u1'),
      [charge({ amount_usd: 100, billed_to: 'owner' }), charge({ amount_usd: 40, billed_to: 'tenant', tenant_id: 'nadia' })],
      [payment({ amount_usd: 60, paid_by: 'owner' })],
      [], th, labels,
    );
    expect(combined).toBeCloseTo(buckets.reduce((s, b) => s + b.balance, 0), 2);
  });
});

// ── tenantTitle ──────────────────────────────────────────────────────────────

describe('tenantTitle', () => {
  it('appends the name when there is one', () => {
    expect(tenantTitle('Current tenant', 'Nadia Salameh')).toBe('Current tenant: Nadia Salameh');
  });

  it('falls back to the bare label rather than printing a dangling colon', () => {
    expect(tenantTitle('Current tenant', null)).toBe('Current tenant');
    expect(tenantTitle('Current tenant')).toBe('Current tenant');
  });
});
