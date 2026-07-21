// Single source of truth for computing a unit's balance on the client, so
// Finance / Dashboard / Dues / statements never disagree. Mirrors the SQL
// unit_balance() / unit_balance_asof() in migration 0033.
//
// Sign convention (same everywhere): + = credit (paid ahead), − = owes.
// opening_balance is folded in but is NOT a charge/payment — it never counts
// toward "collected" or "billed" in the P&L.

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OpeningInfo {
  opening_balance?: number | null;
  opening_balance_date?: string | null;
}

interface Dated { amount_usd: number }
interface Charge extends Dated { charge_date: string }
interface Payment extends Dated { paid_on: string }

/**
 * balance = opening + Σpayments − Σcharges.
 * If `asOf` is given, only transactions dated on/before it count, and the
 * opening balance counts only once its as-of date has arrived.
 */
export function computeBalance(
  unit: OpeningInfo,
  charges: Charge[],
  payments: Payment[],
  asOf?: string | Date | null,
): number {
  const cut = asOf ? new Date(asOf) : null;
  const within = (d: string) => !cut || new Date(d) <= cut;

  const opening = Number(unit.opening_balance ?? 0);
  const openingCounts =
    !cut ||
    !unit.opening_balance_date ||
    new Date(unit.opening_balance_date) <= cut;

  const paid = payments.reduce((s, p) => (within(p.paid_on) ? s + Number(p.amount_usd) : s), 0);
  const charged = charges.reduce((s, c) => (within(c.charge_date) ? s + Number(c.amount_usd) : s), 0);

  return round2((openingCounts ? opening : 0) + paid - charged);
}
