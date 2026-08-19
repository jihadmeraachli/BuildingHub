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
import { licenseCap } from '@/lib/licenseCaps';

const STATUS_COLOR: Record<Subscription['status'], 'green' | 'yellow' | 'red' | 'slate'> = {
  trial: 'yellow', active: 'green', past_due: 'red', cancelled: 'slate',
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

interface UnitRow extends Unit {
  buildingName: string;
  assignment: LicenseAssignment | null;
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
   * here settles anything: the invoice is marked paid only by whish-callback,
   * after asking Whish what actually happened. A browser that "came back
   * successful" is not evidence of payment.
   */
  async function payWithWhish(inv: Invoice) {
    setPaying(inv.id);
    try {
      const { data, error } = await supabase.functions.invoke('whish-pay', {
        body: { invoice_id: inv.id },
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

  async function addLicenses() {
    if (!sub || addCount < 1) return;
    // Client mirror of the 0071 cap trigger — same numbers, friendlier message.
    const cap = licenseCap(sub.scope_type, sub.cap_override);
    if (sub.license_count + addCount > cap) {
      toast.error(t('licensesPage.capReached', { cap }));
      return;
    }
    setAddSaving(true);
    const newCount = sub.license_count + addCount;
    const { error } = await supabase.from('subscriptions')
      .update({ license_count: newCount }).eq('id', sub.id);
    setAddSaving(false);
    if (error) { toast.error(error.message); return; }
    await logEvent('licenses_added', { added: addCount, new_total: newCount });
    setSubs(prev => prev.map(s => s.id === sub.id ? { ...s, license_count: newCount } : s));
    setAddOpen(false);
    toast.success(t('licensesPage.addedToast', { count: addCount }));
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const trialDays = daysLeft(sub?.trial_ends_at ?? null);
  const perUnitLabel = sub
    ? t('licensesPage.perUnit', { price: usd(sub.price_per_unit_cents), period: periodWord(sub.plan) })
    : '';
  const projectedCents = sub ? sub.license_count * sub.price_per_unit_cents : 0;

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
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t('licensesPage.tabOverview')}</TabsTrigger>
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
                </CardContent>
              </Card>

              <Card className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2">
                    <Wallet size={13} /> {t('licensesPage.price')}
                  </div>
                  <p className="font-semibold text-foreground">{perUnitLabel}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {t('licensesPage.projected', {
                      total: usd(projectedCents), period: periodWord(sub.plan), count: sub.license_count,
                    })}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('licensesPage.needMore')}</CardTitle>
                <CardDescription>{t('licensesPage.needMoreDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => setAddOpen(true)}>
                  <Plus size={15} /> {t('licensesPage.addLicenses')}
                </Button>
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
                          <TableHead className="text-end">{t('common.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map(inv => (
                          <TableRow key={inv.id}>
                            <TableCell>{inv.period_start} → {inv.period_end}</TableCell>
                            <TableCell className="font-medium">{usd(inv.amount_cents)}</TableCell>
                            <TableCell>
                              <Badge color={INVOICE_COLOR[inv.status]}>{t(`licensesPage.invoiceStatuses.${inv.status}`)}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : '—'}
                            </TableCell>
                            <TableCell className="text-end">
                              {inv.status === 'open' && (
                                <Button size="sm" onClick={() => payWithWhish(inv)} loading={paying === inv.id}>
                                  {t('licensesPage.payWithWhish')}
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
        </Tabs>
      )}

      {/* Add-licenses modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('licensesPage.addLicenses')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {sub
              ? t('licensesPage.howMany', { price: usd(sub.price_per_unit_cents), period: periodWord(sub.plan) })
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
          {sub && (
            <p className="text-xs text-muted-foreground">
              {t('licensesPage.newTotal', {
                count: sub.license_count + addCount,
                total: usd((sub.license_count + addCount) * sub.price_per_unit_cents),
                period: periodWord(sub.plan),
              })}
            </p>
          )}
          {sub && (
            <p className={`text-xs ${sub.license_count + addCount > licenseCap(sub.scope_type, sub.cap_override) ? 'text-destructive' : 'text-muted-foreground'}`}>
              {t('licensesPage.capHint', {
                cap: licenseCap(sub.scope_type, sub.cap_override),
                remaining: Math.max(0, licenseCap(sub.scope_type, sub.cap_override) - sub.license_count),
              })}
            </p>
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
