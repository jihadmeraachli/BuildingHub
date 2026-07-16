import { useEffect, useMemo, useState, type ElementType } from 'react';
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
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Home, TrendingUp, AlertCircle, Wallet,
  Plus, HandCoins, Layers, ArrowRight, CalendarDays,
} from 'lucide-react';

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
    const spent = billed;

    const perUnit: Record<string, number> = {};
    charges.forEach((c) => { perUnit[c.unit_id] = (perUnit[c.unit_id] ?? 0) - Number(c.amount_usd); });
    payments.forEach((p) => { perUnit[p.unit_id] = (perUnit[p.unit_id] ?? 0) + Number(p.amount_usd); });
    const outstanding = Object.values(perUnit).filter((v) => v < 0).reduce((s, v) => s + Math.abs(v), 0);

    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const ytd = payments.filter((p) => p.paid_on >= ytdStart).reduce((s, p) => s + Number(p.amount_usd), 0);

    // Monthly breakdown (last 12 months)
    const months: Record<string, { collected: number; spent: number }> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months[format(d, 'MMM yy')] = { collected: 0, spent: 0 };
    }
    payments.forEach((p) => {
      const key = format(new Date(p.paid_on), 'MMM yy');
      if (months[key]) months[key].collected += Number(p.amount_usd);
    });
    charges.forEach((c) => {
      const key = format(new Date(c.charge_date), 'MMM yy');
      if (months[key]) months[key].spent += Number(c.amount_usd);
    });

    const dues = (duesRes.data as { amount_due: number; period_label: string; created_at: string }[]) ?? [];
    const latestPeriod = dues.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.period_label ?? '';
    const duesIssued = dues.filter((d) => d.period_label === latestPeriod).reduce((s, d) => s + Number(d.amount_due), 0);
    const avgMonthlySpend = Object.values(months).reduce((s, m) => s + m.spent, 0) / 12;
    const reserve = Math.round((collected - spent) * 100) / 100;
    const runwayMonths = avgMonthlySpend > 0 ? Math.floor(Math.max(0, reserve) / avgMonthlySpend) : 0;
    setCoverage({ runwayMonths, duesIssued, duesPeriod: latestPeriod });

    setAgg({ collected, spent, billed, outstanding, ytd, units: unitsRes.count ?? 0, openIssues: issuesRes.count ?? 0 });
    setMonthly({ labels: Object.keys(months), collected: Object.values(months).map((m) => m.collected), spent: Object.values(months).map((m) => m.spent) });
  }

  async function loadResident() {
    const inIds = myUnitIds.length ? myUnitIds : ['00000000-0000-0000-0000-000000000000'];
    const [c, p] = await Promise.all([
      supabase.from('charges').select('amount_usd').in('unit_id', inIds),
      supabase.from('payments').select('amount_usd').in('unit_id', inIds),
    ]);
    setResident({
      charged: ((c.data ?? []) as { amount_usd: number }[]).reduce((s, r) => s + Number(r.amount_usd), 0),
      paid: ((p.data ?? []) as { amount_usd: number }[]).reduce((s, r) => s + Number(r.amount_usd), 0),
    });
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const fund = Math.round((agg.collected - agg.spent) * 100) / 100;
  const collectionRate = agg.billed > 0 ? Math.round((agg.collected / agg.billed) * 100) : 0;

  // ── Resident view ──────────────────────────────────────────────────────────
  if (!isManager) {
    const balance = Math.round((resident.paid - resident.charged) * 100) / 100;
    return (
      <div className="space-y-6 max-w-2xl">
        <Greeting name={firstName} subtitle={t('dashboard.accountGlance')} />
        <HeroCard
          label={balance < 0 ? t('dashboard.youOwe') : t('dashboard.creditBalance')}
          amount={money(Math.abs(balance))}
          negative={balance < 0}
          stats={[
            { label: t('dashboard.totalCharged'), value: money(resident.charged) },
            { label: t('dashboard.totalPaid'),    value: money(resident.paid) },
          ]}
        />
        <Link to="/finance">
          <QuickLink icon={Wallet} title={t('dashboard.viewStatement')} desc={t('dashboard.viewStatementDesc')} />
        </Link>
        <MeetingsCard meetings={upcoming} />
      </div>
    );
  }

  // ── Manager view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <Greeting name={firstName} subtitle={isPlatformAdmin ? t('dashboard.overviewPlatform') : t('dashboard.overviewBuildings')} />
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 0 && (
            <RadixSelect value={entityKey || '__all__'} onValueChange={(v) => setEntityKey(v === '__all__' ? '' : v)}>
              <SelectTrigger className="min-w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('dashboard.allBuildings')}</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</SelectItem>
                ))}
              </SelectContent>
            </RadixSelect>
          )}
          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={(v) => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {selEntity.blocks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </RadixSelect>
          )}
        </div>
      </div>

      {/* Hero card */}
      <HeroCard
        label={t('dashboard.fundBalance')}
        amount={money(fund)}
        negative={fund < 0}
        pill={t('dashboard.percentCollected', { pct: collectionRate })}
        stats={[
          { label: t('dashboard.collected'), value: money(agg.collected) },
          { label: t('dashboard.spent'),     value: money(agg.spent) },
          { label: t('dashboard.yearToDate'), value: money(agg.ytd) },
        ]}
      />

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t('dashboard.outstanding')} value={money(agg.outstanding)} icon={AlertCircle} accent={agg.outstanding > 0 ? 'amber' : 'default'} />
        <StatCard label={t('dashboard.totalBilled')}  value={money(agg.billed)}        icon={TrendingUp}  accent="teal" />
        <StatCard label={t('dashboard.units')}         value={String(agg.units)}          icon={Home}        accent="teal" />
        <StatCard label={t('dashboard.openIssues')}   value={String(agg.openIssues)}   icon={AlertTriangle} accent={agg.openIssues > 0 ? 'rose' : 'default'} />
      </div>

      {/* Charts */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold">{t('dashboard.collectedVsSpent')}</p>
            <span className="text-xs text-muted-foreground">{t('dashboard.last12Hover')}</span>
          </div>
          <TrendChart labels={monthly.labels} series={[
            { name: t('dashboard.collected'), color: 'hsl(var(--primary))', data: monthly.collected },
            { name: t('dashboard.spent'),     color: 'hsl(var(--destructive))', data: monthly.spent },
          ]} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-semibold mb-4">{t('dashboard.coverage')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <CoverageItem label={t('dashboard.reserve')} value={money(fund)} negative={fund < 0} />
            <CoverageItem label={t('dashboard.runway')} value={`${coverage.runwayMonths} ${t('dashboard.monthsShort')}`} />
            {coverage.duesPeriod && (
              <CoverageItem label={`${t('dashboard.duesIssued')} · ${coverage.duesPeriod}`} value={money(coverage.duesIssued)} />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            {coverage.runwayMonths >= 1 ? t('dashboard.safeNote', { n: coverage.runwayMonths }) : t('dashboard.tightNote')}
          </p>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t('dashboard.quickActions')}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Link to="/finance"><QuickLink icon={Plus}      title={t('dashboard.recordExpense')}     desc={t('dashboard.recordExpenseDesc')} /></Link>
          <Link to="/finance"><QuickLink icon={HandCoins} title={t('dashboard.recordPayment')}     desc={t('dashboard.recordPaymentDesc')} /></Link>
          <Link to="/structure"><QuickLink icon={Layers}  title={t('dashboard.manageStructure')}   desc={t('dashboard.manageStructureDesc')} /></Link>
        </div>
      </div>

      <MeetingsCard meetings={upcoming} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Greeting({ name, subtitle }: { name: string; subtitle: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {name ? `${t('dashboard.welcome')}, ${name}` : t('dashboard.welcome')} <span className="inline-block">👋</span>
      </h1>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
  );
}

function HeroCard({ label, amount, stats, pill, negative }: {
  label: string; amount: string; stats: { label: string; value: string }[]; pill?: string; negative?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="relative overflow-hidden rounded-xl p-6 lg:p-8 text-foreground dark:text-white"
      style={{ background: 'var(--hero-gradient)' }}
    >
      <div className="pointer-events-none absolute -top-20 -end-10 w-64 h-64 rounded-full blur-3xl bg-primary/10 dark:bg-white/10" />
      <div className="pointer-events-none absolute -bottom-20 -start-10 w-64 h-64 rounded-full blur-3xl bg-black/5 dark:bg-black/10" />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-foreground/60 dark:text-white/70">{label}</p>
          {pill && (
            <span className="text-xs font-semibold rounded-full px-3 py-1 bg-primary/10 text-primary dark:bg-white/20 dark:text-white backdrop-blur-sm">
              {pill}
            </span>
          )}
        </div>
        <p className={cn('text-5xl lg:text-6xl font-bold tracking-tight mt-3 tnum', negative && 'text-red-400 dark:text-red-200')}>
          {amount}
        </p>
        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-6">
          {stats.map((s, i) => (
            <div key={i} className={i > 0 ? 'border-s border-foreground/15 dark:border-white/20 ps-8' : ''}>
              <p className="text-xs text-foreground/50 dark:text-white/60">{s.label}</p>
              <p className="text-lg font-semibold tnum mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

type Accent = 'teal' | 'amber' | 'rose' | 'default';

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: ElementType; accent: Accent }) {
  const iconClass: Record<Accent, string> = {
    teal:    'bg-primary/10 text-primary',
    amber:   'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    rose:    'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    default: 'bg-muted text-muted-foreground',
  };
  return (
    <Card className="gap-3 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold tnum mt-1 truncate">{value}</p>
          </div>
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', iconClass[accent])}>
            <Icon size={16} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CoverageItem({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-bold tnum mt-0.5', negative ? 'text-red-400 dark:text-red-300' : 'text-foreground dark:text-white')}>
        {value}
      </p>
    </div>
  );
}

function QuickLink({ icon: Icon, title, desc }: { icon: ElementType; title: string; desc: string }) {
  return (
    <Card className="group cursor-pointer transition-shadow hover:shadow-md gap-0 py-0">
      <CardContent className="p-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
          <ArrowRight size={15} className="text-muted-foreground group-hover:text-primary transition-colors rtl:rotate-180 shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
}

function MeetingsCard({ meetings }: { meetings: Meeting[] }) {
  const { t } = useTranslation();
  if (meetings.length === 0) return null;
  return (
    <div>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t('dashboard.upcomingMeetings')}</h2>
      <div className="space-y-2">
        {meetings.map((m) => (
          <Card key={m.id} className="gap-0 py-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="shrink-0 text-center rounded-lg px-3 py-2 min-w-[52px] bg-primary/10">
                  <p className="text-[10px] text-primary font-semibold uppercase">{format(new Date(m.meeting_date), 'MMM')}</p>
                  <p className="text-xl font-bold text-primary leading-none">{format(new Date(m.meeting_date), 'd')}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{m.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(m.meeting_date), 'EEEE, MMM d, yyyy')}
                    {m.meeting_time ? ` · ${m.meeting_time.slice(0, 5)}` : ''}
                  </p>
                </div>
                <Link to="/meetings" className="text-muted-foreground hover:text-primary transition-colors shrink-0">
                  <CalendarDays size={16} />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
