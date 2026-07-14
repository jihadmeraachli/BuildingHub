import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { supabase } from '@/lib/supabase';
import type { Meeting } from '@/types';
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
      <DashCanvas>
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
      </DashCanvas>
    );
  }

  // ---------- MANAGER ----------
  return (
    <DashCanvas>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <Greeting name={firstName} subtitle={isPlatformAdmin ? t('dashboard.overviewPlatform') : t('dashboard.overviewBuildings')} />
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 0 && (
            <select value={entityKey} onChange={(e) => setEntityKey(e.target.value)} className={SELECT_DARK + ' min-w-[160px]'}>
              <option value="">{t('dashboard.allBuildings')}</option>
              {entities.map((e) => <option key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</option>)}
            </select>
          )}
          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)} className={SELECT_DARK}>
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
        <Stat label={t('dashboard.units')} value={String(agg.units)} icon={Home} tone="brand" />
        <Stat label={t('dashboard.openIssues')} value={String(agg.openIssues)} icon={AlertTriangle} tone={agg.openIssues > 0 ? 'rose' : 'slate'} />
      </div>

      <Panel className="mt-5 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-200">{t('dashboard.collectedVsSpent')}</p>
          <span className="text-xs text-slate-500">{t('dashboard.last12Hover')}</span>
        </div>
        <TrendChart labels={monthly.labels} series={[
          { name: t('dashboard.collected'), color: '#57D6E2', data: monthly.collected },
          { name: t('dashboard.spent'), color: '#fb7185', data: monthly.spent },
        ]} />
      </Panel>

      <Panel className="mt-5 p-5">
        <p className="text-sm font-semibold text-slate-200 mb-3">{t('dashboard.coverage')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-400">{t('dashboard.reserve')}</p>
            <p className={`font-display text-xl font-bold tnum mt-0.5 ${fund < 0 ? 'text-rose-400' : 'text-white'}`}>{money(fund)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">{t('dashboard.runway')}</p>
            <p className="font-display text-xl font-bold tnum mt-0.5 text-white">{coverage.runwayMonths} {t('dashboard.monthsShort')}</p>
          </div>
          {coverage.duesPeriod && (
            <div>
              <p className="text-xs text-slate-400">{t('dashboard.duesIssued')} · {coverage.duesPeriod}</p>
              <p className="font-display text-xl font-bold tnum mt-0.5 text-white">{money(coverage.duesIssued)}</p>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">{coverage.runwayMonths >= 1 ? t('dashboard.safeNote', { n: coverage.runwayMonths }) : t('dashboard.tightNote')}</p>
      </Panel>

      <h2 className="text-xs font-semibold text-slate-400 mt-8 mb-3 uppercase tracking-[0.15em]">{t('dashboard.quickActions')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link to="/finance"><QuickLink icon={Plus} title={t('dashboard.recordExpense')} desc={t('dashboard.recordExpenseDesc')} /></Link>
        <Link to="/finance"><QuickLink icon={HandCoins} title={t('dashboard.recordPayment')} desc={t('dashboard.recordPaymentDesc')} /></Link>
        <Link to="/structure"><QuickLink icon={Layers} title={t('dashboard.manageStructure')} desc={t('dashboard.manageStructureDesc')} /></Link>
      </div>

      <MeetingsCard meetings={upcoming} />
    </DashCanvas>
  );
}

// dark full-bleed canvas — cyan/blue aurora + faint grid (Tatawwor brand)
function DashCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="relative -m-4 lg:-m-6 p-5 lg:p-8 min-h-[calc(100dvh-4rem)] overflow-hidden text-slate-200">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[#080b12]" />
      <div className="pointer-events-none absolute inset-0 -z-10" style={{ backgroundImage: 'radial-gradient(42rem 30rem at 12% -8%, rgba(87,214,226,0.20), transparent 60%), radial-gradient(40rem 30rem at 106% 0%, rgba(52,158,205,0.18), transparent 55%), radial-gradient(46rem 34rem at 55% 122%, rgba(52,158,205,0.10), transparent 55%)' }} />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '34px 34px', maskImage: 'radial-gradient(75% 60% at 50% 20%, #000, transparent)', WebkitMaskImage: 'radial-gradient(75% 60% at 50% 20%, #000, transparent)' }} />
      {children}
    </div>
  );
}

const SELECT_DARK = 'rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#57D6E2]/50 [&>option]:text-slate-900';

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`glass-dark rounded-2xl ${className}`}>{children}</div>;
}

function MeetingsCard({ meetings }: { meetings: Meeting[] }) {
  const { t } = useTranslation();
  if (meetings.length === 0) return null;
  return (
    <>
      <h2 className="text-xs font-semibold text-slate-400 mt-8 mb-3 uppercase tracking-[0.15em]">{t('dashboard.upcomingMeetings')}</h2>
      <div className="space-y-3">
        {meetings.map((m) => (
          <div key={m.id} className="glass-dark rounded-2xl p-4 transition-colors hover:border-[#57D6E2]/40">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 text-center rounded-xl px-3.5 py-2 min-w-[58px] bg-[#57D6E2]/12 ring-1 ring-[#57D6E2]/20">
                <p className="text-[10px] text-[#7fe3ec] font-semibold uppercase">{format(new Date(m.meeting_date), 'MMM')}</p>
                <p className="font-display text-xl font-bold text-white leading-none">{format(new Date(m.meeting_date), 'd')}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white truncate">{m.title}</p>
                <p className="text-sm text-slate-400">
                  {format(new Date(m.meeting_date), 'EEEE, MMM d, yyyy')}{m.meeting_time ? ` · ${m.meeting_time.slice(0, 5)}` : ''}
                </p>
              </div>
              <Link to="/meetings" className="text-slate-500 hover:text-[#57D6E2] transition"><CalendarDays size={18} /></Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Greeting({ name, subtitle }: { name: string; subtitle: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <h1 className="font-display text-3xl lg:text-4xl font-bold text-white tracking-tight">
        {name ? `${t('dashboard.welcome')}, ${name}` : t('dashboard.welcome')} <span className="inline-block">👋</span>
      </h1>
      <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
    </div>
  );
}

function HeroCard({ label, amount, stats, pill }: {
  label: string; amount: string; stats: { label: string; value: string }[]; pill?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}
      className="relative overflow-hidden rounded-3xl text-white p-6 lg:p-8 glow-brand"
      style={{ background: 'linear-gradient(135deg, #0c2b3d 0%, #0a1a28 45%, #070d16 100%)' }}
    >
      {/* brand rim */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px brand-grad opacity-80" />
      {/* animated brand glows */}
      <motion.div className="pointer-events-none absolute -top-24 -end-16 w-80 h-80 rounded-full blur-3xl" style={{ background: 'rgba(87,214,226,0.30)' }}
        animate={{ x: [0, 24, 0], y: [0, 18, 0] }} transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="pointer-events-none absolute -bottom-28 -start-16 w-80 h-80 rounded-full blur-3xl" style={{ background: 'rgba(52,158,205,0.26)' }}
        animate={{ x: [0, -20, 0], y: [0, -16, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
      {/* faint grid */}
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <p className="text-xs text-cyan-100/70 font-semibold uppercase tracking-[0.14em]">{label}</p>
          {pill && <span className="text-xs font-bold rounded-full px-3 py-1 text-[#062330] brand-grad">{pill}</span>}
        </div>
        <p className="font-display text-5xl lg:text-6xl font-bold tracking-tight mt-3 tnum" style={{ textShadow: '0 4px 34px rgba(87,214,226,0.35)' }}>{amount}</p>
        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-7">
          {stats.map((s, i) => (
            <div key={i} className={i > 0 ? 'border-s border-white/10 ps-8' : ''}>
              <p className="text-xs text-slate-400">{s.label}</p>
              <p className="font-display text-lg font-semibold tnum text-white mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: ElementType; tone: 'brand' | 'emerald' | 'rose' | 'amber' | 'slate' }) {
  const tones: Record<string, string> = {
    brand: 'bg-[#57D6E2]/12 text-[#7fe3ec]', emerald: 'bg-emerald-400/12 text-emerald-300',
    rose: 'bg-rose-400/12 text-rose-300', amber: 'bg-amber-400/12 text-amber-300', slate: 'bg-white/8 text-slate-300',
  };
  return (
    <motion.div whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="glass-dark rounded-2xl p-4 transition-colors hover:border-[#57D6E2]/40">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 font-medium">{label}</p>
          <p className="font-display text-2xl font-bold text-white tnum mt-1 truncate">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tones[tone]}`}><Icon size={18} /></div>
      </div>
    </motion.div>
  );
}

function QuickLink({ icon: Icon, title, desc }: { icon: ElementType; title: string; desc: string }) {
  return (
    <div className="group glass-dark rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-[#57D6E2]/40 cursor-pointer">
      <div className="flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-xl bg-[#57D6E2]/12 text-[#7fe3ec] flex items-center justify-center flex-shrink-0 transition-all group-hover:bg-gradient-to-br group-hover:from-[#57D6E2] group-hover:to-[#349ECD] group-hover:text-[#062330]">
          <Icon size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white text-sm">{title}</p>
          <p className="text-xs text-slate-400">{desc}</p>
        </div>
        <ArrowRight size={16} className="text-slate-500 group-hover:text-[#57D6E2] transition-colors rtl:rotate-180" />
      </div>
    </div>
  );
}
