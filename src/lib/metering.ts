// ============================================================
// Metering v2 (0162) — the PREVIEW twin of finalize_meter_cycle() in SQL.
// Same inputs → same numbers, so what the admin sees before finalizing is
// exactly what the server posts. Two models, chosen in meter_settings:
//
//   'mbm'  Month by Month: the pool is the window's PURCHASES; the meters
//          split it. Money in = money out; losses inherently shared.
//   'wa'   Weighted Average: the pool is CONSUMPTION × the rolling average
//          rate = (opening value + purchases) ÷ (opening qty + bought qty).
//          closing value = closing qty × rate → next cycle's opening value.
//
// Losses (consumed − Σ meters) are GROSSED into the billed rate in both
// models: billedRate = pool ÷ Σ meters. Above the alarm threshold the
// result flags `alarm` and the server refuses without explicit confirm.
//
// Rounding: per-unit amounts round to cents individually; chargesTotal is
// the Σ of rounded amounts — the book and the charges agree to the cent.
// ============================================================
import type { Unit } from '@/types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export type MeterModel = 'mbm' | 'wa';

export interface MeterReadingDraft {
  unitId: string | null;          // null = common areas
  start: number;
  end: number;
}

export interface MeterCycleInput {
  model: MeterModel;
  units: Unit[];                  // the units taking part (for the common split)
  readings: MeterReadingDraft[];
  openingStock: number;
  /** WA only: value of the opening stock. 0 on an MbM→WA bridge (residents
   *  already paid for the tank); the setup's initial value on a fresh WA. */
  openingStockValue: number;
  addedQty: number;               // pulled from typed purchase expenses
  addedCostUsd: number;           // pulled — canonical USD
  closingStock: number;
  commonMethod: 'equal' | 'by_shares';
  lossAlarmPct: number;           // gross-up alarm threshold (settings)
}

export interface MeterCycleResult {
  consumed: number;               // opening + added − closing
  sumMeters: number;              // Σ unit deltas + common delta
  commonConsumption: number;
  lossesQty: number;              // consumed − Σ meters (≥ 0 when readings sane)
  lossPct: number;                // of consumed
  alarm: boolean;                 // lossPct > lossAlarmPct
  rateWa: number | null;          // WA base rate (null for MbM)
  rateSpot: number | null;        // this window's purchase price (info only)
  rateBilled: number;             // pool ÷ Σ meters — what units actually pay
  pool: number;                   // what this cycle bills in total
  closingStockValue: number;      // WA: closing qty × rate; MbM: 0
  perUnit: { unitId: string; consumption: number; own: number; common: number; amount: number }[];
  chargesTotal: number;
  warnings: string[];             // human-readable oddities
}

export function computeMeterCycle(input: MeterCycleInput): MeterCycleResult {
  const warnings: string[] = [];

  const consumed = input.openingStock + input.addedQty - input.closingStock;
  if (consumed < 0) warnings.push('negative-consumption');
  if (input.closingStock > input.openingStock + input.addedQty) warnings.push('closing-exceeds-supply');
  if (input.addedQty <= 0 && input.closingStock > input.openingStock) warnings.push('stock-rose-no-purchase');

  const delta = (r: MeterReadingDraft) => {
    const d = r.end - r.start;
    if (d < 0) warnings.push(`negative-reading:${r.unitId ?? 'common'}`);
    return Math.max(0, d);
  };
  const unitReadings = input.readings.filter((r) => r.unitId !== null);
  const commonConsumption = input.readings.filter((r) => r.unitId === null).reduce((s, r) => s + delta(r), 0);
  const unitConsumption = new Map(unitReadings.map((r) => [r.unitId as string, delta(r)]));
  const sumMeters = [...unitConsumption.values()].reduce((s, d) => s + d, 0) + commonConsumption;

  const lossesQty = Math.max(0, consumed) - sumMeters;
  if (lossesQty < 0) warnings.push('meters-exceed-consumed');
  const lossPct = consumed > 0 ? (100 * Math.max(0, lossesQty)) / consumed : 0;
  const alarm = lossPct > input.lossAlarmPct;

  // rates
  const supply = input.openingStock + input.addedQty;
  const rateWa = input.model === 'wa' && supply > 0
    ? (input.openingStockValue + input.addedCostUsd) / supply
    : null;
  const rateSpot = input.addedQty > 0 ? input.addedCostUsd / input.addedQty : null;

  const pool = input.model === 'wa'
    ? r2(Math.max(0, consumed) * (rateWa ?? 0))
    : r2(input.addedCostUsd);
  const rateBilled = sumMeters > 0 ? pool / sumMeters : 0;
  const closingStockValue = input.model === 'wa' ? r2(input.closingStock * (rateWa ?? 0)) : 0;

  // the common split follows the participating units
  const weights = new Map(input.units.map((u) => [u.id, Number(u.share_weight) || 0]));
  const totalWeight = [...weights.values()].reduce((s, w) => s + w, 0) || 1;
  const commonShare = (unitId: string) =>
    input.commonMethod === 'equal'
      ? 1 / (input.units.length || 1)
      : (weights.get(unitId) ?? 0) / totalWeight;

  let perUnit: MeterCycleResult['perUnit'];
  if (sumMeters > 0) {
    const commonCost = commonConsumption * rateBilled;
    perUnit = input.units.map((u) => {
      const cons = unitConsumption.get(u.id) ?? 0;
      const own = cons * rateBilled;
      const common = commonCost * commonShare(u.id);
      return { unitId: u.id, consumption: cons, own: r2(own), common: r2(common), amount: r2(r2(own) + r2(common)) };
    });
  } else {
    // nothing metered moved but the stock did (idle burn, a leak): the whole
    // pool is a common cost, split by the chosen method
    if (pool > 0) warnings.push('no-consumption-cost-split-as-common');
    perUnit = input.units.map((u) => {
      const common = pool * commonShare(u.id);
      return { unitId: u.id, consumption: 0, own: 0, common: r2(common), amount: r2(common) };
    });
  }

  return {
    consumed: r2(consumed), sumMeters: r2(sumMeters), commonConsumption: r2(commonConsumption),
    lossesQty: r2(Math.max(0, lossesQty)), lossPct: r2(lossPct), alarm,
    rateWa, rateSpot, rateBilled, pool, closingStockValue,
    perUnit,
    chargesTotal: r2(perUnit.reduce((s, p) => s + p.amount, 0)),
    warnings,
  };
}
