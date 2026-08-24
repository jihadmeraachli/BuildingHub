import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Subscription, Invoice, SubscriptionEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RadixSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { KeyRound, Wallet, Boxes, Receipt, CalendarPlus, FileText, Ban, Search } from 'lucide-react';
import { licenseCap } from '@/lib/licenseCaps';

const STATUS_BADGE: Record<Subscription['status'], { color: 'green' | 'yellow' | 'red' | 'slate'; label: string }> = {
  trial:     { color: 'yellow', label: 'Trial' },
  active:    { color: 'green',  label: 'Active' },
  grace:     { color: 'red',    label: 'Grace' },
  locked:    { color: 'red',    label: 'Locked' },
  past_due:  { color: 'red',    label: 'Past due' },
  cancelled: { color: 'slate',  label: 'Canceled' },
};

const INVOICE_BADGE: Record<Invoice['status'], { color: 'green' | 'yellow' | 'slate'; label: string }> = {
  open: { color: 'yellow', label: 'Open' },
  paid: { color: 'green',  label: 'Paid' },
  void: { color: 'slate',  label: 'Void' },
};

function usd(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

/** Monthly revenue equivalent in cents (annual plans divided by 12). */
function mrrCents(s: Subscription) {
  const yearly = s.plan === 'annual' ? s.license_count * s.price_per_unit_cents : s.license_count * s.price_per_unit_cents * 12;
  return Math.round(yearly / 12);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function PlatformLicensing() {
  const { user, isPlatformAdmin, loading: authLoading } = useAuth();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);
  const [entityNames, setEntityNames] = useState<Record<string, string>>({});
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  // Subscription list controls — the table is capped, so the page stays fast
  // with thousands of subscriptions (filter/search instead of endless rows).
  const [subSearch, setSubSearch] = useState('');
  const [subStatus, setSubStatus] = useState<'all' | Subscription['status']>('all');

  // Modals
  const [capSub, setCapSub] = useState<Subscription | null>(null);
  const [capValue, setCapValue] = useState('');
  const [extendSub, setExtendSub] = useState<Subscription | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [invoiceSub, setInvoiceSub] = useState<Subscription | null>(null);
  const [invAmount, setInvAmount] = useState(0);
  const [invStart, setInvStart] = useState('');
  const [invEnd, setInvEnd] = useState('');
  const [cancelSub, setCancelSub] = useState<Subscription | null>(null);

  const entityKey = (s: Subscription) => s.building_id ?? s.compound_id ?? s.org_id ?? '';
  const entityName = (s: Subscription) => entityNames[entityKey(s)] ?? '—';
  const subById = (id: string) => subs.find(s => s.id === id);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [subRes, invRes, evRes] = await Promise.all([
      supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').order('created_at', { ascending: false }),
      supabase.from('subscription_events').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    const subList = (subRes.data as Subscription[]) ?? [];
    const evList = (evRes.data as SubscriptionEvent[]) ?? [];
    setSubs(subList);
    setInvoices((invRes.data as Invoice[]) ?? []);
    setEvents(evList);

    // Entity names (one query per table)
    const bIds = subList.filter(s => s.building_id).map(s => s.building_id as string);
    const cIds = subList.filter(s => s.compound_id).map(s => s.compound_id as string);
    const oIds = subList.filter(s => s.org_id).map(s => s.org_id as string);
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

    // Audit actor names
    const actorIds = [...new Set(evList.map(e => e.actor_id).filter(Boolean))] as string[];
    if (actorIds.length) {
      const { data } = await supabase.from('profiles').select('id,full_name').in('id', actorIds);
      setActorNames(Object.fromEntries(((data as { id: string; full_name: string }[]) ?? []).map(p => [p.id, p.full_name])));
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isPlatformAdmin) loadAll(); }, [isPlatformAdmin, loadAll]);

  async function logEvent(subscriptionId: string, eventType: string, metadata: Record<string, unknown>) {
    await supabase.from('subscription_events').insert({
      subscription_id: subscriptionId, event_type: eventType, actor_id: user?.id ?? null, metadata,
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function doSetCap() {
    if (!capSub) return;
    setBusy('cap');
    const override = capValue.trim() === '' ? null : Math.max(1, Number(capValue));
    const { error } = await supabase.from('subscriptions')
      .update({ cap_override: override }).eq('id', capSub.id);
    setBusy('');
    if (error) { toast.error(error.message); return; }
    await logEvent(capSub.id, 'cap_override_set', { entity: entityName(capSub), cap_override: override });
    toast.success(override === null ? 'Cap reset to the scope default' : `Cap set to ${override} licenses`);
    setCapSub(null);
    loadAll();
  }

  async function doExtendTrial() {
    if (!extendSub || extendDays < 1) return;
    setBusy('extend');
    const base = extendSub.trial_ends_at && new Date(extendSub.trial_ends_at) > new Date()
      ? new Date(extendSub.trial_ends_at)
      : new Date();
    const newEnd = new Date(base.getTime() + extendDays * 86_400_000).toISOString();
    const { error } = await supabase.from('subscriptions')
      .update({ trial_ends_at: newEnd, status: 'trial' }).eq('id', extendSub.id);
    setBusy('');
    if (error) { toast.error(error.message); return; }
    await logEvent(extendSub.id, 'trial_extended', { days: extendDays, new_end: newEnd });
    toast.success(`Trial extended by ${extendDays} days`);
    setExtendSub(null);
    loadAll();
  }

  function openInvoiceModal(s: Subscription) {
    const start = new Date();
    const end = new Date(start);
    if (s.plan === 'monthly') end.setMonth(end.getMonth() + 1); else end.setFullYear(end.getFullYear() + 1);
    setInvAmount(s.license_count * s.price_per_unit_cents);
    setInvStart(isoDate(start));
    setInvEnd(isoDate(end));
    setInvoiceSub(s);
  }

  async function doCreateInvoice() {
    if (!invoiceSub || invAmount < 1 || !invStart || !invEnd) return;
    setBusy('invoice');
    const { error } = await supabase.from('invoices').insert({
      subscription_id: invoiceSub.id,
      amount_cents: invAmount,
      period_start: invStart,
      period_end: invEnd,
    });
    setBusy('');
    if (error) { toast.error(error.message); return; }
    await logEvent(invoiceSub.id, 'invoice_created', { amount_cents: invAmount, period_start: invStart, period_end: invEnd });
    toast.success('Invoice created');
    setInvoiceSub(null);
    loadAll();
  }

  async function markPaid(inv: Invoice) {
    setBusy(inv.id);
    // One sealed call (0098): the invoice, the subscription activation and the
    // audit event move together or not at all. This used to be three round
    // trips, and failing between the first two left an invoice reading PAID
    // while the customer stayed locked out. The same function is what a payment
    // gateway's webhook will call, so both paths cannot drift apart.
    const { data: settled, error } = await supabase.rpc('mark_invoice_paid', {
      p_invoice: inv.id,
      p_method: 'manual',
      p_ref: null,
    });
    setBusy('');
    if (error) { toast.error(error.message); return; }
    toast.success(settled
      ? 'Invoice marked paid. Subscription activated for the period'
      : 'That invoice was already settled');
    loadAll();
  }

  async function voidInvoice(inv: Invoice) {
    setBusy(inv.id);
    const { error } = await supabase.from('invoices').update({ status: 'void' }).eq('id', inv.id);
    setBusy('');
    if (error) { toast.error(error.message); return; }
    await logEvent(inv.subscription_id, 'invoice_voided', { invoice_id: inv.id });
    toast.success('Invoice voided');
    loadAll();
  }

  async function doCancelSub() {
    if (!cancelSub) return;
    setBusy('cancel');
    const { error } = await supabase.from('subscriptions')
      .update({ status: 'cancelled' }).eq('id', cancelSub.id);
    setBusy('');
    if (error) { toast.error(error.message); return; }
    await logEvent(cancelSub.id, 'subscription_cancelled', { entity: entityName(cancelSub) });
    toast.success('Subscription cancelled');
    setCancelSub(null);
    loadAll();
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  if (authLoading) return <div className="p-6"><SkeletonTable rows={5} /></div>;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  if (loading) return <div className="p-6"><SkeletonTable rows={5} /></div>;

  // ── Derived stats ─────────────────────────────────────────────────────────

  const live = subs.filter(s => s.status !== 'cancelled');
  const SUB_ROW_CAP = 50;
  const filteredSubs = subs.filter(s =>
    (subStatus === 'all' || s.status === subStatus)
    && (!subSearch.trim() || entityName(s).toLowerCase().includes(subSearch.trim().toLowerCase())),
  );
  const visibleSubs = filteredSubs.slice(0, SUB_ROW_CAP);
  const totalLicenses = live.reduce((n, s) => n + s.license_count, 0);
  const activeCount = live.filter(s => s.status === 'active').length;
  const trialCount = live.filter(s => s.status === 'trial').length;
  const mrr = live.filter(s => s.status === 'active').reduce((n, s) => n + mrrCents(s), 0);
  const openInvoiceTotal = invoices.filter(i => i.status === 'open').reduce((n, i) => n + i.amount_cents, 0);

  const stat = (icon: React.ReactNode, label: string, value: string, sub2: string) => (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-2">
          {icon} {label}
        </div>
        <p className="text-xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{sub2}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground">Platform Licensing</h1>
        <p className="text-sm text-muted-foreground">All subscriptions across the platform. Billing is confirmed manually here.</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat(<Boxes size={13} />, 'Subscriptions', String(live.length), `${activeCount} active · ${trialCount} on trial`)}
        {stat(<KeyRound size={13} />, 'Licenses sold', String(totalLicenses), 'across all live subscriptions')}
        {stat(<Wallet size={13} />, 'MRR (active)', usd(mrr), 'annual plans counted /12')}
        {stat(<Receipt size={13} />, 'Open invoices', usd(openInvoiceTotal), `${invoices.filter(i => i.status === 'open').length} awaiting payment`)}
      </div>

      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        {/* ── Subscriptions ── */}
        <TabsContent value="subscriptions">
          <Card>
            <CardHeader>
              <CardTitle>All subscriptions</CardTitle>
              <CardDescription>Extend trials, issue invoices, or cancel.</CardDescription>
            </CardHeader>
            <CardContent>
              {subs.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <RadixSelect value={subStatus} onValueChange={v => setSubStatus(v as typeof subStatus)}>
                    <SelectTrigger className="w-40 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="past_due">Past due</SelectItem>
                      <SelectItem value="cancelled">Canceled</SelectItem>
                    </SelectContent>
                  </RadixSelect>
                  <div className="relative">
                    <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="search"
                      value={subSearch}
                      onChange={e => setSubSearch(e.target.value)}
                      placeholder="Search entity…"
                      className="h-9 ps-8 pe-3 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 w-56"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {filteredSubs.length === subs.length
                      ? `${subs.length} subscription${subs.length === 1 ? '' : 's'}`
                      : `${filteredSubs.length} of ${subs.length} match`}
                  </span>
                </div>
              )}
              {!subs.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No subscriptions yet.</p>
              ) : !filteredSubs.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No subscriptions match the current filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Licenses</TableHead>
                        <TableHead>Trial ends</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-end">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleSubs.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{entityName(s)}</TableCell>
                          <TableCell className="text-muted-foreground capitalize">{s.scope_type}</TableCell>
                          <TableCell><Badge color={STATUS_BADGE[s.status].color}>{STATUS_BADGE[s.status].label}</Badge></TableCell>
                          <TableCell className="capitalize text-muted-foreground">{s.plan}</TableCell>
                          <TableCell>{s.license_count}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtDate(s.trial_ends_at)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {s.current_period_start ? `${s.current_period_start} → ${s.current_period_end}` : '—'}
                          </TableCell>
                          <TableCell className="text-end">
                            {s.status !== 'cancelled' && (
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  variant="outline" size="xs" title="License cap (0071)"
                                  onClick={() => { setCapValue(s.cap_override != null ? String(s.cap_override) : ''); setCapSub(s); }}
                                >
                                  <KeyRound size={12} /> Cap
                                </Button>
                                <Button
                                  variant="outline" size="xs" title="Extend trial"
                                  onClick={() => { setExtendDays(30); setExtendSub(s); }}
                                >
                                  <CalendarPlus size={12} /> Trial
                                </Button>
                                <Button
                                  variant="outline" size="xs" title="Create invoice"
                                  onClick={() => openInvoiceModal(s)}
                                >
                                  <FileText size={12} /> Invoice
                                </Button>
                                <Button
                                  variant="outline" size="xs" title="Cancel subscription"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setCancelSub(s)}
                                >
                                  <Ban size={12} />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filteredSubs.length > SUB_ROW_CAP && (
                    <p className="text-xs text-muted-foreground text-center py-3">
                      Showing {SUB_ROW_CAP} of {filteredSubs.length}. Refine the search or status filter to narrow down.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Invoices ── */}
        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle>All invoices</CardTitle>
              <CardDescription>Mark an invoice paid once the money arrives. This activates the subscription for the invoiced period.</CardDescription>
            </CardHeader>
            <CardContent>
              {!invoices.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No invoices yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Paid</TableHead>
                        <TableHead className="text-end">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map(inv => {
                        const s = subById(inv.subscription_id);
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium">{s ? entityName(s) : '—'}</TableCell>
                            <TableCell className="text-muted-foreground text-xs">{inv.period_start} → {inv.period_end}</TableCell>
                            <TableCell className="font-medium">{usd(inv.amount_cents)}</TableCell>
                            <TableCell><Badge color={INVOICE_BADGE[inv.status].color}>{INVOICE_BADGE[inv.status].label}</Badge></TableCell>
                            <TableCell className="text-muted-foreground">{fmtDate(inv.paid_at)}</TableCell>
                            <TableCell className="text-end">
                              {inv.status === 'open' && (
                                <div className="flex justify-end gap-1.5">
                                  <Button size="xs" loading={busy === inv.id} onClick={() => markPaid(inv)}>
                                    Mark paid
                                  </Button>
                                  <Button variant="outline" size="xs" loading={busy === inv.id} onClick={() => voidInvoice(inv)}>
                                    Void
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit log ── */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
              <CardDescription>Last 100 licensing events across all subscriptions.</CardDescription>
            </CardHeader>
            <CardContent>
              {!events.length ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No events yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map(ev => {
                        const s = subById(ev.subscription_id);
                        return (
                          <TableRow key={ev.id}>
                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                              {new Date(ev.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell><Badge color="teal">{ev.event_type.replaceAll('_', ' ')}</Badge></TableCell>
                            <TableCell className="text-muted-foreground">{s ? entityName(s) : '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{ev.actor_id ? (actorNames[ev.actor_id] ?? '—') : 'system'}</TableCell>
                            <TableCell className="text-muted-foreground text-xs max-w-[280px] truncate">
                              {JSON.stringify(ev.metadata)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── License cap modal (0071) ── */}
      <Modal open={!!capSub} onClose={() => setCapSub(null)} title="License cap" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cap for <span className="font-medium text-foreground">{capSub ? entityName(capSub) : ''}</span>
            {capSub ? ` — scope default is ${licenseCap(capSub.scope_type)} (${capSub.scope_type}). ` : '. '}
            Leave empty to use the default.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number" min={1}
              value={capValue}
              placeholder={capSub ? String(licenseCap(capSub.scope_type)) : ''}
              onChange={e => setCapValue(e.target.value)}
              className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">licenses</span>
          </div>
          {capSub && capSub.license_count > (capValue.trim() === '' ? licenseCap(capSub.scope_type) : Number(capValue)) && (
            <p className="text-xs text-amber-600">
              Current count ({capSub.license_count}) is above this cap — existing licenses keep working; only further growth is blocked.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setCapSub(null)}>Cancel</Button>
            <Button loading={busy === 'cap'} onClick={doSetCap}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* ── Extend trial modal ── */}
      <Modal open={!!extendSub} onClose={() => setExtendSub(null)} title="Extend trial" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Extend the trial for <span className="font-medium text-foreground">{extendSub ? entityName(extendSub) : ''}</span>.
            Days are added to the current trial end (or today if already expired).
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number" min={1} max={365}
              value={extendDays}
              onChange={e => setExtendDays(Math.max(1, Number(e.target.value)))}
              className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setExtendSub(null)}>Cancel</Button>
            <Button loading={busy === 'extend'} onClick={doExtendTrial}>Extend</Button>
          </div>
        </div>
      </Modal>

      {/* ── Create invoice modal ── */}
      <Modal open={!!invoiceSub} onClose={() => setInvoiceSub(null)} title="Create invoice" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Invoice for <span className="font-medium text-foreground">{invoiceSub ? entityName(invoiceSub) : ''}</span>
            {invoiceSub ? ` — ${invoiceSub.license_count} licenses at ${usd(invoiceSub.price_per_unit_cents)}/unit/${invoiceSub.plan === 'monthly' ? 'month' : 'year'}.` : '.'}
          </p>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Amount (USD)</label>
            <input
              type="number" min={0.01} step={0.01}
              value={(invAmount / 100).toFixed(2)}
              onChange={e => setInvAmount(Math.round(Number(e.target.value) * 100))}
              className="w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Period start</label>
              <input
                type="date" value={invStart} onChange={e => setInvStart(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Period end</label>
              <input
                type="date" value={invEnd} onChange={e => setInvEnd(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setInvoiceSub(null)}>Cancel</Button>
            <Button loading={busy === 'invoice'} onClick={doCreateInvoice}>Create invoice</Button>
          </div>
        </div>
      </Modal>

      {/* ── Cancel subscription modal ── */}
      <Modal open={!!cancelSub} onClose={() => setCancelSub(null)} title="Cancel subscription" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cancel the subscription for <span className="font-medium text-foreground">{cancelSub ? entityName(cancelSub) : ''}</span>?
            Residents of its units will lose access once no active license covers them. This can be undone by creating a new subscription.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setCancelSub(null)}>Keep it</Button>
            <Button variant="danger" loading={busy === 'cancel'} onClick={doCancelSub}>Cancel subscription</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
