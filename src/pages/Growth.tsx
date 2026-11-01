import { useEffect, useState, type ElementType } from 'react';
import { Navigate } from 'react-router-dom';
import { Users, Rocket, BadgeCheck, Building2, Mail, RefreshCw, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TrendChart } from '@/components/ui/Charts';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { fmtDate } from '@/lib/dateFmt';
import { cn } from '@/lib/utils';

/**
 * Growth — the operator's launch dashboard (platform admins only).
 * One RPC, platform_growth() (0178): who signed up and when, trials and
 * subscriptions, the waitlist, sign-ups per day. English-only like the other
 * back-office screens (Activity, Platform Licensing). Store downloads are not
 * here — Apple and Google keep those in their own consoles.
 */
type Growth = {
  generated_at: string; days: number;
  totals: { accounts_total: number; accounts_period: number; accounts_7d: number; trials: number; active: number; past_due: number; buildings_period: number; waitlist_total: number; waitlist_period: number };
  signups_by_day: { day: string; n: number }[];
  signups: { id: string; email: string; name: string | null; created_at: string; last_sign_in_at: string | null; kind: 'manager' | 'resident' | 'none'; scope: string | null; building: string | null }[];
  subscriptions: { id: string; status: string; plan: string; scope_type: string; scope_name: string | null; city: string | null; license_count: number; billing_email: string | null; trial_ends_at: string | null; current_period_end: string | null; created_at: string }[];
  waitlist: { id: string; email: string; locale: string | null; source: string | null; created_at: string }[];
};

const STATUS_COLOR: Record<string, 'green' | 'yellow' | 'red' | 'slate' | 'indigo'> = {
  trial: 'indigo', active: 'green', past_due: 'yellow', grace: 'yellow', locked: 'red', cancelled: 'slate',
};

export default function Growth() {
  const { t } = useTranslation();
  const { isPlatformAdmin, loading: authLoading } = useAuth();
  const [days, setDays] = useState(30);
  const [includeTest, setIncludeTest] = useState(false);
  const [data, setData] = useState<Growth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    const { data: d, error: e } = await supabase.rpc('platform_growth', { p_days: days, p_include_test: includeTest });
    if (e) setError(e.message); else setData(d as Growth);
    setLoading(false);
  }
  useEffect(() => { if (isPlatformAdmin) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isPlatformAdmin, days, includeTest]);

  if (authLoading) return null;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  const totals = data?.totals;
  const daysAgo = (iso: string | null) => iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Growth</h1>
          <p className="text-sm text-muted-foreground">Who signed up, who is trying, who is paying. Store downloads live in App Store Connect and Play Console.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 bg-secondary/60 rounded-xl">
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={cn('px-3 py-1 text-xs font-medium rounded-lg cursor-pointer', days === d ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>{d}d</button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" className="accent-primary" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> include our test accounts
          </label>
          <Button variant="outline" size="sm" onClick={load} loading={loading}><RefreshCw size={14} /></Button>
        </div>
      </div>

      {error && <Card><CardBody><p className="text-sm text-destructive flex items-center gap-2"><AlertCircle size={16} /> {error}</p></CardBody></Card>}
      {loading && !data ? <SkeletonCards count={4} /> : totals && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label={`Accounts · last ${days}d`} value={totals.accounts_period} sub={`${totals.accounts_7d} in the last 7 days · ${totals.accounts_total} all time`} icon={Users} />
            <Tile label="Trials running" value={totals.trials} sub={`${totals.buildings_period} buildings created in ${days}d`} icon={Rocket} />
            <Tile label="Paying" value={totals.active} sub={totals.past_due ? `${totals.past_due} past due` : 'none past due'} icon={BadgeCheck} tone={totals.past_due ? 'amber' : 'teal'} />
            <Tile label="Waitlist" value={totals.waitlist_total} sub={`${totals.waitlist_period} in ${days}d`} icon={Mail} />
          </div>

          <Card><CardBody>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-primary">Sign-ups per day</p>
              <span className="text-xs text-muted-foreground">last {days} days · tap for values</span>
            </div>
            <TrendChart
              labels={(data?.signups_by_day ?? []).map((d) => fmtDate(d.day, 'dd MMM'))}
              series={[{ name: 'Sign-ups', color: '#22E0CB', data: (data?.signups_by_day ?? []).map((d) => d.n) }]}
            />
          </CardBody></Card>

          <Section title="Sign-ups" count={data?.signups.length ?? 0} empty="No accounts yet in this period.">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-start font-medium">Who</th>
                <th className="px-4 py-2 text-start font-medium">Role</th>
                <th className="px-4 py-2 text-start font-medium">Building</th>
                <th className="px-4 py-2 text-start font-medium">Signed up</th>
                <th className="px-4 py-2 text-start font-medium">Last seen</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data?.signups.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5" data-primary=""><span className="font-medium text-foreground">{u.name || '—'}</span><span className="block text-xs text-muted-foreground break-all">{u.email}</span></td>
                    <td className="px-4 py-2.5"><Badge color={u.kind === 'manager' ? 'indigo' : u.kind === 'resident' ? 'green' : 'slate'}>{u.kind === 'none' ? 'no building yet' : u.kind}</Badge></td>
                    <td className="px-4 py-2.5 text-foreground">{u.scope ?? u.building ?? '—'}</td>
                    <td className="px-4 py-2.5 tnum text-foreground">{fmtDate(u.created_at, 'dd-MM-yyyy HH:mm')}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.last_sign_in_at ? `${daysAgo(u.last_sign_in_at)}d ago` : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Trials and subscriptions" count={data?.subscriptions.length ?? 0} empty="No subscriptions yet.">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-start font-medium">Building</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-start font-medium">Units</th>
                <th className="px-4 py-2 text-start font-medium">Contact</th>
                <th className="px-4 py-2 text-start font-medium">Trial ends</th>
                <th className="px-4 py-2 text-start font-medium">Started</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data?.subscriptions.map((s) => {
                  const left = daysAgo(s.trial_ends_at) === null ? null : Math.round((new Date(s.trial_ends_at!).getTime() - Date.now()) / 86400000);
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5" data-primary=""><span className="font-medium text-foreground">{s.scope_name ?? s.scope_type}</span>{s.city && <span className="block text-xs text-muted-foreground">{s.city}</span>}</td>
                      <td className="px-4 py-2.5"><Badge color={STATUS_COLOR[s.status] ?? 'slate'}>{s.status}</Badge> <span className="text-xs text-muted-foreground">{s.plan}</span></td>
                      <td className="px-4 py-2.5 tnum">{s.license_count}</td>
                      <td className="px-4 py-2.5 text-muted-foreground break-all">{s.billing_email ?? '—'}</td>
                      <td className="px-4 py-2.5 tnum">{s.status === 'trial' && s.trial_ends_at ? `${fmtDate(s.trial_ends_at, 'dd-MM-yyyy')} (${left}d)` : s.current_period_end ? `renews ${fmtDate(s.current_period_end, 'dd-MM-yyyy')}` : '—'}</td>
                      <td className="px-4 py-2.5 tnum text-muted-foreground">{fmtDate(s.created_at, 'dd-MM-yyyy')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="Waitlist" count={data?.waitlist.length ?? 0} empty="Nobody on the waitlist.">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-start font-medium">Email</th>
                <th className="px-4 py-2 text-start font-medium">Language</th>
                <th className="px-4 py-2 text-start font-medium">Source</th>
                <th className="px-4 py-2 text-start font-medium">Joined</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data?.waitlist.map((w) => (
                  <tr key={w.id}>
                    <td className="px-4 py-2.5 text-foreground break-all" data-primary="">{w.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{w.locale ?? '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{w.source ?? '—'}</td>
                    <td className="px-4 py-2.5 tnum text-muted-foreground">{fmtDate(w.created_at, 'dd-MM-yyyy HH:mm')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <p className="text-[11px] text-muted-foreground">{t('common.updated', { defaultValue: 'Updated' })} {data ? fmtDate(data.generated_at, 'dd-MM-yyyy HH:mm') : ''}</p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, tone = 'teal' }: { label: string; value: number; sub?: string; icon: ElementType; tone?: 'teal' | 'amber' }) {
  return (
    <Card className="gap-3 py-4"><CardBody className="px-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-bold tnum mt-1">{value}</p>
          {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', tone === 'amber' ? 'bg-amber-400/15 text-amber-300' : 'bg-primary/15 text-primary')}><Icon size={16} /></div>
      </div>
    </CardBody></Card>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-primary">{title}</p>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
        {count === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
      </CardBody>
    </Card>
  );
}
