// ============================================================
// Dual-currency entry (0086). One canonical USD total; the LBP part and its
// rate are the log of how the number came to be. The rate is frozen per row —
// the building setting only prefills the form.
// ============================================================

const r2 = (n: number) => Math.round(n * 100) / 100;

/** usd_part + lbp/rate → the canonical amount_usd. */
export function composeUsdTotal(usdPart: number, lbpPart: number, rate: number): number {
  if (!lbpPart) return r2(usdPart);
  if (!rate || rate <= 0) return NaN; // an LBP amount without a rate is unusable
  return r2(usdPart + lbpPart / rate);
}

/** The USD part of a stored row (derivable, no extra column). */
export function usdPartOf(row: { amount_usd: number; amount_lbp?: number | null; lbp_rate?: number | null }): number {
  if (!row.amount_lbp || !row.lbp_rate) return Number(row.amount_usd);
  return r2(Number(row.amount_usd) - Number(row.amount_lbp) / Number(row.lbp_rate));
}

/** 'USD' | 'LBP' | 'MIX' — for the row tag. Pure-USD rows get no tag. */
export function currencyTag(row: { amount_usd: number; amount_lbp?: number | null; lbp_rate?: number | null }): 'LBP' | 'MIX' | null {
  if (!row.amount_lbp || !row.lbp_rate) return null;
  return usdPartOf(row) > 0.004 ? 'MIX' : 'LBP';
}

export const formatLbp = (n: number) =>
  `LL ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** "$100.00 + LL 5,000,000 @ 89,500" — the detail/notification breakdown. */
export function currencyBreakdown(row: { amount_usd: number; amount_lbp?: number | null; lbp_rate?: number | null }): string | null {
  if (!row.amount_lbp || !row.lbp_rate) return null;
  const usd = usdPartOf(row);
  const lbp = `${formatLbp(Number(row.amount_lbp))} @ ${Number(row.lbp_rate).toLocaleString()}`;
  return usd > 0.004 ? `$${usd.toFixed(2)} + ${lbp}` : lbp;
}
