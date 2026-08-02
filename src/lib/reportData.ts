// ============================================================
// Shared finance-report computation (extracted VERBATIM from Finance.tsx for
// the Reports tab — #62). Pure functions: same inputs → same numbers, so the
// Finance book and every downloaded report agree by construction.
// If the ledger model evolves (owner/tenant buckets, offloads), change it HERE
// and both pages follow.
// ============================================================
import type { Unit, Charge, Payment, Adjustment } from '@/types';
import { computeUnitBalances, adjustmentEffect } from '@/lib/balance';
import type { StatementBucket } from '@/lib/pdf';

export type TenancyRow = {
  unit_id: string; user_id: string; tenure: string; created_at: string;
  ended_at: string | null; profiles: { full_name: string } | null;
};

/** Localized labels the builders need (callers pass t() results). */
export interface ReportLabels { owner: string; tenant: string; formerTenant: string; }

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
    if (oc.length || op.length || oa.length || opening !== 0 || bal.owner !== 0)
      buckets.push({ key: 'owner', title: labels.owner, balance: bal.owner, openingBalance: opening, charges: oc, payments: op, adjustments: oa });
  }
  const activeTid = th.activeTenantId(u.id);
  const tids = Array.from(new Set([
    ...cAll.filter((c) => c.billed_to === 'tenant').map((c) => c.tenant_id ?? '∅'),
    ...pAll.filter((p) => p.paid_by === 'tenant').map((p) => p.tenant_id ?? '∅'),
    ...aAll.filter((a) => a.party === 'tenant').map((a) => a.tenant_id ?? '∅'),
  ])).sort((a, b) => (a === activeTid ? -1 : b === activeTid ? 1 : 0));
  for (const tid of tids) {
    if (!wants(tid)) continue;
    const c = cAll.filter((x) => x.billed_to === 'tenant' && (x.tenant_id ?? '∅') === tid);
    const p = pAll.filter((x) => x.paid_by === 'tenant' && (x.tenant_id ?? '∅') === tid);
    const a = aAll.filter((x) => x.party === 'tenant' && (x.tenant_id ?? '∅') === tid);
    if (!c.length && !p.length && !a.length) continue;
    const isActive = tid !== '∅' && tid === activeTid;
    const name = tid === '∅' ? labels.tenant : (th.nameById(tid) ?? labels.tenant);
    buckets.push({ key: `tenant:${tid}`, title: `${isActive ? labels.tenant : labels.formerTenant} · ${name}`,
      balance: round2n(sumAmt(p) - sumAmt(c) + adjEff(a)), charges: c, payments: p, adjustments: a });
  }
  return { buckets, combined: round2n(buckets.reduce((s, b) => s + b.balance, 0)) };
}
