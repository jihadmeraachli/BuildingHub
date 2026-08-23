import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Subscription, LicenseAssignment, Invoice, Unit, Building } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { KeyRound, Plus, CalendarClock, Wallet, Boxes } from 'lucide-react';
import { monthlyPriceCents, annualPriceCents, effectivePerUnitCents, fmtPerUnit } from '@/lib/pricing';

const STATUS_COLOR: Record<Subscription['status'], 'green' | 'yellow' | 'red' | 'slate'> = {
  trial: 'yellow', active: 'green', grace: 'red', locked: 'red', past_due: 'red', cancelled: 'slate',
};

const INVOICE_COLOR: Record<Invoice['status'], 'green' | 'yellow' | 'slate'> = {
  open: 'yellow', paid: 'green', void: 'slate',
};

function usd(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// preview-date helpers (0117): the server recomputes these authoritatively
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }

interface UnitRow extends Unit {
  buildingName: string;
  assignment: LicenseAssignment | null;
}

/** What the customer is about to buy — a client-side PREVIEW only. The
 *  authoritative amount and dates come from create_payment_intent (0117). */
interface PayIntent {
  kind: 'period' | 'topup';
  plan: 'monthly' | 'annual';
  add?: number;
  amountCents: number | null;
  periodStart: string;
  periodEnd: string;
}

export default function Licenses() {
  const { t } = useTranslation();
  const { user, profile, isPlatformAdmin, grants } = useAuth();
  // Billing is an admin concern — mirror the sidebar's gate (RLS would return
  // nothing anyway; this avoids a confusing empty page for residents).
  const isScopeAdmin = grants.some(g => ['building_admin', 'compound_admin', 'org_admin'].includes(g.role));
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Selected-subscription detail
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paying, setPaying] = useState('');

  /**
   * Hand the payer to Whish's hosted page. We never see the OTP, and nothing
   * here settles anything: the payment intent is settled only by
   * whish-callback, after asking Whish what actually happened. 0117: no
   * invoice exists yet — we send WHAT is being bought and the server computes
   * the amount; the invoice is created, already paid, when money confirms.
   */
  async function payWithWhish(pi: PayIntent) {
    if (!sub) return;
    setPaying('whish');
    try {
      const { data, error } = await supabase.functions.invoke('whish-pay', {
        body: { subscription_id: sub.id, kind: pi.kind, plan: pi.plan, add: pi.add ?? 0 },
      });
      if (error || !data?.collectUrl) {
        toast.error(data?.error ?? error?.message ?? t('licensesPage.payFailed'));
        return;
      }
      // Same tab: Whish sends the payer back to successRedirectUrl when done,
      // and a popup would be eaten by the blocker on some phones.
      window.location.href = data.collectUrl as string;
    } finally {
      setPaying('');
    }
  }
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyUnit, setBusyUnit] = useState<string>('');

  // Add-licenses modal
  const [addOpen, setAddOpen] = useState(false);
  const [addCount, setAddCount] = useState(5);
  const [addSaving, setAddSaving] = useState(false);
  // removing licences: never below what is assigned to a unit
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeCount, setRemoveCount] = useState(1);
  const [removeSaving, setRemoveSaving] = useState(false);
  // 0114: subscribe / renew / cancel / auto-renew
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [subscribePlan, setSubscribePlan] = useState<'monthly' | 'annual'>('monthly');
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  // 0117 pay-first: the subscribe modal goes plan → payment options; nothing
  // is issued before the money is confirmed. payIntent is the preview of what
  // is being bought — the server recomputes the real amount at payment time.
  const [subscribeStep, setSubscribeStep] = useState<'plan' | 'pay'>('plan');
  const [payIntent, setPayIntent] = useState<PayIntent | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const sub = subs.find(s => s.id === selectedId) ?? null;
  const assignedCount = units.filter(u => u.assignment).length;
  const availableCount = sub ? Math.max(0, sub.license_count - assignedCount) : 0;

  const entityKey = (s: Subscription) => s.building_id ?? s.compound_id ?? s.org_id ?? '';
  const periodWord = (plan: 'monthly' | 'annual') =>
    plan === 'monthly' ? t('licensesPage.periodMonth') : t('licensesPage.periodYear');

  // ── Load subscriptions (RLS limits to what the user may see) ──────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('subscriptions').select('*')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });
      const list = (data as Subscription[]) ?? [];
      setSubs(list);
      if (list.length && !selectedId) setSelectedId(list[0].id);

      // Resolve entity names in one pass per table
      const bIds = list.filter(s => s.building_id).map(s => s.building_id as string);
      const cIds = list.filter(s => s.compound_id).map(s => s.compound_id as string);
      const oIds = list.filter(s => s.org_id).map(s => s.org_id as string);
      const names: Record<string, string> = {};
      const [b, c, o] = await Promise.all([
        bIds.length ? supabase.from('buildings').select('id,name').in('id', bIds) : Promise.resolve({ data: [] }),
        cIds.length ? supabase.from('compounds').select('id,name').in('id', cIds) : Promise.resolve({ data: [] }),
        oIds.length ? supabase.from('organizations').select('id,name').in('id', oIds) : Promise.resolve({ data: [] }),
      ]);
      for (const row of [...(b.data ?? []), ...(c.data ?? []), ...(o.data ?? [])] as { id: string; name: string }[]) {
        names[row.id] = row.name;
      }
      setEntityNames(names);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load detail for the selected subscription ─────────────────────────────
  const loadDetail = useCallback(async () => {
    if (!sub) return;
    setDetailLoading(true);

    // Buildings in scope
    let buildingIds: string[] = [];
    let buildingNames: Record<string, string> = {};
    if (sub.scope_type === 'building' && sub.building_id) {
      buildingIds = [sub.building_id];
      const { data } = await supabase.from('buildings').select('id,name').eq('id', sub.building_id);
      buildingNames = Object.fromEntries(((data as Building[]) ?? []).map(b => [b.id, b.name]));
    } else if (sub.scope_type === 'compound' && sub.compound_id) {
      const { data } = await supabase.from('buildings').select('id,name').eq('compound_id', sub.compound_id);
      buildingIds = ((data as Building[]) ?? []).map(b => b.id);
      buildingNames = Object.fromEntries(((data as Building[]) ?? []).map(b => [b.id, b.name]));
    } else if (sub.scope_type === 'org' && sub.org_id) {
      const { data: ob } = await supabase.from('org_buildings').select('building_id').eq('org_id', sub.org_id);
      buildingIds = ((ob as { building_id: string }[]) ?? []).map(r => r.building_id);
      if (buildingIds.length) {
        const { data } = await supabase.from('buildings').select('id,name').in('id', buildingIds);
        buildingNames = Object.fromEntries(((data as Building[]) ?? []).map(b => [b.id, b.name]));
      }
    }

    // Units + active assignments + invoices
    const [unitRes, assignRes, invRes] = await Promise.all([
      buildingIds.length
        ? supabase.from('units').select('*').in('building_id', buildingIds).order('label')
        : Promise.resolve({ data: [] }),
      supabase.from('license_assignments').select('*')
        .eq('subscription_id', sub.id).is('unassigned_at', null),
      supabase.from('invoices').select('*')
        .eq('subscription_id', sub.id).order('created_at', { ascending: false }),
    ]);

    const assignByUnit: Record<string, LicenseAssignment> = {};
    for (const a of (assignRes.data as LicenseAssignment[]) ?? []) assignByUnit[a.unit_id] = a;

    setUnits(
      (((unitRes.data as Unit[]) ?? [])).map(u => ({
        ...u,
        buildingName: buildingNames[u.building_id] ?? '—',
        assignment: assignByUnit[u.id] ?? null,
      })),
    );
    setInvoices((invRes.data as Invoice[]) ?? []);
    setDetailLoading(false);
  }, [sub]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function logEvent(eventType: string, metadata: Record<string, unknown>) {
    if (!sub) return;
    await supabase.from('subscription_events').insert({
      subscription_id: sub.id, event_type: eventType, actor_id: user?.id ?? null, metadata,
    });
  }

  async function assignUnit(u: UnitRow) {
    if (!sub) return;
    if (availableCount < 1) {
      toast.error(t('licensesPage.noAvailable'));
      return;
    }
    setBusyUnit(u.id);
    const { error } = await supabase.from('license_assignments').insert({
      subscription_id: sub.id, unit_id: u.id, assigned_by: user?.id ?? null,
    });
    setBusyUnit('');
    if (error) { toast.error(error.message); return; }
    await logEvent('license_assigned', { unit_id: u.id, unit_label: u.label });
    toast.success(t('licensesPage.assignedTo', { label: u.label }));
    loadDetail();
  }

  async function unassignUnit(u: UnitRow) {
    if (!sub || !u.assignment) return;
    setBusyUnit(u.id);
    const { error } = await supabase.from('license_assignments')
      .update({ unassigned_at: new Date().toISOString(), unassigned_by: user?.id ?? null })
      .eq('id', u.assignment.id);
    setBusyUnit('');
    if (error) { toast.error(error.message); return; }
    await logEvent('license_unassigned', { unit_id: u.id, unit_label: u.label });
    toast.success(t('licensesPage.removedFrom', { label: u.label }));
    loadDetail();
  }

  /** 0117: adds go through request_license_increase. On trial, within the
   *  band, or on a negotiated price the licences apply immediately; a
   *  band-crossing add on an active subscription returns the prorated
   *  difference to pay — the licences land when the payment is confirmed. */
  async function addLicenses() {
    if (!sub || addCount < 1) return;
    setAddSaving(true);
    const { data, error } = await supabase.rpc('request_license_increase', {
      p_subscription: sub.id, p_add: addCount,
    });
    setAddSaving(false);
    if (error) { toast.error(error.message); return; }
    const row = (Array.isArray(data) ? data[0] : data) as { applied: boolean; amount_cents: number | null } | null;
    setAddOpen(false);
    if (row?.applied) {
      toast.success(t('licensesPage.addedToast', { count: addCount }));
      await reloadSub();
    } else if (row) {
      // Band crossed: pay the prorated difference now, licences follow.
      toast.info(t('billing.topupHold'));
      setPayIntent({
        kind: 'topup', plan: sub.plan, add: addCount, amountCents: row.amount_cents,
        periodStart: iso(new Date()), periodEnd: sub.current_period_end ?? '',
      });
      setSubscribeStep('pay');
      setSubscribeOpen(true);
    }
  }

  /** Lower the licence count. Assigned licences stay assigned: the floor is
   *  what units currently hold, so unassign first to go lower. The 0113
   *  audit guard accepts 'licenses_removed'. */
  async function removeLicenses() {
    if (!sub || removeCount < 1) return;
    const floor = assignedCount;
    const newCount = sub.license_count - removeCount;
    if (newCount < floor) {
      toast.error(t('licensesPage.removeFloor', { assigned: floor }));
      return;
    }
    setRemoveSaving(true);
    const { error } = await supabase.from('subscriptions')
      .update({ license_count: newCount }).eq('id', sub.id);
    setRemoveSaving(false);
    if (error) { toast.error(error.message); return; }
    await logEvent('licenses_removed', { removed: removeCount, new_total: newCount });
    setSubs(prev => prev.map(s => s.id === sub.id ? { ...s, license_count: newCount } : s));
    setRemoveOpen(false);
    toast.success(t('licensesPage.removedToast', { count: removeCount }));
  }

  // ── Lifecycle (0117 pay-first): nothing is issued before money moves ──────
  /** "Continue to payment": build a preview of what is being bought. The
   *  authoritative amount and dates are recomputed server-side by
   *  create_payment_intent the moment a pay button is pressed. */
  function subscribeNow() {
    if (!sub) return;
    const start = sub.status === 'trial' && sub.trial_ends_at
      ? addDays(new Date(sub.trial_ends_at), 1)
      : sub.status === 'active' && sub.current_period_end
        ? addDays(new Date(sub.current_period_end + 'T00:00:00'), 1)
        : new Date();
    const end = addDays(addMonths(start, subscribePlan === 'annual' ? 12 : 1), -1);
    const cents = subscribePlan === 'annual' ? annualPriceCents(sub.license_count) : monthlyPriceCents(sub.license_count);
    setPayIntent({ kind: 'period', plan: subscribePlan, amountCents: cents, periodStart: iso(start), periodEnd: iso(end) });
    setSubscribeStep('pay');
  }
  /** The in-app modal (cancelOpen) confirms; no browser confirm() dialogs. */
  async function doCancel() {
    if (!sub) return;
    setLifecycleSaving(true);
    const { error } = await supabase.rpc('cancel_subscription', { p_subscription: sub.id });
    setLifecycleSaving(false);
    setCancelOpen(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('billing.cancelDone'));
    await reloadSub();
  }
  async function doResume() {
    if (!sub) return;
    setLifecycleSaving(true);
    const { error } = await supabase.rpc('resume_subscription', { p_subscription: sub.id });
    setLifecycleSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('billing.resumeDone'));
    await reloadSub();
  }
  async function toggleAutoRenew() {
    if (!sub) return;
    setLifecycleSaving(true);
    const { error } = await supabase.rpc('set_auto_renew', { p_subscription: sub.id, p_on: !sub.auto_renew });
    setLifecycleSaving(false);
    if (error) {
      toast.error(error.message.includes('Save a card') ? t('billing.autoRenewNeedsCard') : error.message);
      return;
    }
    await reloadSub();
  }
  /** Card — same shape as Whish: the server builds the session from what is
   *  being bought, we just follow the redirect. 503 until the keys exist. */
  async function payWithCard(pi: PayIntent) {
    if (!sub) return;
    setPaying('areeba');
    try {
      const { data, error } = await supabase.functions.invoke('areeba-pay', {
        body: { subscription_id: sub.id, kind: pi.kind, plan: pi.plan, add: pi.add ?? 0 },
      });
      if (error || !data?.checkoutUrl) {
        toast.error(data?.error ?? error?.message ?? t('billing.cardUnavailable'));
        return;
      }
      window.location.href = data.checkoutUrl as string;
    } finally {
      setPaying('');
    }
  }
  async function reloadSub() {
    const { data } = await supabase.from('subscriptions').select('*').neq('status', 'cancelled').order('created_at', { ascending: false });
    setSubs((data as Subscription[]) ?? []);
    const { data: inv } = await supabase.from('invoices').select('*').eq('subscription_id', sub?.id ?? '').order('created_at', { ascending: false });
    if (inv) setInvoices(inv as Invoice[]);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const trialDays = daysLeft(sub?.trial_ends_at ?? null);
  // Priced by the BUILDING's size, not by licences bought (0100). A
  // half-licensed building is still that size, so the count that matters is
  // units in scope. price_monthly_cents overrides the band for a negotiated
  // deal; above the top band there is no price, only a conversation.
  // 0114: the band follows LICENCES BOUGHT, not the units that happen to
  // exist — an empty trial building with 32 licences is a 21-40-band account.
  const licenseBasis = sub?.license_count ?? 0;
  const negotiated = sub?.price_monthly_cents ?? null;
  const bandCents = sub?.plan === 'annual' ? annualPriceCents(licenseBasis) : monthlyPriceCents(licenseBasis);
  const priceCents = negotiated !== null
    ? (sub?.plan === 'annual' ? negotiated * 10 : negotiated)
    : bandCents;
  const perUnitCents = effectivePerUnitCents(licenseBasis);
  const priceLabel = priceCents === null
    ? t('licensesPage.priceTalk')
    : t('licensesPage.perPeriod', { price: usd(priceCents), period: periodWord(sub?.plan ?? 'monthly') });

  const entityName = useMemo(
    () => (sub ? entityNames[entityKey(sub)] ?? '—' : ''),
    [sub, entityNames],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isPlatformAdmin && !isScopeAdmin) return <Navigate to="/dashboard" replace />;

  if (loading) return <div className="p-6"><SkeletonTable rows={5} /></div>;

  if (!subs.length) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto text-center mt-16">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <KeyRound size={26} className="text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-2">{t('licensesPage.noSub')}</h2>
          <p className="text-sm text-muted-foreground">
            {profile?.is_platform_admin ? t('licensesPage.noSubPlatform') : t('licensesPage.noSubUser')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">{t('nav.licenses')}</h1>
          <p className="text-sm text-muted-foreground">{t('licensesPage.subtitle')}</p>
        </div>
        {subs.length > 1 && (
          <RadixSelect value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="ms-auto min-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {subs.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {entityNames[entityKey(s)] ?? s.id.slice(0, 8)} ({s.scope_type})
                </SelectItem>
              ))}
            </SelectContent>
          </RadixSelect>
        )}
      </div>

      {sub && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">{t('licensesPage.tabOverview')}</TabsTrigger>
            <TabsTrigger value="manage">{t('billing.tabManage')}</TabsTrigger>
            <TabsTrigger value="assignments">{t('licensesPage.tabAssignments')}</TabsTrigger>
            <TabsTrigger value="invoices">{t('licensesPage.tabInvoices')}</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2">
                    <Boxes size={13} /> {t('licensesPage.cardSubscription')}
                  </div>
                  <p className="font-semibold text-foreground truncate">{entityName}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge color={STATUS_COLOR[sub.status]}>{t(`licensesPage.statuses.${sub.status}`)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {sub.plan === 'monthly' ? t('register.monthly') : t('register.annual')}
                    </span>
                  </div>
                  {sub.status === 'trial' && (
                    <p className="text-xs text-muted-foreground mt-1.5">{t('billing.trialNoSub')}</p>
                  )}
                </CardContent>
              </Card>

              <Card className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2">
                    <CalendarClock size={13} /> {sub.status === 'trial' ? t('licensesPage.trialEnds') : t('licensesPage.currentPeriod')}
                  </div>
                  {sub.status === 'trial' ? (
                    <>
                      <p className="font-semibold text-foreground">
                        {trialDays !== null ? t('licensesPage.daysLeft', { count: trialDays }) : '—'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {sub.trial_ends_at ? new Date(sub.trial_ends_at).toLocaleDateString() : ''}
                      </p>
                    </>
                  ) : (
                    <p className="font-semibold text-foreground text-sm">
                      {sub.current_period_start ?? '—'} → {sub.current_period_end ?? '—'}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2">
                    <KeyRound size={13} /> {t('licensesPage.licensePool')}
                  </div>
                  <p className="font-semibold text-foreground">
                    {t('licensesPage.assignedOf', { assigned: assignedCount, total: sub.license_count })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5">{t('licensesPage.availableCount', { count: availableCount })}</p>
                  {/* #0117: the pre-payment signal is TIME, not an open invoice */}
                  {sub.status === 'active' && sub.current_period_end && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t(sub.cancel_at_period_end ? 'billing.expiresIn' : 'billing.renewsIn',
                        { count: daysLeft(sub.current_period_end) ?? 0, date: sub.current_period_end })}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2">
                    <Wallet size={13} /> {t('licensesPage.price')}
                  </div>
                  <p className="font-semibold text-foreground">{priceLabel}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {priceCents === null
                      ? t('licensesPage.priceTalkSub')
                      : t('licensesPage.priceBand', { count: licenseBasis, rate: fmtPerUnit(perUnitCents) })}
                  </p>
                </CardContent>
              </Card>
            </div>

          </TabsContent>

          {/* ── Manage subscription: its own tab (0116) ── */}
          <TabsContent value="manage">
            <Card>
              <CardHeader>
                <CardTitle>{t('billing.manageTitle')}</CardTitle>
                <CardDescription>
                  {sub.status === 'trial' ? t('billing.manageTrial', { date: sub.trial_ends_at ? new Date(sub.trial_ends_at).toLocaleDateString() : '' })
                    : sub.status === 'grace' ? t('billing.manageGrace', { date: sub.grace_ends_at ? new Date(sub.grace_ends_at).toLocaleDateString() : '' })
                    : sub.status === 'locked' ? t('billing.manageLocked')
                    : sub.cancel_at_period_end ? t('billing.manageEnding', { date: sub.current_period_end ?? '' })
                    : t('billing.manageActive', { start: sub.current_period_start ?? '', end: sub.current_period_end ?? '' })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Subscribe only while there is nothing subscribed; Cancel only
                    once there is. Grace/locked point at the open invoice. */}
                <div className="flex flex-wrap gap-2">
                  {(sub.status === 'trial' || sub.status === 'grace') && !sub.cancel_at_period_end && (
                    <Button onClick={() => { setSubscribePlan(sub.plan); setSubscribeStep('plan'); setSubscribeOpen(true); }}>
                      {t('billing.subscribeNow')}
                    </Button>
                  )}
                  {(sub.status === 'active' || sub.status === 'locked') && !sub.cancel_at_period_end && (
                    <Button onClick={() => { setSubscribePlan(sub.plan); setSubscribeStep('plan'); setSubscribeOpen(true); }}>
                      {t('billing.renewNow')}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setAddOpen(true)}>
                    <Plus size={15} /> {t('licensesPage.addLicenses')}
                  </Button>
                  {sub.license_count > assignedCount && (
                    <Button variant="outline" onClick={() => { setRemoveCount(1); setRemoveOpen(true); }}>
                      {t('licensesPage.removeLicenses')}
                    </Button>
                  )}
                  {sub.cancel_at_period_end ? (
                    <Button variant="outline" loading={lifecycleSaving} onClick={doResume}>{t('billing.resume')}</Button>
                  ) : sub.status !== 'trial' && sub.status !== 'cancelled' && (
                    <Button variant="ghost" loading={lifecycleSaving} onClick={() => setCancelOpen(true)} className="text-destructive">
                      {t('billing.cancel')}
                    </Button>
                  )}
                </div>
                {/* auto-renew: only real once a card is stored at the gateway */}
                <label className={`flex items-start gap-2.5 ${sub.provider_customer_ref ? 'cursor-pointer' : 'opacity-60'}`}>
                  <input type="checkbox" checked={!!sub.auto_renew} disabled={!sub.provider_customer_ref || lifecycleSaving}
                    onChange={toggleAutoRenew} className="mt-0.5 accent-primary" />
                  <span>
                    <span className="text-sm font-medium text-foreground">{t('billing.autoRenew')}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {sub.provider_customer_ref ? t('billing.autoRenewHint') : t('billing.autoRenewNeedsCard')}
                    </span>
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">{t('billing.paymentMethodsNote')}</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Assignments ── */}
          <TabsContent value="assignments">
            <Card>
              <CardHeader>
                <CardTitle>{t('licensesPage.unitLicenses')}</CardTitle>
                <CardDescription>
                  {t('licensesPage.assignmentsDesc', { count: availableCount })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {detailLoading ? (
                  <SkeletonTable rows={5} />
                ) : !units.length ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    {t('licensesPage.noUnits')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('licensesPage.unit')}</TableHead>
                          <TableHead>{t('auth.building')}</TableHead>
                          <TableHead>{t('common.status')}</TableHead>
                          <TableHead className="text-end">{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {units.map(u => (
                          <TableRow key={u.id}>
                            <TableCell className="font-medium">{u.label}</TableCell>
                            <TableCell className="text-muted-foreground">{u.buildingName}</TableCell>
                            <TableCell>
                              {u.assignment
                                ? <Badge color="green">{t('licensesPage.licensed')}</Badge>
                                : <Badge color="slate">{t('licensesPage.unlicensed')}</Badge>}
                            </TableCell>
                            <TableCell className="text-end">
                              {u.assignment ? (
                                <Button
                                  variant="outline" size="sm"
                                  loading={busyUnit === u.id}
                                  onClick={() => unassignUnit(u)}
                                >
                                  {t('licensesPage.unassign')}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  loading={busyUnit === u.id}
                                  disabled={availableCount < 1}
                                  onClick={() => assignUnit(u)}
                                >
                                  {t('licensesPage.assign')}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Invoices ── */}
          <TabsContent value="invoices">
            <Card>
              <CardHeader>
                <CardTitle>{t('licensesPage.tabInvoices')}</CardTitle>
                <CardDescription>{t('licensesPage.invoicesDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {!invoices.length ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">{t('licensesPage.noInvoices')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('licensesPage.period')}</TableHead>
                          <TableHead>{t('licensesPage.amount')}</TableHead>
                          <TableHead>{t('common.status')}</TableHead>
                          <TableHead>{t('licensesPage.paid')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map(inv => (
                          <TableRow key={inv.id}>
                            <TableCell>
                              {inv.period_start} → {inv.period_end}
                              {inv.kind === 'topup' && <Badge color="indigo" className="ms-2">{t('billing.topup')}</Badge>}
                              {inv.status === 'open' && inv.due_date && (
                                <span className="block text-xs text-muted-foreground">{t('billing.dueBy', { date: inv.due_date })}</span>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{usd(inv.amount_cents)}</TableCell>
                            <TableCell>
                              <Badge color={INVOICE_COLOR[inv.status]}>{t(`licensesPage.invoiceStatuses.${inv.status}`)}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* 0116: Subscribe / Renew — choose the cycle, see the dates, pay */}
      <Modal open={subscribeOpen} onClose={() => { setSubscribeOpen(false); setSubscribeStep('plan'); setPayIntent(null); }}
        title={subscribeStep === 'pay' ? t('billing.choosePayment') : sub?.status === 'active' ? t('billing.renewNow') : t('billing.subscribeNow')} size="sm">
        {sub && subscribeStep === 'plan' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('billing.subscribeHint', { count: sub.license_count })}</p>
            <div className="grid grid-cols-2 gap-2">
              {(['monthly', 'annual'] as const).map((plan) => {
                const cents = plan === 'annual' ? annualPriceCents(sub.license_count) : monthlyPriceCents(sub.license_count);
                const on = subscribePlan === plan;
                return (
                  <button key={plan} type="button" onClick={() => setSubscribePlan(plan)}
                    className={`rounded-xl border px-3 py-2.5 text-start transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}>
                    <span className="block text-sm font-medium text-foreground">{plan === 'monthly' ? t('register.monthly') : t('register.annual')}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {cents != null ? `${usd(cents)}/${periodWord(plan)}` : t('licensesPage.priceTalk')}
                      {plan === 'annual' && cents != null ? ` · ${t('register.save17')}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* #13: say when the paid period starts and renews */}
            <p className="text-xs text-muted-foreground">
              {sub.status === 'trial' && sub.trial_ends_at
                ? t('billing.startsAfterTrial', { date: new Date(sub.trial_ends_at).toLocaleDateString() })
                : t('billing.startsOn', { date: sub.current_period_end ?? new Date().toLocaleDateString() })}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setSubscribeOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={subscribeNow}>{t('billing.continueToPayment')}</Button>
            </div>
          </div>
        )}
        {sub && subscribeStep === 'pay' && payIntent && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {payIntent.amountCents != null
                ? t('billing.payDesc', { amount: usd(payIntent.amountCents), start: payIntent.periodStart, end: payIntent.periodEnd })
                : t('licensesPage.priceTalk')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" loading={paying === 'whish'} onClick={() => payWithWhish(payIntent)}>
                {t('licensesPage.payWithWhish')}
              </Button>
              <Button variant="outline" loading={paying === 'areeba'} onClick={() => payWithCard(payIntent)}>
                {t('billing.payWithCard')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('billing.payLater')}</p>
          </div>
        )}
      </Modal>

      {/* #4: in-app confirmation instead of the browser's "app.abniyah.com says" */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('billing.cancel')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('billing.cancelConfirm')}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="outline" loading={lifecycleSaving} onClick={doCancel} className="text-destructive">
              {t('billing.cancelYes')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={removeOpen} onClose={() => setRemoveOpen(false)} title={t('licensesPage.removeLicenses')} size="sm">
        {sub && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('licensesPage.howManyRemove')}</p>
            <input
              type="number"
              min={1}
              max={Math.max(1, sub.license_count - assignedCount)}
              value={removeCount}
              onChange={e => setRemoveCount(Math.max(1, Number(e.target.value)))}
              className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className={`text-xs ${sub.license_count - removeCount < assignedCount ? 'text-destructive' : 'text-muted-foreground'}`}>
              {t('licensesPage.removeFloor', { assigned: assignedCount })}
              {' '}
              {priceCents === null
                ? t('licensesPage.newTotalTalk', { count: Math.max(assignedCount, sub.license_count - removeCount) })
                : t('licensesPage.newTotalBanded', {
                    count: Math.max(assignedCount, sub.license_count - removeCount),
                    price: usd((sub.plan === 'annual' ? annualPriceCents(Math.max(assignedCount, sub.license_count - removeCount)) : monthlyPriceCents(Math.max(assignedCount, sub.license_count - removeCount))) ?? priceCents ?? 0),
                    period: periodWord(sub.plan),
                  })}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setRemoveOpen(false)}>{t('common.cancel')}</Button>
              <Button loading={removeSaving} onClick={removeLicenses} disabled={sub.license_count - removeCount < assignedCount}>
                {t('licensesPage.removeLicenses')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('licensesPage.addLicenses')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {sub
              ? t('licensesPage.howManyBanded')
              : ''}
          </p>
          <input
            type="number"
            min={1}
            max={9999}
            value={addCount}
            onChange={e => setAddCount(Math.max(1, Number(e.target.value)))}
            className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {/* The price is the BUILDING's band (0100), not licences × a rate: the
              old line multiplied by the legacy per-unit price and told a
              15-unit building it would pay $75 when its band is $85. Adding
              licences never changes the price unless the unit count changes. */}
          {sub && (
            <p className="text-xs text-muted-foreground">
              {priceCents === null
                ? t('licensesPage.newTotalTalk', { count: sub.license_count + addCount })
                : t('licensesPage.newTotalBanded', {
                    count: sub.license_count + addCount,
                    price: usd((sub.plan === 'annual' ? annualPriceCents(sub.license_count + addCount) : monthlyPriceCents(sub.license_count + addCount)) ?? priceCents ?? 0),
                    period: periodWord(sub.plan),
                  })}
            </p>
          )}
          {/* 0116: paid first when the add crosses the band */}
          {sub && sub.status === 'active' && !sub.price_monthly_cents
            && monthlyPriceCents(sub.license_count + addCount) !== monthlyPriceCents(sub.license_count) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('billing.topupNotice')}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={addSaving} onClick={addLicenses}>{t('licensesPage.addLicenses')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
