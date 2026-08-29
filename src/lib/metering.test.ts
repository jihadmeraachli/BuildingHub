import { describe, it, expect } from 'vitest';
import { computeMeterCycle, type MeterCycleInput } from '@/lib/metering';
import type { Unit } from '@/types';

/**
 * Metering v2 (0162) — the client is the PREVIEW twin of SQL
 * finalize_meter_cycle(). The rules that must stay true:
 *
 *  - MbM bills exactly the window's purchases: pool = added cost, losses
 *    inherently grossed into the billed rate.
 *  - WA bills consumption at the rolling average; the closing value chains
 *    into the next cycle at the same rate.
 *  - The MbM→WA bridge (opening value 0) yields a CHEAPER blended rate than
 *    the spot price — residents get their prepaid tank back liter by liter.
 *  - Losses above the alarm threshold flag `alarm`; at the threshold they
 *    don't (strictly greater).
 *  - Per-unit rounding to cents; Σ per-unit == chargesTotal ≈ pool.
 */

const unit = (id: string, share = 1): Unit => ({
  id, building_id: 'b1', label: id.toUpperCase(), share_weight: share, occupancy: 'occupied',
  opening_balance: 0, opening_balance_date: null, created_at: '2026-01-01',
} as Unit);

const base = (over: Partial<MeterCycleInput> = {}): MeterCycleInput => ({
  model: 'mbm',
  units: [unit('u1', 2), unit('u2', 1)],
  readings: [
    { unitId: 'u1', start: 0, end: 60 },
    { unitId: 'u2', start: 0, end: 20 },
    { unitId: null, start: 0, end: 10 },
  ],
  openingStock: 0, openingStockValue: 0,
  addedQty: 100, addedCostUsd: 105,
  closingStock: 10,
  commonMethod: 'equal',
  lossAlarmPct: 10,
  ...over,
});

describe('computeMeterCycle v2', () => {
  it('MbM: the pool is exactly the purchases; meters split it, losses inside', () => {
    const r = computeMeterCycle(base());
    expect(r.pool).toBe(105);                       // money in = money out
    expect(r.consumed).toBe(90);                    // 0 + 100 − 10
    expect(r.sumMeters).toBe(90);
    expect(r.lossesQty).toBe(0);
    expect(r.rateWa).toBeNull();
    expect(r.rateSpot).toBeCloseTo(1.05, 6);
    expect(r.rateBilled).toBeCloseTo(105 / 90, 6);
    expect(r.chargesTotal).toBeCloseTo(105, 1);     // per-unit cent rounding
    expect(r.perUnit.reduce((s, p) => s + p.amount, 0)).toBe(r.chargesTotal);
  });

  it('WA: rolling average rate, pool = consumed × rate, closing value chains', () => {
    const r = computeMeterCycle(base({
      model: 'wa',
      openingStock: 50, openingStockValue: 45,
      addedQty: 100, addedCostUsd: 110,
      closingStock: 60,
      readings: [
        { unitId: 'u1', start: 0, end: 50 },
        { unitId: 'u2', start: 0, end: 30 },
        { unitId: null, start: 0, end: 5 },
      ],
      commonMethod: 'by_shares',
    }));
    expect(r.rateWa).toBeCloseTo(155 / 150, 6);     // (45+110) / (50+100)
    expect(r.consumed).toBe(90);                    // 50 + 100 − 60
    expect(r.pool).toBe(93);                        // 90 × 1.0333…
    expect(r.closingStockValue).toBe(62);           // 60 × rate → next opening
    expect(r.lossesQty).toBe(5);                    // 90 − 85 metered
    expect(r.alarm).toBe(false);                    // 5.56% < 10%
    // by-shares common split: u1 (2/3), u2 (1/3) of the 5-unit common cost
    expect(r.perUnit.find((p) => p.unitId === 'u1')?.amount).toBeCloseTo(58.36, 2);
    expect(r.perUnit.find((p) => p.unitId === 'u2')?.amount).toBeCloseTo(34.64, 2);
    expect(r.chargesTotal).toBeCloseTo(93, 1);
  });

  it('the MbM→WA bridge (opening value 0) undercuts spot until the tank turns', () => {
    const r = computeMeterCycle(base({
      model: 'wa',
      openingStock: 50, openingStockValue: 0,       // residents already paid
      addedQty: 100, addedCostUsd: 110,
      closingStock: 60,
    }));
    expect(r.rateWa).toBeCloseTo(110 / 150, 6);     // blended with free stock
    expect(r.rateSpot).toBeCloseTo(1.1, 6);
    expect(r.rateWa as number).toBeLessThan(r.rateSpot as number);
  });

  it('losses alarm is strictly-greater than the threshold', () => {
    const at = computeMeterCycle(base({
      // consumed 100, metered 90 → exactly 10%
      openingStock: 10, addedQty: 100, closingStock: 10,
      readings: [{ unitId: 'u1', start: 0, end: 70 }, { unitId: 'u2', start: 0, end: 20 }],
    }));
    expect(at.lossPct).toBeCloseTo(10, 2);
    expect(at.alarm).toBe(false);
    const over = computeMeterCycle(base({
      openingStock: 10, addedQty: 100, closingStock: 10,
      readings: [{ unitId: 'u1', start: 0, end: 69 }, { unitId: 'u2', start: 0, end: 20 }],
    }));
    expect(over.alarm).toBe(true);
  });

  it('data-error shapes surface as warnings, never silent numbers', () => {
    const impossible = computeMeterCycle(base({ closingStock: 200 }));
    expect(impossible.warnings).toContain('closing-exceeds-supply');
    const noInvoice = computeMeterCycle(base({ addedQty: 0, addedCostUsd: 0, openingStock: 5, closingStock: 20 }));
    expect(noInvoice.warnings).toContain('stock-rose-no-purchase');
    const overMetered = computeMeterCycle(base({
      openingStock: 0, addedQty: 50, closingStock: 0,
      readings: [{ unitId: 'u1', start: 0, end: 80 }],
    }));
    expect(overMetered.warnings).toContain('meters-exceed-consumed');
  });

  it('idle burn with no metered movement splits the pool as a common cost', () => {
    const r = computeMeterCycle(base({
      readings: [], openingStock: 20, addedQty: 0, addedCostUsd: 0, closingStock: 5,
      model: 'wa', openingStockValue: 18,
    }));
    expect(r.sumMeters).toBe(0);
    expect(r.warnings).toContain('no-consumption-cost-split-as-common');
    expect(r.chargesTotal).toBeCloseTo(r.pool, 1);  // whole pool as common
  });
});
