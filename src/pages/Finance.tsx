import { useEffect, useMemo, useState, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Plus, Wallet, TrendingUp, AlertCircle, Receipt, HandCoins, BookOpen, Paperclip, FileText, Pencil, Download, Scale, Ban } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { computeBalance, adjustmentEffect } from '@/lib/balance';
import type { Unit, Expense, Charge, Payment, Adjustment, AdjustmentKind, Group, Compound, ExpenseCategory, AllocationMethod, AllocationScope, PaymentMethod, Dues, BilledTo } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { Donut, TrendChart, MiniBar } from '@/components/ui/Charts';
import { SkeletonTable } from '@/components/ui/Skeleton';

const CATEGORIES: ExpenseCategory[] = ['water', 'electricity', 'common_expenses', 'projects', 'contracts', 'fines', 'other'];
const CAT_LABEL: Record<ExpenseCategory, string> = {
  water: 'Water', electricity: 'Electricity', common_expenses: 'Common Expenses',
  projects: 'Projects', contracts: 'Contracts', fines: 'Fines', other: 'Other',
};
const PAY_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'other'];
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split `amount` across `units` by method; rounding fixed so parts sum to total. */
function allocate(amount: number, units: Unit[], method: AllocationMethod, custom: Record<string, string>): { unit_id: string; amount: number }[] {
  if (units.length === 0) return [];
  if (method === 'custom') return units.map((u) => ({ unit_id: u.id, amount: round2(Number(custom[u.id]) || 0) }));
  let raw: number[];
  if (method === 'by_shares') {
    const total = units.reduce((s, u) => s + Number(u.share_weight), 0) || 1;
    raw = units.map((u) => (amount * Number(u.share_weight)) / total);
  } else raw = units.map(() => amount / units.length);
  const rounded = raw.map(round2);
  const diff = round2(amount - rounded.reduce((s, r) => s + r, 0));
  if (rounded.length) rounded[rounded.length - 1] = round2(rounded[rounded.length - 1] + diff);
  return units.map((u, i) => ({ unit_id: u.id, amount: rounded[i] }));
}

interface Entity { key: string; kind: 'compound' | 'building'; id: string; name: string; buildingIds: string[]; blocks: { id: string; name: string }[]; }

type ExpScope = 'all' | 'block' | 'group' | 'units' | 'unit';
type ExpForm = {
  category: ExpenseCategory; description: string; amount: string; expense_date: string;
  scope: ExpScope; method: AllocationMethod; block_id: string; group_id: string; unit_id: string; selectedUnits: string[];
  billed_to: BilledTo;
};
const defaultBilledTo = (cat: ExpenseCategory): BilledTo =>
  cat === 'water' || cat === 'electricity' ? 'tenant' : 'both';
const newExpForm = (): ExpForm => ({
  category: 'common_expenses', description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10),
  scope: 'all', method: 'by_shares', block_id: '', group_id: '', unit_id: '', selectedUnits: [], billed_to: 'both',
});
type PayForm = { unit_id: string; amount: string; method: PaymentMethod; paid_on: string; note: string };
const newPayForm = (): PayForm => ({ unit_id: '', amount: '', method: 'cash', paid_on: new Date().toISOString().slice(0, 10), note: '' });

export default function Finance() {
  const { t } = useTranslation();
  const { can, canAny, isPlatformAdmin, profile, myUnitIds, myOwnerUnitIds, myTenantUnitIds } = useAuth();
  const { buildings } = useManagedBuildings();
  const isManager = isPlatformAdmin || canAny('finance.view');

  const [compounds, setCompounds] = useState<Compound[]>([]);
  useEffect(() => { supabase.from('compounds').select('*').then(({ data }) => setCompounds((data as Compound[]) ?? [])); }, []);

  // build selectable entities: one per compound (grouping its blocks) + each standalone building
  const entities = useMemo<Entity[]>(() => {
    const out: Entity[] = [];
    const byCompound: Record<string, typeof buildings> = {};
    for (const b of buildings) {
      if (b.compound_id) (byCompound[b.compound_id] ??= []).push(b);
      else out.push({ key: `b:${b.id}`, kind: 'building', id: b.id, name: b.name, buildingIds: [b.id], blocks: [{ id: b.id, name: b.name }] });
    }
    for (const [cid, blocks] of Object.entries(byCompound)) {
      const name = compounds.find((c) => c.id === cid)?.name ?? 'Compound';
      out.push({ key: `c:${cid}`, kind: 'compound', id: cid, name, buildingIds: blocks.map((b) => b.id), blocks: blocks.map((b) => ({ id: b.id, name: b.name })) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [buildings, compounds]);

  const [entityKey, setEntityKey] = useState('');
  const [blockFilters, setBlockFilters] = useState<string[]>([]);
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilters([]); }, [entityKey]);

  const [tab, setTab] = useState<'book' | 'expenses' | 'payments' | 'adjustments'>('book');
  // Book "as of" date — empty = today/live. Lets you pull a statement position
  // at a past date (e.g. year-end). Only affects the Book tab. (0033)
  const [asOf, setAsOf] = useState<string>('');
  // void (soft-cancel) + adjustments (0034)
  const [voidTarget, setVoidTarget] = useState<{ table: 'payments' | 'charges' | 'adjustments'; id: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState({ unit_id: '', kind: 'discount' as AdjustmentKind, amount: '', effective_date: new Date().toISOString().slice(0, 10), note: '' });
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('all');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [units, setUnits] = useState<Unit[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unitGroups, setUnitGroups] = useState<{ group_id: string; unit_id: string }[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  const canManageFinance = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('expense.manage', id));

  useEffect(() => {
    if (isManager && entity) loadScope();
    else if (!isManager && myUnitIds.length) loadResident();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, isManager]);

  async function loadScope() {
    if (!entity) return;
    setLoading(true);
    const blocks = entity.buildingIds;
    const [{ data: u }, { data: g }, { data: c }, { data: p }, { data: e }, { data: a }] = await Promise.all([
      supabase.from('units').select('*').in('building_id', blocks).order('label'),
      supabase.from('groups').select('*').in('building_id', blocks).order('name'),
      supabase.from('charges').select('*').in('building_id', blocks),
      supabase.from('payments').select('*').in('building_id', blocks).order('paid_on', { ascending: false }),
      entity.kind === 'compound'
        ? supabase.from('expenses').select('*').or(`compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`).order('expense_date', { ascending: false })
        : supabase.from('expenses').select('*').eq('building_id', entity.id).order('expense_date', { ascending: false }),
      supabase.from('adjustments').select('*').in('building_id', blocks).order('effective_date', { ascending: false }),
    ]);
    const unitList = (u as Unit[]) ?? [];
    setUnits(unitList);
    setGroups((g as Group[]) ?? []);
    setCharges((c as Charge[]) ?? []);
    setPayments((p as Payment[]) ?? []);
    setExpenses((e as Expense[]) ?? []);
    setAdjustments((a as Adjustment[]) ?? []);
    const ids = unitList.map((x) => x.id);
    if (ids.length) {
      const { data: ug } = await supabase.from('unit_groups').select('group_id, unit_id').in('unit_id', ids);
      setUnitGroups((ug as { group_id: string; unit_id: string }[]) ?? []);
    } else setUnitGroups([]);
    setLoading(false);
  }

  async function loadResident() {
    setLoading(true);
    const [{ data: u }, { data: c }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('units').select('*').in('id', myUnitIds),
      supabase.from('charges').select('*').in('unit_id', myUnitIds).order('charge_date', { ascending: false }),
      supabase.from('payments').select('*').in('unit_id', myUnitIds).order('paid_on', { ascending: false }),
      supabase.from('adjustments').select('*').in('unit_id', myUnitIds).order('effective_date', { ascending: false }),
    ]);
    setUnits((u as Unit[]) ?? []);
    setCharges((c as Charge[]) ?? []);
    setPayments((p as Payment[]) ?? []);
    setAdjustments((a as Adjustment[]) ?? []);
    setLoading(false);
  }

  const unitById = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units]);
  const blockName = useMemo(() => Object.fromEntries(buildings.map((b) => [b.id, b.name])), [buildings]);
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const unitDisplay = (uid: string) => {
    const u = unitById[uid];
    if (!u) return '—';
    return multiBlock ? `${blockName[u.building_id] ?? ''} · ${u.label}` : u.label;
  };

  // block-filter (client side) — slices to selected blocks; [] = all
  const inBlock = (bid: string | null) => blockFilters.length === 0 || (bid != null && blockFilters.includes(bid));
  const vUnits = units.filter((u) => inBlock(u.building_id));
  const vCharges = charges.filter((c) => inBlock(c.building_id));
  const vPayments = payments.filter((p) => inBlock(p.building_id));
  const vExpenses = expenses.filter((e) => inBlock(e.building_id) || (blockFilters.length === 0 && !e.building_id));

  // period filter
  const now = new Date();
  let range: { from: Date; to: Date } | null = null;
  if (period === 'year') range = { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
  else if (period === 'month') { const [y, m] = monthValue.split('-').map(Number); range = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) }; }
  const inRange = (d: string) => !range || (new Date(d) >= range.from && new Date(d) <= range.to);
  const periodLabel = period === 'month' ? new Date(`${monthValue}-01`).toLocaleString(undefined, { month: 'long', year: 'numeric' }) : period === 'year' ? t('finance.thisYear') : t('finance.allTime');

  // voided charges/payments never count toward cash or the book
  const pCharges = vCharges.filter((c) => !c.voided_at && inRange(c.charge_date));
  const pPayments = vPayments.filter((p) => !p.voided_at && inRange(p.paid_on));
  const pExpenses = vExpenses.filter((e) => inRange(e.expense_date));

  const collectedP = round2(pPayments.reduce((s, p) => s + Number(p.amount_usd), 0));
  const billedP = round2(pCharges.reduce((s, c) => s + Number(c.amount_usd), 0));
  const netP = round2(collectedP - billedP);

  // per-unit book. Balance folds in the opening balance and, when an "as of"
  // date is set, only counts transactions up to that date (see computeBalance).
  const book = useMemo(() => vUnits.map((u) => {
    const uCharges = vCharges.filter((c) => c.unit_id === u.id);
    const uPayments = vPayments.filter((p) => p.unit_id === u.id);
    const uAdj = adjustments.filter((a) => a.unit_id === u.id);
    const within = (d: string) => !asOf || new Date(d) <= new Date(asOf);
    const charged = uCharges.reduce((s, c) => (!c.voided_at && within(c.charge_date) ? s + Number(c.amount_usd) : s), 0);
    const paid = uPayments.reduce((s, p) => (!p.voided_at && within(p.paid_on) ? s + Number(p.amount_usd) : s), 0);
    return { unit: u, charged, paid, balance: computeBalance(u, uCharges, uPayments, asOf || null, uAdj) };
  }), [vUnits, vCharges, vPayments, adjustments, asOf]);
  const outstanding = round2(book.reduce((s, r) => s + (r.balance < 0 ? -r.balance : 0), 0));

  // category breakdown (charges → block-sliceable)
  const breakdown = CATEGORIES.map((cat) => ({
    label: t(`finance.cats.${cat}`),
    value: round2(pCharges.filter((c) => c.category === cat).reduce((s, c) => s + Number(c.amount_usd), 0)),
  })).filter((d) => d.value > 0);

  // trend: collected (payments) vs billed (charges), granularity by period
  const trend = useMemo(() => {
    if (period === 'month') {
      const [y, m] = monthValue.split('-').map(Number);
      const days = new Date(y, m, 0).getDate();
      const collected = new Array(days).fill(0); const billed = new Array(days).fill(0);
      pPayments.forEach((p) => { collected[new Date(p.paid_on).getDate() - 1] += Number(p.amount_usd); });
      pCharges.forEach((c) => { billed[new Date(c.charge_date).getDate() - 1] += Number(c.amount_usd); });
      const labels = Array.from({ length: days }, (_, i) => (i === 0 || i === days - 1 || (i + 1) % 5 === 0 ? String(i + 1) : ''));
      return { labels, collected: collected.map(round2), billed: billed.map(round2) };
    }
    const buckets = period === 'year'
      ? Array.from({ length: 12 }, (_, k) => ({ key: `${now.getFullYear()}-${k}`, label: new Date(now.getFullYear(), k, 1).toLocaleString(undefined, { month: 'short' }), c: 0, b: 0 }))
      : Array.from({ length: 12 }, (_, k) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1); return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString(undefined, { month: 'short' }), c: 0, b: 0 }; });
    const find = (dt: string) => { const d = new Date(dt); return buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`); };
    pPayments.forEach((p) => { const x = find(p.paid_on); if (x) x.c += Number(p.amount_usd); });
    pCharges.forEach((c) => { const x = find(c.charge_date); if (x) x.b += Number(c.amount_usd); });
    return { labels: buckets.map((x) => x.label), collected: buckets.map((x) => round2(x.c)), billed: buckets.map((x) => round2(x.b)) };
  }, [period, monthValue, pPayments, pCharges]); // eslint-disable-line react-hooks/exhaustive-deps

  // units targeted by the current expense form
  const targetUnits = useMemo(() => {
    if (expForm.scope === 'all') return units;
    if (expForm.scope === 'block') return units.filter((u) => u.building_id === expForm.block_id);
    if (expForm.scope === 'group') return units.filter((u) => unitGroups.some((x) => x.group_id === expForm.group_id && x.unit_id === u.id));
    if (expForm.scope === 'units') return units.filter((u) => expForm.selectedUnits.includes(u.id));
    if (expForm.scope === 'unit') return units.filter((u) => u.id === expForm.unit_id);
    return [];
  }, [expForm, units, unitGroups]);
  const preview = useMemo(() => allocate(Number(expForm.amount) || 0, targetUnits, expForm.method, custom), [expForm.amount, expForm.method, targetUnits, custom]);
  const previewSum = preview.reduce((s, r) => s + r.amount, 0);

  function openExpense() { setEditingExpenseId(null); setExpForm({ ...newExpForm(), scope: entity?.kind === 'compound' ? 'all' : 'all' }); setCustom({}); setExpFile(null); setExpOpen(true); }
  function openPayment() { setEditingPaymentId(null); setPayForm(newPayForm()); setPayFile(null); setPayOpen(true); }
  function openAdjustment() { setAdjForm({ unit_id: '', kind: 'discount', amount: '', effective_date: new Date().toISOString().slice(0, 10), note: '' }); setAdjOpen(true); }
  function openExpenseEdit(e: Expense) {
    const myCharges = charges.filter((c) => c.expense_id === e.id);
    setEditingExpenseId(e.id); setDetailExpense(null); setExpFile(null);
    setExpForm({ category: e.category, description: e.description, amount: String(e.amount_usd), expense_date: e.expense_date, scope: 'units', method: e.method, block_id: '', group_id: '', unit_id: '', selectedUnits: myCharges.map((c) => c.unit_id), billed_to: myCharges[0]?.billed_to ?? 'both' });
    setCustom(Object.fromEntries(myCharges.map((c) => [c.unit_id, String(c.amount_usd)])));
    setExpOpen(true);
  }
  function openPaymentEdit(p: Payment) {
    setEditingPaymentId(p.id); setPayFile(null);
    setPayForm({ unit_id: p.unit_id, amount: String(p.amount_usd), method: p.method, paid_on: p.paid_on, note: p.note ?? '' });
    setPayOpen(true);
  }

  async function saveExpense() {
    const amount = Number(expForm.amount);
    if (!entity || !amount || amount <= 0 || targetUnits.length === 0) return;
    setSaving(true);
    const desc = expForm.description.trim() || CAT_LABEL[expForm.category];
    const invoice_url = expFile ? await uploadFile('attachments', `${entity.id}/expenses`, expFile) : null;

    // expense-level tagging: compound entities carry compound_id; single-block keeps building_id
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (expForm.scope === 'block' ? expForm.block_id : null);
    const scope_type: AllocationScope = expForm.scope === 'all' ? (entity.kind === 'compound' ? 'compound' : 'block') : (expForm.scope as AllocationScope);

    let expenseId = editingExpenseId;
    if (editingExpenseId) {
      const patch: Record<string, unknown> = { category: expForm.category, description: desc, amount_usd: amount, expense_date: expForm.expense_date, scope_type, method: expForm.method };
      if (invoice_url) patch.invoice_url = invoice_url;
      await supabase.from('expenses').update(patch).eq('id', editingExpenseId);
      await supabase.from('charges').delete().eq('expense_id', editingExpenseId);
    } else {
      const { data: exp, error } = await supabase.from('expenses').insert({
        building_id, compound_id, category: expForm.category, description: desc, amount_usd: amount,
        expense_date: expForm.expense_date, scope_type, method: expForm.method, invoice_url, created_by: profile?.id,
      }).select().single();
      if (error || !exp) { setSaving(false); toast.error(error?.message ?? 'Could not save expense'); return; }
      expenseId = (exp as Expense).id;
    }

    // each charge carries the UNIT's own block_id → compound book slices by block
    const rows = allocate(amount, targetUnits, expForm.method, custom).filter((r) => r.amount !== 0).map((r) => ({
      expense_id: expenseId, unit_id: r.unit_id, building_id: unitById[r.unit_id]?.building_id,
      category: expForm.category, description: desc, amount_usd: r.amount, charge_date: expForm.expense_date, billed_to: expForm.billed_to, created_by: profile?.id,
    }));
    if (rows.length) await supabase.from('charges').insert(rows);
    toast.success(t('finance.expenseSaved'));
    setSaving(false); setExpOpen(false); loadScope();
  }

  async function deleteExpense(id: string) {
    if (!confirm('Delete this expense and the charges it created?')) return;
    await supabase.from('expenses').delete().eq('id', id);
    setDetailExpense(null); loadScope();
  }

  // Void = soft-cancel that keeps the record for audit (replaces hard delete).
  async function confirmVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    const patch = { voided_at: new Date().toISOString(), voided_by: profile?.id ?? null, void_reason: voidReason.trim() || null };
    const { error } = await supabase.from(voidTarget.table).update(patch).eq('id', voidTarget.id);
    setVoiding(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('finance.voided'));
    setVoidTarget(null); setVoidReason('');
    isManager ? loadScope() : loadResident();
  }

  async function saveAdjustment() {
    const amount = Number(adjForm.amount);
    if (!adjForm.unit_id || !amount || amount <= 0) { toast.error(t('finance.adjNeedsAmount')); return; }
    setSaving(true);
    const { error } = await supabase.from('adjustments').insert({
      unit_id: adjForm.unit_id,
      building_id: unitById[adjForm.unit_id]?.building_id,
      kind: adjForm.kind,
      amount_usd: amount,
      effective_date: adjForm.effective_date,
      note: adjForm.note.trim() || null,
      created_by: profile?.id,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('finance.adjSaved'));
    setAdjOpen(false); loadScope();
  }

  async function savePayment() {
    const amount = Number(payForm.amount);
    if (!payForm.unit_id || !amount || amount <= 0) return;
    setSaving(true);
    const receipt_url = payFile ? await uploadFile('attachments', `${payForm.unit_id}/payments`, payFile) : null;
    const base: Record<string, unknown> = { unit_id: payForm.unit_id, amount_usd: amount, method: payForm.method, paid_on: payForm.paid_on, note: payForm.note.trim() || null };
    if (receipt_url) base.receipt_url = receipt_url;
    const { error } = editingPaymentId
      ? await supabase.from('payments').update(base).eq('id', editingPaymentId)
      : await supabase.from('payments').insert({ ...base, building_id: unitById[payForm.unit_id]?.building_id, recorded_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(`Could not save payment: ${error.message}`); return; }
    toast.success(t('finance.paymentSaved'));
    setPayOpen(false); loadScope();
  }

  // (payments are voided, not deleted — see confirmVoid)

  // ─── PDF export ───────────────────────────────────────────────────────────

  async function exportUnitStatement(unit: Unit, unitCharges: Charge[], unitPayments: Payment[]) {
    const { UnitStatementDoc, downloadPdf } = await import('@/lib/pdf');
    const el = (
      <UnitStatementDoc
        unitLabel={unit.label}
        buildingName={entity?.name ?? ''}
        period={periodLabel}
        generatedOn={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
        charges={unitCharges}
        payments={unitPayments}
      />
    );
    await downloadPdf(el, `statement-unit-${unit.label.replace(/\s+/g, '-')}.pdf`);
  }

  async function exportBuildingReport() {
    const { BuildingReportDoc, downloadPdf } = await import('@/lib/pdf');
    const el = (
      <BuildingReportDoc
        entityName={entity?.name ?? ''}
        period={periodLabel}
        generatedOn={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
        kpi={{ collected: collectedP, billed: billedP, outstanding }}
        book={book}
        expenses={pExpenses}
      />
    );
    await downloadPdf(el, `report-${(entity?.name ?? 'building').replace(/\s+/g, '-')}-${period}.pdf`);
  }

  // ================= RESIDENT VIEW =================
  if (!isManager) {
    if (!myUnitIds.length) return <EmptyState title={t('finance.noStatement')} body={t('finance.noStatementBody')} />;
    const myChargesForUnit = (unitId: string) => {
      const isOwner = myOwnerUnitIds.includes(unitId);
      const isTenant = myTenantUnitIds.includes(unitId);
      return charges.filter((c) => c.unit_id === unitId && (
        c.billed_to === 'both' || (isOwner && c.billed_to === 'owner') || (isTenant && c.billed_to === 'tenant')
      ));
    };
    const rBook = units.map((u) => {
      const unitCharges = myChargesForUnit(u.id).filter((c) => !c.voided_at);
      const uPayments = payments.filter((p) => p.unit_id === u.id && !p.voided_at);
      const uAdj = adjustments.filter((a) => a.unit_id === u.id);
      const charged = unitCharges.reduce((s, c) => s + Number(c.amount_usd), 0);
      const paid = uPayments.reduce((s, p) => s + Number(p.amount_usd), 0);
      // include opening balance + adjustments so the resident sees the true figure
      return { unit: u, charged, paid, balance: computeBalance(u, unitCharges, uPayments, null, uAdj), unitCharges };
    });
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('finance.myAccount')}</h1>
          {rBook.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => {
              const r = rBook[0];
              exportUnitStatement(r.unit, r.unitCharges, payments.filter(p => p.unit_id === r.unit.id));
            }}>
              <Download size={15} /> {t('finance.exportStatement')}
            </Button>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-6">{t('finance.myAccountSub')}</p>
        {rBook.map((r) => (
          <Card key={r.unit.id} className="mb-4"><CardBody>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">{t('finance.unit')} {r.unit.label}</p>
                <p className={`text-3xl font-bold tnum ${r.balance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(r.balance)}</p>
                <p className="text-xs text-slate-400 mt-1">{r.balance < 0 ? t('finance.youOwe') : t('finance.creditBalance')}</p>
              </div>
              <div className="text-end text-sm space-y-0.5">
                <p className="text-slate-500">{t('finance.charged')} <span className="font-medium text-slate-800 tnum">{money(r.charged)}</span></p>
                <p className="text-slate-500">{t('finance.paid')} <span className="font-medium text-slate-800 tnum">{money(r.paid)}</span></p>
              </div>
            </div>
          </CardBody></Card>
        ))}
        <ResidentDuesCard unitIds={myUnitIds} />
        <StatementList charges={rBook.flatMap(r => r.unitCharges)} payments={payments} unitLabel={Object.fromEntries(units.map((u) => [u.id, u.label]))} />
      </div>
    );
  }

  // ================= MANAGER VIEW =================
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('finance.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('finance.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 1 && (
            <RadixSelect value={entityKey} onValueChange={setEntityKey}>
              <SelectTrigger className="min-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => <SelectItem key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
          )}
          {entity?.kind === 'compound' && multiBlock && (
            <MultiSelect
              options={entity.blocks.map(b => ({ value: b.id, label: b.name }))}
              value={blockFilters}
              onChange={setBlockFilters}
              allLabel={t('finance.allBlocks')}
            />
          )}
          <RadixSelect value={period} onValueChange={(v) => setPeriod(v as 'month' | 'year' | 'all')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('finance.allTime')}</SelectItem>
              <SelectItem value="year">{t('finance.thisYear')}</SelectItem>
              <SelectItem value="month">{t('finance.month')}</SelectItem>
            </SelectContent>
          </RadixSelect>
          {period === 'month' && (
            <MonthPicker value={monthValue} onChange={setMonthValue} />
          )}
        </div>
      </div>

      {!entity ? <Empty body={t('finance.noBuildings')} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <Kpi label={t('finance.collected')} value={money(collectedP)} icon={TrendingUp} tone="emerald" hint={periodLabel} />
            <Kpi label={t('finance.billed')} value={money(billedP)} icon={Receipt} tone="slate" hint={periodLabel} />
            <Kpi label={t('finance.net')} value={money(netP)} icon={Wallet} tone={netP >= 0 ? 'indigo' : 'rose'} hint={periodLabel} />
            <Kpi label={t('finance.outstanding')} value={money(outstanding)} icon={AlertCircle} tone={outstanding > 0 ? 'amber' : 'slate'} hint={t('finance.owedNow')} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mb-6">
            <Card className="lg:col-span-2"><CardBody>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-primary">{t('dashboard.collectedVsSpent')}</p>
                <span className="text-xs text-muted-foreground">{periodLabel}{blockFilters.length === 1 ? ` · ${blockName[blockFilters[0]]}` : blockFilters.length > 1 ? ` · ${blockFilters.length} blocks` : ''}</span>
              </div>
              <TrendChart labels={trend.labels} series={[{ name: t('finance.collected'), color: '#10b981', data: trend.collected }, { name: t('finance.billed'), color: '#6366f1', data: trend.billed }]} />
            </CardBody></Card>
            <Card><CardBody>
              <p className="text-sm font-semibold text-primary mb-3">{t('finance.spendingByCategory')} <span className="font-normal text-muted-foreground text-xs">· {periodLabel}</span></p>
              <Donut data={breakdown} centerLabel={t('finance.billed')} />
            </CardBody></Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="inline-flex p-1 bg-slate-100 rounded-xl">
              {([['book', t('finance.book'), BookOpen], ['expenses', t('finance.expenses'), Receipt], ['payments', t('finance.payments'), HandCoins], ['adjustments', t('finance.adjustments'), Scale]] as ['book' | 'expenses' | 'payments' | 'adjustments', string, typeof BookOpen][]).map(([key, label, Icon]) => (
                <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-lg transition cursor-pointer ${tab === key ? 'bg-white text-slate-900 shadow-sm dark:bg-primary/20 dark:text-primary dark:shadow-none' : 'text-slate-500 hover:text-slate-700 dark:text-white dark:hover:text-primary'}`}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={exportBuildingReport} disabled={!entity || units.length === 0}><Download size={16} /> {t('finance.exportReport')}</Button>
              {canManageFinance && (
                <>
                  <Button variant="secondary" onClick={openAdjustment} disabled={units.length === 0}><Scale size={16} /> {t('finance.adjustment')}</Button>
                  <Button variant="secondary" onClick={openPayment} disabled={units.length === 0}><HandCoins size={16} /> {t('finance.recordPayment')}</Button>
                  <Button onClick={openExpense} disabled={units.length === 0}><Plus size={16} /> {t('finance.recordExpense')}</Button>
                </>
              )}
            </div>
          </div>

          {units.length === 0 ? (
            <Card><CardBody><div className="text-center py-10">
              <Wallet className="mx-auto text-slate-300 mb-2" size={28} />
              <p className="text-sm text-slate-500 mb-3">{t('finance.addUnitsFirst')}</p>
              <Link to="/structure"><Button variant="secondary" size="sm">{t('finance.goToStructure')}</Button></Link>
            </div></CardBody></Card>
          ) : loading ? <SkeletonTable rows={6} cols={5} /> : (
            <>
              {tab === 'book' && (
                <>
                <div className="flex items-center justify-end gap-2 mb-3">
                  <label className="text-xs text-slate-500">{t('finance.balanceAsOf')}</label>
                  <input
                    type="date"
                    value={asOf}
                    onChange={(e) => setAsOf(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#57D6E2]/50"
                  />
                  {asOf && (
                    <button onClick={() => setAsOf('')} className="text-xs text-[#7fe3ec] hover:underline cursor-pointer">
                      {t('finance.backToLive')}
                    </button>
                  )}
                </div>
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                    <th className="px-5 py-3 text-start font-medium w-40">{t('finance.collectedCol')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.billed')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.paid')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.balance')}</th>
                    <th className="px-3 py-3 w-8" />
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {book.map((r) => {
                      const pct = r.charged > 0 ? (r.paid / r.charged) * 100 : (r.paid > 0 ? 100 : 0);
                      return (
                        <tr key={r.unit.id} className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-semibold text-foreground dark:text-white">{unitDisplay(r.unit.id)}</td>
                          <td className="px-5 py-3"><div className="flex items-center gap-2"><MiniBar pct={pct} color={pct >= 100 ? '#10b981' : pct > 0 ? '#f59e0b' : '#e2e8f0'} /><span className="text-xs text-foreground dark:text-white tnum w-9 text-end">{Math.round(pct)}%</span></div></td>
                          <td className="px-5 py-3 text-end text-foreground dark:text-white tnum">{money(r.charged)}</td>
                          <td className="px-5 py-3 text-end text-foreground dark:text-white tnum">{money(r.paid)}</td>
                          <td className={`px-5 py-3 text-end font-semibold tnum ${r.balance < 0 ? 'text-red-400 dark:text-red-300' : r.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground dark:text-white'}`}>{money(r.balance)}</td>
                          <td className="px-3 py-3">
                            <button title={t('finance.exportStatement')} onClick={() => exportUnitStatement(r.unit, vCharges.filter(c => c.unit_id === r.unit.id), vPayments.filter(p => p.unit_id === r.unit.id))} className="text-primary hover:text-primary/70 transition cursor-pointer">
                              <Download size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div></Card>
                </>
              )}

              {tab === 'expenses' && (pExpenses.length === 0 ? <Empty body={t('finance.noExpenses', { period: periodLabel })} /> : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.description')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.category')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.split')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {pExpenses.map((e) => (
                      <tr key={e.id} onClick={() => setDetailExpense(e)} className="hover:bg-primary/5 cursor-pointer">
                        <td className="px-5 py-3 font-medium text-foreground dark:text-white"><span className="inline-flex items-center gap-1.5">{e.description}{e.invoice_url && <Paperclip size={13} className="text-muted-foreground" />}</span></td>
                        <td className="px-5 py-3"><Badge>{t(`finance.cats.${e.category}`)}</Badge></td>
                        <td className="px-5 py-3 text-foreground dark:text-white text-xs">{e.building_id ? blockName[e.building_id] ?? t('finance.aBlock') : (e.compound_id ? t('finance.wholeCompound') : e.scope_type)} · {e.method.replace('_', ' ')}</td>
                        <td className="px-5 py-3 text-foreground dark:text-white">{format(new Date(e.expense_date), 'MMM d, yyyy')}</td>
                        <td className="px-5 py-3 text-end font-semibold text-foreground dark:text-white tnum">{money(Number(e.amount_usd))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div></Card>
              ))}

              {tab === 'payments' && (pPayments.length === 0 ? <Empty body={t('finance.noPayments', { period: periodLabel })} /> : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.method')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.note')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                    {canManageFinance && <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {vPayments.filter((p) => inRange(p.paid_on)).map((p) => (
                      <tr key={p.id} onClick={() => !p.voided_at && setDetailPayment(p)} className={`${p.voided_at ? 'opacity-45' : 'hover:bg-primary/5 cursor-pointer'}`}>
                        <td className="px-5 py-3 font-semibold text-foreground dark:text-white">
                          {unitDisplay(p.unit_id)}
                          {p.voided_at && <span className="ms-2 text-[10px] uppercase tracking-wide bg-slate-500/15 text-slate-400 rounded px-1.5 py-0.5">{t('finance.voidedBadge')}</span>}
                        </td>
                        <td className="px-5 py-3 text-foreground dark:text-white">{t(`finance.methods.${p.method}`)}</td>
                        <td className="px-5 py-3 text-foreground dark:text-white">{format(new Date(p.paid_on), 'MMM d, yyyy')}</td>
                        <td className="px-5 py-3 text-foreground dark:text-white"><span className="inline-flex items-center gap-2">{p.note ?? '—'}{p.receipt_url && <AttachmentLink url={p.receipt_url} className="text-primary hover:text-primary/80 inline-flex" icon={Paperclip} />}</span></td>
                        <td className={`px-5 py-3 text-end font-semibold tnum ${p.voided_at ? 'line-through text-slate-400' : 'text-foreground dark:text-white'}`}>{money(Number(p.amount_usd))}</td>
                        {canManageFinance && (
                          <td className="px-5 py-3"><div className="flex items-center justify-end gap-1">
                            {!p.voided_at && <>
                              <button onClick={(ev) => { ev.stopPropagation(); openPaymentEdit(p); }} className="p-1.5 rounded-lg text-primary hover:text-primary/70 hover:bg-primary/10 cursor-pointer"><Pencil size={15} /></button>
                              <button onClick={(ev) => { ev.stopPropagation(); setVoidReason(''); setVoidTarget({ table: 'payments', id: p.id, label: `${unitDisplay(p.unit_id)} · ${money(Number(p.amount_usd))}` }); }} className="p-1.5 rounded-lg text-primary hover:text-destructive hover:bg-destructive/10 cursor-pointer" title={t('finance.void')}><Ban size={15} /></button>
                            </>}
                          </div></td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table></div></Card>
              ))}

              {tab === 'adjustments' && (adjustments.length === 0 ? <Empty body={t('finance.noAdjustments')} /> : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.adjKind')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.note')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.effect')}</th>
                    {canManageFinance && <th className="px-5 py-3 w-8" />}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {adjustments.map((a) => {
                      const eff = adjustmentEffect(a.kind, Number(a.amount_usd));
                      return (
                        <tr key={a.id} className={a.voided_at ? 'opacity-45' : ''}>
                          <td className="px-5 py-3 font-semibold text-foreground dark:text-white">
                            {unitDisplay(a.unit_id)}
                            {a.voided_at && <span className="ms-2 text-[10px] uppercase tracking-wide bg-slate-500/15 text-slate-400 rounded px-1.5 py-0.5">{t('finance.voidedBadge')}</span>}
                          </td>
                          <td className="px-5 py-3"><Badge>{t(`finance.adjKinds.${a.kind}`)}</Badge></td>
                          <td className="px-5 py-3 text-foreground dark:text-white">{format(new Date(a.effective_date), 'MMM d, yyyy')}</td>
                          <td className="px-5 py-3 text-muted-foreground text-xs">{a.note ?? '—'}</td>
                          <td className={`px-5 py-3 text-end font-semibold tnum ${a.voided_at ? 'line-through text-slate-400' : eff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(eff)}</td>
                          {canManageFinance && (
                            <td className="px-3 py-3 text-end">
                              {!a.voided_at && (
                                <button onClick={() => { setVoidReason(''); setVoidTarget({ table: 'adjustments', id: a.id, label: `${t(`finance.adjKinds.${a.kind}`)} · ${money(eff)}` }); }} className="p-1.5 rounded-lg text-primary hover:text-destructive hover:bg-destructive/10 cursor-pointer" title={t('finance.void')}><Ban size={15} /></button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div></Card>
              ))}
            </>
          )}
        </>
      )}

      {/* Expense modal */}
      <Modal open={expOpen} onClose={() => setExpOpen(false)} title={editingExpenseId ? t('finance.editExpense') : t('finance.recordExpense')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('finance.category')} value={expForm.category} onValueChange={(v) => { const cat = v as ExpenseCategory; setExpForm({ ...expForm, category: cat, billed_to: defaultBilledTo(cat) }); }}>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`finance.cats.${c}`)}</SelectItem>)}
            </SelectField>
            <Input label={t('finance.amount')} type="number" step="0.01" min="0" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
          </div>
          <Input label={t('finance.description')} value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} />
          <div className="grid grid-cols-3 gap-3">
            <Input label={t('finance.date')} type="date" value={expForm.expense_date} onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })} />
            <SelectField label={t('finance.applyTo')} value={expForm.scope} onValueChange={(v) => setExpForm({ ...expForm, scope: v as ExpScope })}>
              <SelectItem value="all">{entity?.kind === 'compound' ? t('finance.wholeCompound') : t('finance.allUnits')}</SelectItem>
              {entity?.kind === 'compound' && multiBlock && <SelectItem value="block">{t('finance.aBlock')}</SelectItem>}
              <SelectItem value="group">{t('finance.aGroup')}</SelectItem>
              <SelectItem value="units">{t('finance.selectedUnits')}</SelectItem>
              <SelectItem value="unit">{t('finance.singleUnit')}</SelectItem>
            </SelectField>
            <SelectField label={t('finance.billedTo')} value={expForm.billed_to} onValueChange={(v) => setExpForm({ ...expForm, billed_to: v as BilledTo })}>
              <SelectItem value="both">{t('finance.billedToOptions.both')}</SelectItem>
              <SelectItem value="owner">{t('finance.billedToOptions.owner')}</SelectItem>
              <SelectItem value="tenant">{t('finance.billedToOptions.tenant')}</SelectItem>
            </SelectField>
          </div>

          {expForm.scope === 'block' && (
            <SelectField label={t('finance.block')} value={expForm.block_id || '__none__'} onValueChange={(v) => setExpForm({ ...expForm, block_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('finance.selectUnit')}</SelectItem>
              {entity?.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          )}
          {expForm.scope === 'group' && (
            <SelectField label={t('finance.group')} value={expForm.group_id || '__none__'} onValueChange={(v) => setExpForm({ ...expForm, group_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('finance.selectGroup')}</SelectItem>
              {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectField>
          )}
          {expForm.scope === 'unit' && (
            <SelectField label={t('finance.unit')} value={expForm.unit_id || '__none__'} onValueChange={(v) => setExpForm({ ...expForm, unit_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('finance.selectUnit')}</SelectItem>
              {units.map((u) => <SelectItem key={u.id} value={u.id}>{unitDisplay(u.id)}</SelectItem>)}
            </SelectField>
          )}
          {expForm.scope === 'units' && (
            <div>
              <label className="text-sm font-medium text-slate-600">{t('structure.units')}</label>
              <div className="mt-1.5 max-h-32 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-50">
                {units.map((u) => {
                  const on = expForm.selectedUnits.includes(u.id);
                  return (
                    <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={on} className="rounded" onChange={() => setExpForm({ ...expForm, selectedUnits: on ? expForm.selectedUnits.filter((x) => x !== u.id) : [...expForm.selectedUnits, u.id] })} />
                      <span className="text-sm text-slate-800">{unitDisplay(u.id)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <SelectField label={t('finance.splitMethod')} value={expForm.method} onValueChange={(v) => setExpForm({ ...expForm, method: v as AllocationMethod })}>
            <SelectItem value="by_shares">{t('finance.byShares')}</SelectItem>
            <SelectItem value="equal">{t('finance.equally')}</SelectItem>
            <SelectItem value="custom">{t('finance.customAmounts')}</SelectItem>
          </SelectField>

          {targetUnits.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 text-xs font-medium text-slate-500">
                <span>{t('finance.previewUnits', { count: targetUnits.length })}</span>
                <span className={Math.abs(previewSum - (Number(expForm.amount) || 0)) > 0.01 ? 'text-amber-600' : 'text-slate-500'}>{t('finance.total')} {money(previewSum)}</span>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                {targetUnits.map((u) => {
                  const r = preview.find((x) => x.unit_id === u.id);
                  return (
                    <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-slate-700">{unitDisplay(u.id)} <span className="text-slate-400 text-xs">({Number(u.share_weight)} sh)</span></span>
                      {expForm.method === 'custom'
                        ? <input type="number" step="0.01" min="0" value={custom[u.id] ?? ''} placeholder="0.00" onChange={(e) => setCustom({ ...custom, [u.id]: e.target.value })} className="w-24 text-end rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
                        : <span className="font-medium text-slate-900 tnum">{money(r?.amount ?? 0)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('finance.invoiceOptional')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setExpFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setExpOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveExpense} loading={saving} disabled={targetUnits.length === 0 || !(Number(expForm.amount) > 0)}>{editingExpenseId ? t('finance.saveChanges') : `${t('finance.createAndBill')} ${targetUnits.length || ''}`}</Button>
          </div>
        </div>
      </Modal>

      {/* Payment modal */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={editingPaymentId ? t('finance.editPayment') : t('finance.recordPayment')}>
        <div className="space-y-4">
          <SelectField label={t('finance.unit')} value={payForm.unit_id || '__none__'} onValueChange={(v) => setPayForm({ ...payForm, unit_id: v === '__none__' ? '' : v })}>
            <SelectItem value="__none__">{t('finance.selectUnit')}</SelectItem>
            {book.map((r) => <SelectItem key={r.unit.id} value={r.unit.id}>{unitDisplay(r.unit.id)} ({money(r.balance)})</SelectItem>)}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.amount')} type="number" step="0.01" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            <SelectField label={t('finance.method')} value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v as PaymentMethod })}>
              {PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{t(`finance.methods.${m}`)}</SelectItem>)}
            </SelectField>
          </div>
          <Input label={t('finance.date')} type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} />
          <Input label={t('finance.noteOptional')} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('finance.receiptOptional')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setPayFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPayOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={savePayment} loading={saving} disabled={!payForm.unit_id || !(Number(payForm.amount) > 0)}>{t('finance.record')}</Button>
          </div>
        </div>
      </Modal>

      {/* Expense detail */}
      <Modal open={!!detailExpense} onClose={() => setDetailExpense(null)} title={detailExpense?.description ?? t('finance.expenses')} size="lg">
        {detailExpense && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { l: t('finance.amount'), v: money(Number(detailExpense.amount_usd)) },
                { l: t('finance.category'), v: t(`finance.cats.${detailExpense.category}`) },
                { l: t('finance.date'), v: format(new Date(detailExpense.expense_date), 'MMM d, yyyy') },
                { l: t('finance.split'), v: detailExpense.building_id ? (blockName[detailExpense.building_id] ?? t('finance.aBlock')) : (detailExpense.compound_id ? t('finance.wholeCompound') : detailExpense.scope_type) },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-400 uppercase tracking-wide">{x.l}</p><p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{x.v}</p></div>
              ))}
            </div>
            {detailExpense.invoice_url && <a href={detailExpense.invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"><FileText size={15} /> {t('finance.viewInvoice')}</a>}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t('finance.billedToUnits')}</p>
              <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-50 max-h-72 overflow-y-auto">
                {charges.filter((c) => c.expense_id === detailExpense.id).map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm"><span className="text-slate-700">{unitDisplay(c.unit_id)}</span><span className="font-medium text-slate-900 tnum">{money(Number(c.amount_usd))}</span></div>
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

      {/* Payment detail */}
      <Modal open={!!detailPayment} onClose={() => setDetailPayment(null)} title={detailPayment ? `${t('finance.payment')} — ${unitDisplay(detailPayment.unit_id)}` : t('finance.payment')}>
        {detailPayment && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 px-4 py-3"><p className="text-xs text-emerald-600">{t('finance.amount')}</p><p className="text-2xl font-bold text-emerald-700 tnum">{money(Number(detailPayment.amount_usd))}</p></div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { l: t('finance.unit'), v: unitDisplay(detailPayment.unit_id) },
                { l: t('finance.method'), v: t(`finance.methods.${detailPayment.method}`) },
                { l: t('finance.date'), v: format(new Date(detailPayment.paid_on), 'MMM d, yyyy') },
                { l: t('finance.note'), v: detailPayment.note || '—' },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[11px] text-slate-400 uppercase tracking-wide">{x.l}</p><p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{x.v}</p></div>
              ))}
            </div>
            {detailPayment.receipt_url && <AttachmentLink url={detailPayment.receipt_url} label={t('finance.viewReceipt')} className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline" />}
            {canManageFinance && (
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button variant="danger" onClick={() => { const p = detailPayment; setDetailPayment(null); setVoidReason(''); setVoidTarget({ table: 'payments', id: p.id, label: `${unitDisplay(p.unit_id)} · ${money(Number(p.amount_usd))}` }); }}><Ban size={15} /> {t('finance.void')}</Button>
                <Button variant="secondary" onClick={() => { openPaymentEdit(detailPayment); setDetailPayment(null); }}>{t('common.edit')}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Adjustment — non-cash change (credit note / discount / write-off / penalty / refund) */}
      <Modal open={adjOpen} onClose={() => setAdjOpen(false)} title={t('finance.newAdjustment')}>
        <div className="space-y-4">
          <SelectField label={t('finance.unit')} value={adjForm.unit_id} onValueChange={(v) => setAdjForm({ ...adjForm, unit_id: v })}>
            {book.map((r) => <SelectItem key={r.unit.id} value={r.unit.id}>{unitDisplay(r.unit.id)} ({money(r.balance)})</SelectItem>)}
          </SelectField>
          <SelectField label={t('finance.adjKind')} value={adjForm.kind} onValueChange={(v) => setAdjForm({ ...adjForm, kind: v as AdjustmentKind })}>
            {(['discount', 'credit_note', 'waiver', 'write_off', 'penalty', 'refund'] as AdjustmentKind[]).map((k) => (
              <SelectItem key={k} value={k}>{t(`finance.adjKinds.${k}`)}</SelectItem>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.amount')} type="number" step="0.01" min="0" value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} />
            <Input label={t('finance.date')} type="date" value={adjForm.effective_date} onChange={(e) => setAdjForm({ ...adjForm, effective_date: e.target.value })} />
          </div>
          {adjForm.amount && Number(adjForm.amount) > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('finance.adjEffectHint', {
                dir: adjustmentEffect(adjForm.kind, Number(adjForm.amount)) < 0 ? t('finance.adjIncreasesOwed') : t('finance.adjReducesOwed'),
                amt: money(Math.abs(adjustmentEffect(adjForm.kind, Number(adjForm.amount)))),
              })}
            </p>
          )}
          <Input label={t('finance.note')} value={adjForm.note} onChange={(e) => setAdjForm({ ...adjForm, note: e.target.value })} placeholder={t('finance.adjNotePlaceholder')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setAdjOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveAdjustment} loading={saving} disabled={!adjForm.unit_id || !adjForm.amount}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Void confirmation — soft-cancel, keeps the record */}
      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title={t('finance.voidTitle')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('finance.voidExplain', { item: voidTarget?.label ?? '' })}</p>
          <Input label={t('finance.voidReason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={t('finance.voidReasonPlaceholder')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setVoidTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={voiding} onClick={confirmVoid}>{t('finance.void')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone, hint }: { label: string; value: string; icon: ElementType; tone?: string; hint?: string }) {
  const gradients: Record<string, string> = {
    emerald: 'from-emerald-400 to-teal-500',
    indigo:  'from-violet-400 to-indigo-500',
    rose:    'from-rose-400 to-pink-500',
    amber:   'from-amber-400 to-orange-500',
    slate:   'from-slate-400 to-slate-500',
  };
  const gradient = gradients[tone ?? 'slate'] ?? 'from-teal-400 to-teal-600';
  return (
    <Card><CardBody><div className="flex items-start justify-between">
      <div className="min-w-0"><p className="text-xs text-muted-foreground font-medium">{label}</p><p className={`text-xl lg:text-2xl font-bold tnum mt-1 truncate ${tone === 'rose' ? 'text-red-400 dark:text-red-300' : 'text-foreground'}`}>{value}</p>{hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}</div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${gradient} text-white shadow-sm`}><Icon size={18} /></div>
    </div></CardBody></Card>
  );
}
function ResidentDuesCard({ unitIds }: { unitIds: string[] }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Dues[]>([]);
  const key = unitIds.join(',');
  useEffect(() => {
    if (!unitIds.length) return;
    supabase.from('dues').select('*').in('unit_id', unitIds).order('due_date', { ascending: false }).limit(8)
      .then(({ data }) => setRows((data as Dues[]) ?? []));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  return (
    <Card className="mb-4"><CardBody>
      <p className="text-sm font-semibold text-primary mb-3">{t('dues.residentTitle')}</p>
      <div className="space-y-2">
        {rows.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{d.period_label}{d.due_date ? ` · ${format(new Date(d.due_date), 'MMM d, yyyy')}` : ''}</span>
            <span className="font-semibold text-slate-900 tnum">{money(Number(d.amount_due))}</span>
          </div>
        ))}
      </div>
    </CardBody></Card>
  );
}

function Empty({ body }: { body: string }) { return <Card><CardBody><p className="text-sm text-muted-foreground text-center py-10">{body}</p></CardBody></Card>; }
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3"><Wallet className="text-slate-400" size={22} /></div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="text-sm text-slate-500 mt-1">{body}</p>
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
    <Card><div className="overflow-x-auto"><table className="w-full text-sm">
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
            <td className={`px-5 py-3 text-end font-semibold tnum ${r.amount < 0 ? 'text-red-400 dark:text-red-300' : 'text-emerald-600'}`}>{r.amount < 0 ? money(r.amount) : `+${money(r.amount)}`}</td>
          </tr>
        ))}
      </tbody>
    </table></div></Card>
  );
}
