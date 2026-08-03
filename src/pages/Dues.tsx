import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, Wallet, Settings2, Trash2, Info, ChevronRight, Receipt, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { computeUnitBalances } from '@/lib/balance';
import { useEntities } from '@/lib/entities';
import {
  tenancyHelpers, buildDuesRows, computeDuesGeneration,
  type TenancyRow, type DuesGenRow, type OffBudgetSpec, type OffBudgetBillTo,
} from '@/lib/reportData';
import type { Unit, Charge, Payment, Adjustment, DuesPlan, Dues as DuesItem, DuesCadence, DuesMethod, DuesPlanType, Tenure } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/ui/Skeleton';

const CADENCES: DuesCadence[] = ['monthly', 'quarterly', 'semiannual', 'annual'];
const METHODS: DuesMethod[] = ['by_shares', 'equal', 'custom'];
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const [plan, setPlan] = useState<DuesPlan | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [ownerCustomAmounts, setOwnerCustomAmounts] = useState<Record<string, string>>({});
  const [items, setItems] = useState<DuesItem[]>([]);
  // ended memberships included, so a unit whose tenant left still resolves that
  // tenant's name on their historical dues rows (0070)
  const [tenancy, setTenancy] = useState<TenancyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // plan form
  const [planOpen, setPlanOpen] = useState(false);
  const [pCadence, setPCadence] = useState<DuesCadence>('quarterly');
  const [pMethod, setPMethod] = useState<DuesMethod>('by_shares');
  const [pPool, setPPool] = useState('');
  const [pOwnerPool, setPOwnerPool] = useState('');
  const [pCustom, setPCustom] = useState<Record<string, string>>({});
  const [pOwnerCustom, setPOwnerCustom] = useState<Record<string, string>>({});
  const [pPlanType, setPPlanType] = useState<DuesPlanType>('b1');
  const [saving, setSaving] = useState(false);

  // generate form
  const [genOpen, setGenOpen] = useState(false);
  const [genPeriod, setGenPeriod] = useState('');
  const [genDue, setGenDue] = useState(new Date().toISOString().slice(0, 10));

  // special charge (C13) — one-time, allocated across units, off the plan cycle
  const [obOpen, setObOpen] = useState(false);
  const [obLabel, setObLabel] = useState('');
  const [obBillTo, setObBillTo] = useState<OffBudgetBillTo>('owner');
  const [obMethod, setObMethod] = useState<DuesMethod>('by_shares');
  const [obTotal, setObTotal] = useState('');
  const [obCustom, setObCustom] = useState<Record<string, string>>({});
  const [obPeriod, setObPeriod] = useState('');
  const [obDue, setObDue] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { if (entity) load(); }, [entityKey, entities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity) return;
    setLoading(true);
    const blocks = entity.buildingIds;
    const planQ = entity.kind === 'compound'
      ? supabase.from('dues_plans').select('*').eq('compound_id', entity.id).maybeSingle()
      : supabase.from('dues_plans').select('*').eq('building_id', entity.id).maybeSingle();
    const [{ data: u }, { data: c }, { data: p }, { data: pl }, { data: a }] = await Promise.all([
      supabase.from('units').select('*').in('building_id', blocks).order('label'),
      supabase.from('charges').select('*').in('building_id', blocks),
      supabase.from('payments').select('*').in('building_id', blocks),
      planQ,
      supabase.from('adjustments').select('*').in('building_id', blocks),
    ]);
    setUnits((u as Unit[]) ?? []);
    setCharges((c as Charge[]) ?? []);
    setPayments((p as Payment[]) ?? []);
    setAdjustments((a as Adjustment[]) ?? []);
    const planRow = (pl as DuesPlan) ?? null;
    setPlan(planRow);
    const ids = ((u as Unit[]) ?? []).map((x) => x.id);
    if (ids.length) {
      const [{ data: d }, { data: mem }] = await Promise.all([
        supabase.from('dues').select('*').in('building_id', blocks).order('created_at', { ascending: false }),
        supabase.from('memberships').select('unit_id, user_id, tenure, created_at, ended_at, profiles(full_name)').in('unit_id', ids),
      ]);
      setItems((d as DuesItem[]) ?? []);
      setTenancy((mem as unknown as TenancyRow[]) ?? []);
    } else { setItems([]); setTenancy([]); }
    if (planRow && planRow.method === 'custom') {
      const { data: ca } = await supabase.from('dues_unit_amounts').select('unit_id, amount, owner_amount').eq('plan_id', planRow.id);
      const rows = (ca as { unit_id: string; amount: number; owner_amount: number }[]) ?? [];
      setCustomAmounts(Object.fromEntries(rows.map((r) => [r.unit_id, String(r.amount)])));
      setOwnerCustomAmounts(Object.fromEntries(rows.map((r) => [r.unit_id, String(r.owner_amount ?? 0)])));
    } else { setCustomAmounts({}); setOwnerCustomAmounts({}); }
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

  /** Carry-in already applied in OUTSTANDING dues for this unit+party.
   *
   *  Dues never move the balance ledger, so arrears stay on the books after a
   *  due is issued and the next generation would bill them again: 1East owing
   *  796.08 was asked 250+796.08 on one special charge and 250+796.08 on the
   *  next — 2,092.16 against a real 1,296.08.
   *
   *  Only the CARRY portion is netted off, not the whole outstanding amount:
   *  that figure also contains the earlier row's own base, which is a separate
   *  amount still genuinely owed. Paying clears the row and moves the balance,
   *  so the carry comes back into play by itself. */
  const carryApplied = useMemo(() => {
    const paidSince = (unitId: string, party: Tenure, since: string, tenantId: string | null) =>
      payments
        .filter((p) => p.unit_id === unitId && !p.voided_at && p.created_at >= since
          && (party === 'tenant'
            ? p.paid_by === 'tenant' && (!tenantId || p.tenant_id === tenantId)
            : p.paid_by !== 'tenant'))
        .reduce((s, p) => s + Number(p.amount_usd), 0);
    return (unitId: string, party: Tenure) =>
      items
        .filter((d) => d.unit_id === unitId && d.billed_to === party)
        .filter((d) => Number(d.amount_due) - paidSince(unitId, party, d.created_at, d.tenant_id) > 0)
        .reduce((s, d) => s + Number(d.carry_in), 0);
  }, [items, payments]);

  function openPlan() {
    if (plan) {
      setPCadence(plan.cadence); setPMethod(plan.method);
      setPPool(plan.pool_amount != null ? String(plan.pool_amount) : '');
      setPOwnerPool(plan.owner_pool_amount ? String(plan.owner_pool_amount) : '');
      setPCustom(customAmounts); setPOwnerCustom(ownerCustomAmounts); setPPlanType(plan.plan_type ?? 'b1');
    } else {
      setPCadence('quarterly'); setPMethod('by_shares'); setPPool(''); setPOwnerPool('');
      setPCustom({}); setPOwnerCustom({}); setPPlanType('b1');
    }
    setPlanOpen(true);
  }

  async function savePlan() {
    if (!entity) return;
    setSaving(true);
    const payload = {
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      cadence: pCadence, method: pMethod,
      pool_amount: pMethod === 'custom' ? null : (Number(pPool) || 0),
      owner_pool_amount: pMethod === 'custom' ? 0 : (Number(pOwnerPool) || 0),
      plan_type: pPlanType, active: true,
    };
    let planId = plan?.id;
    if (plan) await supabase.from('dues_plans').update(payload).eq('id', plan.id);
    else { const { data } = await supabase.from('dues_plans').insert(payload).select().single(); planId = (data as DuesPlan)?.id; }
    if (planId && pMethod === 'custom') {
      await supabase.from('dues_unit_amounts').delete().eq('plan_id', planId);
      const rows = units.map((u) => ({
        plan_id: planId, unit_id: u.id,
        amount: Number(pCustom[u.id]) || 0,
        owner_amount: Number(pOwnerCustom[u.id]) || 0,
      }));
      if (rows.length) await supabase.from('dues_unit_amounts').insert(rows);
    }
    toast.success(t('dues.planSaved'));
    setSaving(false); setPlanOpen(false); load();
  }

  const isB2 = plan?.plan_type === 'b2';

  const genPlan = useMemo(() => ({
    method: (plan?.method ?? 'by_shares') as DuesMethod,
    planType: (plan?.plan_type ?? 'b1') as DuesPlanType,
    poolAmount: Number(plan?.pool_amount) || 0,
    ownerPoolAmount: Number(plan?.owner_pool_amount) || 0,
    custom: num(customAmounts),
    ownerCustom: num(ownerCustomAmounts),
  }), [plan, customAmounts, ownerCustomAmounts]);

  /** Preview and insert come from the same pure call, so what the manager sees
   *  is exactly what gets written. */
  const preview = useMemo(() => {
    if (!plan) return [];
    return computeDuesGeneration({
      units, plan: genPlan, balances: balanceOf,
      activeTenantId: th.activeTenantId,
      carryApplied,
      includeRecurring: true,
    });
  }, [plan, units, genPlan, balanceOf, th, genPeriod, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const obSpec: OffBudgetSpec | null = useMemo(() => (
    obLabel.trim()
      ? { label: obLabel.trim(), method: obMethod, total: Number(obTotal) || 0, custom: num(obCustom), billTo: obBillTo }
      : null
  ), [obLabel, obMethod, obTotal, obCustom, obBillTo]);

  const obPreview = useMemo(() => {
    if (!plan || !obSpec) return [];
    return computeDuesGeneration({
      units, plan: genPlan, balances: balanceOf,
      activeTenantId: th.activeTenantId,
      carryApplied,
      includeRecurring: false,
      offBudget: obSpec,
    });
  }, [plan, units, genPlan, balanceOf, th, obPeriod, obSpec, items]); // eslint-disable-line react-hooks/exhaustive-deps

  function toRows(gen: DuesGenRow[], period: string, due: string) {
    return gen.map((r) => ({
      plan_id: plan?.id ?? null, building_id: r.unit.building_id, unit_id: r.unit.id,
      period_label: period, due_date: due || null,
      base_amount: r.base, carry_in: r.carry, amount_due: r.due,
      billed_to: r.party, tenant_id: r.tenantId, kind: r.kind, label: r.label,
      created_by: profile?.id,
    }));
  }

  async function generate() {
    if (!entity || !plan || !genPeriod.trim()) return;
    setSaving(true);
    const rows = toRows(preview, genPeriod.trim(), genDue);
    if (rows.length) { const { error } = await supabase.from('dues').insert(rows); if (error) { toast.error(error.message); setSaving(false); return; } }
    toast.success(t('dues.generated'));
    setSaving(false); setGenOpen(false); load();
  }

  async function generateOffBudget() {
    if (!entity || !plan || !obSpec || !obPeriod.trim()) return;
    setSaving(true);
    const rows = toRows(obPreview, obPeriod.trim(), obDue);
    if (rows.length) { const { error } = await supabase.from('dues').insert(rows); if (error) { toast.error(error.message); setSaving(false); return; } }
    toast.success(t('dues.generated'));
    setSaving(false); setObOpen(false);
    setObLabel(''); setObTotal(''); setObCustom({});
    load();
  }

  async function removeItem(id: string) {
    if (!confirm('Delete this dues item?')) return;
    await supabase.from('dues').delete().eq('id', id);
    load();
  }

  const vItems = items.filter((d) => !blockFilter || d.building_id === blockFilter);
  const unitLabel = (uid: string) => {
    const u = units.find((x) => x.id === uid); if (!u) return '—';
    return multiBlock ? `${blockName[u.building_id] ?? ''} · ${u.label}` : u.label;
  };

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
          {/* Editing the plan stays open in arrears mode - configuring one before
              flipping the switch is legitimate. ISSUING is what gets blocked:
              get_overdue_dues() only reminds on 'dues' buildings, so dues raised
              here would notify residents and then never be chased. */}
          {canManage && entity && <Button variant="secondary" onClick={openPlan}><Settings2 size={16} /> {plan ? t('dues.editPlan') : t('dues.setupPlan')}</Button>}
          {canManage && entity && plan && duesMode && <Button variant="secondary" onClick={() => { setObPeriod(''); setObOpen(true); }}><Receipt size={16} /> {t('dues.offBudgetAction')}</Button>}
          {canManage && entity && plan && duesMode && <Button onClick={() => { setGenPeriod(''); setGenOpen(true); }}><Plus size={16} /> {t('dues.generate')}</Button>}
        </div>
      </div>

      {entity && entity.billingMode !== 'dues' && (
        <Card className="mb-4"><CardBody>
          <p className="text-sm text-amber-600 dark:text-amber-400 flex items-start gap-2">
            <Info size={15} className="shrink-0 mt-0.5" />
            <span>
              {t('dues.arrearsNote1', { kind: t(`register.nouns.${entity.kind}`, { defaultValue: entity.kind }) })}{' '}
              <Link to="/buildings" className="underline">{t('nav.buildings')}</Link>{' '}
              {t('dues.arrearsNote2')}
              <span className="block mt-1.5 text-muted-foreground">
                {t('dues.arrearsBlocked')}{' '}
                {t('dues.arrearsOneOff')}{' '}
                <Link to="/finance" className="underline">{t('nav.finance')}</Link>.
              </span>
            </span>
          </p>
        </CardBody></Card>
      )}

      {!entity ? <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{entities.length ? t('common.pickEntity') : t('finance.noBuildings')}</p></CardBody></Card>
        : !plan ? (
          <Card><CardBody><div className="text-center py-10">
            <Wallet className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground mb-3">{t('dues.noPlan')}</p>
            {canManage && <Button variant="secondary" size="sm" onClick={openPlan}>{t('dues.setupPlan')}</Button>}
          </div></CardBody></Card>
        ) : (
          <>
            <Card className="mb-4"><CardBody>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isB2 ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}>{t(`dues.planTypes.${plan.plan_type ?? 'b1'}`)}</span>
                <span className="text-slate-500">{t('dues.cadence')}: <span className="font-medium text-slate-800">{t(`dues.cadences.${plan.cadence}`)}</span></span>
                <span className="text-slate-500">{t('dues.method')}: <span className="font-medium text-slate-800">{t(`dues.methods.${plan.method}`)}</span></span>
                {plan.pool_amount != null && <span className="text-slate-500">{t('dues.pool')}: <span className="font-medium text-slate-800 tnum">{money(Number(plan.pool_amount))}</span></span>}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{isB2 ? t('dues.flatFeeNote') : t('dues.reconcileNote')}</p>
            </CardBody></Card>

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
                                  <button onClick={(e) => { e.stopPropagation(); removeItem(g.parties[0].lines[0].id); }}
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
                                      <button onClick={(e) => { e.stopPropagation(); removeItem(d.id); }}
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
                                    <button onClick={(e) => { e.stopPropagation(); removeItem(p.lines[0].id); }}
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

      {/* Plan modal */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title={plan ? t('dues.editPlan') : t('dues.setupPlan')} size="lg">
        <div className="space-y-4">
          <SelectField label={t('dues.planType')} value={pPlanType} onValueChange={(v) => setPPlanType(v as DuesPlanType)}>
            <SelectItem value="b1">{t('dues.planTypes.b1')}</SelectItem>
            <SelectItem value="b2">{t('dues.planTypes.b2')}</SelectItem>
          </SelectField>
          <p className="text-xs text-muted-foreground -mt-2">{pPlanType === 'b2' ? t('dues.flatFeeNote') : t('dues.reconcileNote')}</p>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('dues.cadence')} value={pCadence} onValueChange={(v) => setPCadence(v as DuesCadence)}>
              {CADENCES.map((c) => <SelectItem key={c} value={c}>{t(`dues.cadences.${c}`)}</SelectItem>)}
            </SelectField>
            <SelectField label={t('dues.method')} value={pMethod} onValueChange={(v) => setPMethod(v as DuesMethod)}>
              {METHODS.map((m) => <SelectItem key={m} value={m}>{t(`dues.methods.${m}`)}</SelectItem>)}
            </SelectField>
          </div>
          {pMethod !== 'custom'
            ? (
              <div className="space-y-3">
                <div>
                  <Input label={t('dues.pool')} type="number" step="0.01" min="0" value={pPool} onChange={(e) => setPPool(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">{t('dues.poolPartyHint')}</p>
                </div>
                <div>
                  <Input label={t('dues.ownerPool')} type="number" step="0.01" min="0" value={pOwnerPool} onChange={(e) => setPOwnerPool(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">{t('dues.ownerPoolHint')}</p>
                </div>
              </div>
            )
            : (
              <div>
                <label className="text-sm font-medium text-foreground">{t('dues.customAmounts')}</label>
                <p className="text-xs text-muted-foreground mt-0.5">{t('dues.customPartyHint')}</p>
                <div className="mt-1.5 max-h-56 overflow-y-auto border border-border rounded-xl divide-y divide-border/60">
                  <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground uppercase tracking-wide">
                    <span>{t('dues.unit')}</span>
                    <span className="flex gap-2">
                      <span className="w-28 text-end">{t('dues.tenantColumn')}</span>
                      <span className="w-28 text-end">{t('dues.ownerColumn')}</span>
                    </span>
                  </div>
                  {units.map((u) => (
                    <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-sm gap-2">
                      <span className="text-foreground truncate">{unitLabel(u.id)}</span>
                      <span className="flex gap-2 shrink-0">
                        <input type="number" step="0.01" min="0" value={pCustom[u.id] ?? ''} placeholder="0.00"
                          onChange={(e) => setPCustom({ ...pCustom, [u.id]: e.target.value })}
                          className="w-28 text-end rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        <input type="number" step="0.01" min="0" value={pOwnerCustom[u.id] ?? ''} placeholder="0.00"
                          onChange={(e) => setPOwnerCustom({ ...pOwnerCustom, [u.id]: e.target.value })}
                          className="w-28 text-end rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPlanOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={savePlan} loading={saving}>{t('dues.savePlan')}</Button>
          </div>
        </div>
      </Modal>

      {/* Generate modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title={t('dues.generateTitle')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.period')} value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} placeholder={t('dues.periodPlaceholder')} />
            <Input label={t('dues.dueDate')} type="date" value={genDue} onChange={(e) => setGenDue(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">{isB2 ? t('dues.flatFeeNote') : t('dues.reconcileNote')}</p>
          <GenPreview rows={preview} isB2={isB2} unitLabel={unitLabel} th={th} labels={labels} t={t} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setGenOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={generate} loading={saving} disabled={!genPeriod.trim()}>{t('dues.generate')}</Button>
          </div>
        </div>
      </Modal>

      {/* Special charge (C13) — one-time, owner-only, allocated across units.
          The name is generic, so the owner-only rule is stated in the modal
          rather than left to be inferred. */}
      <Modal open={obOpen} onClose={() => setObOpen(false)} title={t('dues.offBudgetTitle')} size="lg">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('dues.offBudgetNote')}</p>
          <div>
            <SelectField label={t('dues.offBudgetBillTo')} value={obBillTo} onValueChange={(v) => setObBillTo(v as OffBudgetBillTo)}>
              <SelectItem value="owner">{t('dues.billToOwner')}</SelectItem>
              <SelectItem value="tenant_where_leased">{t('dues.billToTenant')}</SelectItem>
            </SelectField>
            <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
              <User size={13} className="shrink-0 mt-0.5" />
              <span>{obBillTo === 'owner' ? t('dues.billToOwnerHint') : t('dues.billToTenantHint')}</span>
            </p>
          </div>
          <Input label={t('dues.offBudgetLabel')} value={obLabel} onChange={(e) => setObLabel(e.target.value)} placeholder={t('dues.offBudgetPlaceholder')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.period')} value={obPeriod} onChange={(e) => setObPeriod(e.target.value)} placeholder={t('dues.periodPlaceholder')} />
            <Input label={t('dues.dueDate')} type="date" value={obDue} onChange={(e) => setObDue(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('dues.method')} value={obMethod} onValueChange={(v) => setObMethod(v as DuesMethod)}>
              {METHODS.map((m) => <SelectItem key={m} value={m}>{t(`dues.methods.${m}`)}</SelectItem>)}
            </SelectField>
            {obMethod !== 'custom' && (
              <Input label={t('dues.offBudgetTotal')} type="number" step="0.01" min="0" value={obTotal} onChange={(e) => setObTotal(e.target.value)} />
            )}
          </div>
          {obMethod === 'custom' && (
            <div>
              <label className="text-sm font-medium text-foreground">{t('dues.customAmounts')}</label>
              <div className="mt-1.5 max-h-48 overflow-y-auto border border-border rounded-xl divide-y divide-border/60">
                {units.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-foreground truncate">{unitLabel(u.id)}</span>
                    <input type="number" step="0.01" min="0" value={obCustom[u.id] ?? ''} placeholder="0.00"
                      onChange={(e) => setObCustom({ ...obCustom, [u.id]: e.target.value })}
                      className="w-28 text-end rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <GenPreview rows={obPreview} isB2={isB2} unitLabel={unitLabel} th={th} labels={labels} t={t} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setObOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={generateOffBudget} loading={saving} disabled={!obLabel.trim() || !obPeriod.trim()}>{t('dues.generate')}</Button>
          </div>
        </div>
      </Modal>
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

