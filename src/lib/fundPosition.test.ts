import { describe, it, expect } from 'vitest';
import { fundPosition, type FundInputs } from '@/lib/reportData';
import type { Unit, Charge, Payment, Adjustment, Expense } from '@/types';

/**
 * fundPosition() is the client twin of SQL fund_position() (0106). It decides
 * what a committee is told it has in the drawer and what is genuinely the
 * building's own money. The rules that must stay true:
 *
 *   - a pass-through building has NO reserve: every dollar billed was a bill
 *   - a neighbour's overpayment is held FOR them, never the building's money
 *   - a dues prepayment is the same thing as an overpayment, arithmetically
 *   - an expense paid from the fund reduces cash and reserve, bills nobody
 *   - a refund handed over in cash leaves the drawer
 *   - voided rows are not money; an as-of date excludes what came after it
 *   - the reconciliation guard catches an expense nobody explained
 */

const unit = (id: string, over: Partial<Unit> = {}): Unit => ({
  id, building_id: 'b1', label: id.toUpperCase(), share_weight: 1, occupancy: 'occupied',
  opening_balance: 0, opening_balance_date: null, created_at: '2026-01-01', ...over,
} as Unit);

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: 'c' + Math.random().toString(36).slice(2, 8), expense_id: null, unit_id: 'u1', building_id: 'b1',
  category: 'common_expenses', description: 'x', amount_usd: 100, charge_date: '2026-03-01',
  billed_to: 'owner', created_by: null, created_at: '2026-03-01', ...over,
} as Charge);

const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'p' + Math.random().toString(36).slice(2, 8), unit_id: 'u1', building_id: 'b1', amount_usd: 100,
  method: 'cash', paid_on: '2026-03-05', note: null, receipt_url: null, recorded_by: null,
  paid_by: 'owner', ...over,
} as Payment);

const expense = (over: Partial<Expense> = {}): Expense => ({
  id: 'e' + Math.random().toString(36).slice(2, 8), building_id: 'b1', compound_id: null,
  category: 'common_expenses', description: 'x', amount_usd: 300, expense_date: '2026-03-02',
  scope_type: 'block', method: 'equal', invoice_url: null, funded_by_fund_usd: 0,
  created_by: null, created_at: '2026-03-02', ...over,
} as Expense);

const adjustment = (over: Partial<Adjustment> = {}): Adjustment => ({
  id: 'a' + Math.random().toString(36).slice(2, 8), unit_id: 'u1', building_id: 'b1',
  kind: 'refund', amount_usd: 50, party: 'owner', effective_date: '2026-03-03',
  note: null, created_by: null, created_at: '2026-03-03', ...over,
} as Adjustment);

const base = (over: Partial<FundInputs> = {}): FundInputs => ({
  units: [unit('u1'), unit('u2')], charges: [], payments: [], adjustments: [], expenses: [],
  entries: [], opening: 0, ...over,
});

// A $300 expense split equally over two units, both paid in full.
const passThrough = (): FundInputs => {
  const e = expense({ id: 'e1', amount_usd: 300 });
  return base({
    expenses: [e],
    charges: [charge({ expense_id: 'e1', unit_id: 'u1', amount_usd: 150 }), charge({ expense_id: 'e1', unit_id: 'u2', amount_usd: 150 })],
    payments: [payment({ unit_id: 'u1', amount_usd: 150 }), payment({ unit_id: 'u2', amount_usd: 150 })],
  });
};

describe('fundPosition', () => {
  it('a pass-through building has no reserve: every dollar billed was a bill', () => {
    const r = fundPosition(passThrough());
    expect(r.cash).toBe(0);
    expect(r.credits).toBe(0);
    expect(r.arrears).toBe(0);
    expect(r.reserve).toBe(0);
    expect(r.unreconciled).toBe(0);
  });

  it('the neighbour who paid more: cash rises, reserve does not', () => {
    const inp = passThrough();
    inp.payments.push(payment({ unit_id: 'u1', amount_usd: 500 })); // paid ahead
    const r = fundPosition(inp);
    expect(r.cash).toBe(500);       // it IS in the drawer
    expect(r.credits).toBe(500);    // … and it is held for u1
    expect(r.available).toBe(0);    // nothing the building may call its own
    expect(r.reserve).toBe(0);
  });

  it('arrears are the mirror image: not in the drawer yet, but the building\'s once collected', () => {
    const inp = passThrough();
    inp.payments = inp.payments.filter((p) => p.unit_id !== 'u2'); // u2 never paid
    const r = fundPosition(inp);
    expect(r.cash).toBe(-150);      // the bill was paid out of money not yet collected
    expect(r.arrears).toBe(150);
    expect(r.available).toBe(-150);
    expect(r.reserve).toBe(0);      // once u2 pays, the building is square
  });

  it('a dues prepayment is arithmetically an overpayment: prepaid, not owned', () => {
    // residents prepay $1,000 each before any expense exists
    const r = fundPosition(base({
      payments: [payment({ unit_id: 'u1', amount_usd: 1000 }), payment({ unit_id: 'u2', amount_usd: 1000 })],
    }));
    expect(r.cash).toBe(2000);
    expect(r.credits).toBe(2000);
    expect(r.available).toBe(0);
    expect(r.reserve).toBe(0);
  });

  it('a charge that is not an expense (a levy) is how a reserve is built', () => {
    const r = fundPosition(base({
      charges: [charge({ unit_id: 'u1', amount_usd: 200 }), charge({ unit_id: 'u2', amount_usd: 200 })],
      payments: [payment({ unit_id: 'u1', amount_usd: 200 }), payment({ unit_id: 'u2', amount_usd: 200 })],
    }));
    expect(r.cash).toBe(400);
    expect(r.credits).toBe(0);
    expect(r.reserve).toBe(400);    // genuinely the building's
  });

  it('an expense paid from the fund bills nobody and draws the reserve down', () => {
    const inp = base({
      opening: 1000,
      expenses: [expense({ id: 'e1', amount_usd: 300, funded_by_fund_usd: 300 })],
    });
    const r = fundPosition(inp);
    expect(r.cash).toBe(700);
    expect(r.arrears).toBe(0);
    expect(r.reserve).toBe(700);
    expect(r.fund_paid).toBe(300);
    expect(r.unreconciled).toBe(0);
  });

  it('a partly fund-paid expense: the billed part is owed, the rest is the fund\'s', () => {
    const inp = base({
      opening: 1000,
      expenses: [expense({ id: 'e1', amount_usd: 1000, funded_by_fund_usd: 400 })],
      charges: [charge({ expense_id: 'e1', unit_id: 'u1', amount_usd: 300 }), charge({ expense_id: 'e1', unit_id: 'u2', amount_usd: 300 })],
    });
    const r = fundPosition(inp);
    expect(r.cash).toBe(0);         // the whole $1,000 left the drawer
    expect(r.arrears).toBe(600);
    expect(r.reserve).toBe(600);    // 1000 opening − 400 the fund bore
    expect(r.unreconciled).toBe(0);
  });

  it('the guard catches an expense nobody explained (C1)', () => {
    const inp = base({
      expenses: [expense({ id: 'e1', amount_usd: 1000, funded_by_fund_usd: 0 })],
      charges: [charge({ expense_id: 'e1', unit_id: 'u1', amount_usd: 600 })],
    });
    expect(fundPosition(inp).unreconciled).toBe(1);
    // … and the backfill rule (fund part = amount − billed) clears it
    inp.expenses[0].funded_by_fund_usd = 400;
    expect(fundPosition(inp).unreconciled).toBe(0);
  });

  it('a cash refund leaves the drawer; a discount does not', () => {
    const inp = base({
      opening: 500,
      adjustments: [adjustment({ kind: 'refund', amount_usd: 50 }), adjustment({ kind: 'discount', amount_usd: 30 })],
    });
    const r = fundPosition(inp);
    expect(r.refunds_out).toBe(50);
    expect(r.cash).toBe(450);
  });

  it('other income and outflows move cash without touching any unit', () => {
    const r = fundPosition(base({
      entries: [
        { kind: 'income', amount_usd: 1200, entry_date: '2026-03-01' },   // antenna rent
        { kind: 'outflow', amount_usd: 200, entry_date: '2026-03-10' },   // cash withdrawn
        { kind: 'income', amount_usd: 999, entry_date: '2026-03-11', voided_at: '2026-03-12' },
      ],
    }));
    expect(r.other_in).toBe(1200);
    expect(r.other_out).toBe(200);
    expect(r.cash).toBe(1000);
    expect(r.credits).toBe(0);
    expect(r.reserve).toBe(1000);
  });

  it('voided payments are not money', () => {
    const inp = passThrough();
    inp.payments.push(payment({ unit_id: 'u1', amount_usd: 9999, voided_at: '2026-03-09' }));
    expect(fundPosition(inp).cash).toBe(0);
  });

  it('an as-of date excludes what came after it, opening date included', () => {
    const inp = base({
      opening: 800, openingDate: '2026-02-01',
      payments: [payment({ unit_id: 'u1', amount_usd: 100, paid_on: '2026-03-05' })],
      expenses: [expense({ amount_usd: 50, expense_date: '2026-04-01', funded_by_fund_usd: 50 })],
    });
    expect(fundPosition(inp, '2026-01-15').cash).toBe(0);     // before the opening
    expect(fundPosition(inp, '2026-03-31').cash).toBe(900);   // opening + payment, expense not yet
    expect(fundPosition(inp).cash).toBe(850);
  });

  it('the identity holds whatever the inputs: reserve = cash − (credits − arrears)', () => {
    const inp = base({
      opening: 333.33,
      expenses: [expense({ id: 'e1', amount_usd: 1000, funded_by_fund_usd: 100 })],
      charges: [charge({ expense_id: 'e1', unit_id: 'u1', amount_usd: 450 }), charge({ expense_id: 'e1', unit_id: 'u2', amount_usd: 450 })],
      payments: [payment({ unit_id: 'u1', amount_usd: 700 })],
      adjustments: [adjustment({ kind: 'refund', amount_usd: 20, unit_id: 'u1' })],
      entries: [{ kind: 'income', amount_usd: 75.5, entry_date: '2026-03-01' }],
    });
    const r = fundPosition(inp);
    expect(r.reserve).toBeCloseTo(r.cash - (r.credits - r.arrears), 2);
  });
});
