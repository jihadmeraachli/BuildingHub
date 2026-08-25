import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { composeUsdTotal } from '@/lib/currency';
import { useExpenseTypes } from '@/lib/expenseTypes';
import { Plus, Trash2, Info, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { computeUnitBalances } from '@/lib/balance';
import { useEntities } from '@/lib/entities';
import {
  tenancyHelpers, buildDuesRows, computeDuesGeneration, tenantTitle,
  type TenancyRow, type DuesGenRow, type OffBudgetBillTo,
} from '@/lib/reportData';
import type { Unit, Charge, Payment, Adjustment, Dues as DuesItem, Budget, DuesMethod, DuesPlanType, Tenure, Group } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { fmtMoney } from '@/lib/money';

const METHODS: DuesMethod[] = ['by_shares', 'equal', 'custom'];
// one formatter, following the reader's language (src/lib/money.ts)
const money = (n: number) => fmtMoney(n);
/** Carry-in sign colors match Finance: a credit is good, arrears are not. */
const carryTone = (n: number) =>
  n < 0 ? 'text-emerald-600 dark:text-emerald-400'
    : n > 0 ? 'text-red-500 dark:text-red-300'
    : 'text-muted-foreground';

export default function Dues() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useManagedBuildings();
  const entities = useEntities(buildings);
  // GLOBAL entity selection (sidebar) — Dues needs one entity; '' shows a prompt.
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  const canManage = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('expense.manage', id));
  /** Dues can only be ISSUED on a dues-mode entity. The reminder helpers
   *  (get_overdue_dues, 0056/0070) skip arrears buildings entirely, so dues
   *  raised in arrears mode would notify residents once and then never be
   *  chased, while the arrears reminder keeps quoting a balance the dues never
   *  touched. The DB already made this call; the UI now matches it. */
  const duesMode = entity?.billingMode === 'dues';
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  const [units, setUnits] = useState<Unit[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [items, setItems] = useState<DuesItem[]>([]);
  // ended memberships included, so a unit whose tenant left still resolves that
  // tenant's name on their historical dues rows (0070)
  const [tenancy, setTenancy] = useState<TenancyRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unitGroups, setUnitGroups] = useState<{ group_id: string; unit_id: string }[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Point-in-time view: dues issued by this date, settled by payments up to
   *  it. '' = live. Uses created_at on both sides so the as-of view runs on the
   *  same clock as the settlement rule rather than mixing issue and value
   *  dates. */
  const [asOf, setAsOf] = useState('');
  const upTo = useMemo(() => {
    const cut = asOf ? new Date(`${asOf}T23:59:59`) : null;
    return (iso: string) => !cut || new Date(iso) <= cut;
  }, [asOf]);

  const [saving, setSaving] = useState(false);
  // the entity's catalog for the line picker (0085)
  const { activeTypes } = useExpenseTypes(entity?.kind, entity?.id);

  // ── the budget being issued. THERE IS NO PLAN: every issuance is built from
  // scratch out of LINES (type + amount), and the total of the lines is what
  // gets split. Time-bound: period from → to, held against actuals in Reports.
  type BudgetLineDraft = { expense_type_id: string; note: string; usd: string; lbp: string; rate: string };
  const [genOpen, setGenOpen] = useState(false);
  const [genPeriod, setGenPeriod] = useState('');
  const [genStart, setGenStart] = useState('');
  const [genEnd, setGenEnd] = useState('');
  const [genDue, setGenDue] = useState(new Date().toISOString().slice(0, 10));
  const [budLines, setBudLines] = useState<BudgetLineDraft[]>([]);
  const [genCustom, setGenCustom] = useState<Record<string, string>>({});
  const [prefillRate, setPrefillRate] = useState('');
  // ON = a normal period, netted against each party's position. OFF = a flat
  // ask for an unbudgeted cost, collected in full even from units in credit.
  const [genTrueUp, setGenTrueUp] = useState(true);
  // Who the run's pool falls on, and how much — both default to the plan but
  // are per-run, so an off-cycle ask (fuel to tenants, capital to owners) does
  // not need the plan edited and put back afterwards.
  const [genBillTo, setGenBillTo] = useState<OffBudgetBillTo>('tenant_where_leased');
  // Allocation for THIS run: which units, and on what basis. Defaults to the
  // whole entity on the plan's basis, so a normal period is unchanged.
  const [genMethod, setGenMethod] = useState<DuesMethod>('by_shares');
  const [genScope, setGenScope] = useState<'all' | 'group' | 'units'>('all');
  const [genGroupId, setGenGroupId] = useState('');
  const [genUnitIds, setGenUnitIds] = useState<string[]>([]);
  const [confirmCancelBudget, setConfirmCancelBudget] = useState<Budget | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<string | null>(null);


  useEffect(() => { if (entity) load(); }, [entityKey, entities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity) return;
    setLoading(true);
    const blocks = entity.buildingIds;
    // H6 (finance audit): charges/payments/adjustments/dues go through
    // fetchAll — PostgREST silently caps a plain select at 1000 rows, and an
    // unpaged read here would generate dues from a truncated ledger (wrong
    // carry-ins inserted as real obligations). Same fix Finance.tsx already
    // has for these tables. Ordering includes id as a stable tiebreaker.
    const [{ data: u }, chargeRows, paymentRows, adjRows] = await Promise.all([
      supabase.from('units').select('*').in('building_id', blocks).order('label'),
      fetchAll<Charge>((f, t) => supabase.from('charges').select('*').in('building_id', blocks).order('charge_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
      fetchAll<Payment>((f, t) => supabase.from('payments').select('*').in('building_id', blocks).order('paid_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
      fetchAll<Adjustment>((f, t) => supabase.from('adjustments').select('*').in('building_id', blocks).order('effective_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
    ]);
    setUnits((u as Unit[]) ?? []);
    setCharges(chargeRows);
    setPayments(paymentRows);
    setAdjustments(adjRows);
    const ids = ((u as Unit[]) ?? []).map((x) => x.id);
    if (ids.length) {
      const budQ = entity.kind === 'compound'
        ? supabase.from('budgets').select('*').eq('compound_id', entity.id)
        : supabase.from('budgets').select('*').eq('building_id', entity.id);
      const [duesRows, { data: mem }, { data: g }, { data: ug }, { data: buds }] = await Promise.all([
        fetchAll<DuesItem>((f, t) => supabase.from('dues').select('*').in('building_id', blocks).is('converted_at', null).order('created_at', { ascending: false }).order('id').range(f, t)),
        supabase.from('memberships').select('unit_id, user_id, tenure, created_at, ended_at, profiles(full_name)').in('unit_id', ids),
        supabase.from('groups').select('*').in('building_id', blocks).order('name'),
        supabase.from('unit_groups').select('group_id, unit_id').in('unit_id', ids),
        budQ.is('cancelled_at', null).order('period_start', { ascending: false }),
      ]);
      // D11: drop dues of units no longer present (e.g. soft-deleted) so the
      // Dues tab and its balances match the visible unit list — `ids` is the
      // fetched (RLS-visible, non-trashed) unit set.
      { const idSet = new Set(ids); setItems(duesRows.filter((d) => idSet.has(d.unit_id))); }
      setTenancy((mem as unknown as TenancyRow[]) ?? []);
      setGroups((g as Group[]) ?? []);
      setUnitGroups((ug as { group_id: string; unit_id: string }[]) ?? []);
      setBudgets((buds as Budget[]) ?? []);
    } else { setItems([]); setTenancy([]); setGroups([]); setUnitGroups([]); setBudgets([]); }
    setLoading(false);
  }

  const th = useMemo(
    () => tenancyHelpers(tenancy, charges, payments, adjustments),
    [tenancy, charges, payments, adjustments]);

  const labels = useMemo(
    () => ({ owner: t('finance.owner'), tenant: t('finance.currentTenant'), formerTenant: t('finance.formerTenant') }),
    [t]);

  /** Party balances per unit — the dues true-up is per sub-ledger now (0070),
   *  so an owner's carry-in never nets against a tenant's dues. */
  const balanceOf = useMemo(() => {
    const m: Record<string, { owner: number; tenant: number; total: number }> = {};
    units.forEach((u) => {
      m[u.id] = computeUnitBalances(
        u,
        charges.filter((c) => c.unit_id === u.id),
        payments.filter((p) => p.unit_id === u.id),
        adjustments.filter((a) => a.unit_id === u.id),
      );
    });
    return m;
  }, [units, charges, payments, adjustments]);

  const num = (r: Record<string, string>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v) || 0]));

  /** Unpaid portion of dues ALREADY issued to this unit+party.
   *
   *  Dues never touch the balance ledger, so an outstanding due both collects
   *  arrears that still sit on the ledger AND makes a part-payment look like
   *  credit. computeDuesGeneration clamps the carry against this so neither is
   *  billed twice. Settlement uses the same test as get_overdue_dues — that
   *  party's payments since the row was issued — so the screen and the
   *  reminder cron agree. */
  // 0140 (dues audit D1): a party's OUTSTANDING dues is an AGGREGATE — Σ of the
  // party's issued dues minus the party's payments since the earliest one — NOT
  // a per-due subtraction. The old per-due form subtracted one payment from
  // EVERY due, over-crediting the carry and silently under-billing next period.
  // This matches get_overdue_dues' aggregate exactly, so screen and cron agree.
  const outstandingDues = useMemo(() => {
    return (unitId: string, party: Tenure) => {
      const dues = items.filter((d) => d.unit_id === unitId && d.billed_to === party && upTo(d.created_at));
      if (!dues.length) return 0;
      const totalDue = dues.reduce((s, d) => s + Number(d.amount_due), 0);
      const dueIds = new Set(dues.map((d) => d.id));
      const since = dues.reduce((m, d) => (d.created_at < m ? d.created_at : m), dues[0].created_at);
      const tenantId = party === 'tenant' ? (dues.find((d) => d.tenant_id)?.tenant_id ?? null) : null;
      // 0147 (D7): a payment pinned to one of these dues (due_id) settles it
      // exactly, whenever it was made; an undirected payment reconciles through
      // the running-account window as before. Mirrors get_overdue_dues.
      const paid = payments
        .filter((p) => !p.voided_at && upTo(p.created_at) && (
          p.due_id
            ? dueIds.has(p.due_id)
            : p.unit_id === unitId && p.created_at >= since
              && (party === 'tenant'
                ? p.paid_by === 'tenant' && (!tenantId || p.tenant_id === tenantId)
                : p.paid_by !== 'tenant')))
        .reduce((s, p) => s + Number(p.amount_usd), 0);
      return Math.max(0, totalDue - paid);
    };
  }, [items, payments, upTo]);

  /** Start a fresh budget. Every issuance is its own plan, so the modal always
   *  opens empty — one blank line, the entity's LBP prefill rate fetched for
   *  the line editor (frozen per line on save, 0086). */
  async function openBudget() {
    setGenPeriod(''); setGenStart(''); setGenEnd('');
    setGenDue(new Date().toISOString().slice(0, 10));
    setGenTrueUp(true); setGenBillTo('tenant_where_leased');
    setGenMethod('by_shares'); setGenScope('all'); setGenGroupId(''); setGenUnitIds([]);
    setGenCustom({});
    setBudLines([{ expense_type_id: '', note: '', usd: '', lbp: '', rate: '' }]);
    setGenOpen(true);
    const bid = entity?.buildingIds[0];
    if (bid) {
      const { data } = await supabase.rpc('effective_lbp_rate', { p_building: bid });
      setPrefillRate(data ? String(data) : '');
    } else setPrefillRate('');
  }

  const isB2 = false; // b2 lives on as the per-issuance true-up toggle

  /** Units this run targets. Allocation divides across THESE only, so an
   *  equal split over a group is a split over that group, not the building. */
  const genUnits = useMemo(() => {
    const scoped = units.filter((u) => !blockFilter || u.building_id === blockFilter);
    if (genScope === 'group') {
      const ids = new Set(unitGroups.filter((x) => x.group_id === genGroupId).map((x) => x.unit_id));
      return scoped.filter((u) => ids.has(u.id));
    }
    if (genScope === 'units') return scoped.filter((u) => genUnitIds.includes(u.id));
    return scoped;
  }, [units, blockFilter, genScope, genGroupId, genUnitIds, unitGroups]);

  /** Σ of the line totals (USD part + LBP/rate, 0086) — THE pool. */
  const budgetTotal = useMemo(() =>
    budLines.reduce((s, l) => {
      const t = composeUsdTotal(Number(l.usd) || 0, Number(l.lbp) || 0, Number(l.rate) || 0);
      return s + (Number.isNaN(t) ? 0 : t);
    }, 0), [budLines]);

  const genPlan = useMemo(() => ({
    method: genMethod,
    planType: 'b1' as DuesPlanType,
    poolAmount: Math.round(budgetTotal * 100) / 100,
    ownerPoolAmount: 0,
    custom: num(genCustom),
    ownerCustom: {},
  }), [budgetTotal, genMethod, genCustom]);

  /** Preview and insert come from the same pure call, so what the manager sees
   *  is exactly what gets written. */
  const preview = useMemo(() => {
    return computeDuesGeneration({
      units: genUnits, plan: genPlan, balances: balanceOf,
      activeTenantId: th.activeTenantId,
      outstandingDues,
      includeRecurring: true,
      applyTrueUp: genTrueUp,
      recurringBillTo: genBillTo,
    });
  }, [genUnits, genPlan, balanceOf, th, genPeriod, items, genTrueUp, genBillTo]); // eslint-disable-line react-hooks/exhaustive-deps



  function toRows(gen: DuesGenRow[], period: string, due: string, budgetId: string) {
    return gen.map((r) => ({
      plan_id: null, budget_id: budgetId, building_id: r.unit.building_id, unit_id: r.unit.id,
      period_label: period, due_date: due || null,
      base_amount: r.base, carry_in: r.carry, amount_due: r.due,
      billed_to: r.party, tenant_id: r.tenantId, kind: r.kind, label: r.label,
      created_by: profile?.id,
    }));
  }

  async function issueBudget() {
    if (!entity || !genPeriod.trim() || !genStart || !genEnd) return;
    const lines = budLines.filter((l) => composeUsdTotal(Number(l.usd) || 0, Number(l.lbp) || 0, Number(l.rate) || 0) > 0);
    if (lines.some((l) => (Number(l.lbp) || 0) > 0 && (Number(l.rate) || 0) <= 0)) { toast.error(t('finance.lbpNeedsRate')); return; }
    if (!lines.length) { toast.error(t('dues.needLines')); return; }
    // D6: a budget with lines but no target units would insert lines and ZERO
    // dues — a silent $0 obligation. Block it.
    if (!preview.length) { toast.error(t('dues.needUnits')); return; }
    // D5: guard against accidentally issuing the same period twice (duplicate
    // obligations). Cancel the existing one first to re-issue.
    if (budgets.some((b) => b.period_start === genStart && b.period_end === genEnd)) {
      toast.error(t('dues.periodExists')); return;
    }
    // D8 (dues audit): the preview's carry was computed from the ledgers loaded
    // when the modal opened. If a payment or charge landed since (another
    // manager, or a resident paying), that carry is stale. Re-read the ledgers
    // now; if anything moved, refresh the preview and make the manager re-confirm
    // rather than silently writing a stale obligation. The no-race case reads
    // identical data and proceeds untouched.
    setSaving(true);
    {
      const blocks = entity.buildingIds;
      const unitSet = new Set(units.map((u) => u.id));
      const sig = (arr: Array<{ created_at: string; voided_at?: string | null }>, amt: 'amount_usd' | 'amount_due') =>
        `${arr.length}|${arr.reduce((sum, x) => sum + Number((x as Record<string, unknown>)[amt] as number || 0), 0)}`
        + `|${arr.reduce((m, x) => (x.created_at > m ? x.created_at : m), '')}|${arr.filter((x) => x.voided_at).length}`;
      const [freshC, freshP, freshA, freshD] = await Promise.all([
        fetchAll<Charge>((f, t) => supabase.from('charges').select('*').in('building_id', blocks).order('id').range(f, t)),
        fetchAll<Payment>((f, t) => supabase.from('payments').select('*').in('building_id', blocks).order('id').range(f, t)),
        fetchAll<Adjustment>((f, t) => supabase.from('adjustments').select('*').in('building_id', blocks).order('id').range(f, t)),
        fetchAll<DuesItem>((f, t) => supabase.from('dues').select('*').in('building_id', blocks).is('converted_at', null).order('id').range(f, t)),
      ]);
      const freshItems = freshD.filter((d) => unitSet.has(d.unit_id));
      const drift =
        sig(charges, 'amount_usd')     !== sig(freshC, 'amount_usd') ||
        sig(payments, 'amount_usd')    !== sig(freshP, 'amount_usd') ||
        sig(adjustments, 'amount_usd') !== sig(freshA, 'amount_usd') ||
        sig(items, 'amount_due')       !== sig(freshItems, 'amount_due');
      if (drift) {
        setCharges(freshC); setPayments(freshP); setAdjustments(freshA); setItems(freshItems);
        setSaving(false);
        toast.error(t('dues.balancesChanged'));
        return;
      }
    }
    // 0125 (audit M3): one transaction — the budget, its lines and its dues
    // land together or not at all. The old three-insert client sequence could
    // half-complete on a dropped connection, leaving a $0 "issued" budget.
    const { error } = await supabase.rpc('issue_budget', {
      p_budget: {
        building_id: entity.kind === 'building' ? entity.id : null,
        compound_id: entity.kind === 'compound' ? entity.id : null,
        label: genPeriod.trim(), period_start: genStart, period_end: genEnd,
        due_date: genDue || null, method: genMethod, billed_to: genBillTo, true_up: genTrueUp,
      },
      p_lines: lines.map((l) => {
        const lbp = Number(l.lbp) || 0;
        return {
          expense_type_id: l.expense_type_id || null, note: l.note.trim() || null,
          amount_usd: composeUsdTotal(Number(l.usd) || 0, lbp, Number(l.rate) || 0),
          amount_lbp: lbp > 0 ? lbp : null, lbp_rate: lbp > 0 ? Number(l.rate) : null,
        };
      }),
      // budget_id/created_by in these rows are ignored — the RPC stamps its own
      p_dues: toRows(preview, genPeriod.trim(), genDue, ''),
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('dues.generated'));
    setGenOpen(false); load();
  }


  async function cancelBudget(b: Budget) {
    // one transaction (0092): withdraw the dues AND mark the budget, or neither
    const { error } = await supabase.rpc('cancel_budget', { p_budget: b.id });
    setConfirmCancelBudget(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('dues.budgetCancelled'));
    load();
  }

  /** D9: best-effort credit that will REMAIN if this budget is cancelled.
   *  Cancelling withdraws the dues but keeps payments (0145) — so any money the
   *  billed parties already paid becomes a standalone unit credit. Payments
   *  aren't linked to specific dues yet (D7), so this is bounded by the budget's
   *  period start and may slightly over-state; it exists only to warn the manager. */
  function budgetPaidCredit(b: Budget): number {
    const rows = items.filter((d) => d.budget_id === b.id);
    const seen = new Set<string>();
    let credit = 0;
    for (const d of rows) {
      const isTenant = d.billed_to === 'tenant';
      const key = `${d.unit_id}|${isTenant ? 'tenant' : 'owner'}|${isTenant ? (d.tenant_id ?? '') : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      credit += payments
        .filter((p) => p.unit_id === d.unit_id && p.paid_on >= b.period_start &&
          (isTenant ? p.paid_by === 'tenant' && (!d.tenant_id || p.tenant_id === d.tenant_id)
                    : p.paid_by !== 'tenant'))
        .reduce((sum, p) => sum + Number(p.amount_usd), 0);
    }
    return credit;
  }

  async function removeItem(id: string) {
    const { error } = await supabase.from('dues').delete().eq('id', id);
    setConfirmDeleteItem(null);
    if (error) { toast.error(error.message); return; }
    load();
  }

  const vItems = items.filter((d) => (!blockFilter || d.building_id === blockFilter) && upTo(d.created_at));
  const unitLabel = (uid: string) => {
    const u = units.find((x) => x.id === uid); if (!u) return '—';
    return multiBlock ? `${blockName[u.building_id] ?? ''} · ${u.label}` : u.label;
  };

  /** What each unit still owes ACROSS every open period.
   *
   *  The table below is per period, and in dues mode the ledger balance answers
   *  a different question — dues never touch it — so without this there is
   *  nowhere to see a unit's actual position. Settlement matches
   *  get_overdue_dues (0082): the party's dues are one running account, billed
   *  since the oldest open row less that party's payments since then, so this
   *  shows exactly what the reminders chase. */
  const owedByUnit = useMemo(() => {
    type Row = { unitId: string; party: Tenure; tenantId: string | null;
                 billed: number; paid: number; owed: number; periods: number };
    const acc = new Map<string, Row & { since: string; dueIds: Set<string> }>();
    for (const d of vItems) {
      const key = `${d.unit_id}|${d.billed_to}|${d.tenant_id ?? ''}`;
      const r = acc.get(key) ?? { unitId: d.unit_id, party: d.billed_to, tenantId: d.tenant_id,
                                  billed: 0, paid: 0, owed: 0, periods: 0, since: d.created_at, dueIds: new Set<string>() };
      r.billed += Number(d.amount_due);
      r.periods += 1;
      r.dueIds.add(d.id);
      if (d.created_at < r.since) r.since = d.created_at;
      acc.set(key, r);
    }
    const out = Array.from(acc.values()).map((r) => {
      // 0147 (D7): directed payments (due_id in this group) settle exactly;
      // undirected ones reconcile through the window. Mirrors get_overdue_dues.
      const paid = payments
        .filter((p) => !p.voided_at && upTo(p.created_at) && (
          p.due_id
            ? r.dueIds.has(p.due_id)
            : p.unit_id === r.unitId && p.created_at >= r.since
              && (r.party === 'tenant'
                ? p.paid_by === 'tenant' && (!r.tenantId || p.tenant_id === r.tenantId)
                : p.paid_by !== 'tenant')))
        .reduce((s, p) => s + Number(p.amount_usd), 0);
      return { ...r, paid, owed: Math.max(0, Math.round((r.billed - paid) * 100) / 100) };
    }).filter((r) => r.owed > 0);
    out.sort((a, b) => (unitLabel(a.unitId)).localeCompare(unitLabel(b.unitId), undefined, { numeric: true })
      || (a.party === 'owner' ? -1 : 1));
    return out;
  }, [vItems, payments, upTo]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Unit + period totals with owner / tenant sub-rows (0070). */
  const duesGroups = useMemo(
    () => buildDuesRows(vItems, units, th, labels),
    [vItems, units, th, labels]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The line label inside a party sub-row: an assessment shows its name. */
  const lineLabel = (d: DuesItem) =>
    d.kind === 'off_budget' ? (d.label || t('dues.offBudget')) : t('dues.recurringLine');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('dues.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('dues.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity selection moved to the sidebar (global). Block drill-down stays local. */}
          {entity?.kind === 'compound' && multiBlock && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={(v) => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {entity.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
          )}
          {/* No standing plan any more: every issuance IS the plan (0087).
              Issuing stays blocked in arrears mode — get_overdue_dues() only
              reminds on 'dues' buildings. */}
          {canManage && entity && duesMode && <Button variant="tinted" onClick={openBudget}><Plus size={16} /> {t('dues.newBudget')}</Button>}
        </div>
      </div>

      {entity && entity.billingMode !== 'dues' && (
        <Card className="mb-4 border-amber-500/25 bg-amber-500/[0.06]"><CardBody>
          <div className="flex items-start gap-2.5 text-sm">
            <Info size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <div>
              <p className="font-medium text-foreground">
                {t('dues.arrearsNote1', { kind: t(`register.nouns.${entity.kind}`, { defaultValue: entity.kind }) })}{' '}
                <Link to="/buildings" className="text-primary underline underline-offset-2">{t('nav.buildings')}</Link>{' '}
                {t('dues.arrearsNote2')}
              </p>
              <p className="mt-1.5 text-muted-foreground">
                {t('dues.arrearsBlocked')}{' '}
                {t('dues.arrearsOneOff')}{' '}
                <Link to="/finance" className="text-primary underline underline-offset-2">{t('nav.finance')}</Link>.
              </p>
            </div>
          </div>
        </CardBody></Card>
      )}

      {!entity ? <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{entities.length ? t('common.pickEntity') : t('finance.noBuildings')}</p></CardBody></Card>
        : (
          <>
            {budgets.length > 0 && (
              <Card className="mb-4"><CardBody>
                <p className="text-sm font-semibold text-foreground mb-2">{t('dues.issuedBudgets')}</p>
                <div className="divide-y divide-border/60">
                  {budgets.map((b) => {
                    const issued = items.filter((d) => d.budget_id === b.id)
                      .reduce((s, d) => s + Number(d.amount_due), 0);
                    return (
                      <div key={b.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="text-foreground min-w-0">
                          {b.label}
                          <span className="text-muted-foreground/70"> · {fmtDate(b.period_start, 'MMM d')} – {fmtDate(b.period_end, 'MMM d, yyyy')}</span>
                          {b.expense_id && <span className="ms-1.5 text-xs text-amber-600 dark:text-amber-400">{t('finance.extraordinaryTag')}</span>}
                        </span>
                        <span className="flex items-center gap-3 shrink-0">
                          <span className="font-semibold text-foreground tnum">{money(Math.round(issued * 100) / 100)}</span>
                          {canManage && (
                            <button onClick={() => setConfirmCancelBudget(b)} className="text-xs text-primary hover:text-rose-600 hover:underline cursor-pointer">
                              {t('dues.cancelBudget')}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardBody></Card>
            )}
            <div className="flex items-center justify-end gap-2 mb-3">
              <label className="text-xs text-muted-foreground">{t('dues.asOfLabel')}</label>
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
                className="rounded-lg border border-border bg-background text-foreground px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
              {asOf && (
                <button onClick={() => setAsOf('')} className="text-xs text-primary hover:underline cursor-pointer">
                  {t('finance.backToLive')}
                </button>
              )}
            </div>
            {!loading && owedByUnit.length > 0 && (
              <Card className="mb-4"><CardBody>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-sm font-semibold text-foreground">
                    {t('dues.owedTitle')}
                    {asOf && <span className="text-muted-foreground font-normal"> · {t('finance.asOf', { date: fmtDate(asOf, 'MMM d, yyyy') })}</span>}
                  </p>
                  <p className="text-sm font-semibold text-foreground tnum">
                    {money(owedByUnit.reduce((s, r) => s + r.owed, 0))}
                  </p>
                </div>
                <div className="space-y-1.5">
                  {owedByUnit.map((r) => (
                    <div key={`${r.unitId}|${r.party}|${r.tenantId ?? ''}`}
                         className="flex items-center justify-between text-sm gap-3">
                      <span className="text-foreground min-w-0">
                        {unitLabel(r.unitId)}
                        <span className="text-muted-foreground/70">
                          {' · '}
                          {r.party === 'owner'
                            ? labels.owner
                            : tenantTitle(
                                r.tenantId && r.tenantId === th.activeTenantId(r.unitId) ? labels.tenant : labels.formerTenant,
                                r.tenantId ? th.nameById(r.tenantId) : null)}
                          {r.periods > 1 && ` · ${t('dues.acrossPeriods', { count: r.periods })}`}
                          {r.paid > 0 && ` · ${t('dues.paidSoFar', { amount: money(r.paid) })}`}
                        </span>
                      </span>
                      <span className="font-semibold text-foreground tnum shrink-0">{money(r.owed)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-3">{t('dues.owedHint')}</p>
              </CardBody></Card>
            )}
            {loading ? <SkeletonTable rows={5} cols={6} />
              : vItems.length === 0 ? <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{t('dues.noDues')}</p></CardBody></Card>
              : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('dues.period')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('dues.unit')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('dues.base')}</th>
                    {!isB2 && <th className="px-5 py-3 text-end font-medium">{t('dues.carry')}</th>}
                    <th className="px-5 py-3 text-end font-medium">{t('dues.amountDue')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('dues.dueDate')}</th>
                    {canManage && <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-border/60">
                    {duesGroups.map((g) => {
                      const open = expanded[g.key] ?? false;
                      const single = g.parties.length === 1 && g.parties[0].lines.length === 1;
                      const cols = 4 + (isB2 ? 0 : 1) + (canManage ? 1 : 0);
                      return (
                        <Fragment key={g.key}>
                          <tr className={`hover:bg-secondary/40 ${g.split ? 'cursor-pointer' : ''}`}
                              onClick={() => g.split && setExpanded((s) => ({ ...s, [g.key]: !open }))}>
                            <td className="px-5 py-3 text-muted-foreground">{g.periodLabel}</td>
                            <td className="px-5 py-3 font-semibold text-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                {g.split && (
                                  <ChevronRight size={14}
                                    className={`text-muted-foreground transition-transform ${open ? 'rotate-90' : ''} rtl:-scale-x-100`} />
                                )}
                                {unitLabel(g.unitId)}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-end text-muted-foreground tnum">{money(g.base)}</td>
                            {!isB2 && <td className={`px-5 py-3 text-end tnum ${carryTone(g.carry)}`}>{money(g.carry)}</td>}
                            <td className="px-5 py-3 text-end font-semibold text-foreground tnum">{money(g.due)}</td>
                            <td className="px-5 py-3 text-muted-foreground">{g.dueDate ? fmtDate(g.dueDate, 'MMM d, yyyy') : '—'}</td>
                            {canManage && (
                              <td className="px-5 py-3 text-end">
                                {single && (
                                  <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteItem(g.parties[0].lines[0].id); }}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer">
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>

                          {g.split && open && g.parties.map((p) => (
                            <Fragment key={`${g.key}|${p.key}`}>
                              <tr className="bg-secondary/30 text-xs">
                                <td className="px-5 py-2" />
                                <td className="px-5 py-2 ps-10 text-foreground/90">
                                  <span className="font-medium">{p.title}</span>
                                  {p.isFormer && <span className="ms-1.5 text-muted-foreground/70">({t('dues.formerNote')})</span>}
                                </td>
                                <td className="px-5 py-2 text-end text-muted-foreground tnum">{money(p.base)}</td>
                                {!isB2 && <td className={`px-5 py-2 text-end tnum ${carryTone(p.carry)}`}>{money(p.carry)}</td>}
                                <td className="px-5 py-2 text-end font-semibold text-foreground tnum">{money(p.due)}</td>
                                <td className="px-5 py-2" />
                                {canManage && <td className="px-5 py-2" />}
                              </tr>
                              {/* individual lines only when a party has more than one (recurring + assessment) */}
                              {p.lines.length > 1 && p.lines.map((d) => (
                                <tr key={d.id} className="bg-secondary/10 text-xs">
                                  <td className="px-5 py-1.5" />
                                  <td className="px-5 py-1.5 ps-16 text-muted-foreground">{lineLabel(d)}</td>
                                  <td className="px-5 py-1.5 text-end text-muted-foreground tnum">{money(Number(d.base_amount))}</td>
                                  {!isB2 && <td className="px-5 py-1.5" />}
                                  <td className="px-5 py-1.5 text-end text-muted-foreground tnum">{money(Number(d.amount_due))}</td>
                                  <td className="px-5 py-1.5" />
                                  {canManage && (
                                    <td className="px-5 py-1.5 text-end">
                                      <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteItem(d.id); }}
                                        className="p-1 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer">
                                        <Trash2 size={13} />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                              {p.lines.length === 1 && canManage && (
                                <tr className="bg-secondary/10">
                                  <td className="px-5 py-1" colSpan={cols - 1} />
                                  <td className="px-5 py-1 text-end">
                                    <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteItem(p.lines[0].id); }}
                                      className="p-1 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer">
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table></div></Card>
              )}
          </>
        )}

      {/* New budget (0087): there is no plan — the LINES are the plan. */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title={t('dues.newBudget')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.budgetLabel')} value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} placeholder={t('dues.periodPlaceholder')} />
            <Input label={t('dues.dueDate')} type="date" value={genDue} onChange={(e) => setGenDue(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.periodFrom')} type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} />
            <Input label={t('dues.periodTo')} type="date" value={genEnd} onChange={(e) => setGenEnd(e.target.value)} />
          </div>

          {/* ── the budget itself: one row per expense type ── */}
          <div>
            <label className="text-sm font-medium text-foreground">{t('dues.budgetLines')}</label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">{t('dues.budgetLinesHint')}</p>
            <div className="space-y-1.5">
              {budLines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_6rem_5rem_auto] gap-1.5 items-center">
                  <select value={l.expense_type_id}
                    onChange={(e) => setBudLines(budLines.map((x, j) => j === i ? { ...x, expense_type_id: e.target.value } : x))}
                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40">
                    <option value="">{t('dues.pickType')}</option>
                    {activeTypes.map((ty) => <option key={ty.id} value={ty.id}>{ty.key ? t(`finance.cats.${ty.key}`) : ty.name}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0" placeholder="USD" value={l.usd}
                    onChange={(e) => setBudLines(budLines.map((x, j) => j === i ? { ...x, usd: e.target.value } : x))}
                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm text-end focus:outline-none focus:ring-2 focus:ring-ring/40" />
                  <input type="number" step="1" min="0" placeholder="LBP" value={l.lbp}
                    onChange={(e) => setBudLines(budLines.map((x, j) => j === i ? { ...x, lbp: e.target.value, rate: x.rate || prefillRate } : x))}
                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm text-end focus:outline-none focus:ring-2 focus:ring-ring/40" />
                  <input type="number" step="0.01" min="0" placeholder={t('dues.rateShort')} value={l.rate}
                    onChange={(e) => setBudLines(budLines.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))}
                    disabled={!(Number(l.lbp) > 0)}
                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1.5 text-sm text-end focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-40" />
                  <button type="button" onClick={() => setBudLines(budLines.filter((_, j) => j !== i))}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button type="button"
                onClick={() => setBudLines([...budLines, { expense_type_id: '', note: '', usd: '', lbp: '', rate: prefillRate }])}
                className="text-xs text-primary hover:underline cursor-pointer">
                + {t('dues.addLine')}
              </button>
              <p className="text-sm text-muted-foreground">
                {t('dues.budgetTotal')}: <span className="font-semibold text-foreground tnum">{money(Math.round(budgetTotal * 100) / 100)}</span>
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('dues.scope')} value={genScope} onValueChange={(v) => setGenScope(v as 'all' | 'group' | 'units')}>
              <SelectItem value="all">{t('dues.scopeAll')}</SelectItem>
              {groups.length > 0 && <SelectItem value="group">{t('dues.scopeGroup')}</SelectItem>}
              <SelectItem value="units">{t('dues.scopeUnits')}</SelectItem>
            </SelectField>
            <SelectField label={t('dues.method')} value={genMethod} onValueChange={(v) => setGenMethod(v as DuesMethod)}>
              {METHODS.map((m) => <SelectItem key={m} value={m}>{t(`dues.methods.${m}`)}</SelectItem>)}
            </SelectField>
          </div>
          {genScope === 'group' && (
            <SelectField label={t('dues.group')} value={genGroupId} onValueChange={setGenGroupId}>
              {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectField>
          )}
          {genScope === 'units' && (
            <div>
              <label className="text-sm font-medium text-foreground">{t('dues.pickUnits')}</label>
              <div className="mt-1.5 max-h-40 overflow-y-auto border border-border rounded-xl divide-y divide-border/60">
                {units.filter((u) => !blockFilter || u.building_id === blockFilter).map((u) => (
                  <label key={u.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer">
                    <input type="checkbox" className="accent-primary"
                      checked={genUnitIds.includes(u.id)}
                      onChange={(e) => setGenUnitIds((prev) =>
                        e.target.checked ? [...prev, u.id] : prev.filter((x) => x !== u.id))} />
                    <span className="text-foreground">{unitLabel(u.id)}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('dues.pickUnitsHint', { count: genUnitIds.length })}</p>
            </div>
          )}
          <div>
            <SelectField label={t('dues.billTo')} value={genBillTo} onValueChange={(v) => setGenBillTo(v as OffBudgetBillTo)}>
              <SelectItem value="tenant_where_leased">{t('dues.billToTenant')}</SelectItem>
              <SelectItem value="owner">{t('dues.billToOwner')}</SelectItem>
            </SelectField>
            <p className="text-xs text-muted-foreground mt-1">
              {genBillTo === 'owner' ? t('dues.billToOwnerHint') : t('dues.billToTenantHint')}
            </p>
          </div>
          {genMethod === 'custom' && (
            <div>
              <label className="text-sm font-medium text-foreground">{t('dues.customAmounts')}</label>
              <div className="mt-1.5 max-h-40 overflow-y-auto border border-border rounded-xl divide-y divide-border/60">
                {genUnits.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-foreground truncate">{unitLabel(u.id)}</span>
                    <input type="number" step="0.01" min="0" value={genCustom[u.id] ?? ''} placeholder="0.00"
                      onChange={(e) => setGenCustom({ ...genCustom, [u.id]: e.target.value })}
                      className="w-28 text-end rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {!isB2 && (
            <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-border p-3">
              <input type="checkbox" checked={genTrueUp} onChange={(e) => setGenTrueUp(e.target.checked)}
                className="mt-0.5 accent-primary" />
              <span>
                <span className="text-sm font-medium text-foreground">{t('dues.applyTrueUp')}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {genTrueUp ? t('dues.trueUpOnHint') : t('dues.trueUpOffHint')}
                </span>
              </span>
            </label>
          )}
          <p className="text-xs text-muted-foreground">{isB2 ? t('dues.flatFeeNote') : (genTrueUp ? t('dues.reconcileNote') : t('dues.flatAskNote'))}</p>
          <GenPreview rows={preview} isB2={isB2} unitLabel={unitLabel} th={th} labels={labels} t={t} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setGenOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={issueBudget} loading={saving} disabled={!genPeriod.trim() || !genStart || !genEnd || preview.length === 0}>{t('dues.issueBudget')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmCancelBudget} onClose={() => setConfirmCancelBudget(null)}
        onConfirm={() => confirmCancelBudget && cancelBudget(confirmCancelBudget)}
        title={t('dues.cancelBudgetTitle')}
        message={confirmCancelBudget
          ? t('dues.cancelBudgetConfirm', { label: confirmCancelBudget.label })
            + (budgetPaidCredit(confirmCancelBudget) > 0
                ? ' ' + t('dues.cancelBudgetPaidWarn', { amount: money(budgetPaidCredit(confirmCancelBudget)) })
                : '')
          : ''}
        confirmLabel={t('dues.cancelBudgetTitle')}
      />
      <ConfirmModal
        open={!!confirmDeleteItem} onClose={() => setConfirmDeleteItem(null)}
        onConfirm={() => confirmDeleteItem && removeItem(confirmDeleteItem)}
        title={t('dues.deleteItemTitle')} message={t('dues.deleteItemConfirm')}
        confirmLabel={t('common.delete')}
      />
    </div>
  );
}

/** Generation preview — grouped by unit with the same owner / tenant sub-rows
 *  the Dues table shows, so the manager sees exactly what will be written. */
function GenPreview({ rows, isB2, unitLabel, th, labels, t }: {
  rows: DuesGenRow[]; isB2: boolean; unitLabel: (id: string) => string;
  th: ReturnType<typeof tenancyHelpers>; labels: { owner: string; tenant: string; formerTenant: string };
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const byUnit = useMemo(() => {
    const m = new Map<string, { unitId: string; total: number; lines: DuesGenRow[] }>();
    for (const r of rows) {
      let g = m.get(r.unit.id);
      if (!g) { g = { unitId: r.unit.id, total: 0, lines: [] }; m.set(r.unit.id, g); }
      g.lines.push(r);
      g.total = Math.round((g.total + r.due) * 100) / 100;
    }
    return Array.from(m.values());
  }, [rows]);

  const lineTitle = (r: DuesGenRow) => {
    if (r.party === 'owner') {
      return r.kind === 'off_budget' ? `${labels.owner} · ${r.label ?? t('dues.offBudget')}` : labels.owner;
    }
    const name = r.tenantId ? th.nameById(r.tenantId) : null;
    return `${labels.tenant}${name ? ` · ${name}` : ''}`;
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 bg-secondary/50 text-xs font-medium text-muted-foreground">
        {t('dues.amountDue')}: {t('dues.unitsCount', { count: byUnit.length })}
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-border/60">
        {byUnit.map((g) => (
          <div key={g.unitId} className="px-3 py-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-foreground font-medium">{unitLabel(g.unitId)}</span>
              <span className="font-semibold text-foreground tnum">{money(g.total)}</span>
            </div>
            {g.lines.map((r, i) => (
              <div key={i} className="flex items-center justify-between ps-4 text-xs text-muted-foreground">
                <span>{lineTitle(r)}</span>
                <span className="tnum">
                  {isB2
                    ? money(r.due)
                    : <>{money(r.base)}{r.carry !== 0 && <> {r.carry < 0 ? '−' : '+'} {money(Math.abs(r.carry))}</>} = <span className="font-semibold text-foreground">{money(r.due)}</span></>}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

