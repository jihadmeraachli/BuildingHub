import { useEffect, useMemo, useState, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Plus, Wallet, TrendingUp, AlertCircle, Receipt, HandCoins, BookOpen, Paperclip, FileText, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import type { Unit, Expense, Charge, Payment, Group, ExpenseCategory, AllocationMethod, AllocationScope, PaymentMethod } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Donut, TrendChart, MiniBar } from '@/components/ui/Charts';

const CATEGORIES: ExpenseCategory[] = ['water', 'electricity', 'common_expenses', 'projects', 'contracts', 'fines', 'other'];
const CAT_LABEL: Record<ExpenseCategory, string> = {
  water: 'Water', electricity: 'Electricity', common_expenses: 'Common Expenses',
  projects: 'Projects', contracts: 'Contracts', fines: 'Fines', other: 'Other',
};
const PAY_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'other'];

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Split `amount` across `units` by method; rounding fixed so the parts sum to the total. */
function allocate(amount: number, units: Unit[], method: AllocationMethod, custom: Record<string, string>): { unit_id: string; amount: number }[] {
  if (units.length === 0) return [];
  if (method === 'custom') {
    return units.map((u) => ({ unit_id: u.id, amount: Math.round((Number(custom[u.id]) || 0) * 100) / 100 }));
  }
  let raw: number[];
  if (method === 'by_shares') {
    const total = units.reduce((s, u) => s + Number(u.share_weight), 0) || 1;
    raw = units.map((u) => (amount * Number(u.share_weight)) / total);
  } else {
    raw = units.map(() => amount / units.length); // equal (and percentage fallback)
  }
  const rounded = raw.map((r) => Math.round(r * 100) / 100);
  const diff = Math.round((amount - rounded.reduce((s, r) => s + r, 0)) * 100) / 100;
  if (rounded.length) rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + diff) * 100) / 100;
  return units.map((u, i) => ({ unit_id: u.id, amount: rounded[i] }));
}

type ExpForm = {
  category: ExpenseCategory; description: string; amount: string; expense_date: string;
  scope: AllocationScope; method: AllocationMethod; group_id: string; unit_id: string; selectedUnits: string[];
};
const newExpForm = (): ExpForm => ({
  category: 'common_expenses', description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10),
  scope: 'block', method: 'by_shares', group_id: '', unit_id: '', selectedUnits: [],
});

type PayForm = { unit_id: string; amount: string; method: PaymentMethod; paid_on: string; note: string };
const newPayForm = (): PayForm => ({ unit_id: '', amount: '', method: 'cash', paid_on: new Date().toISOString().slice(0, 10), note: '' });

export default function Finance() {
  const { t } = useTranslation();
  const { can, canAny, isPlatformAdmin, profile, myUnitIds } = useAuth();
  const { buildings } = useManagedBuildings();
  const legacyManager = profile?.role === 'super_admin' || profile?.role === 'building_admin';
  const isManager = isPlatformAdmin || canAny('finance.view') || legacyManager;

  const [buildingId, setBuildingId] = useState('');
  const [tab, setTab] = useState<'book' | 'expenses' | 'payments'>('book');
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('all');
  const [units, setUnits] = useState<Unit[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unitGroups, setUnitGroups] = useState<{ group_id: string; unit_id: string }[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState<ExpForm>(newExpForm());
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [expFile, setExpFile] = useState<File | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState<PayForm>(newPayForm());
  const [payFile, setPayFile] = useState<File | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [detailPayment, setDetailPayment] = useState<Payment | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);

  useEffect(() => { if (!buildingId && buildings.length) setBuildingId(buildings[0].id); }, [buildings, buildingId]);

  const canManageFinance = isPlatformAdmin || can('expense.manage', buildingId) || legacyManager;

  useEffect(() => {
    if (isManager && buildingId) loadManager();
    else if (!isManager && myUnitIds.length) loadResident();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, isManager]);

  async function loadManager() {
    setLoading(true);
    const [{ data: u }, { data: g }, { data: e }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('units').select('*').eq('building_id', buildingId).order('label'),
      supabase.from('groups').select('*').eq('building_id', buildingId).order('name'),
      supabase.from('expenses').select('*').eq('building_id', buildingId).order('expense_date', { ascending: false }),
      supabase.from('charges').select('*').eq('building_id', buildingId),
      supabase.from('payments').select('*').eq('building_id', buildingId).order('paid_on', { ascending: false }),
    ]);
    const unitList = (u as Unit[]) ?? [];
    setUnits(unitList);
    setGroups((g as Group[]) ?? []);
    setExpenses((e as Expense[]) ?? []);
    setCharges((c as Charge[]) ?? []);
    setPayments((p as Payment[]) ?? []);
    const ids = unitList.map((x) => x.id);
    if (ids.length) {
      const { data: ug } = await supabase.from('unit_groups').select('group_id, unit_id').in('unit_id', ids);
      setUnitGroups((ug as { group_id: string; unit_id: string }[]) ?? []);
    } else setUnitGroups([]);
    setLoading(false);
  }

  async function loadResident() {
    setLoading(true);
    const [{ data: u }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('units').select('*').in('id', myUnitIds),
      supabase.from('charges').select('*').in('unit_id', myUnitIds).order('charge_date', { ascending: false }),
      supabase.from('payments').select('*').in('unit_id', myUnitIds).order('paid_on', { ascending: false }),
    ]);
    setUnits((u as Unit[]) ?? []);
    setCharges((c as Charge[]) ?? []);
    setPayments((p as Payment[]) ?? []);
    setLoading(false);
  }

  const unitLabel = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.label])), [units]);
  const book = useMemo(() => units.map((u) => {
    const charged = charges.filter((c) => c.unit_id === u.id).reduce((s, c) => s + Number(c.amount_usd), 0);
    const paid = payments.filter((p) => p.unit_id === u.id).reduce((s, p) => s + Number(p.amount_usd), 0);
    return { unit: u, charged, paid, balance: Math.round((paid - charged) * 100) / 100 };
  }), [units, charges, payments]);

  // ---- period filter ----
  const now = new Date();
  let range: { from: Date; to: Date } | null = null;
  if (period === 'year') range = { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
  else if (period === 'month') {
    const [y, m] = monthValue.split('-').map(Number);
    range = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) };
  }
  const inRange = (d: string) => !range || (new Date(d) >= range.from && new Date(d) <= range.to);
  const periodLabel = period === 'month'
    ? new Date(`${monthValue}-01`).toLocaleString(undefined, { month: 'long', year: 'numeric' })
    : period === 'year' ? t('finance.thisYear') : t('finance.allTime');

  const fPayments = useMemo(() => payments.filter((p) => inRange(p.paid_on)), [payments, period, monthValue]); // eslint-disable-line react-hooks/exhaustive-deps
  const fExpenses = useMemo(() => expenses.filter((e) => inRange(e.expense_date)), [expenses, period, monthValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const collectedP = round2(fPayments.reduce((s, p) => s + Number(p.amount_usd), 0));
  const spentP = round2(fExpenses.reduce((s, e) => s + Number(e.amount_usd), 0));
  const netP = round2(collectedP - spentP);
  const outstanding = round2(book.reduce((s, r) => s + (r.balance < 0 ? -r.balance : 0), 0)); // current, all-time

  // expense breakdown (period) for the donut
  const breakdown = CATEGORIES.map((cat) => ({
    label: t(`finance.cats.${cat}`),
    value: round2(fExpenses.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount_usd), 0)),
  })).filter((d) => d.value > 0);

  // collected vs spent trend — granularity follows the period filter:
  // month → daily buckets; year/all → monthly buckets.
  const trend = useMemo(() => {
    if (period === 'month') {
      const [y, m] = monthValue.split('-').map(Number);
      const days = new Date(y, m, 0).getDate();
      const collected = new Array(days).fill(0);
      const spent = new Array(days).fill(0);
      fPayments.forEach((p) => { const d = new Date(p.paid_on).getDate(); collected[d - 1] += Number(p.amount_usd); });
      fExpenses.forEach((e) => { const d = new Date(e.expense_date).getDate(); spent[d - 1] += Number(e.amount_usd); });
      const labels = Array.from({ length: days }, (_, i) => (i === 0 || i === days - 1 || (i + 1) % 5 === 0 ? String(i + 1) : ''));
      return { labels, collected: collected.map(round2), spent: spent.map(round2) };
    }
    const buckets = period === 'year'
      ? Array.from({ length: 12 }, (_, k) => ({ key: `${now.getFullYear()}-${k}`, label: new Date(now.getFullYear(), k, 1).toLocaleString(undefined, { month: 'short' }), c: 0, s: 0 }))
      : Array.from({ length: 12 }, (_, k) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1); return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString(undefined, { month: 'short' }), c: 0, s: 0 }; });
    const find = (dt: string) => { const d = new Date(dt); return buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`); };
    fPayments.forEach((p) => { const b = find(p.paid_on); if (b) b.c += Number(p.amount_usd); });
    fExpenses.forEach((e) => { const b = find(e.expense_date); if (b) b.s += Number(e.amount_usd); });
    return { labels: buckets.map((b) => b.label), collected: buckets.map((b) => round2(b.c)), spent: buckets.map((b) => round2(b.s)) };
  }, [period, monthValue, fPayments, fExpenses]); // eslint-disable-line react-hooks/exhaustive-deps

  // units the current expense form targets
  const targetUnits = useMemo(() => {
    if (expForm.scope === 'block') return units;
    if (expForm.scope === 'group') return units.filter((u) => unitGroups.some((x) => x.group_id === expForm.group_id && x.unit_id === u.id));
    if (expForm.scope === 'units') return units.filter((u) => expForm.selectedUnits.includes(u.id));
    if (expForm.scope === 'unit') return units.filter((u) => u.id === expForm.unit_id);
    return [];
  }, [expForm, units, unitGroups]);

  const preview = useMemo(
    () => allocate(Number(expForm.amount) || 0, targetUnits, expForm.method, custom),
    [expForm.amount, expForm.method, targetUnits, custom],
  );
  const previewSum = preview.reduce((s, r) => s + r.amount, 0);

  function openExpense() { setEditingExpenseId(null); setExpForm(newExpForm()); setCustom({}); setExpFile(null); setExpOpen(true); }
  function openPayment() { setEditingPaymentId(null); setPayForm(newPayForm()); setPayFile(null); setPayOpen(true); }

  function openExpenseEdit(e: Expense) {
    const myCharges = charges.filter((c) => c.expense_id === e.id);
    setEditingExpenseId(e.id);
    setDetailExpense(null);
    setExpFile(null);
    setExpForm({
      category: e.category, description: e.description, amount: String(e.amount_usd), expense_date: e.expense_date,
      scope: 'units', method: e.method, group_id: '', unit_id: '', selectedUnits: myCharges.map((c) => c.unit_id),
    });
    // prefill custom amounts from existing charges (so "custom" edits are exact)
    setCustom(Object.fromEntries(myCharges.map((c) => [c.unit_id, String(c.amount_usd)])));
    setExpOpen(true);
  }

  function openPaymentEdit(p: Payment) {
    setEditingPaymentId(p.id);
    setPayFile(null);
    setPayForm({ unit_id: p.unit_id, amount: String(p.amount_usd), method: p.method, paid_on: p.paid_on, note: p.note ?? '' });
    setPayOpen(true);
  }

  async function saveExpense() {
    const amount = Number(expForm.amount);
    if (!amount || amount <= 0 || targetUnits.length === 0) return;
    setSaving(true);
    const desc = expForm.description.trim() || CAT_LABEL[expForm.category];
    const invoice_url = expFile ? await uploadFile('attachments', `${buildingId}/expenses`, expFile) : null;

    let expenseId = editingExpenseId;
    if (editingExpenseId) {
      const patch: Record<string, unknown> = {
        category: expForm.category, description: desc, amount_usd: amount,
        expense_date: expForm.expense_date, scope_type: expForm.scope, method: expForm.method,
      };
      if (invoice_url) patch.invoice_url = invoice_url;
      await supabase.from('expenses').update(patch).eq('id', editingExpenseId);
      await supabase.from('charges').delete().eq('expense_id', editingExpenseId); // re-allocate cleanly
    } else {
      const { data: exp, error } = await supabase.from('expenses').insert({
        building_id: buildingId, category: expForm.category, description: desc,
        amount_usd: amount, expense_date: expForm.expense_date, scope_type: expForm.scope, method: expForm.method, invoice_url, created_by: profile?.id,
      }).select().single();
      if (error || !exp) { setSaving(false); return; }
      expenseId = (exp as Expense).id;
    }

    const rows = allocate(amount, targetUnits, expForm.method, custom)
      .filter((r) => r.amount !== 0)
      .map((r) => ({
        expense_id: expenseId, unit_id: r.unit_id, building_id: buildingId,
        category: expForm.category, description: desc,
        amount_usd: r.amount, charge_date: expForm.expense_date, created_by: profile?.id,
      }));
    if (rows.length) await supabase.from('charges').insert(rows);

    setSaving(false);
    setExpOpen(false);
    loadManager();
  }

  async function deleteExpense(id: string) {
    if (!confirm('Delete this expense and the charges it created? This cannot be undone.')) return;
    await supabase.from('expenses').delete().eq('id', id); // charges cascade
    setDetailExpense(null);
    loadManager();
  }

  async function savePayment() {
    const amount = Number(payForm.amount);
    if (!payForm.unit_id || !amount || amount <= 0) return;
    setSaving(true);
    const receipt_url = payFile ? await uploadFile('attachments', `${buildingId}/payments`, payFile) : null;
    // receipt_url is only added when present, so payments still work before migration 0003.
    const base: Record<string, unknown> = {
      unit_id: payForm.unit_id, amount_usd: amount, method: payForm.method,
      paid_on: payForm.paid_on, note: payForm.note.trim() || null,
    };
    if (receipt_url) base.receipt_url = receipt_url;

    const { error } = editingPaymentId
      ? await supabase.from('payments').update(base).eq('id', editingPaymentId)
      : await supabase.from('payments').insert({ ...base, building_id: buildingId, recorded_by: profile?.id });

    setSaving(false);
    if (error) { alert(`Could not save payment: ${error.message}`); return; }
    setPayOpen(false);
    loadManager();
  }

  async function deletePayment(id: string) {
    if (!confirm('Delete this payment? This cannot be undone.')) return;
    await supabase.from('payments').delete().eq('id', id);
    loadManager();
  }

  // ================= RESIDENT VIEW =================
  if (!isManager) {
    if (!myUnitIds.length) return <EmptyState title={t('finance.noStatement')} body={t('finance.noStatementBody')} />;
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">{t('finance.myAccount')}</h1>
        <p className="text-sm text-slate-500 mb-6">{t('finance.myAccountSub')}</p>
        {book.map((r) => (
          <Card key={r.unit.id} className="mb-4">
            <CardBody>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Unit {r.unit.label}</p>
                  <p className={`text-3xl font-bold tnum ${r.balance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(r.balance)}</p>
                  <p className="text-xs text-slate-400 mt-1">{r.balance < 0 ? t('finance.youOwe') : t('finance.creditBalance')}</p>
                </div>
                <div className="text-end text-sm space-y-0.5">
                  <p className="text-slate-500">{t('finance.charged')} <span className="font-medium text-slate-800 tnum">{money(r.charged)}</span></p>
                  <p className="text-slate-500">{t('finance.paid')} <span className="font-medium text-slate-800 tnum">{money(r.paid)}</span></p>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
        <StatementList charges={charges} payments={payments} unitLabel={unitLabel} />
      </div>
    );
  }

  // ================= MANAGER VIEW =================
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('finance.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('finance.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {buildings.length > 1 && (
            <Select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} className="min-w-[180px]">
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Select value={period} onChange={(e) => setPeriod(e.target.value as 'month' | 'year' | 'all')}>
            <option value="all">{t('finance.allTime')}</option>
            <option value="year">{t('finance.thisYear')}</option>
            <option value="month">{t('finance.month')}</option>
          </Select>
          {period === 'month' && (
            <input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400"
            />
          )}
        </div>
      </div>

      {!buildingId ? (
        <Empty body={t('finance.noBuildings')} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <Kpi label={t('finance.collected')} value={money(collectedP)} icon={TrendingUp} tone="emerald" hint={periodLabel} />
            <Kpi label={t('finance.spent')} value={money(spentP)} icon={Receipt} tone="slate" hint={periodLabel} />
            <Kpi label={t('finance.net')} value={money(netP)} icon={Wallet} tone={netP >= 0 ? 'indigo' : 'rose'} hint={periodLabel} />
            <Kpi label={t('finance.outstanding')} value={money(outstanding)} icon={AlertCircle} tone={outstanding > 0 ? 'amber' : 'slate'} hint={t('finance.owedNow')} />
          </div>

          {/* charts */}
          <div className="grid lg:grid-cols-3 gap-4 mb-6">
            <Card className="lg:col-span-2">
              <CardBody>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700">{t('dashboard.collectedVsSpent')}</p>
                  <span className="text-xs text-slate-400">{periodLabel}</span>
                </div>
                <TrendChart labels={trend.labels} series={[
                  { name: t('finance.collected'), color: '#10b981', data: trend.collected },
                  { name: t('finance.spent'), color: '#f43f5e', data: trend.spent },
                ]} />
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-sm font-semibold text-slate-700 mb-3">{t('finance.spendingByCategory')} <span className="font-normal text-slate-400 text-xs">· {periodLabel}</span></p>
                <Donut data={breakdown} centerLabel={t('finance.spent')} />
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="inline-flex p-1 bg-slate-100 rounded-xl">
              {([['book', t('finance.book'), BookOpen], ['expenses', t('finance.expenses'), Receipt], ['payments', t('finance.payments'), HandCoins]] as ['book' | 'expenses' | 'payments', string, typeof BookOpen][]).map(([key, label, Icon]) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-lg transition cursor-pointer ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            {canManageFinance && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={openPayment} disabled={units.length === 0}><HandCoins size={16} /> {t('finance.recordPayment')}</Button>
                <Button onClick={openExpense} disabled={units.length === 0}><Plus size={16} /> {t('finance.recordExpense')}</Button>
              </div>
            )}
          </div>

          {units.length === 0 ? (
            <Card><CardBody><div className="text-center py-10">
              <Wallet className="mx-auto text-slate-300 mb-2" size={28} />
              <p className="text-sm text-slate-500 mb-3">{t('finance.addUnitsFirst')}</p>
              <Link to="/structure"><Button variant="secondary" size="sm">{t('finance.goToStructure')}</Button></Link>
            </div></CardBody></Card>
          ) : loading ? <p className="text-sm text-slate-500">{t('common.loading')}</p> : (
            <>
              {tab === 'book' && (
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wide">
                        <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                        <th className="px-5 py-3 text-start font-medium w-40">{t('finance.collectedCol')}</th>
                        <th className="px-5 py-3 text-end font-medium">{t('finance.billed')}</th>
                        <th className="px-5 py-3 text-end font-medium">{t('finance.paid')}</th>
                        <th className="px-5 py-3 text-end font-medium">{t('finance.balance')}</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-50">
                        {book.map((r) => {
                          const pct = r.charged > 0 ? (r.paid / r.charged) * 100 : (r.paid > 0 ? 100 : 0);
                          return (
                          <tr key={r.unit.id} className="hover:bg-slate-50/60">
                            <td className="px-5 py-3 font-semibold text-slate-900">{r.unit.label}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <MiniBar pct={pct} color={pct >= 100 ? '#10b981' : pct > 0 ? '#f59e0b' : '#e2e8f0'} />
                                <span className="text-xs text-slate-400 tnum w-9 text-end">{Math.round(pct)}%</span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-end text-slate-600 tnum">{money(r.charged)}</td>
                            <td className="px-5 py-3 text-end text-slate-600 tnum">{money(r.paid)}</td>
                            <td className={`px-5 py-3 text-end font-semibold tnum ${r.balance < 0 ? 'text-rose-600' : r.balance > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{money(r.balance)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {tab === 'expenses' && (fExpenses.length === 0 ? <Empty body={t('finance.noExpenses', { period: periodLabel })} /> : (
                <Card><div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="px-5 py-3 text-start font-medium">{t('finance.description')}</th>
                      <th className="px-5 py-3 text-start font-medium">{t('finance.category')}</th>
                      <th className="px-5 py-3 text-start font-medium">{t('finance.split')}</th>
                      <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {fExpenses.map((e) => (
                        <tr key={e.id} onClick={() => setDetailExpense(e)} className="hover:bg-indigo-50/40 cursor-pointer">
                          <td className="px-5 py-3 font-medium text-slate-900">
                            <span className="inline-flex items-center gap-1.5">
                              {e.description}
                              {e.invoice_url && <Paperclip size={13} className="text-slate-400" />}
                            </span>
                          </td>
                          <td className="px-5 py-3"><Badge color="indigo">{t(`finance.cats.${e.category}`)}</Badge></td>
                          <td className="px-5 py-3 text-slate-500 text-xs">{e.scope_type} · {e.method.replace('_', ' ')}</td>
                          <td className="px-5 py-3 text-slate-500">{format(new Date(e.expense_date), 'MMM d, yyyy')}</td>
                          <td className="px-5 py-3 text-end font-semibold text-slate-900 tnum">{money(Number(e.amount_usd))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></Card>
              ))}

              {tab === 'payments' && (fPayments.length === 0 ? <Empty body={t('finance.noPayments', { period: periodLabel })} /> : (
                <Card><div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wide">
                      <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                      <th className="px-5 py-3 text-start font-medium">{t('finance.method')}</th>
                      <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                      <th className="px-5 py-3 text-start font-medium">{t('finance.note')}</th>
                      <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                      {canManageFinance && <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>}
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {fPayments.map((p) => (
                        <tr key={p.id} onClick={() => setDetailPayment(p)} className="hover:bg-indigo-50/40 cursor-pointer">
                          <td className="px-5 py-3 font-semibold text-slate-900">{unitLabel[p.unit_id] ?? '—'}</td>
                          <td className="px-5 py-3 text-slate-600">{t(`finance.methods.${p.method}`)}</td>
                          <td className="px-5 py-3 text-slate-500">{format(new Date(p.paid_on), 'MMM d, yyyy')}</td>
                          <td className="px-5 py-3 text-slate-500">
                            <span className="inline-flex items-center gap-2">
                              {p.note ?? '—'}
                              {p.receipt_url && <a href={p.receipt_url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-indigo-600 hover:text-indigo-800"><Paperclip size={13} /></a>}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-end font-semibold text-emerald-600 tnum">{money(Number(p.amount_usd))}</td>
                          {canManageFinance && (
                            <td className="px-5 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={(ev) => { ev.stopPropagation(); openPaymentEdit(p); }} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"><Pencil size={15} /></button>
                                <button onClick={(ev) => { ev.stopPropagation(); deletePayment(p.id); }} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 size={15} /></button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div></Card>
              ))}
            </>
          )}
        </>
      )}

      {/* ---------------- Expense modal ---------------- */}
      <Modal open={expOpen} onClose={() => setExpOpen(false)} title={editingExpenseId ? t('finance.editExpense') : t('finance.recordExpense')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('finance.category')} value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value as ExpenseCategory })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`finance.cats.${c}`)}</option>)}
            </Select>
            <Input label={t('finance.amount')} type="number" step="0.01" min="0" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
          </div>
          <Input label={t('finance.description')} value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="..." />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.date')} type="date" value={expForm.expense_date} onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })} />
            <Select label={t('finance.applyTo')} value={expForm.scope} onChange={(e) => setExpForm({ ...expForm, scope: e.target.value as AllocationScope })}>
              <option value="block">{t('finance.allUnits')}</option>
              <option value="group">{t('finance.aGroup')}</option>
              <option value="units">{t('finance.selectedUnits')}</option>
              <option value="unit">{t('finance.singleUnit')}</option>
            </Select>
          </div>

          {expForm.scope === 'group' && (
            <Select label={t('finance.group')} value={expForm.group_id} onChange={(e) => setExpForm({ ...expForm, group_id: e.target.value })}>
              <option value="">{t('finance.selectGroup')}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
          )}
          {expForm.scope === 'unit' && (
            <Select label={t('finance.unit')} value={expForm.unit_id} onChange={(e) => setExpForm({ ...expForm, unit_id: e.target.value })}>
              <option value="">{t('finance.selectUnit')}</option>
              {units.map((u) => <option key={u.id} value={u.id}>{t('finance.unit')} {u.label}</option>)}
            </Select>
          )}
          {expForm.scope === 'units' && (
            <div>
              <label className="text-sm font-medium text-slate-600">{t('structure.units')}</label>
              <div className="mt-1.5 max-h-32 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-50">
                {units.map((u) => {
                  const on = expForm.selectedUnits.includes(u.id);
                  return (
                    <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={on} className="rounded" onChange={() => setExpForm({
                        ...expForm,
                        selectedUnits: on ? expForm.selectedUnits.filter((x) => x !== u.id) : [...expForm.selectedUnits, u.id],
                      })} />
                      <span className="text-sm text-slate-800">{t('finance.unit')} {u.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <Select label={t('finance.splitMethod')} value={expForm.method} onChange={(e) => setExpForm({ ...expForm, method: e.target.value as AllocationMethod })}>
            <option value="by_shares">{t('finance.byShares')}</option>
            <option value="equal">{t('finance.equally')}</option>
            <option value="custom">{t('finance.customAmounts')}</option>
          </Select>

          {/* preview */}
          {targetUnits.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 text-xs font-medium text-slate-500">
                <span>{t('finance.previewUnits', { count: targetUnits.length })}</span>
                <span className={Math.abs(previewSum - (Number(expForm.amount) || 0)) > 0.01 ? 'text-amber-600' : 'text-slate-500'}>
                  {t('finance.total')} {money(previewSum)}
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                {targetUnits.map((u) => {
                  const row = preview.find((r) => r.unit_id === u.id);
                  return (
                    <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-slate-700">{t('finance.unit')} {u.label} <span className="text-slate-400 text-xs">({Number(u.share_weight)} sh)</span></span>
                      {expForm.method === 'custom' ? (
                        <input type="number" step="0.01" min="0" value={custom[u.id] ?? ''} placeholder="0.00"
                          onChange={(e) => setCustom({ ...custom, [u.id]: e.target.value })}
                          className="w-24 text-end rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
                      ) : <span className="font-medium text-slate-900 tnum">{money(row?.amount ?? 0)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('finance.invoiceOptional')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setExpFile(e.target.files?.[0] ?? null)}
              className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-sm file:bg-white file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setExpOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveExpense} loading={saving} disabled={targetUnits.length === 0 || !(Number(expForm.amount) > 0)}>
              {editingExpenseId ? t('finance.saveChanges') : `${t('finance.createAndBill')} ${targetUnits.length || ''}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------------- Payment modal ---------------- */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={editingPaymentId ? t('finance.editPayment') : t('finance.recordPayment')}>
        <div className="space-y-4">
          <Select label={t('finance.unit')} value={payForm.unit_id} onChange={(e) => setPayForm({ ...payForm, unit_id: e.target.value })}>
            <option value="">{t('finance.selectUnit')}</option>
            {book.map((r) => <option key={r.unit.id} value={r.unit.id}>{t('finance.unit')} {r.unit.label} ({money(r.balance)})</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.amount')} type="number" step="0.01" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            <Select label={t('finance.method')} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value as PaymentMethod })}>
              {PAY_METHODS.map((m) => <option key={m} value={m}>{t(`finance.methods.${m}`)}</option>)}
            </Select>
          </div>
          <Input label={t('finance.date')} type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} />
          <Input label={t('finance.noteOptional')} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('finance.receiptOptional')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setPayFile(e.target.files?.[0] ?? null)}
              className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-sm file:bg-white file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPayOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={savePayment} loading={saving} disabled={!payForm.unit_id || !(Number(payForm.amount) > 0)}>{t('finance.record')}</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------- Expense detail ---------------- */}
      <Modal open={!!detailExpense} onClose={() => setDetailExpense(null)} title={detailExpense?.description ?? t('finance.expenses')} size="lg">
        {detailExpense && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { l: t('finance.amount'), v: money(Number(detailExpense.amount_usd)) },
                { l: t('finance.category'), v: t(`finance.cats.${detailExpense.category}`) },
                { l: t('finance.date'), v: format(new Date(detailExpense.expense_date), 'MMM d, yyyy') },
                { l: t('finance.split'), v: `${detailExpense.scope_type} · ${detailExpense.method.replace('_', ' ')}` },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide">{x.l}</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{x.v}</p>
                </div>
              ))}
            </div>

            {detailExpense.invoice_url && (
              <a href={detailExpense.invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                <FileText size={15} /> {t('finance.viewInvoice')}
              </a>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t('finance.billedToUnits')}</p>
              <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-50 max-h-72 overflow-y-auto">
                {charges.filter((c) => c.expense_id === detailExpense.id).map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-700">{t('finance.unit')} {unitLabel[c.unit_id] ?? '—'}</span>
                    <span className="font-medium text-slate-900 tnum">{money(Number(c.amount_usd))}</span>
                  </div>
                ))}
              </div>
            </div>

            {canManageFinance && (
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button variant="danger" onClick={() => deleteExpense(detailExpense.id)}>{t('common.delete')}</Button>
                <Button variant="secondary" onClick={() => openExpenseEdit(detailExpense)}>{t('common.edit')}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---------------- Payment detail ---------------- */}
      <Modal open={!!detailPayment} onClose={() => setDetailPayment(null)} title={detailPayment ? `${t('finance.payment')} — ${t('finance.unit')} ${unitLabel[detailPayment.unit_id] ?? ''}` : t('finance.payment')}>
        {detailPayment && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 px-4 py-3">
              <p className="text-xs text-emerald-600">{t('finance.amount')}</p>
              <p className="text-2xl font-bold text-emerald-700 tnum">{money(Number(detailPayment.amount_usd))}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { l: t('finance.unit'), v: unitLabel[detailPayment.unit_id] ?? '—' },
                { l: t('finance.method'), v: t(`finance.methods.${detailPayment.method}`) },
                { l: t('finance.date'), v: format(new Date(detailPayment.paid_on), 'MMM d, yyyy') },
                { l: t('finance.note'), v: detailPayment.note || '—' },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide">{x.l}</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{x.v}</p>
                </div>
              ))}
            </div>
            {detailPayment.receipt_url && (
              <a href={detailPayment.receipt_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                <FileText size={15} /> {t('finance.viewReceipt')}
              </a>
            )}
            {canManageFinance && (
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button variant="danger" onClick={() => { const id = detailPayment.id; setDetailPayment(null); deletePayment(id); }}>{t('common.delete')}</Button>
                <Button variant="secondary" onClick={() => { openPaymentEdit(detailPayment); setDetailPayment(null); }}>{t('common.edit')}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---- presentational helpers ----
function Kpi({ label, value, icon: Icon, tone, hint }: { label: string; value: string; icon: ElementType; tone: 'indigo' | 'emerald' | 'rose' | 'amber' | 'slate'; hint?: string }) {
  const tones: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600', amber: 'bg-amber-50 text-amber-600', slate: 'bg-slate-100 text-slate-500',
  };
  return (
    <Card><CardBody>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 font-medium">{label}</p>
          <p className="text-xl lg:text-2xl font-bold text-slate-900 tnum mt-1 truncate">{value}</p>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tones[tone]}`}><Icon size={18} /></div>
      </div>
    </CardBody></Card>
  );
}

function Empty({ body }: { body: string }) {
  return <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{body}</p></CardBody></Card>;
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3"><Wallet className="text-slate-400" size={22} /></div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500 mt-1">{body}</p>
    </div>
  );
}

function StatementList({ charges, payments, unitLabel }: { charges: Charge[]; payments: Payment[]; unitLabel: Record<string, string> }) {
  const { t } = useTranslation();
  type Row = { date: string; label: string; unit: string; amount: number };
  const rows: Row[] = [
    ...charges.map((c) => ({ date: c.charge_date, label: c.description || t(`finance.cats.${c.category}`), unit: unitLabel[c.unit_id] ?? '', amount: -Number(c.amount_usd) })),
    ...payments.map((p) => ({ date: p.paid_on, label: t('finance.payment'), unit: unitLabel[p.unit_id] ?? '', amount: Number(p.amount_usd) })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (rows.length === 0) return <Empty body={t('finance.noTransactions')} />;
  return (
    <Card><div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wide">
          <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
          <th className="px-5 py-3 text-start font-medium">{t('finance.description')}</th>
          <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50/60">
              <td className="px-5 py-3 text-slate-500">{format(new Date(r.date), 'MMM d, yyyy')}</td>
              <td className="px-5 py-3 text-slate-800">{r.label} <span className="text-slate-400 text-xs">· {t('finance.unit')} {r.unit}</span></td>
              <td className={`px-5 py-3 text-end font-semibold tnum ${r.amount < 0 ? 'text-slate-700' : 'text-emerald-600'}`}>
                {r.amount < 0 ? money(r.amount) : `+${money(r.amount)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div></Card>
  );
}
