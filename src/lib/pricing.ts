// ============================================================
// Pricing bands.
//
// The building pays ONE MONTHLY PRICE for its size. Not a per-unit rate.
//
// Why the model changed (2026-08-20): a flat $5/unit never tapered, so the
// customers worth most were the ones the price list punished hardest — a
// 250-unit compound saw $15,000 a year and stopped reading. Every competitor
// tapers; we did not.
//
// Why BANDS and not a tapering per-unit rate: a per-unit rate that drops at a
// threshold is not monotonic. At $4 up to 30 units and $3 above, a 31-unit
// building pays $93 where a 30-unit one pays $120 — cheaper for being bigger,
// and an invitation to invent a storeroom. Making flat per-unit bands monotonic
// caps each drop at about 3%, which is not a taper at all. A flat price per
// band is monotonic by construction, and it is the only shape the buyer can
// read without doing arithmetic in a committee meeting.
//
// Two properties the numbers below hold, and any future edit must keep:
//   1. MONOTONIC. A bigger building never pays less than a smaller one, so
//      there is nothing to game by inventing a storeroom.
//   2. The per-unit figure DESCENDS across bands (4.25, 2.63, 2.14, …) so the
//      "as low as" line never goes backwards as a building grows.
//
// ⚠️ THE FLOOR, and the decision inside it. From 17 units up, every building
// pays the same or less than the old $5/unit. BELOW 17 UNITS THEY PAY MORE: a
// 10-unit building goes from $50 to $85, a 5-unit from $25 to $85. That is
// what a minimum price means, and every product in this category has one
// (PayHOA charges $49 for anything up to 25 units, so a 5-unit association
// pays them $9.80/unit).
//
// It is a deliberate choice, not an oversight: a 5-unit building costs about
// as much to support as a 50-unit one, and per-unit pricing let the smallest
// buildings pay less than they cost. If Abniyah decides very small buildings
// ARE a market worth serving cheaply, add a starter band below 20 rather than
// lowering the floor for everyone.
//
// ⚠️ Mirrored by monthly_price_cents() in SQL (migration 0100). Change both.
// ============================================================

export interface PricingBand {
  /** inclusive lower bound */
  from: number;
  /** inclusive upper bound; null = open ended (negotiated) */
  to: number | null;
  /** the whole monthly price, in cents. null = talk to us */
  monthlyCents: number | null;
}

export const PRICING_BANDS: PricingBand[] = [
  { from: 1,   to: 20,   monthlyCents: 8500 },
  { from: 21,  to: 40,   monthlyCents: 10500 },
  { from: 41,  to: 70,   monthlyCents: 15000 },
  { from: 71,  to: 120,  monthlyCents: 20500 },
  { from: 121, to: 200,  monthlyCents: 28000 },
  { from: 201, to: 350,  monthlyCents: 38000 },
  { from: 351, to: 500,  monthlyCents: 48000 },
  { from: 501, to: null, monthlyCents: null },   // negotiated
];

/** Annual is 12 months for the price of 10 — the same 17% the old per-unit
 *  plan gave, so nothing about the yearly pitch changes. */
export const ANNUAL_MONTHS_CHARGED = 10;

export function bandFor(units: number): PricingBand {
  const n = Math.max(1, Math.floor(units || 0));
  return PRICING_BANDS.find((b) => n >= b.from && (b.to === null || n <= b.to))
    ?? PRICING_BANDS[PRICING_BANDS.length - 1];
}

/** What this building pays per month. null means the top band: negotiated. */
export function monthlyPriceCents(units: number): number | null {
  return bandFor(units).monthlyCents;
}

export function annualPriceCents(units: number): number | null {
  const m = monthlyPriceCents(units);
  return m === null ? null : m * ANNUAL_MONTHS_CHARGED;
}

/**
 * The "as low as" per-unit figure for a band, in cents.
 *
 * Computed at the band's TOP, which is the only point where it is the lowest
 * — a 41-unit building in the 41-70 band actually pays $3.66/unit, not $2.14.
 * That is why the copy must say "as low as" and never a bare rate: the
 * flattering number stays true at every point in the band, and the claim
 * survives someone checking it with a calculator.
 */
export function asLowAsPerUnitCents(band: PricingBand): number | null {
  if (band.monthlyCents === null || band.to === null) return null;
  return band.monthlyCents / band.to;
}

/** What THIS building actually pays per unit, for the account page. Honest
 *  rather than flattering: it is their real number, not the band's floor. */
export function effectivePerUnitCents(units: number): number | null {
  const m = monthlyPriceCents(units);
  const n = Math.max(1, Math.floor(units || 0));
  return m === null ? null : m / n;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

export const fmtMonthly = (units: number): string => {
  const c = monthlyPriceCents(units);
  return c === null ? '' : money(c);
};

export const fmtPerUnit = (cents: number | null): string => (cents === null ? '' : money(cents));
