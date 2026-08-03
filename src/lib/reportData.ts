// ============================================================
// Shared finance-report computation (extracted VERBATIM from Finance.tsx for
// the Reports tab — #62). Pure functions: same inputs → same numbers, so the
// Finance book and every downloaded report agree by construction.
// If the ledger model evolves (owner/tenant buckets, offloads), change it HERE
// and both pages follow.
// ============================================================
import type { Unit, Charge, Payment, Adjustment, Dues, DuesMethod, DuesPlan, Tenure } from '@/types';
import { computeUnitBalances, adjustmentEffect } from '@/lib/balance';
import type { StatementBucket } from '@/lib/pdf';

export type TenancyRow = {
  unit_id: string; user_id: string; tenure: string; created_at: string;
  ended_at: string | null; profiles: { full_name: string } | null;
};

/** Localized labels the builders need (callers pass t() results).
 *  `tenant` is the CURRENT tenant's label ("Current tenant"); a tenant is always
 *  qualified as current or former so the two never read the same. */
export interface ReportLabels { owner: string; tenant: string; formerTenant: string; }

/** "Current tenant: Nadia" / "Former tenant: Rami" — one format everywhere
 *  (toggles, book sub-rows, statement buckets, PDFs) so a name never appears
 *  bare or with a different separator depending on the screen. */
export const tenantTitle = (label: string, name?: string | null) =>
  name ? `${label}: ${name}` : label;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tenant lookups derived from the memberships history (incl. ended rows). */
export function tenancyHelpers(
  tenancy: TenancyRow[], charges: Charge[], payments: Payment[], adjustments: Adjustment[],
) {
  const activeTenantIds = new Set(
    tenancy.filter((m) => m.tenure === 'tenant' && !m.ended_at).map((m) => m.unit_id));
  const everTenantIds = (() => {
    const s = new Set(tenancy.filter((m) => m.tenure === 'tenant').map((m) => m.unit_id));
    charges.forEach((c) => { if (c.billed_to === 'tenant') s.add(c.unit_id); });
    payments.forEach((p) => { if (p.paid_by === 'tenant') s.add(p.unit_id); });
    adjustments.forEach((a) => { if (a.party === 'tenant') s.add(a.unit_id); });
    return s;
  })();
  const nameById = (id: string | null | undefined): string | null =>
    id ? (tenancy.find((m) => m.user_id === id)?.profiles?.full_name ?? null) : null;
  const activeTenantId = (unitId: string): string | null =>
    tenancy.find((m) => m.unit_id === unitId && m.tenure === 'tenant' && !m.ended_at)?.user_id ?? null;
  return { activeTenantIds, everTenantIds, nameById, activeTenantId };
}
export type TenancyHelpers = ReturnType<typeof tenancyHelpers>;

export interface BookRow {
  unit: Unit; charged: number; paid: number; adj: number; balance: number;
  owner: number; tenant: number; split: boolean;
  ownerCharged: number; ownerPaid: number; ownerAdj: number;
  tenantCharged: number; tenantPaid: number; tenantAdj: number;
  hasActiveTenant: boolean; activeTenantName: string | null;
  curTenantCharged: number; curTenantPaid: number; curTenantAdj: number; curTenant: number;
  fmrTenantCharged: number; fmrTenantPaid: number; fmrTenantAdj: number; fmrTenant: number;
  showFormer: boolean; fmrTenantNames: string[];
}

/** Per-unit book rows (verbatim from Finance.tsx `book` memo). Pass the
 *  ALREADY block-filtered units/charges/payments; adjustments unfiltered
 *  by block (matches Finance). asOf: only count transactions up to it. */
export function buildBook(
  vUnits: Unit[], vCharges: Charge[], vPayments: Payment[], adjustments: Adjustment[],
  asOf: string | null, th: TenancyHelpers,
): BookRow[] {
  return vUnits.map((u) => {
    const uCharges = vCharges.filter((c) => c.unit_id === u.id);
    const uPayments = vPayments.filter((p) => p.unit_id === u.id);
    const uAdj = adjustments.filter((a) => a.unit_id === u.id);
    const within = (d: string) => !asOf || new Date(d) <= new Date(asOf);
    const liveC = uCharges.filter((c) => !c.voided_at && within(c.charge_date));
    const liveP = uPayments.filter((p) => !p.voided_at && within(p.paid_on));
    const sum = <X extends { amount_usd: number }>(rows: X[]) => rows.reduce((s, r) => s + Number(r.amount_usd), 0);
    const ownerCharged = sum(liveC.filter((c) => c.billed_to !== 'tenant'));
    const tenantCharged = sum(liveC.filter((c) => c.billed_to === 'tenant'));
    const ownerPaid = sum(liveP.filter((p) => p.paid_by !== 'tenant'));
    const tenantPaid = sum(liveP.filter((p) => p.paid_by === 'tenant'));
    const charged = ownerCharged + tenantCharged;
    const paid = ownerPaid + tenantPaid;
    const liveA = uAdj.filter((a) => !a.voided_at && within(a.effective_date));
    const adjSum = <X extends { kind: Adjustment['kind']; amount_usd: number }>(rows: X[]) =>
      rows.reduce((s, a) => s + adjustmentEffect(a.kind, Number(a.amount_usd)), 0);
    const ownerAdj = adjSum(liveA.filter((a) => a.party !== 'tenant'));
    const tenantAdj = adjSum(liveA.filter((a) => a.party === 'tenant'));
    const adj = ownerAdj + tenantAdj;
    const activeTid = th.activeTenantId(u.id);
    const isCur = (tid: string | null | undefined) => !!activeTid && tid === activeTid;
    const curTenantCharged = sum(liveC.filter((c) => c.billed_to === 'tenant' && isCur(c.tenant_id)));
    const curTenantPaid = sum(liveP.filter((p) => p.paid_by === 'tenant' && isCur(p.tenant_id)));
    const curTenantAdj = adjSum(liveA.filter((a) => a.party === 'tenant' && isCur(a.tenant_id)));
    const curTenant = curTenantPaid - curTenantCharged + curTenantAdj;
    const fmrTenantCharged = sum(liveC.filter((c) => c.billed_to === 'tenant' && !isCur(c.tenant_id)));
    const fmrTenantPaid = sum(liveP.filter((p) => p.paid_by === 'tenant' && !isCur(p.tenant_id)));
    const fmrTenantAdj = adjSum(liveA.filter((a) => a.party === 'tenant' && !isCur(a.tenant_id)));
    const fmrTenant = fmrTenantPaid - fmrTenantCharged + fmrTenantAdj;
    const fmrTenantNames = Array.from(new Set(
      [...liveC.filter((c) => c.billed_to === 'tenant' && !isCur(c.tenant_id)).map((c) => c.tenant_id),
       ...liveP.filter((p) => p.paid_by === 'tenant' && !isCur(p.tenant_id)).map((p) => p.tenant_id),
       ...liveA.filter((a) => a.party === 'tenant' && !isCur(a.tenant_id)).map((a) => a.tenant_id)]
        .map((id) => th.nameById(id)).filter((n): n is string => !!n)));
    const showFormer = fmrTenantCharged !== 0 || fmrTenantPaid !== 0 || fmrTenantAdj !== 0 || fmrTenant !== 0;
    const bal = computeUnitBalances(u, uCharges, uPayments, uAdj, asOf || null);
    const split = th.activeTenantIds.has(u.id) || (th.everTenantIds.has(u.id) && bal.tenant !== 0) || showFormer;
    return { unit: u, charged, paid, adj, balance: bal.total, owner: bal.owner, tenant: bal.tenant, split, ownerCharged, ownerPaid, ownerAdj, tenantCharged, tenantPaid, tenantAdj,
      hasActiveTenant: th.activeTenantIds.has(u.id), activeTenantName: th.nameById(activeTid),
      curTenantCharged, curTenantPaid, curTenantAdj, curTenant,
      fmrTenantCharged, fmrTenantPaid, fmrTenantAdj, fmrTenant, showFormer, fmrTenantNames };
  });
}

/** Owner / current-tenant / former-tenant buckets for a unit's PDF statement
 *  (verbatim from Finance.tsx). `only` restricts to a subset of bucket keys. */
export function buildUnitBuckets(
  u: Unit, cAll: Charge[], pAll: Payment[], aAll: Adjustment[],
  th: TenancyHelpers, labels: ReportLabels, only?: Set<string>,
  /** Dues for this unit, split onto the party buckets they fall on (0070).
   *  Obligations only — never folded into a bucket's balance. */
  duesAll: Dues[] = [],
): { buckets: StatementBucket[]; combined: number } {
  const bal = computeUnitBalances(u, cAll, pAll, aAll);
  const sumAmt = (rows: { amount_usd: number }[]) => rows.reduce((s, r) => s + Number(r.amount_usd), 0);
  const adjEff = (rows: Adjustment[]) => rows.reduce((s, a) => s + adjustmentEffect(a.kind, Number(a.amount_usd)), 0);
  const round2n = (n: number) => Math.round(n * 100) / 100;
  const wants = (k: string) => !only || only.has(k);
  const buckets: StatementBucket[] = [];
  if (wants('owner')) {
    const oc = cAll.filter((c) => c.billed_to !== 'tenant');
    const op = pAll.filter((p) => p.paid_by !== 'tenant');
    const oa = aAll.filter((a) => a.party !== 'tenant');
    const opening = Number(u.opening_balance) || 0;
    const od = duesAll.filter((d) => d.billed_to !== 'tenant');
    if (oc.length || op.length || oa.length || od.length || opening !== 0 || bal.owner !== 0)
      buckets.push({ key: 'owner', title: labels.owner, balance: bal.owner, openingBalance: opening, charges: oc, payments: op, adjustments: oa, dues: od });
  }
  const activeTid = th.activeTenantId(u.id);
  const tids = Array.from(new Set([
    ...cAll.filter((c) => c.billed_to === 'tenant').map((c) => c.tenant_id ?? '∅'),
    ...pAll.filter((p) => p.paid_by === 'tenant').map((p) => p.tenant_id ?? '∅'),
    ...aAll.filter((a) => a.party === 'tenant').map((a) => a.tenant_id ?? '∅'),
    ...duesAll.filter((d) => d.billed_to === 'tenant').map((d) => d.tenant_id ?? '∅'),
  ])).sort((a, b) => (a === activeTid ? -1 : b === activeTid ? 1 : 0));
  for (const tid of tids) {
    if (!wants(tid)) continue;
    const c = cAll.filter((x) => x.billed_to === 'tenant' && (x.tenant_id ?? '∅') === tid);
    const p = pAll.filter((x) => x.paid_by === 'tenant' && (x.tenant_id ?? '∅') === tid);
    const a = aAll.filter((x) => x.party === 'tenant' && (x.tenant_id ?? '∅') === tid);
    const d = duesAll.filter((x) => x.billed_to === 'tenant' && (x.tenant_id ?? '∅') === tid);
    if (!c.length && !p.length && !a.length && !d.length) continue;
    const isActive = tid !== '∅' && tid === activeTid;
    const name = tid === '∅' ? null : th.nameById(tid);
    buckets.push({ key: `tenant:${tid}`, title: tenantTitle(isActive ? labels.tenant : labels.formerTenant, name),
      balance: round2n(sumAmt(p) - sumAmt(c) + adjEff(a)), charges: c, payments: p, adjustments: a, dues: d });
  }
  return { buckets, combined: round2n(buckets.reduce((s, b) => s + b.balance, 0)) };
}

// ============================================================
// DUES — party-aware (0070, #61)
//
// A dues row used to be unit-level: one obligation trued up against the unit's
// TOTAL balance. On a leased unit that nets the tenant's carry-in against the
// owner's dues, which is wrong once the sub-ledger exists (0064-0067). Dues now
// carry `billed_to` + `tenant_id` and are computed per party.
//
// Two rules make the numbers hold together:
//   1. CARRY IS PARTY-SCOPED. Owner carry = −bal.owner, tenant carry =
//      −bal.tenant. A unit's pre-existing balance sits on the owner side
//      (opening_balance is owner by definition), so it never lands on a tenant.
//   2. AN OUTSTANDING DUE ABSORBS THE CARRY. Dues never touch the balance
//      ledger, so arrears stay visible after a due already collects them, and a
//      part-payment shows up as credit that is not really credit. A new ask
//      therefore clamps both against what is still outstanding:
//          carry = max(0, −L − D) − max(0, L − D)
//      L = the party's ledger balance (+ = credit), D = unpaid issued dues.
//      Q1 of 2000 outstanding with 200 expensed adds NO carry — the 2000 is
//      already collecting that 200. Paying 1000 of it does not create credit
//      either, because 1000 is still owed.
//
// Move-out needs no dues offload: end_membership() (0065) credits the owner
// sub-ledger, so the departed tenant's balance lands in the OWNER's carry-in
// next period on its own. Historical dues rows keep their original tenant_id,
// which is what the former-tenant view reads.
// ============================================================

/** One party's slice of a unit's dues for a period. */
export interface DuesPartyGroup {
  key: string;                 // 'owner' | `tenant:${id}`
  party: Tenure;
  tenantId: string | null;
  title: string;               // 'Owner' | 'Tenant · Nadia' | 'Former tenant · Rami'
  isFormer: boolean;
  base: number; carry: number; due: number;
  lines: Dues[];               // recurring first, then one-time special charges
}

/** A unit's dues for one period: the total, plus its party sub-rows. */
export interface DuesUnitGroup {
  key: string;
  unitId: string;
  unit: Unit | null;
  periodLabel: string;
  dueDate: string | null;
  base: number; carry: number; due: number;
  parties: DuesPartyGroup[];
  /** Show sub-rows? True once a tenant is involved on either side. */
  split: boolean;
}

const partyKey = (d: Pick<Dues, 'billed_to' | 'tenant_id'>) =>
  d.billed_to === 'tenant' ? `tenant:${d.tenant_id ?? '∅'}` : 'owner';

/**
 * Group dues rows into unit + period totals with owner / tenant sub-rows.
 * Drives the Dues tab, the resident card and the statements from one shape, so
 * the screen and the PDF can never disagree.
 */
export function buildDuesRows(
  items: Dues[], units: Unit[], th: TenancyHelpers, labels: ReportLabels,
): DuesUnitGroup[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const groups = new Map<string, DuesUnitGroup>();

  for (const d of items) {
    const gKey = `${d.unit_id}|${d.period_label}`;
    let g = groups.get(gKey);
    if (!g) {
      g = { key: gKey, unitId: d.unit_id, unit: unitById.get(d.unit_id) ?? null,
            periodLabel: d.period_label, dueDate: d.due_date,
            base: 0, carry: 0, due: 0, parties: [], split: false };
      groups.set(gKey, g);
    }
    // The period's due date is the earliest set on any of its rows.
    if (d.due_date && (!g.dueDate || d.due_date < g.dueDate)) g.dueDate = d.due_date;

    const pKey = partyKey(d);
    let p = g.parties.find((x) => x.key === pKey);
    if (!p) {
      const tenantId = d.billed_to === 'tenant' ? d.tenant_id : null;
      const isFormer = d.billed_to === 'tenant' && tenantId !== th.activeTenantId(d.unit_id);
      const name = tenantId ? th.nameById(tenantId) : null;
      const title = d.billed_to === 'tenant'
        ? tenantTitle(isFormer ? labels.formerTenant : labels.tenant, name)
        : labels.owner;
      p = { key: pKey, party: d.billed_to, tenantId, title, isFormer,
            base: 0, carry: 0, due: 0, lines: [] };
      g.parties.push(p);
    }
    p.lines.push(d);
    p.base  = round2(p.base  + Number(d.base_amount));
    p.carry = round2(p.carry + Number(d.carry_in));
    p.due   = round2(p.due   + Number(d.amount_due));
  }

  for (const g of groups.values()) {
    // Owner first, then the current tenant, then former tenants.
    g.parties.sort((a, b) =>
      a.party !== b.party ? (a.party === 'owner' ? -1 : 1)
        : Number(a.isFormer) - Number(b.isFormer));
    for (const p of g.parties) {
      p.lines.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'recurring' ? -1 : 1));
      g.base  = round2(g.base  + p.base);
      g.carry = round2(g.carry + p.carry);
      g.due   = round2(g.due   + p.due);
    }
    g.split = g.parties.some((p) => p.party === 'tenant') || g.parties.length > 1;
  }

  return Array.from(groups.values()).sort((a, b) => {
    const d = (b.dueDate ?? '').localeCompare(a.dueDate ?? '');
    if (d) return d;
    const pl = b.periodLabel.localeCompare(a.periodLabel);
    return pl || (a.unit?.label ?? '').localeCompare(b.unit?.label ?? '', undefined, { numeric: true });
  });
}

// ---------- generation ----------

/** Per-unit allocation of a pool, by the plan's method. */
function allocate(
  method: DuesMethod, pool: number, custom: Record<string, number>, u: Unit, units: Unit[],
): number {
  if (method === 'custom') return round2(Number(custom[u.id]) || 0);
  if (method === 'equal') return round2(pool / (units.length || 1));
  const total = units.reduce((s, x) => s + Number(x.share_weight), 0) || 1;
  return round2((pool * Number(u.share_weight)) / total);
}

export interface DuesGenPlan {
  method: DuesMethod;
  planType: DuesPlan['plan_type'];
  /** Recurring budget: tenant where the unit is leased, owner otherwise. */
  poolAmount: number;
  /** Owner-only slice, same allocation method. */
  ownerPoolAmount: number;
  custom: Record<string, number>;
  ownerCustom: Record<string, number>;
}

/** Who a special charge falls on.
 *  - 'owner'              capital spend on the property (roof, elevator,
 *                         facade). Follows ownership, never the occupant.
 *  - 'tenant_where_leased' a running cost that landed off-cycle (a fuel
 *                         surcharge when oil doubles, a generator top-up).
 *                         Same rule as the recurring budget: the tenant where
 *                         a unit is leased, the owner where it is not. */
export type OffBudgetBillTo = 'owner' | 'tenant_where_leased';

/** A one-time SPECIAL CHARGE allocated across units, outside the plan's period
 *  cycle — for money the fund needs NOW rather than at the next generation. */
export interface OffBudgetSpec {
  label: string;
  method: DuesMethod;
  total: number;
  custom: Record<string, number>;
  billTo: OffBudgetBillTo;
}

export interface DuesGenRow {
  unit: Unit;
  party: Tenure;
  tenantId: string | null;
  kind: Dues['kind'];
  label: string | null;
  base: number;
  carry: number;
  due: number;
}

export interface DuesGenInput {
  units: Unit[];
  plan: DuesGenPlan;
  /** Party balances per unit id, from computeUnitBalances. */
  balances: Record<string, { owner: number; tenant: number; total: number }>;
  /** The unit's ACTIVE tenant, or null. Only a tenant who is currently there
   *  can be billed the recurring budget. */
  activeTenantId: (unitId: string) => string | null;
  /** Amount still owed on dues ALREADY issued to this party (unpaid portion).
   *
   *  Dues never touch the balance ledger, so an outstanding due does two things
   *  the ledger cannot show: it already collects arrears that are still sitting
   *  on the ledger, and it makes a part-payment look like credit. Both have to
   *  be cancelled out or a new ask double-bills. */
  outstandingDues: (unitId: string, party: Tenure) => number;
  /** Generate the plan's recurring amounts (false = special-charge-only run). */
  includeRecurring: boolean;
  /** Apply the arrears true-up? Default true — a normal period nets the party's
   *  position. Turn it OFF to raise a FLAT ask: an unbudgeted cost (fuel
   *  doubling mid-quarter) has to be collected in full even from a unit sitting
   *  on credit, because the cash is needed now. The credit is not lost — the
   *  next trued-up period absorbs it. b2 plans are always flat. */
  applyTrueUp?: boolean;
  offBudget?: OffBudgetSpec | null;
}

/**
 * Work out what a generation run would write. Pure, so the preview in the
 * generate modal and the rows actually inserted come from the same call.
 */
export function computeDuesGeneration(input: DuesGenInput): DuesGenRow[] {
  const { units, plan, balances, activeTenantId, outstandingDues, includeRecurring, offBudget } = input;
  const applyTrueUp = input.applyTrueUp !== false;
  const isB2 = plan.planType === 'b2';
  const rows: DuesGenRow[] = [];

  for (const u of units) {
    const bal = balances[u.id] ?? { owner: 0, tenant: 0, total: 0 };
    const tenantId = activeTenantId(u.id);
    const leased = !!tenantId;

    const recurring  = includeRecurring ? allocate(plan.method, plan.poolAmount, plan.custom, u, units) : 0;
    const ownerSlice = includeRecurring ? allocate(plan.method, plan.ownerPoolAmount, plan.ownerCustom, u, units) : 0;
    const offBase    = offBudget ? allocate(offBudget.method, offBudget.total, offBudget.custom, u, units) : 0;

    // Build each party's lines first, then settle the carry ONCE per party.
    // Which side a line lands on:
    //   recurring budget  → tenant where leased, owner otherwise
    //   owner slice       → always owner
    //   special charge    → owner, or (billTo=tenant_where_leased) the same rule
    //                       as the recurring budget
    type Line = { kind: Dues['kind']; label: string | null; base: number };
    const tenantLines: Line[] = [];
    const ownerLines: Line[] = [];

    if (includeRecurring) {
      if (leased) tenantLines.push({ kind: 'recurring', label: null, base: recurring });
      ownerLines.push({ kind: 'recurring', label: null, base: round2(ownerSlice + (leased ? 0 : recurring)) });
    }
    if (offBudget) {
      const toTenant = offBudget.billTo === 'tenant_where_leased' && leased;
      (toTenant ? tenantLines : ownerLines)
        .push({ kind: 'off_budget', label: offBudget.label, base: offBase });
    }

    // A party can have two lines in one run (recurring + special charge) but only
    // ONE carry-in. It is applied to the first line, and whatever that line
    // cannot absorb spills onto the next, so the lines always sum to
    // max(0, totalBase + carry) — "the carry applies to the sum". The carry is
    // reported on whichever line actually absorbed it, so a reduced amount is
    // never left looking unexplained. A line that comes to nothing is not
    // emitted and does not consume the carry.
    const settle = (party: Tenure, lines: Line[], partyBal: number, tid: string | null) => {
      if (!lines.length) return;
      // An outstanding ask absorbs arrears AND masks apparent credit, so both
      // are clamped against it:
      //   max(0, −L − D)  arrears NOT already covered by an outstanding ask
      //   max(0,  L − D)  credit beyond everything outstanding (genuine prepay)
      // Only the uncovered part of either reaches the new ask.
      const D = outstandingDues(u.id, party);
      const carry = isB2 || !applyTrueUp ? 0
        : round2(Math.max(0, -partyBal - D) - Math.max(0, partyBal - D));
      let left = carry;
      for (const l of lines) {
        const due = isB2 ? l.base : Math.max(0, round2(l.base + left));
        if (due <= 0 && l.base <= 0) continue;
        rows.push({ unit: u, party, tenantId: party === 'tenant' ? tid : null,
                    kind: l.kind, label: l.label, base: l.base, carry: left, due });
        left = isB2 ? 0 : round2(l.base + left - due);
      }
    };

    settle('tenant', tenantLines, bal.tenant, tenantId);
    settle('owner', ownerLines, bal.owner, null);
  }

  return rows;
}
