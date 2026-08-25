import { useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { gsHiddenKey } from '@/pages/GettingStarted';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { fmtDate } from '@/lib/dateFmt';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { supabase } from '@/lib/supabase';
import { tenantTitle } from '@/lib/reportData';
import type { Meeting, AdjustmentKind, FundPosition } from '@/types';
import { adjustmentEffect } from '@/lib/balance';
import { TrendChart } from '@/components/ui/Charts';
import { PendingInvites } from '@/components/PendingInvites';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Home, TrendingUp, AlertCircle, Wallet, Building2,
  Plus, HandCoins, Layers, ArrowRight, CalendarDays,
} from 'lucide-react';
import { fmtMoney } from '@/lib/money';

// one formatter, following the reader's language (src/lib/money.ts)
const money = (n: number) => fmtMoney(n);
interface Agg {
  collected: number; spent: number; billed: number; outstanding: number; ytd: number;
  units: number; openIssues: number;
  carry: number; // net opening balances + adjustments (T2 / 0061)
}

// Raw resident rows, held so the period filter re-slices without a refetch.
type RCharge = { amount_usd: number; unit_id: string; billed_to?: string; tenant_id?: string | null; charge_date: string };
type RPayment = { amount_usd: number; unit_id: string; paid_by?: string; tenant_id?: string | null; paid_on: string };
type RAdjustment = { kind: AdjustmentKind; amount_usd: number; unit_id: string; party?: string; tenant_id?: string | null; effective_date: string };
type RUnit = { id: string; label: string; opening_balance: number; opening_balance_date: string | null; building_id: string; buildings: { name: string } | null };
type RMembership = { unit_id: string; user_id: string; tenure: string; ended_at: string | null; profiles: { full_name: string } | null };

export default function Dashboard() {
  const { t } = useTranslation();
  const { profile, isPlatformAdmin, canAny, grants, myUnitIds, myOwnerUnitIds, myTenantUnitIds, residentLens, residentUnitId } = useAuth();

  // New admins land on the setup checklist instead of an empty dashboard —
  // but only ONCE per session, so a deliberate Dashboard click still works.
  // (Return happens after all hooks — early-returning here breaks hook order.)
  const isScopeAdmin = grants.some(g => ['building_admin', 'compound_admin', 'org_admin'].includes(g.role));
  const routeToSetup =
    isScopeAdmin && !isPlatformAdmin && !residentLens
    && localStorage.getItem(gsHiddenKey(profile?.id)) !== '1'
    && sessionStorage.getItem('abniyah_gs_routed') !== '1';
  const { buildings, loading: buildingsLoading } = useManagedBuildings();
  // Dual-persona lens: an admin browsing "My home" gets the resident dashboard.
  const isManager = (isPlatformAdmin || canAny('finance.view')) && !residentLens;
  // Monotonic request id: a slow, stale response must never overwrite a newer one.
  const loadSeq = useRef(0);

  const [agg, setAgg] = useState<Agg>({ collected: 0, spent: 0, billed: 0, outstanding: 0, ytd: 0, units: 0, openIssues: 0, carry: 0 });
  const [monthly, setMonthly] = useState<{ labels: string[]; collected: number[]; spent: number[] }>({ labels: [], collected: [], spent: [] });
  // 0106: cash on hand, apart from what residents owe. null until the RPC
  // exists (migration not applied) — the hero then falls back to the net
  // position it always showed, under its honest name.
  const [fundPos, setFundPos] = useState<FundPosition | null>(null);
  const [rRaw, setRRaw] = useState<{
    unitIds: string[]; charges: RCharge[]; payments: RPayment[];
    adjustments: RAdjustment[]; units: RUnit[]; memberships: RMembership[];
  }>({ unitIds: [], charges: [], payments: [], adjustments: [], units: [], memberships: [] });
  /** 'combined' | 'owner' | `cur:<buildingId>` | `fmr:<buildingId>` */
  const [residentView, setResidentView] = useState('combined');
  // Residents get the same period control as managers (mirrors Finance).
  const [rPeriod, setRPeriod] = useState<'month' | 'year' | 'all'>('all');
  const [rMonth, setRMonth] = useState(() => new Date().toISOString().slice(0, 7));
  // Manager period. Flows are summed inside it; positions (outstanding, fund)
  // and counts (units, open issues) are taken AS OF its last day — see 0072.
  const [mPeriod, setMPeriod] = useState<'month' | 'year' | 'all'>('all');
  const [mMonth, setMMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const { mFrom, mTo } = useMemo(() => {
    const now = new Date();
    if (mPeriod === 'year') return { mFrom: iso(new Date(now.getFullYear(), 0, 1)), mTo: iso(new Date(now.getFullYear(), 11, 31)) };
    if (mPeriod === 'month') {
      const [y, m] = mMonth.split('-').map(Number);
      return { mFrom: iso(new Date(y, m - 1, 1)), mTo: iso(new Date(y, m, 0)) };
    }
    return { mFrom: null as string | null, mTo: null as string | null };
  }, [mPeriod, mMonth]);
  const mAsOfLabel = mTo && mPeriod !== 'all' ? fmtDate(mTo, 'MMM d, yyyy') : '';
  const [upcoming, setUpcoming] = useState<Meeting[]>([]);
  const entities = useEntities(buildings);
  // GLOBAL entity selection — picked once in the sidebar, applied everywhere.
  const { entityKey } = useAuth();
  const [blockFilters, setBlockFilters] = useState<string[]>([]);
  useEffect(() => { setBlockFilters([]); }, [entityKey]);
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
  }, [buildingsLoading, idsKey, isManager, entityKey, blockFilters, residentUnitId, mFrom, mTo]);

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
    // The period goes DOWN to the RPCs (0072) for the same reason: filtering it
    // here would mean fetching every row back, which is what 0049 removed.
    // Until 0072 is applied the RPCs have no period parameters, and PostgREST
    // answers "function not found" (PGRST202) rather than ignoring them — which
    // would take the whole manager dashboard down between deploy and migration.
    // So: try with the period, fall back to the un-filtered call.
    const rpcWithPeriod = async (fn: string, withPeriod: Record<string, unknown>) => {
      const res = await supabase.rpc(fn, { p_building_ids: inIds, ...withPeriod });
      if (res.error?.code === 'PGRST202') {
        const plain = await supabase.rpc(fn, { p_building_ids: inIds });
        return { ...plain, degraded: !plain.error };
      }
      return { ...res, degraded: false };
    };
    const [statsRes, monthlyRes, carryRes, fundRes] = await Promise.all([
      rpcWithPeriod('dashboard_stats', { p_from: mFrom, p_to: mTo }),
      rpcWithPeriod('dashboard_monthly', { p_to: mTo }),
      // T2: net carry (opening balances + adjustments) so the Fund balance
      // reflects units that joined with a balance (0061).
      rpcWithPeriod('dashboard_carry', { p_to: mTo }),
      // 0106: cash on hand. Missing function (PGRST202) = not applied yet → null.
      supabase.rpc('fund_position', { p_building_ids: inIds, p_to: mTo }),
    ]);
    // Say so rather than showing all-time numbers under a period label.
    if (statsRes.degraded && mPeriod !== 'all' && seq === loadSeq.current) {
      toast.error(t('dashboard.periodNeedsMigration'));
    }

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
    // net opening + adjustments; tolerate an un-applied 0061 (carry = 0)
    const carry = carryRes.error ? 0 : Number((Array.isArray(carryRes.data) ? carryRes.data[0] : carryRes.data) ?? 0);

    const labels = monthsRows.map((m) => fmtDate(m.month_start, 'MMM yy'));
    const monthlyCollected = monthsRows.map((m) => Number(m.collected));
    const monthlySpent = monthsRows.map((m) => Number(m.spent));

    const fundRow = fundRes.error ? null : ((Array.isArray(fundRes.data) ? fundRes.data[0] : fundRes.data) as FundPosition | undefined) ?? null;

    const avgMonthlySpend = monthlySpent.reduce((a, b) => a + b, 0) / 12;
    // Runway is months of spend the building can pay WITHOUT billing anyone:
    // that is "available" (cash minus what is held for residents), not the
    // net position it used to be (0106). Falls back when the RPC is absent.
    const reserve = fundRow ? Number(fundRow.available) : Math.round((collected - spent) * 100) / 100;
    const runwayMonths = avgMonthlySpend > 0 ? Math.floor(Math.max(0, reserve) / avgMonthlySpend) : 0;

    // A newer load started while this one was in flight — discard, don't overwrite.
    if (seq !== loadSeq.current) return;
    setFundPos(fundRow);
    setCoverage({ runwayMonths, duesIssued: Number(s?.dues_issued ?? 0), duesPeriod: s?.dues_period ?? '' });
    setAgg({
      collected, spent, billed, carry,
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
    const [c, p, u, a, mem] = await Promise.all([
      supabase.from('charges').select('amount_usd, unit_id, billed_to, tenant_id, charge_date').in('unit_id', inIds).is('voided_at', null),
      supabase.from('payments').select('amount_usd, unit_id, paid_by, tenant_id, paid_on').in('unit_id', inIds).is('voided_at', null),
      supabase.from('units').select('id, label, opening_balance, opening_balance_date, building_id, buildings(name)').in('id', inIds),
      supabase.from('adjustments').select('kind, amount_usd, unit_id, party, tenant_id, effective_date').in('unit_id', inIds).is('voided_at', null),
      // ended memberships included so a departed tenant still resolves by name
      supabase.from('memberships').select('unit_id, user_id, tenure, ended_at, profiles(full_name)').in('unit_id', inIds),
    ]);
    // 0106: the building's cash, as aggregates only (the function is gated to
    // members). Transparency is the pitch; nobody else's credit is shown.
    const rBuildingIds = [...new Set(((u.data ?? []) as unknown as RUnit[]).map((x) => x.building_id))];
    if (rBuildingIds.length) {
      supabase.rpc('fund_position', { p_building_ids: rBuildingIds }).then(({ data, error }) => {
        const row = error ? null : (Array.isArray(data) ? data[0] : data) as FundPosition | undefined;
        setFundPos(row ?? null);
      });
    }
    // Rows are kept RAW so the period filter re-slices them without a refetch.
    setRRaw({
      unitIds: inIds,
      charges: (c.data ?? []) as RCharge[],
      payments: (p.data ?? []) as RPayment[],
      adjustments: (a.data ?? []) as RAdjustment[],
      units: (u.data ?? []) as unknown as RUnit[],
      memberships: (mem.data ?? []) as unknown as RMembership[],
    });
  }

  // ── Resident figures, derived from the raw rows ──────────────────────────
  // The period scopes charged/paid (movement inside the window) and the balance
  // becomes the running balance AS OF the window's last day — never a sum of
  // the window, which would not be a balance at all.
  const rDerived = useMemo(() => {
    const now = new Date();
    let range: { from: Date; to: Date } | null = null;
    if (rPeriod === 'year') range = { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
    else if (rPeriod === 'month') { const [y, m] = rMonth.split('-').map(Number); range = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) }; }
    const asOf = range?.to ?? null;
    const inRange = (d: string) => !range || (new Date(d) >= range.from && new Date(d) <= range.to);
    const upTo = (d: string) => !asOf || new Date(d) <= asOf;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const { charges: C, payments: P, adjustments: A, units: U, memberships: M, unitIds } = rRaw;
    const isTenantRow = (party?: string) => party === 'tenant';
    const currentIds = new Set(M.filter((m) => m.tenure === 'tenant' && !m.ended_at).map((m) => m.user_id));
    const isCur = (tid?: string | null) => !!tid && currentIds.has(tid);
    const nameOf = (id: string) => M.find((m) => m.user_id === id)?.profiles?.full_name ?? null;
    const buildingOf = (unitId: string) => U.find((x) => x.id === unitId)?.building_id ?? '';

    const sum = <R extends { amount_usd: number }>(rows: R[]) => rows.reduce((s, x) => s + Number(x.amount_usd), 0);
    const eff = (rows: RAdjustment[]) => rows.reduce((s, x) => s + adjustmentEffect(x.kind, Number(x.amount_usd)), 0);
    // opening balances only count once their as-of date has arrived (0033)
    const opening = U.reduce((s, u) => s + (
      (!asOf || !u.opening_balance_date || new Date(u.opening_balance_date) <= asOf) ? Number(u.opening_balance ?? 0) : 0), 0);

    // shown = inside the window; live = everything up to the window's end
    const cShown = C.filter((x) => inRange(x.charge_date));
    const pShown = P.filter((x) => inRange(x.paid_on));
    const cLive = C.filter((x) => upTo(x.charge_date));
    const pLive = P.filter((x) => upTo(x.paid_on));
    const aLive = A.filter((x) => upTo(x.effective_date));

    const ownerBal = r2(opening + sum(pLive.filter((x) => !isTenantRow(x.paid_by)))
      - sum(cLive.filter((x) => x.billed_to !== 'tenant')) + eff(aLive.filter((x) => !isTenantRow(x.party))));
    const tenantBal = r2(sum(pLive.filter((x) => isTenantRow(x.paid_by)))
      - sum(cLive.filter((x) => x.billed_to === 'tenant')) + eff(aLive.filter((x) => isTenantRow(x.party))));
    const combined = r2(ownerBal + tenantBal);

    const viewerIsTenant = unitIds.some((id) => myTenantUnitIds.includes(id))
      && !unitIds.some((id) => myOwnerUnitIds.includes(id));

    /** One tenant bucket: a building + current-or-former. */
    const bucket = (bid: string | null, wantCur: boolean) => {
      const inScope = (unitId: string) => bid === null || buildingOf(unitId) === bid;
      const pick = <R extends { unit_id: string; tenant_id?: string | null }>(rows: R[]) =>
        rows.filter((x) => inScope(x.unit_id) && isCur(x.tenant_id) === wantCur);
      const c = pick(cShown.filter((x) => x.billed_to === 'tenant'));
      const p = pick(pShown.filter((x) => isTenantRow(x.paid_by)));
      const cl = pick(cLive.filter((x) => x.billed_to === 'tenant'));
      const pl = pick(pLive.filter((x) => isTenantRow(x.paid_by)));
      const al = pick(aLive.filter((x) => isTenantRow(x.party)));
      const names = Array.from(new Set([
        ...(wantCur ? M.filter((m) => m.tenure === 'tenant' && !m.ended_at && inScope(m.unit_id)).map((m) => m.user_id) : []),
        ...[...cl, ...pl, ...al].map((x) => x.tenant_id).filter((id): id is string => !!id).filter((id) => isCur(id) === wantCur),
      ])).map(nameOf).filter((n): n is string => !!n);
      return { charged: sum(c), paid: sum(p), balance: r2(sum(pl) - sum(cl) + eff(al)), names,
               exists: cl.length > 0 || pl.length > 0 || al.length > 0 || (wantCur && names.length > 0) };
    };

    // One bucket pair per building the resident holds units in, so two
    // buildings never comingle their tenants (only visible on "All buildings").
    const buildingIds = Array.from(new Set(U.map((u) => u.building_id)));
    const multiBuilding = buildingIds.length > 1;
    const buckets = buildingIds.flatMap((bid) => {
      const bname = U.find((u) => u.building_id === bid)?.buildings?.name ?? '';
      const mk = (wantCur: boolean) => {
        const b = bucket(bid, wantCur);
        if (!b.exists) return [];
        const base = tenantTitle(
          wantCur ? t('finance.currentTenant')
            : (b.names.length > 1 ? t('finance.formerTenants') : t('finance.formerTenant')),
          b.names.join(', ') || null);
        return [{ key: `${wantCur ? 'cur' : 'fmr'}:${bid}`, label: multiBuilding ? `${bname} · ${base}` : base, ...b }];
      };
      return [...mk(true), ...mk(false)];
    });

    return {
      charged: sum(cShown), paid: sum(pShown),
      ownerCharged: sum(cShown.filter((x) => x.billed_to !== 'tenant')),
      ownerPaid: sum(pShown.filter((x) => !isTenantRow(x.paid_by))),
      tenantCharged: sum(cShown.filter((x) => x.billed_to === 'tenant')),
      tenantPaid: sum(pShown.filter((x) => isTenantRow(x.paid_by))),
      ownerBal, tenantBal, combined, viewerIsTenant, buckets,
      canSplit: !viewerIsTenant && buckets.length > 0,
      asOfLabel: asOf ? fmtDate(asOf, 'MMM d, yyyy') : '',
      // per-unit balances for the portfolio cards, as of the same date
      perUnit: U.map((u) => ({
        id: u.id, label: u.label, buildingName: u.buildings?.name ?? '—',
        balance: r2(
          ((!asOf || !u.opening_balance_date || new Date(u.opening_balance_date) <= asOf) ? Number(u.opening_balance ?? 0) : 0)
          + sum(pLive.filter((x) => x.unit_id === u.id)) - sum(cLive.filter((x) => x.unit_id === u.id))
          + eff(aLive.filter((x) => x.unit_id === u.id))),
      })),
    };
  }, [rRaw, rPeriod, rMonth, myOwnerUnitIds, myTenantUnitIds, t]);

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  // Fund balance = cash surplus + carried-in balances (opening + adjustments),
  // i.e. the true net book position. carry is 0 when no unit had a starting
  // balance, so this is unchanged for those buildings. (T2)
  const fund = Math.round((agg.collected - agg.spent + agg.carry) * 100) / 100;
  const collectionRate = agg.billed > 0 ? Math.round((agg.collected / agg.billed) * 100) : 0;

  if (routeToSetup) {
    sessionStorage.setItem('abniyah_gs_routed', '1');
    return <Navigate to="/getting-started" replace />;
  }
  // A collector (0110) has no book and no unit: their screen is /collect.
  if (!isManager && !myUnitIds.length && canAny('payment.record')) {
    return <Navigate to="/collect" replace />;
  }

  // ── Resident view ──────────────────────────────────────────────────────────
  if (!isManager) {
    // A tenant sees their own side only. An owner toggles Combined / Owner /
    // a building's current or former tenants. A selected bucket can vanish when
    // the unit scope changes, so fall back to Combined rather than show zeros.
    const selected = rDerived.buckets.find((b) => b.key === residentView);
    const effective = rDerived.viewerIsTenant ? 'tenant'
      : (residentView === 'combined' || residentView === 'owner') ? residentView
      : selected ? residentView : 'combined';

    const balance = effective === 'owner' ? rDerived.ownerBal
      : effective === 'tenant' ? rDerived.tenantBal
      : selected ? selected.balance : rDerived.combined;
    const shownCharged = effective === 'owner' ? rDerived.ownerCharged
      : effective === 'tenant' ? rDerived.tenantCharged
      : selected ? selected.charged : rDerived.charged;
    const shownPaid = effective === 'owner' ? rDerived.ownerPaid
      : effective === 'tenant' ? rDerived.tenantPaid
      : selected ? selected.paid : rDerived.paid;

    // Combined / Owner, then each building's current and former tenant buckets.
    const viewOptions = [
      { key: 'combined', label: t('finance.view.combined') },
      { key: 'owner', label: t('finance.view.owner') },
      ...rDerived.buckets.map((b) => ({ key: b.key, label: b.label })),
    ];
    const myUnits = rDerived.perUnit;
    // Mirrors the MANAGER dashboard's structure (full-width hero, card grid)
    // so switching the Managing / My home lens changes the data, not the app.
    return (
      <div className="space-y-6">
        <PendingInvites />
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <Greeting name={firstName} subtitle={t('dashboard.accountGlance')} lens="home" />
          <div className="flex items-center gap-2 flex-wrap">
            <RadixSelect value={rPeriod} onValueChange={(v) => setRPeriod(v as 'month' | 'year' | 'all')}>
              <SelectTrigger className="min-w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('finance.allTime')}</SelectItem>
                <SelectItem value="year">{t('finance.thisYear')}</SelectItem>
                <SelectItem value="month">{t('finance.month')}</SelectItem>
              </SelectContent>
            </RadixSelect>
            {rPeriod === 'month' && <MonthPicker value={rMonth} onChange={setRMonth} />}
          </div>
        </div>
        {rDerived.canSplit && (
          <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5 text-sm gap-0.5">
            {viewOptions.map((o) => (
              <button key={o.key} onClick={() => setResidentView(o.key)}
                className={cn('px-3 py-1.5 rounded-md transition', effective === o.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <HeroCard
          label={`${balance < 0 ? t('dashboard.youOwe') : t('dashboard.creditBalance')}${
            rDerived.asOfLabel ? ` · ${t('finance.asOf', { date: rDerived.asOfLabel })}` : ''}`}
          amount={money(Math.abs(balance))}
          negative={balance < 0}
          stats={[
            { label: t('dashboard.totalCharged'), value: money(shownCharged) },
            { label: t('dashboard.totalPaid'),    value: money(shownPaid) },
          ]}
        />
        {/* 0106: the building's fund, two lines. What it holds and what is
            genuinely its own — never another resident's balance. */}
        {fundPos && (
          <Card><CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('dashboard.buildingFund')}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <p className="text-xs text-muted-foreground">{t('dashboard.cashOnHand')}</p>
                <p className={cn('text-xl font-semibold tnum mt-0.5', Number(fundPos.cash) < 0 && 'text-red-500')}>{money(Number(fundPos.cash))}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('dashboard.reserveLabel')}</p>
                <p className={cn('text-xl font-semibold tnum mt-0.5', Number(fundPos.reserve) < 0 && 'text-red-500')}>{money(Number(fundPos.reserve))}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">{t('dashboard.buildingFundHint')}</p>
          </CardContent></Card>
        )}

        {/* Portfolio: one card per unit when the account spans several (investor case) */}
        {myUnits.length > 1 && (
          <div>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t('dashboard.myUnits')}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                      <p className={cn('text-lg font-semibold tnum shrink-0', u.balance < 0 ? 'text-red-400 dark:text-red-300' : 'text-foreground')}>
                        {money(u.balance)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
        {/* Stacked, not side by side: the statement link is a one-line action
            and the meetings card is a list, so a two-column row left them
            top-aligned at different heights and reading as unrelated. */}
        <div className="space-y-4">
          <Link to="/finance" className="block">
            <QuickLink icon={Wallet} title={t('dashboard.viewStatement')} desc={t('dashboard.viewStatementDesc')} />
          </Link>
          <MeetingsCard meetings={upcoming} />
        </div>
      </div>
    );
  }

  // ── Manager view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PendingInvites />
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <Greeting
          name={firstName}
          subtitle={isPlatformAdmin ? t('dashboard.overviewPlatform') : t('dashboard.overviewBuildings')}
          lens="managing"
          entity={selEntity?.name}
        />
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity selection moved to the sidebar (global). Block drill-down stays local. */}
          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <MultiSelect
              options={selEntity.blocks.map(b => ({ value: b.id, label: b.name }))}
              value={blockFilters}
              onChange={setBlockFilters}
              allLabel={t('finance.allBlocks')}
            />
          )}
          <RadixSelect value={mPeriod} onValueChange={(v) => setMPeriod(v as 'month' | 'year' | 'all')}>
            <SelectTrigger className="min-w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('finance.allTime')}</SelectItem>
              <SelectItem value="year">{t('finance.thisYear')}</SelectItem>
              <SelectItem value="month">{t('finance.month')}</SelectItem>
            </SelectContent>
          </RadixSelect>
          {mPeriod === 'month' && <MonthPicker value={mMonth} onChange={setMMonth} />}
        </div>
      </div>

      {/* Says plainly which numbers moved with the filter and which are a
          snapshot, so a position is never read as a period total. */}
      {mAsOfLabel && (
        <p className="text-xs text-muted-foreground -mt-3">
          {t('dashboard.periodHint', { date: mAsOfLabel })}
        </p>
      )}

      {/* Hero card */}
      {/* 0106: the hero is CASH, apart from what residents owe. Until the
          migration lands it shows the net position it always did, but named
          for what it is — that number was never the drawer. */}
      {fundPos ? (
        <HeroCard
          label={`${t('dashboard.cashOnHand')}${mAsOfLabel ? ` · ${t('finance.asOf', { date: mAsOfLabel })}` : ''}`}
          amount={money(Number(fundPos.cash))}
          negative={Number(fundPos.cash) < 0}
          pill={t('dashboard.percentCollected', { pct: collectionRate })}
          stats={[
            { label: t('dashboard.heldForResidents'), value: money(Number(fundPos.credits)) },
            { label: t('dashboard.availableToSpend'), value: money(Number(fundPos.available)) },
            { label: t('dashboard.stillToCollect'),   value: money(Number(fundPos.arrears)) },
            { label: t('dashboard.reserveLabel'),     value: money(Number(fundPos.reserve)) },
          ]}
        />
      ) : (
        <HeroCard
          label={`${t('dashboard.fundBalance')}${mAsOfLabel ? ` · ${t('finance.asOf', { date: mAsOfLabel })}` : ''}`}
          amount={money(fund)}
          negative={fund < 0}
          pill={t('dashboard.percentCollected', { pct: collectionRate })}
          stats={[
            { label: t('dashboard.collected'), value: money(agg.collected) },
            { label: t('dashboard.spent'),     value: money(agg.spent) },
            { label: t('dashboard.yearToDate'), value: money(agg.ytd) },
          ]}
        />
      )}

      {/* Stat row. Outstanding / Units / Open issues are AS-OF snapshots (0072);
          Billed is a flow inside the period. The suffix keeps that visible. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={`${t('dashboard.outstanding')}${mAsOfLabel ? ` · ${mAsOfLabel}` : ''}`} value={money(agg.outstanding)} icon={AlertCircle}   accent="teal" />
        <StatCard label={t('dashboard.totalBilled')}  value={money(agg.billed)}      icon={TrendingUp}    accent="teal" />
        <StatCard label={`${t('dashboard.units')}${mAsOfLabel ? ` · ${mAsOfLabel}` : ''}`}       value={String(agg.units)}      icon={Home}          accent="teal" />
        <StatCard label={`${t('dashboard.openIssues')}${mAsOfLabel ? ` · ${mAsOfLabel}` : ''}`}  value={String(agg.openIssues)} icon={AlertTriangle} accent="teal" />
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
            {/* Audit M2: the hero reads fund_position().reserve; this card used
                to show the pre-0106 collected − billed + carry, so the same
                screen carried two different "Reserve" numbers whenever an
                expense was fund-funded. Same source now, same fallback. */}
            <CoverageItem label={t('dashboard.reserve')} value={money(fundPos ? Number(fundPos.reserve) : fund)} negative={(fundPos ? Number(fundPos.reserve) : fund) < 0} />
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

/**
 * The greeting carries the LENS (#67).
 *
 * Feedback was that switching Managing / My home did not visibly change the
 * dashboard and it was unclear which building was being managed. It did change
 * — the two views are structurally different — but nothing on the page NAMED
 * which one you were in, so the difference read as the page being inconsistent
 * rather than as a deliberate switch.
 *
 * So the lens is stated, with the entity beside it: "Managing · Tulip" against
 * "My home". Someone who lands mid-scroll can tell whose numbers they are
 * looking at without going back to the sidebar.
 */
function Greeting({ name, subtitle, lens, entity }: {
  name: string; subtitle: string;
  lens?: 'managing' | 'home';
  /** the building or compound in view; omitted when nothing is selected */
  entity?: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {name ? `${t('dashboard.welcome')}, ${name}` : t('dashboard.welcome')} <span className="inline-block">👋</span>
      </h1>
      {lens && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {lens === 'managing' ? <Building2 size={12} /> : <Home size={12} />}
            {lens === 'managing' ? t('nav.lensManaging') : t('nav.lensMyHome')}
          </span>
          {entity && <span className="text-xs text-muted-foreground">{entity}</span>}
        </div>
      )}
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
        <p className={cn('text-5xl lg:text-6xl font-bold tracking-tight mt-3 tnum', negative && 'text-red-400 dark:text-red-300')}>
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
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary/25">
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
                  <p className="text-[10px] text-primary font-semibold uppercase">{fmtDate(m.meeting_date, 'MMM')}</p>
                  <p className="text-xl font-bold text-primary leading-none">{fmtDate(m.meeting_date, 'd')}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{m.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {fmtDate(m.meeting_date, 'EEEE, MMM d, yyyy')}
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
