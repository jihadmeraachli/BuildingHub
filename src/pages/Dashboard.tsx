import { useEffect, useMemo, useState, type ElementType } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { supabase } from '@/lib/supabase';
import type { Meeting } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { TrendChart } from '@/components/ui/Charts';
import {
  AlertTriangle, Home, TrendingUp, AlertCircle, Wallet, Plus, HandCoins, Layers, ArrowRight, CalendarDays,
} from 'lucide-react';

// signed currency: -$1,234.00  (fixes the "-$-" double-sign bug)
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Agg {
  collected: number; spent: number; billed: number; outstanding: number; ytd: number;
  units: number; openIssues: number;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { profile, isPlatformAdmin, canAny, myUnitIds } = useAuth();
  const { buildings } = useManagedBuildings();
  const isManager = isPlatformAdmin || canAny('finance.view');

  const [agg, setAgg] = useState<Agg>({ collected: 0, spent: 0, billed: 0, outstanding: 0, ytd: 0, units: 0, openIssues: 0 });
  const [monthly, setMonthly] = useState<{ labels: string[]; collected: number[]; spent: number[] }>({ labels: [], collected: [], spent: [] });
  const [resident, setResident] = useState({ charged: 0, paid: 0 });
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const entities = useEntities(buildings);
  const [entityKey, setEntityKey] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  useEffect(() => { setBlockFilter(''); }, [entityKey]);
  const selEntity = entities.find((e) => e.key === entityKey) ?? null;
  const [coverage, setCoverage] = useState({ runwayMonths: 0, duesIssued: 0, duesPeriod: '' });
  const buildingIds = useMemo(() => buildings.map((b) => b.id), [buildings]);
  const idsKey = buildingIds.join(',');

  useEffect(() => {
    if (isManager) loadManager();
    else if (myUnitIds.length) loadResident();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, isManager, entityKey, blockFilter]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase.from('meetings').select('*').gte('meeting_date', today);
    if (isManager) {
      const scope = entityKey ? (blockFilter ? [blockFilter] : (selEntity?.buildingIds ?? buildingIds)) : buildingIds;
      q = q.in('building_id', scope.length ? scope : ['00000000-0000-0000-0000-000000000000']);
    }
    q.order('meeting_date', { ascending: true }).limit(5).then(({ data }) => setUpcoming((data as Meeting[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, entityKey, blockFilter, isManager]);

  async function loadManager() {
    const ent = entities.find((e) => e.key === entityKey);
    const scope = entityKey ? (blockFilter ? [blockFilter] : (ent?.buildingIds ?? buildingIds)) : buildingIds;
    const inIds = scope.length ? scope : ['00000000-0000-0000-0000-000000000000'];
    const [chargesRes, paymentsRes, unitsRes, issuesRes, duesRes] = await Promise.all([
      supabase.from('charges').select('amount_usd, unit_id, charge_date').in('building_id', inIds),
      supabase.from('payments').select('amount_usd, unit_id, paid_on').in('building_id', inIds),
      supabase.from('units').select('id', { count: 'exact', head: true }).in('building_id', inIds),
      supabase.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'open').in('building_id', inIds),
      supabase.from('dues').select('amount_due, period_label, created_at').in('building_id', inIds),
    ]);

    const charges = (chargesRes.data as { amount_usd: number; unit_id: string; charge_date: string }[]) ?? [];
    const payments = (paymentsRes.data as { amount_usd: number; unit_id: string; paid_on: string }[]) ?? [];

    const billed = charges.reduce((s, c) => s + Number(c.amount_usd), 0);
    const collected = payments.reduce((s, p) => s + Number(p.amount_usd), 0);
    const spent = billed; // expense-driven: total charges == total expenses (block-tagged)

    const perUnit: Record<string, number> = {};
    charges.forEach((c) => { perUnit[c.unit_id] = (perUnit[c.unit_id] ?? 0) - Number(c.amount_usd); });
    payments.forEach((p) => { perUnit[p.unit_id] = (perUnit[p.unit_id] ?? 0) + Number(p.amount_usd); });
    const outstanding = Object.values(perUnit).reduce((s, b) => s + (b < 0 ? -b : 0), 0);

    const ref = new Date();
    const ytd = payments.filter((p) => new Date(p.paid_on).getFullYear() === ref.getFullYear())
      .reduce((s, p) => s + Number(p.amount_usd), 0);

    const buckets = Array.from({ length: 12 }, (_, k) => {
      const d = new Date(ref.getFullYear(), ref.getMonth() - 11 + k, 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString(undefined, { month: 'short' }), collected: 0, spent: 0 };
    });
    const bucketFor = (dt: string) => { const d = new Date(dt); return buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`); };
    payments.forEach((p) => { const m = bucketFor(p.paid_on); if (m) m.collected += Number(p.amount_usd); });
    charges.forEach((c) => { const m = bucketFor(c.charge_date); if (m) m.spent += Number(c.amount_usd); });
    setMonthly({
      labels: buckets.map((b) => b.label),
      collected: buckets.map((b) => Math.round(b.collected * 100) / 100),
      spent: buckets.map((b) => Math.round(b.spent * 100) / 100),
    });

    setAgg({
      collected, spent, billed, outstanding: Math.round(outstanding * 100) / 100, ytd: Math.round(ytd * 100) / 100,
      units: unitsRes.count ?? 0, openIssues: issuesRes.count ?? 0,
    });

    // coverage: reserve runway + latest dues issued
    const fundLocal = Math.round((collected - spent) * 100) / 100;
    const monthsWithSpend = buckets.filter((s) => s.spent > 0).length || 1;
    const avgMonthly = buckets.reduce((s, x) => s + x.spent, 0) / monthsWithSpend;
    const runwayMonths = avgMonthly > 0 ? Math.round((Math.max(0, fundLocal) / avgMonthly) * 10) / 10 : 0;
    const duesRows = (duesRes.data as { amount_due: number; period_label: string; created_at: string }[]) ?? [];
    let duesIssued = 0, duesPeriod = '';
    if (duesRows.length) {
      const latest = duesRows.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
      duesPeriod = latest.period_label;
      duesIssued = Math.round(duesRows.filter((d) => d.period_label === duesPeriod).reduce((s, d) => s + Number(d.amount_due), 0) * 100) / 100;
    }
    setCoverage({ runwayMonths, duesIssued, duesPeriod });
  }

  async function loadResident() {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from('charges').select('amount_usd').in('unit_id', myUnitIds),
      supabase.from('payments').select('amount_usd').in('unit_id', myUnitIds),
    ]);
    setResident({
      charged: ((c as { amount_usd: number }[]) ?? []).reduce((s, x) => s + Number(x.amount_usd), 0),
      paid: ((p as { amount_usd: number }[]) ?? []).reduce((s, x) => s + Number(x.amount_usd), 0),
    });
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const fund = Math.round((agg.collected - agg.spent) * 100) / 100;
  const collectionRate = agg.billed > 0 ? Math.round((agg.collected / agg.billed) * 100) : 0;

  // ---------- RESIDENT ----------
  if (!isManager) {
    const balance = Math.round((resident.paid - resident.charged) * 100) / 100;
    return (
      <div>
        <Greeting name={firstName} subtitle={t('dashboard.accountGlance')} />
        <HeroCard
          label={balance < 0 ? t('dashboard.youOwe') : t('dashboard.creditBalance')}
          amount={money(Math.abs(balance))}
          stats={[{ label: t('dashboard.totalCharged'), value: money(resident.charged) }, { label: t('dashboard.totalPaid'), value: money(resident.paid) }]}
        />
        <div className="mt-5">
          <Link to="/finance"><QuickLink icon={Wallet} title={t('dashboard.viewStatement')} desc={t('dashboard.viewStatementDesc')} /></Link>
        </div>
        <MeetingsCard meetings={upcoming} />
      </div>
    );
  }

  // ---------- MANAGER ----------
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <Greeting name={firstName} subtitle={isPlatformAdmin ? t('dashboard.overviewPlatform') : t('dashboard.overviewBuildings')} />
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 0 && (
            <select
              value={entityKey}
              onChange={(e) => setEntityKey(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 min-w-[160px]"
            >
              <option value="">{t('dashboard.allBuildings')}</option>
              {entities.map((e) => <option key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</option>)}
            </select>
          )}
          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <select
              value={blockFilter}
              onChange={(e) => setBlockFilter(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <option value="">{t('finance.allBlocks')}</option>
              {selEntity.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <HeroCard
        label={t('dashboard.fundBalance')}
        amount={money(fund)}
        pill={t('dashboard.percentCollected', { pct: collectionRate })}
        stats={[
          { label: t('dashboard.collected'), value: money(agg.collected) },
          { label: t('dashboard.spent'), value: money(agg.spent) },
          { label: t('dashboard.yearToDate'), value: money(agg.ytd) },
        ]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        <Stat label={t('dashboard.outstanding')} value={money(agg.outstanding)} icon={AlertCircle} tone={agg.outstanding > 0 ? 'amber' : 'slate'} />
        <Stat label={t('dashboard.totalBilled')} value={money(agg.billed)} icon={TrendingUp} tone="emerald" />
        <Stat label={t('dashboard.units')} value={String(agg.units)} icon={Home} tone="indigo" />
        <Stat label={t('dashboard.openIssues')} value={String(agg.openIssues)} icon={AlertTriangle} tone={agg.openIssues > 0 ? 'rose' : 'slate'} />
      </div>

      <Card className="mt-5">
        <CardBody>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-700">{t('dashboard.collectedVsSpent')}</p>
            <span className="text-xs text-slate-400">{t('dashboard.last12Hover')}</span>
          </div>
          <TrendChart labels={monthly.labels} series={[
            { name: t('dashboard.collected'), color: '#10b981', data: monthly.collected },
            { name: t('dashboard.spent'), color: '#f43f5e', data: monthly.spent },
          ]} />
        </CardBody>
      </Card>

      <Card className="mt-5">
        <CardBody>
          <p className="text-sm font-semibold text-slate-700 mb-3">{t('dashboard.coverage')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-500">{t('dashboard.reserve')}</p>
              <p className={`text-xl font-bold tnum mt-0.5 ${fund < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{money(fund)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('dashboard.runway')}</p>
              <p className="text-xl font-bold tnum mt-0.5 text-slate-900">{coverage.runwayMonths} {t('dashboard.monthsShort')}</p>
            </div>
            {coverage.duesPeriod && (
              <div>
                <p className="text-xs text-slate-500">{t('dashboard.duesIssued')} · {coverage.duesPeriod}</p>
                <p className="text-xl font-bold tnum mt-0.5 text-slate-900">{money(coverage.duesIssued)}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-2">{coverage.runwayMonths >= 1 ? t('dashboard.safeNote', { n: coverage.runwayMonths }) : t('dashboard.tightNote')}</p>
        </CardBody>
      </Card>

      <h2 className="text-sm font-semibold text-slate-500 mt-8 mb-3 uppercase tracking-wide">{t('dashboard.quickActions')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link to="/finance"><QuickLink icon={Plus} title={t('dashboard.recordExpense')} desc={t('dashboard.recordExpenseDesc')} /></Link>
        <Link to="/finance"><QuickLink icon={HandCoins} title={t('dashboard.recordPayment')} desc={t('dashboard.recordPaymentDesc')} /></Link>
        <Link to="/structure"><QuickLink icon={Layers} title={t('dashboard.manageStructure')} desc={t('dashboard.manageStructureDesc')} /></Link>
      </div>

      <MeetingsCard meetings={upcoming} />
    </div>
  );
}

function MeetingsCard({ meetings }: { meetings: Meeting[] }) {
  const { t } = useTranslation();
  if (meetings.length === 0) return null;
  return (
    <>
      <h2 className="text-sm font-semibold text-slate-500 mt-8 mb-3 uppercase tracking-wide">{t('dashboard.upcomingMeetings')}</h2>
      <div className="space-y-3">
        {meetings.map((m) => (
          <Card key={m.id} className="transition-shadow hover:shadow-md">
            <CardBody>
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 text-center bg-indigo-50 rounded-xl px-3.5 py-2 min-w-[58px]">
                  <p className="text-[10px] text-indigo-500 font-semibold uppercase">{format(new Date(m.meeting_date), 'MMM')}</p>
                  <p className="text-xl font-bold text-indigo-700 leading-none">{format(new Date(m.meeting_date), 'd')}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{m.title}</p>
                  <p className="text-sm text-slate-500">
                    {format(new Date(m.meeting_date), 'EEEE, MMM d, yyyy')}{m.meeting_time ? ` · ${m.meeting_time.slice(0, 5)}` : ''}
                  </p>
                </div>
                <Link to="/meetings" className="text-slate-300 hover:text-indigo-600 transition"><CalendarDays size={18} /></Link>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

function Greeting({ name, subtitle }: { name: string; subtitle: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
        {name ? `${t('dashboard.welcome')}, ${name}` : t('dashboard.welcome')} <span className="inline-block">👋</span>
      </h1>
      <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function HeroCard({ label, amount, stats, pill }: {
  label: string; amount: string; stats: { label: string; value: string }[]; pill?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-white p-6 lg:p-7 shadow-xl shadow-indigo-600/20">
      <div className="absolute -top-16 -end-10 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-20 -start-10 w-64 h-64 rounded-full bg-violet-400/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/70">{label}</p>
          {pill && <span className="text-xs font-medium bg-white/15 backdrop-blur rounded-full px-2.5 py-1">{pill}</span>}
        </div>
        <p className="text-4xl lg:text-5xl font-extrabold tracking-tight mt-2 tnum">{amount}</p>
        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-6">
          {stats.map((s, i) => (
            <div key={i} className={i > 0 ? 'border-s border-white/15 ps-8' : ''}>
              <p className="text-xs text-white/60">{s.label}</p>
              <p className="text-lg font-semibold tnum">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: ElementType; tone: 'indigo' | 'emerald' | 'rose' | 'amber' | 'slate' }) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600', slate: 'bg-slate-100 text-slate-500',
  };
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardBody>
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-medium">{label}</p>
            <p className="text-2xl font-bold text-slate-900 tnum mt-1 truncate">{value}</p>
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tones[tone]}`}><Icon size={18} /></div>
        </div>
      </CardBody>
    </Card>
  );
}

function QuickLink({ icon: Icon, title, desc }: { icon: ElementType; title: string; desc: string }) {
  return (
    <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
      <CardBody>
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
            <Icon size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 text-sm">{title}</p>
            <p className="text-xs text-slate-500">{desc}</p>
          </div>
          <ArrowRight size={16} className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
        </div>
      </CardBody>
    </Card>
  );
}
