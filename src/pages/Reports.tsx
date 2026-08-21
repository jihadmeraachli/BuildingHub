import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileBarChart2, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { fetchAll } from '@/lib/fetchAll';
import { useExpenseTypes } from '@/lib/expenseTypes';
import { fmtDate } from '@/lib/dateFmt';
import { computeBalance } from '@/lib/balance';
import { tenancyHelpers, buildBook, buildBudgetVsActual, buildLedger, buildResidentLedger, tenantTitle, type TenancyRow } from '@/lib/reportData';
import { CustomReportCard } from '@/components/CustomReportCard';
import type { Unit, Charge, Payment, Expense, Adjustment, Budget, BudgetLine } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { SkeletonCards } from '@/components/ui/Skeleton';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Reports (#62) — the output room. Finance stays the operational workbench
 * (record & reconcile); every downloadable report lives here, one card each,
 * so future reports (arrears aging, AGM summary, …) have a home. Number
 * crunching is shared with Finance via lib/reportData — same inputs, same
 * figures, by construction.
 */

/** Resident report set: my unit's statement + the building's expenses (0069).
 *  A tenant's statement is THEIR ledger only; owners get the full unit. */
function ResidentReports() {
  const { t } = useTranslation();
  const { memberships, residentUnitId } = useAuth();
  const myUnits = useMemo(
    () => memberships.filter((m) => m.unit).map((m) => ({ unit: m.unit as Unit, tenure: m.tenure })),
    [memberships]);

  const [bldgs, setBldgs] = useState<{ id: string; name: string; compound_id: string | null }[]>([]);
  const [buildingId, setBuildingId] = useState('');
  useEffect(() => {
    const ids = [...new Set(myUnits.map((m) => m.unit.building_id))];
    if (!ids.length) return;
    supabase.from('buildings').select('id, name, compound_id').in('id', ids).then(({ data }) => {
      const rows = (data as { id: string; name: string; compound_id: string | null }[]) ?? [];
      setBldgs(rows);
      setBuildingId((cur) => cur || rows[0]?.id || '');
    });
  }, [myUnits]);

  // My own ledger, for the Custom report: MY charges (my share of each
  // expense) and MY payments. Not the building's expenses — a $1,200 concierge
  // bill is not what one owner paid, their charge is. RLS scopes this anyway;
  // the unit filter is so the query is honest about what it is asking for.
  const myUnitIds = useMemo(() => myUnits.map((m) => m.unit.id), [myUnits]);
  const [myCharges, setMyCharges] = useState<Charge[]>([]);
  const [myPayments, setMyPayments] = useState<Payment[]>([]);
  useEffect(() => {
    if (!myUnitIds.length) { setMyCharges([]); setMyPayments([]); return; }
    Promise.all([
      fetchAll<Charge>((f, to) => supabase.from('charges').select('*').in('unit_id', myUnitIds)
        .order('charge_date', { ascending: false }).order('id').range(f, to)),
      fetchAll<Payment>((f, to) => supabase.from('payments').select('*').in('unit_id', myUnitIds)
        .order('paid_on', { ascending: false }).order('id').range(f, to)),
    ]).then(([c, p]) => { setMyCharges(c); setMyPayments(p); });
  }, [myUnitIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const myLedger = useMemo(() => buildResidentLedger(myCharges, myPayments, {
    // charges carry a copy of their expense's category, so no join is needed
    categoryName: (c) => (c.category ? t(`finance.cats.${c.category}`) : t('finance.cats.other')),
    unitLabel: (uid) => myUnits.find((m) => m.unit.id === uid)?.unit.label ?? '—',
    paymentWord: t('reports.custom.payment'),
  }), [myCharges, myPayments, myUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  // The building's OWN spending — the transparency view (0069). Kept strictly
  // separate from "my charges": a charge is a share of an expense, so one list
  // containing both would count every figure twice.
  const myBuilding = bldgs.find((b) => b.id === buildingId) ?? null;
  const { types: bldgExpenseTypes } = useExpenseTypes(
    myBuilding?.compound_id ? 'compound' : 'building',
    myBuilding?.compound_id ?? myBuilding?.id,
  );
  const [bldgExpenses, setBldgExpenses] = useState<Expense[]>([]);
  useEffect(() => {
    if (!myBuilding) { setBldgExpenses([]); return; }
    const q = myBuilding.compound_id
      ? supabase.from('expenses').select('*').or(`building_id.eq.${myBuilding.id},compound_id.eq.${myBuilding.compound_id}`)
      : supabase.from('expenses').select('*').eq('building_id', myBuilding.id);
    q.order('expense_date', { ascending: false })
      .then(({ data }) => setBldgExpenses((data as Expense[]) ?? []));
  }, [buildingId, myBuilding?.compound_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildingLedger = useMemo(() => buildLedger(bldgExpenses, [], {
    // catalog name, so a custom type never prints as "Other" (0085)
    typeName: (e) => bldgExpenseTypes.find((x) => x.id === e.expense_type_id)?.name
      ?? (e.category ? t(`finance.cats.${e.category}`) : t('finance.cats.other')),
    unitLabel: () => '',
    payerLabel: () => '',
    paymentWord: t('reports.custom.payment'),
  }), [bldgExpenses, bldgExpenseTypes]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('reports.title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('reports.residentSubtitle')}</p>
      </div>

      {/* The two cards that used to sit here are gone. "My unit statement"
          duplicated Finance → My home → Export statement, exactly the same PDF
          behind a second door. "Building expenses" became a SCOPE of the
          report below, where it is filterable and groupable instead of a
          single fixed download. */}
      {bldgs.length > 1 && (
        <div className="max-w-xs mb-4">
          <SelectField label={t('reports.building')} value={buildingId} onValueChange={setBuildingId}>
            {bldgs.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectField>
        </div>
      )}

      <div className="max-w-6xl">
        <CustomReportCard
          scopes={[
            { key: 'mine', label: t('reports.custom.scopeMine'), rows: myLedger },
            { key: 'building', label: t('reports.custom.scopeBuilding'), rows: buildingLedger },
          ]}
          entityName={myBuilding?.name ?? ''}
          // Follow the sidebar's my-home picker: pick unit 503 there and the
          // report opens on 503, rather than silently showing both.
          // AuthContext hands out an id; the ledger filters on the label.
          unitFilter={myUnits.find((m) => m.unit.id === residentUnitId)?.unit.label ?? ''}
        />
      </div>
    </div>
  );
}

export default function Reports() {
  const { t } = useTranslation();
  const { canAny, isPlatformAdmin, residentLens, memberships, loading: authLoading } = useAuth();
  const { buildings } = useManagedBuildings();
  const entities = useEntities(buildings);

  // GLOBAL entity selection (sidebar) — reports need one entity; '' shows a prompt.
  const { entityKey } = useAuth();
  const entity = entities.find((e) => e.key === entityKey) ?? null;

  const [period, setPeriod] = useState<'all' | 'year' | 'month'>('all');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));


  const [units, setUnits] = useState<Unit[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [tenancy, setTenancy] = useState<TenancyRow[]>([]);
  // Budget vs actual (0087): pick an issued budget, hold it against the
  // expenses booked inside its period.
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [bvaBudgetId, setBvaBudgetId] = useState('');
  const [bvaLines, setBvaLines] = useState<BudgetLine[]>([]);
  const { types: allExpenseTypes } = useExpenseTypes(entity?.kind, entity?.id);
  useEffect(() => {
    if (!entity) { setBudgets([]); return; }
    const q = entity.kind === 'compound'
      ? supabase.from('budgets').select('*').eq('compound_id', entity.id)
      : supabase.from('budgets').select('*').eq('building_id', entity.id);
    q.is('cancelled_at', null).order('period_start', { ascending: false })
      .then(({ data }) => setBudgets((data as Budget[]) ?? []));
  }, [entityKey, entity?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bvaBudgetId) { setBvaLines([]); return; }
    supabase.from('budget_lines').select('*').eq('budget_id', bvaBudgetId)
      .then(({ data }) => setBvaLines((data as BudgetLine[]) ?? []));
  }, [bvaBudgetId]);
  const bva = useMemo(() => {
    const budget = budgets.find((b) => b.id === bvaBudgetId);
    if (!budget || !bvaLines.length) return null;
    return buildBudgetVsActual(budget, bvaLines,
      expenses.filter((e) => !('voided_at' in e) || !e.voided_at),
      (id) => {
        const ty = allExpenseTypes.find((x) => x.id === id);
        if (!ty) return t('reports.uncategorized');
        return ty.key ? t(`finance.cats.${ty.key}`) : ty.name;
      });
  }, [budgets, bvaBudgetId, bvaLines, expenses, allExpenseTypes, t]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!entity) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const blocks = entity.buildingIds;
      const [{ data: u }, chargeRows, paymentRows, expenseRows, adjRows] = await Promise.all([
        supabase.from('units').select('*').in('building_id', blocks).order('label'),
        fetchAll<Charge>((f, to) => supabase.from('charges').select('*').in('building_id', blocks).order('charge_date', { ascending: false }).order('id').range(f, to)),
        fetchAll<Payment>((f, to) => supabase.from('payments').select('*').in('building_id', blocks).order('paid_on', { ascending: false }).order('id').range(f, to)),
        entity.kind === 'compound'
          ? fetchAll<Expense>((f, to) => supabase.from('expenses').select('*').or(`compound_id.eq.${entity.id},building_id.in.(${blocks.join(',')})`).order('expense_date', { ascending: false }).order('id').range(f, to))
          : fetchAll<Expense>((f, to) => supabase.from('expenses').select('*').eq('building_id', entity.id).order('expense_date', { ascending: false }).order('id').range(f, to)),
        fetchAll<Adjustment>((f, to) => supabase.from('adjustments').select('*').in('building_id', blocks).order('effective_date', { ascending: false }).order('id').range(f, to)),
      ]);
      if (cancelled) return;
      const unitList = (u as Unit[]) ?? [];
      setUnits(unitList); setCharges(chargeRows); setPayments(paymentRows);
      setExpenses(expenseRows); setAdjustments(adjRows);
      if (unitList.length) {
        const ids = unitList.map((x) => x.id);
        // Dues used to be fetched here too, only to list a party's obligations
        // on the unit-statement PDF. That card is gone (Finance exports the
        // same statement from the unit's own row), so the query went with it
        // rather than loading on every visit for nobody.
        const { data: mem } = await supabase.from('memberships')
          .select('unit_id, user_id, tenure, created_at, ended_at, profiles(full_name)')
          .in('unit_id', ids);
        if (!cancelled) setTenancy((mem as unknown as TenancyRow[]) ?? []);
      } else { setTenancy([]); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entityKey, entities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = useMemo(() => tenancyHelpers(tenancy, charges, payments, adjustments),
    [tenancy, charges, payments, adjustments]);
  const labels = { owner: t('finance.owner'), tenant: t('finance.currentTenant'), formerTenant: t('finance.formerTenant') };

  // The Custom report's source: everything in this entity that moved money.
  // Deliberately NOT period-filtered here — the card carries its own date
  // range, and two date filters fighting each other is how people end up
  // distrusting a total they cannot reproduce.
  const ledgerRows = useMemo(() => buildLedger(expenses, payments, {
    typeName: (e) => {
      const cat = allExpenseTypes.find((x) => x.id === e.expense_type_id);
      // catalog name first — a custom type must never print as "Other" (0085)
      return cat?.name ?? (e.category ? t(`finance.cats.${e.category}`) : t('finance.cats.other'));
    },
    unitLabel: (uid) => units.find((u) => u.id === uid)?.label ?? '—',
    payerLabel: (p) => (p.paid_by === 'tenant'
      ? tenantTitle(labels.tenant, th.nameById(p.tenant_id))
      : labels.owner),
    paymentWord: t('reports.custom.payment'),
  }), [expenses, payments, units, allExpenseTypes, th]); // eslint-disable-line react-hooks/exhaustive-deps

  // Period filter (mirrors Finance)
  const now = new Date();
  let range: { from: Date; to: Date } | null = null;
  if (period === 'year') range = { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
  else if (period === 'month') { const [y, m] = monthValue.split('-').map(Number); range = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) }; }
  const inRange = (d: string) => !range || (new Date(d) >= range.from && new Date(d) <= range.to);
  const periodLabel = period === 'month'
    ? new Date(`${monthValue}-01`).toLocaleString(undefined, { month: 'long', year: 'numeric' })
    : period === 'year' ? t('finance.thisYear') : t('finance.allTime');
  const round2 = (n: number) => Math.round(n * 100) / 100;

  async function downloadBuildingReport() {
    if (!entity) return;
    setBusy('report');
    try {
      const { BuildingReportDoc, downloadPdf } = await import('@/lib/pdf');
      const pCharges = charges.filter((c) => !c.voided_at && inRange(c.charge_date));
      const pPayments = payments.filter((p) => !p.voided_at && inRange(p.paid_on));
      const pExpenses = expenses.filter((e) => inRange(e.expense_date));
      const collected = round2(pPayments.reduce((s, p) => s + Number(p.amount_usd), 0));
      const billed = round2(pCharges.reduce((s, c) => s + Number(c.amount_usd), 0));
      const periodEnd = range ? range.to : null;
      const outstanding = round2(units.reduce((s, u) => {
        const bal = computeBalance(u,
          charges.filter((c) => c.unit_id === u.id), payments.filter((p) => p.unit_id === u.id),
          periodEnd, adjustments.filter((a) => a.unit_id === u.id));
        return s + (bal < 0 ? -bal : 0);
      }, 0));
      const book = buildBook(units, charges, payments, adjustments, null, th);
      const unitLabel = (uid: string) => units.find((u) => u.id === uid)?.label ?? '—';
      const el = (
        <BuildingReportDoc
          entityName={entity.name}
          period={periodLabel}
          generatedOn={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          kpi={{ collected, billed, outstanding }}
          book={book}
          expenses={pExpenses}
          payments={pPayments.map((p) => ({ id: p.id, date: p.paid_on, unit: unitLabel(p.unit_id), method: p.method, amount: Number(p.amount_usd) }))}
        />
      );
      await downloadPdf(el, `report-${entity.name.replace(/\s+/g, '-')}-${period}.pdf`);
    } catch (e) {
      toast.error(t('reports.exportFailed'));
      console.error('building report failed:', e);
    } finally { setBusy(''); }
  }

  if (authLoading) return <div className="p-6"><SkeletonCards count={2} /></div>;
  // Residents (and dual-persona users browsing "My home") get their own report
  // set: their statement + the building's expenses (transparency, 0069).
  const managerMode = (isPlatformAdmin || canAny('finance.view')) && !residentLens;
  if (!managerMode) {
    if (memberships.length) return <ResidentReports />;
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('reports.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('reports.subtitle')}</p>
        </div>
        {/* Entity selection moved to the sidebar (global). */}
      </div>

      {!entity ? (
        <Card><CardBody><p className="text-sm text-muted-foreground text-center py-10">{t('common.pickEntity')}</p></CardBody></Card>
      ) : loading ? <SkeletonCards count={2} /> : (
        <div className="grid md:grid-cols-2 gap-4 max-w-4xl">
          {/* ── Building financial report ── */}
          <Card><CardBody>
            <div className="flex items-center gap-2.5 mb-2">
              <FileBarChart2 size={18} className="text-primary" />
              <p className="font-semibold text-foreground">{t('reports.buildingReport')}</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t('reports.buildingReportDesc')}</p>
            <div className="space-y-3">
              <SelectField label={t('reports.period')} value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
                <SelectItem value="all">{t('finance.allTime')}</SelectItem>
                <SelectItem value="year">{t('finance.thisYear')}</SelectItem>
                <SelectItem value="month">{t('reports.specificMonth')}</SelectItem>
              </SelectField>
              {period === 'month' && (
                <input
                  type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              )}
              <Button onClick={downloadBuildingReport} loading={busy === 'report'} disabled={!entity || units.length === 0} className="w-full">
                <Download size={15} /> {t('reports.download')}
              </Button>
            </div>
          </CardBody></Card>

          {/* The Unit statement card that used to sit here is gone. Finance's
              book already exports a statement from each unit's own row, where
              you are already looking at that unit — this was a second door to
              the identical PDF, in a place where you first had to find the unit
              in a dropdown. Same reasoning that removed the two resident cards. */}

          {/* Budget vs actual (0087): how well did the prepaid budget perform */}
          <Card className="md:col-span-2"><CardBody>
            <div className="flex items-center gap-2.5 mb-2">
              <FileBarChart2 size={18} className="text-primary" />
              <p className="font-semibold text-foreground">{t('reports.budgetVsActual')}</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t('reports.budgetVsActualDesc')}</p>
            {budgets.length === 0
              ? <p className="text-sm text-muted-foreground">{t('reports.noBudgets')}</p>
              : (
                <div className="space-y-3">
                  <SelectField label={t('dues.budgetLabel')} value={bvaBudgetId || '__none__'} onValueChange={(v) => setBvaBudgetId(v === '__none__' ? '' : v)}>
                    <SelectItem value="__none__">{t('reports.pickBudget')}</SelectItem>
                    {budgets.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label} · {fmtDate(b.period_start, 'MMM d')} – {fmtDate(b.period_end, 'MMM d, yyyy')}
                      </SelectItem>
                    ))}
                  </SelectField>
                  {bva && (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-start font-medium">{t('finance.category')}</th>
                          <th className="px-4 py-2.5 text-end font-medium">{t('reports.budgeted')}</th>
                          <th className="px-4 py-2.5 text-end font-medium">{t('reports.actual')}</th>
                          <th className="px-4 py-2.5 text-end font-medium">{t('reports.variance')}</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border/60">
                          {bva.rows.map((r) => (
                            <tr key={r.typeId ?? 'null'}>
                              <td className="px-4 py-2 text-foreground">{r.typeName}{r.budgeted === 0 && <span className="ms-1.5 text-xs text-amber-600 dark:text-amber-400">{t('reports.unbudgeted')}</span>}</td>
                              <td className="px-4 py-2 text-end text-muted-foreground tnum">{money(r.budgeted)}</td>
                              <td className="px-4 py-2 text-end text-foreground tnum">{money(r.actual)}</td>
                              <td className={`px-4 py-2 text-end tnum font-medium ${r.variance < 0 ? 'text-red-500 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(r.variance)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-border font-semibold">
                            <td className="px-4 py-2 text-foreground">{t('reports.total')}</td>
                            <td className="px-4 py-2 text-end text-foreground tnum">{money(bva.totalBudgeted)}</td>
                            <td className="px-4 py-2 text-end text-foreground tnum">{money(bva.totalActual)}</td>
                            <td className={`px-4 py-2 text-end tnum ${bva.totalBudgeted - bva.totalActual < 0 ? 'text-red-500 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(Math.round((bva.totalBudgeted - bva.totalActual) * 100) / 100)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
          </CardBody></Card>
        </div>
      )}

      {entity && !loading && (
        <div className="mt-4 max-w-6xl">
          <CustomReportCard rows={ledgerRows} entityName={entity.name} />
        </div>
      )}
    </div>
  );
}
