// Single source of truth for computing a unit's balance on the client, so
// Finance / Dashboard / Dues / statements never disagree. Mirrors the SQL
// unit_balance() / unit_balance_asof() in migrations 0033 + 0034.
//
// Sign convention (same everywhere): + = credit (paid ahead), − = owes.
//   balance = opening + Σpayments − Σcharges + Σadjustment_effect
// Voided charges/payments/adjustments are excluded. opening_balance is folded in
// but is NOT cash — it never counts toward "collected"/"billed" in the P&L.

import type { AdjustmentKind } from '@/types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Signed effect of an adjustment on the balance. Mirrors adjustment_effect() in SQL. */
export function adjustmentEffect(kind: AdjustmentKind, amount: number): number {
  return kind === 'penalty' || kind === 'refund' ? -Number(amount) : Number(amount);
}

export interface OpeningInfo {
  opening_balance?: number | null;
  opening_balance_date?: string | null;
}

interface Voidable { voided_at?: string | null }
interface Charge extends Voidable { amount_usd: number; charge_date: string }
interface Payment extends Voidable { amount_usd: number; paid_on: string }
interface Adj extends Voidable { amount_usd: number; kind: AdjustmentKind; effective_date: string }

const live = (r: Voidable) => !r.voided_at;

/**
 * balance = opening + Σpayments − Σcharges + Σadjustments, ignoring voided rows.
 * If `asOf` is given, only rows dated on/before it count, and the opening balance
 * counts only once its as-of date has arrived.
 */
export function computeBalance(
  unit: OpeningInfo,
  charges: Charge[],
  payments: Payment[],
  asOf?: string | Date | null,
  adjustments: Adj[] = [],
): number {
  const cut = asOf ? new Date(asOf) : null;
  const within = (d: string) => !cut || new Date(d) <= cut;

  const opening = Number(unit.opening_balance ?? 0);
  const openingCounts =
    !cut || !unit.opening_balance_date || new Date(unit.opening_balance_date) <= cut;

  const paid = payments.reduce((s, p) => (live(p) && within(p.paid_on) ? s + Number(p.amount_usd) : s), 0);
  const charged = charges.reduce((s, c) => (live(c) && within(c.charge_date) ? s + Number(c.amount_usd) : s), 0);
  const adj = adjustments.reduce(
    (s, a) => (live(a) && within(a.effective_date) ? s + adjustmentEffect(a.kind, a.amount_usd) : s), 0);

  return round2((openingCounts ? opening : 0) + paid - charged + adj);
}
