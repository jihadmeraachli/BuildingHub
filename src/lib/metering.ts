// ============================================================
// Metering (0090) — generator / water cycles for expense types flagged
// `is_metered` (0085). The admin records, per period:
//
//   stock:    opening level, quantity bought, cost of what was bought, closing
//   readings: start/end meter reading per unit, plus the common areas
//
// and the cycle turns into money like this:
//
//   unit_cost   = added_cost / added_qty        (avg cost of what was BOUGHT)
//   consumed    = opening + added − closing     (what actually left the tank)
//   total_cost  = consumed × unit_cost
//   cost_per_kw = total_cost / total_consumption(units + common)
//   unit pays   = its consumption × cost_per_kw
//   common cost = common consumption × cost_per_kw, split equal/by-shares
//                 across the units and added on top
//
// The finalized cycle posts ONE expense (the metered type, custom allocation)
// whose charges are exactly these per-unit amounts — so the book, the party
// model and the reminders all treat it like any other expense. The expense
// total is Σ of the ROUNDED per-unit amounts: the book and the charges must
// agree to the cent, so rounding happens per unit, never on the total.
// ============================================================
import type { Unit } from '@/types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MeterReadingDraft {
  unitId: string | null;          // null = common areas
  start: number;
  end: number;
}

export interface MeterCycleInput {
  units: Unit[];                  // the units taking part (for the common split)
  readings: MeterReadingDraft[];
  openingStock: number;
  addedQty: number;
  addedCostUsd: number;           // canonical USD (compose LBP before calling)
  closingStock: number;
  commonMethod: 'equal' | 'by_shares';
}

export interface MeterCycleResult {
  unitCost: number;               // per liter / m³
  consumed: number;
  totalCost: number;
  totalConsumption: number;       // kW / m³, units + common
  commonConsumption: number;
  costPerUnitOfConsumption: number;
  perUnit: { unitId: string; consumption: number; own: number; common: number; amount: number }[];
  chargesTotal: number;           // Σ rounded per-unit amounts = the expense amount
  warnings: string[];             // human-readable oddities (negative delta, …)
}

export function computeMeterCycle(input: MeterCycleInput): MeterCycleResult {
  const warnings: string[] = [];
  const unitCost = input.addedQty > 0 ? input.addedCostUsd / input.addedQty : 0;
  const consumed = input.openingStock + input.addedQty - input.closingStock;
  if (consumed < 0) warnings.push('negative-consumption');
  const totalCost = r2(Math.max(0, consumed) * unitCost);

  const delta = (r: MeterReadingDraft) => {
    const d = r.end - r.start;
    if (d < 0) warnings.push(`negative-reading:${r.unitId ?? 'common'}`);
    return Math.max(0, d);
  };
  const unitReadings = input.readings.filter((r) => r.unitId !== null);
  const commonConsumption = input.readings.filter((r) => r.unitId === null).reduce((s, r) => s + delta(r), 0);
  const unitConsumption = new Map(unitReadings.map((r) => [r.unitId as string, delta(r)]));
  const totalConsumption = [...unitConsumption.values()].reduce((s, d) => s + d, 0) + commonConsumption;

  // the common split follows the participating units
  const weights = new Map(input.units.map((u) => [u.id, Number(u.share_weight) || 0]));
  const totalWeight = [...weights.values()].reduce((s, w) => s + w, 0) || 1;
  const commonShare = (unitId: string) =>
    input.commonMethod === 'equal'
      ? 1 / (input.units.length || 1)
      : (weights.get(unitId) ?? 0) / totalWeight;

  let perUnit: MeterCycleResult['perUnit'];
  let costPerUnitOfConsumption = 0;

  if (totalConsumption > 0) {
    costPerUnitOfConsumption = totalCost / totalConsumption;
    const commonCost = commonConsumption * costPerUnitOfConsumption;
    perUnit = input.units.map((u) => {
      const cons = unitConsumption.get(u.id) ?? 0;
      const own = cons * costPerUnitOfConsumption;
      const common = commonCost * commonShare(u.id);
      return { unitId: u.id, consumption: cons, own: r2(own), common: r2(common), amount: r2(own + common) };
    });
  } else {
    // nothing metered moved but the stock did (idle burn, a leak): the whole
    // cost is a common cost, split by the chosen method
    if (totalCost > 0) warnings.push('no-consumption-cost-split-as-common');
    perUnit = input.units.map((u) => {
      const common = totalCost * commonShare(u.id);
      return { unitId: u.id, consumption: 0, own: 0, common: r2(common), amount: r2(common) };
    });
  }

  return {
    unitCost: r2(unitCost), consumed: r2(consumed), totalCost,
    totalConsumption: r2(totalConsumption), commonConsumption: r2(commonConsumption),
    costPerUnitOfConsumption,
    perUnit,
    chargesTotal: r2(perUnit.reduce((s, p) => s + p.amount, 0)),
    warnings,
  };
}
