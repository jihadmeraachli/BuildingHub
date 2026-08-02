import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileBarChart2, FileText, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { fetchAll } from '@/lib/fetchAll';
import { computeBalance } from '@/lib/balance';
import { tenancyHelpers, buildBook, buildUnitBuckets, type TenancyRow } from '@/lib/reportData';
import type { Unit, Charge, Payment, Expense, Adjustment } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { SkeletonCards } from '@/components/ui/Skeleton';

/**
 * Reports (#62) — the output room. Finance stays the operational workbench
 * (record & reconcile); every downloadable report lives here, one card each,
 * so future reports (arrears aging, AGM summary, …) have a home. Number
 * crunching is shared with Finance via lib/reportData — same inputs, same
 * figures, by construction.
 */
export default function Reports() {
  const { t } = useTranslation();
  const { canAny, isPlatformAdmin, loading: authLoading } = useAuth();
  const { buildings } = useManagedBuildings();
  const entities = useEntities(buildings);

  const [entityKey, setEntityKey] = useState('');
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;

  const [period, setPeriod] = useState<'all' | 'year' | 'month'>('all');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [statementUnitId, setStatementUnitId] = useState('');

  const [units, setUnits] = useState<Unit[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [tenancy, setTenancy] = useState<TenancyRow[]>([]);
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
        const { data: mem } = await supabase.from('memberships')
          .select('unit_id, user_id, tenure, created_at, ended_at, profiles(full_name)')
          .in('unit_id', unitList.map((x) => x.id));
        if (!cancelled) setTenancy((mem as unknown as TenancyRow[]) ?? []);
      } else setTenancy([]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const th = useMemo(() => tenancyHelpers(tenancy, charges, payments, adjustments),
    [tenancy, charges, payments, adjustments]);
  const labels = { owner: t('finance.owner'), tenant: t('finance.tenant'), formerTenant: t('finance.formerTenant') };

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

  async function downloadUnitStatement() {
    const unit = units.find((u) => u.id === statementUnitId);
    if (!unit) { toast.error(t('reports.pickUnitFirst')); return; }
    setBusy('statement');
    try {
      const { UnitStatementDoc, downloadPdf } = await import('@/lib/pdf');
      const cAll = charges.filter((c) => c.unit_id === unit.id && !c.voided_at);
      const pAll = payments.filter((p) => p.unit_id === unit.id && !p.voided_at);
      const aAll = adjustments.filter((a) => a.unit_id === unit.id && !a.voided_at);
      const { buckets, combined } = buildUnitBuckets(unit, cAll, pAll, aAll, th, labels);
      const el = (
        <UnitStatementDoc
          unitLabel={unit.label}
          buildingName={entity?.name ?? ''}
          period={t('finance.allTime')}
          generatedOn={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          buckets={buckets}
          combinedBalance={combined}
        />
      );
      await downloadPdf(el, `statement-unit-${unit.label.replace(/\s+/g, '-')}.pdf`);
    } catch (e) {
      toast.error(t('reports.exportFailed'));
      console.error('unit statement failed:', e);
    } finally { setBusy(''); }
  }

  if (authLoading) return <div className="p-6"><SkeletonCards count={2} /></div>;
  if (!isPlatformAdmin && !canAny('finance.view')) return <Navigate to="/dashboard" replace />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('reports.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('reports.subtitle')}</p>
        </div>
        {entities.length > 1 && (
          <RadixSelect value={entityKey} onValueChange={setEntityKey}>
            <SelectTrigger className="min-w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {entities.map((e) => <SelectItem key={e.key} value={e.key}>{e.name}</SelectItem>)}
            </SelectContent>
          </RadixSelect>
        )}
      </div>

      {loading ? <SkeletonCards count={2} /> : (
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

          {/* ── Unit statement ── */}
          <Card><CardBody>
            <div className="flex items-center gap-2.5 mb-2">
              <FileText size={18} className="text-primary" />
              <p className="font-semibold text-foreground">{t('reports.unitStatement')}</p>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t('reports.unitStatementDesc')}</p>
            <div className="space-y-3">
              <SelectField label={t('finance.unit')} value={statementUnitId || '__none__'} onValueChange={(v) => setStatementUnitId(v === '__none__' ? '' : v)}>
                <SelectItem value="__none__">{t('reports.pickUnit')}</SelectItem>
                {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}
              </SelectField>
              <Button onClick={downloadUnitStatement} loading={busy === 'statement'} disabled={!statementUnitId} className="w-full">
                <Download size={15} /> {t('reports.download')}
              </Button>
            </div>
          </CardBody></Card>
        </div>
      )}
    </div>
  );
}
