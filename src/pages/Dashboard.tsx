import { useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { supabase } from '@/lib/supabase';
import type { Meeting, AdjustmentKind } from '@/types';
import { adjustmentEffect } from '@/lib/balance';
import { TrendChart } from '@/components/ui/Charts';
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Card, CardContent } from '@/components/ui/Card';
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
  const { profile, isPlatformAdmin, canAny, myUnitIds, residentLens, residentUnitId } = useAuth();
  const { buildings, loading: buildingsLoading } = useManagedBuildings();
  // Dual-persona lens: an admin browsing "My home" gets the resident dashboard.
  const isManager = (isPlatformAdmin || canAny('finance.view')) && !residentLens;
  // Monotonic request id: a slow, stale response must never overwrite a newer one.
  const loadSeq = useRef(0);

  const [agg, setAgg] = useState<Agg>({ collected: 0, spent: 0, billed: 0, outstanding: 0, ytd: 0, units: 0, openIssues: 0 });
  const [monthly, setMonthly] = useState<{ labels: string[]; collected: number[]; spent: number[] }>({ labels: [], collected: [], spent: [] });
  const [resident, setResident] = useState({ charged: 0, paid: 0, opening: 0 });
  const [myUnits, setMyUnits] = useState<{ id: string; label: string; buildingName: string; balance: number }[]>([]);
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const entities = useEntities(buildings);
  const [entityKey, setEntityKey] = useState('');
  const [blockFilters, setBlockFilters] = useState<string[]>([]);
  useEffect(() => { setBlockFilters([]); }, [entityKey]);
  // Platform admin gets NO "All buildings" mode: cross-tenant totals are
  // meaningless for the operator and the most expensive query in the app —
  // force one entity at a time.
  useEffect(() => {
    if (isPlatformAdmin && !entityKey && entities.length) setEntityKey(entities[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin, entityKey, entities]);
  const selEntity = entities.find((e) => e.key === entityKey) ?? null;
  const [coverage, setCoverage] = useState({ runwayMonths: 0, duesIssued: 0, duesPeriod: '' });
  const buildingIds = useMemo(() => buildings.map((b) => b.id), [buildings]);
  const idsKey = buildingIds.join(',');

  useEffect(() => {
    // Wait for the building list — querying with an empty scope produces an
    // all-zero result that can land AFTER the real one and overwrite it.
    if (buildingsLoading) return;
    // Platform admin: wait for the forced entity selection (no all-buildings query).
    if (isPlatformAdmin && !entityKey) return;
    if (isManager) loadManager();
    else if (myUnitIds.length) loadResident();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingsLoading, idsKey, isManager, entityKey, blockFilters, residentUnitId]);

  useEffect(() => {
    if (buildingsLoading) return;
    if (isPlatformAdmin && !entityKey) return;
    const today = new Date().toISOString().slice(0, 10);
    let q = supabase.from('meetings').select('*').gte('meeting_date', today);
    if (isManager) {
      const scope = entityKey ? (blockFilters.length > 0 ? blockFilters : (selEntity?.buildingIds ?? buildingIds)) : buildingIds;
      q = q.in('building_id', scope.length ? scope : ['00000000-0000-0000-0000-000000000000']);
    }
    q.order('meeting_date', { ascending: true }).limit(5).then(({ data }) => setUpcoming((data as Meeting[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingsLoading, idsKey, entityKey, blockFilters, isManager]);

  async function loadManager() {
    const seq = ++loadSeq.current;
    const ent = entities.find((e) => e.key === entityKey);
    const scope = entityKey ? (blockFilters.length > 0 ? blockFilters : (ent?.buildingIds ?? buildingIds)) : buildingIds;
    const inIds = scope.length ? scope : ['00000000-0000-0000-0000-000000000000'];

    // Server-side aggregation (0049): the DB answers with numbers, not rows —
    // no payload growth, no silent 1000-row truncation as history accumulates.
    const [statsRes, monthlyRes] = await Promise.all([
      supabase.rpc('dashboard_stats', { p_building_ids: inIds }),
      supabase.rpc('dashboard_monthly', { p_building_ids: inIds }),
    ]);

    // Never render silent zeros on failure (e.g. migration 0049 not applied) —
    // say so, and keep whatever was on screen.
    if (statsRes.error || monthlyRes.error) {
      if (seq !== loadSeq.current) return;
      const msg = statsRes.error?.message ?? monthlyRes.error?.message ?? '';
      console.error('dashboard load failed:', msg);
      toast.error(`Dashboard data failed to load: ${msg}`);
      return;
    }

    const s = (Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data) as {
      billed: number; collected: number; outstanding: number; ytd: number;
      units: number; open_issues: number; dues_period: string; dues_issued: number;
    } | undefined;
    const monthsRows = ((monthlyRes.data ?? []) as { month_start: string; collected: number; spent: number }[]);

    const billed = Number(s?.billed ?? 0);
    const collected = Number(s?.collected ?? 0);
    const spent = billed;

    const labels = monthsRows.map((m) => format(new Date(m.month_start), 'MMM yy'));
    const monthlyCollected = monthsRows.map((m) => Number(m.collected));
    const monthlySpent = monthsRows.map((m) => Number(m.spent));

    const avgMonthlySpend = monthlySpent.reduce((a, b) => a + b, 0) / 12;
    const reserve = Math.round((collected - spent) * 100) / 100;
    const runwayMonths = avgMonthlySpend > 0 ? Math.floor(Math.max(0, reserve) / avgMonthlySpend) : 0;

    // A newer load started while this one was in flight — discard, don't overwrite.
    if (seq !== loadSeq.current) return;
    setCoverage({ runwayMonths, duesIssued: Number(s?.dues_issued ?? 0), duesPeriod: s?.dues_period ?? '' });
    setAgg({
      collected, spent, billed,
      outstanding: Number(s?.outstanding ?? 0),
      ytd: Number(s?.ytd ?? 0),
      units: Number(s?.units ?? 0),
      openIssues: Number(s?.open_issues ?? 0),
    });
    setMonthly({ labels, collected: monthlyCollected, spent: monthlySpent });
  }

  async function loadResident() {
    // Unit picker: '' = all my units, otherwise drill into one.
    const pickedIds = residentUnitId ? [residentUnitId] : myUnitIds;
    const inIds = pickedIds.length ? pickedIds : ['00000000-0000-0000-0000-000000000000'];
    const [c, p, u, a] = await Promise.all([
      supabase.from('charges').select('amount_usd, unit_id').in('unit_id', inIds).is('voided_at', null),
      supabase.from('payments').select('amount_usd, unit_id').in('unit_id', inIds).is('voided_at', null),
      supabase.from('units').select('id, label, opening_balance, building_id, buildings(name)').in('id', inIds),
      supabase.from('adjustments').select('kind, amount_usd, unit_id').in('unit_id', inIds).is('voided_at', null),
    ]);
    const adj = ((a.data ?? []) as { kind: AdjustmentKind; amount_usd: number }[])
      .reduce((s, r) => s + adjustmentEffect(r.kind, Number(r.amount_usd)), 0);
    setResident({
      charged: ((c.data ?? []) as { amount_usd: number }[]).reduce((s, r) => s + Number(r.amount_usd), 0),
      paid: ((p.data ?? []) as { amount_usd: number }[]).reduce((s, r) => s + Number(r.amount_usd), 0),
      opening: ((u.data ?? []) as { opening_balance: number }[]).reduce((s, r) => s + Number(r.opening_balance ?? 0), 0) + adj,
    });

    // Portfolio: per-unit balances, so an investor with units in several
    // buildings sees each one — not just an opaque combined total.
    const perUnit: Record<string, number> = {};
    for (const id of inIds) perUnit[id] = 0;
    ((u.data ?? []) as { id: string; opening_balance: number }[]).forEach((r) => {
      perUnit[r.id] = (perUnit[r.id] ?? 0) + Number(r.opening_balance ?? 0);
    });
    ((p.data ?? []) as { amount_usd: number; unit_id: string }[]).forEach((r) => {
      perUnit[r.unit_id] = (perUnit[r.unit_id] ?? 0) + Number(r.amount_usd);
    });
    ((c.data ?? []) as { amount_usd: number; unit_id: string }[]).forEach((r) => {
      perUnit[r.unit_id] = (perUnit[r.unit_id] ?? 0) - Number(r.amount_usd);
    });
    ((a.data ?? []) as { kind: AdjustmentKind; amount_usd: number; unit_id: string }[]).forEach((r) => {
      perUnit[r.unit_id] = (perUnit[r.unit_id] ?? 0) + adjustmentEffect(r.kind, Number(r.amount_usd));
    });
    setMyUnits(
      (((u.data ?? []) as unknown) as { id: string; label: string; buildings: { name: string } | null }[]).map((r) => ({
        id: r.id,
        label: r.label,
        buildingName: r.buildings?.name ?? '—',
        balance: Math.round((perUnit[r.id] ?? 0) * 100) / 100,
      })),
    );
  }

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const fund = Math.round((agg.collected - agg.spent) * 100) / 100;
  const collectionRate = agg.billed > 0 ? Math.round((agg.collected / agg.billed) * 100) : 0;

  // ── Resident view ──────────────────────────────────────────────────────────
  if (!isManager) {
    const balance = Math.round((resident.opening + resident.paid - resident.charged) * 100) / 100;
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
        {/* Portfolio: one card per unit when the account spans several (investor case) */}
        {myUnits.length > 1 && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t('dashboard.myUnits')}</h2>
            <div className="space-y-2">
              {myUnits.map((u) => (
                <Card key={u.id} className="gap-0 py-0">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Home size={17} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{u.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.buildingName}</p>
                      </div>
                      <p className={cn('text-lg font-semibold tnum shrink-0', u.balance < 0 ? 'text-red-500 dark:text-red-300' : 'text-foreground')}>
                        {money(u.balance)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
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
                {!isPlatformAdmin && <SelectItem value="__all__">{t('dashboard.allBuildings')}</SelectItem>}
                {entities.map((e) => (
                  <SelectItem key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</SelectItem>
                ))}
              </SelectContent>
            </RadixSelect>
          )}
          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <MultiSelect
              options={selEntity.blocks.map(b => ({ value: b.id, label: b.name }))}
              value={blockFilters}
              onChange={setBlockFilters}
              allLabel={t('finance.allBlocks')}
            />
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
        <StatCard label={t('dashboard.outstanding')} value={money(agg.outstanding)} icon={AlertCircle}   accent="teal" />
        <StatCard label={t('dashboard.totalBilled')}  value={money(agg.billed)}      icon={TrendingUp}    accent="teal" />
        <StatCard label={t('dashboard.units')}        value={String(agg.units)}      icon={Home}          accent="teal" />
        <StatCard label={t('dashboard.openIssues')}   value={String(agg.openIssues)} icon={AlertTriangle} accent="teal" />
      </div>

      {/* Charts */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold">{t('dashboard.collectedVsSpent')}</p>
            <span className="text-xs text-muted-foreground">{t('dashboard.last12Hover')}</span>
          </div>
          <TrendChart labels={monthly.labels} series={[
            { name: t('dashboard.collected'), color: 'var(--primary)', data: monthly.collected },
            { name: t('dashboard.spent'),     color: 'var(--destructive)', data: monthly.spent },
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
    teal:    'bg-primary/15 text-primary',
    amber:   'bg-amber-400/15 text-amber-300',
    rose:    'bg-rose-400/15 text-rose-300',
    default: 'bg-primary/10 text-primary/50',
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
