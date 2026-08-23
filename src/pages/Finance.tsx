import { useEffect, useMemo, useState, Fragment, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, Wallet, TrendingUp, AlertCircle, Receipt, HandCoins, BookOpen, Paperclip, FileText, Pencil, Download, Scale, Ban, Send, Gauge, Landmark, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { computeBalance, computeUnitBalances, adjustmentEffect } from '@/lib/balance';
import { tenancyHelpers, buildBook, buildUnitBuckets as buildUnitBucketsShared, tenantTitle, requestLinesAsOf, fundPosition } from '@/lib/reportData';
import { useExpenseTypes, legacyCategoryFor } from '@/lib/expenseTypes';
import { composeUsdTotal, usdPartOf, currencyTag, currencyBreakdown } from '@/lib/currency';
import type { Unit, Expense, Charge, Payment, Adjustment, AdjustmentKind, Group, Compound, ExpenseCategory, AllocationMethod, AllocationScope, PaymentMethod, Dues, Tenure, PaymentRequest, PaymentRequestLine, BillingMode, Fund, FundEntry, FundEntryKind, Project } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { MeteringPanel } from '@/components/MeteringPanel';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Donut, TrendChart, MiniBar } from '@/components/ui/Charts';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { fmtMoney } from '@/lib/money';

const CATEGORIES: ExpenseCategory[] = ['water', 'electricity', 'common_expenses', 'projects', 'contracts', 'fines', 'other'];
const CAT_LABEL: Record<ExpenseCategory, string> = {
  water: 'Water', electricity: 'Electricity', common_expenses: 'Common Expenses',
  projects: 'Projects', contracts: 'Contracts', fines: 'Fines', other: 'Other',
};
const PAY_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'other'];
// one formatter, following the reader's language (src/lib/money.ts)
const money = (n: number) => fmtMoney(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split `amount` across `units` by method; rounding fixed so parts sum to total. */
type TenancyRow = { unit_id: string; user_id: string; tenure: string; created_at: string; ended_at: string | null; profiles: { full_name: string } | null };

// Subtle marker on tenant-attributed rows (payments, adjustments, expenses).
function TenantTag({ label }: { label: string }) {
  return (
    <span className="ms-1.5 align-middle text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
      {label}
    </span>
  );
}

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

interface Entity { key: string; kind: 'compound' | 'building'; id: string; name: string; buildingIds: string[]; blocks: { id: string; name: string }[]; billingMode: BillingMode; }

type ExpScope = 'all' | 'block' | 'group' | 'units' | 'unit';
type ExpForm = {
  category: ExpenseCategory; expense_type_id: string; description: string; amount: string; amount_lbp: string; lbp_rate: string; expense_date: string; extraordinary: boolean;
  scope: ExpScope; method: AllocationMethod; block_id: string; group_id: string; unit_id: string; selectedUnits: string[];
  // T5: for units that HAVE a tenant, charge this party. Owner-only units always
  // go to the owner regardless. (No more 'both' / 'all members'.)
  leasedTo: Tenure;
  // 0106: who bears it. 'residents' bills the whole amount; 'fund' bills nobody
  // (the building's own money); 'mixed' bills what is allocated and the
  // remainder is the fund's. The remainder is never silent: under 'residents'
  // a short allocation blocks save until it is named.
  funding: ExpFunding;
  // 0109: the project this expense belongs to ('' = none)
  project_id: string;
};
type ExpFunding = 'residents' | 'fund' | 'mixed';
const fundingOf = (e: Expense): ExpFunding => {
  const fp = Number(e.funded_by_fund_usd ?? 0);
  if (fp <= 0) return 'residents';
  return Math.abs(fp - Number(e.amount_usd)) < 0.005 ? 'fund' : 'mixed';
};
const defaultLeasedTo = (cat: ExpenseCategory): Tenure =>
  cat === 'water' || cat === 'electricity' ? 'tenant' : 'owner';
const newExpForm = (): ExpForm => ({
  category: 'common_expenses', expense_type_id: '', description: '', amount: '', amount_lbp: '', lbp_rate: '', expense_date: new Date().toISOString().slice(0, 10), extraordinary: false,
  scope: 'all', method: 'by_shares', block_id: '', group_id: '', unit_id: '', selectedUnits: [], leasedTo: 'owner', funding: 'residents', project_id: '',
});
type FundEntryForm = { kind: FundEntryKind; amount: string; amount_lbp: string; lbp_rate: string; entry_date: string; description: string; counterparty: string };
const newFundEntryForm = (): FundEntryForm => ({ kind: 'income', amount: '', amount_lbp: '', lbp_rate: '', entry_date: new Date().toISOString().slice(0, 10), description: '', counterparty: '' });
type PayForm = { unit_id: string; amount: string; amount_lbp: string; lbp_rate: string; method: PaymentMethod; paid_on: string; note: string; paid_by: Tenure };
const newPayForm = (): PayForm => ({ unit_id: '', amount: '', amount_lbp: '', lbp_rate: '', method: 'cash', paid_on: new Date().toISOString().slice(0, 10), note: '', paid_by: 'owner' });

export default function Finance() {
  const { t } = useTranslation();
  const { can, canAny, isPlatformAdmin, profile, myUnitIds: allMyUnitIds, myOwnerUnitIds, myTenantUnitIds, residentLens, residentUnitId } = useAuth();
  // Unit picker (sidebar, My-home lens): '' = all my units, otherwise drill into one.
  const myUnitIds = residentUnitId ? allMyUnitIds.filter((id) => id === residentUnitId) : allMyUnitIds;
  const { buildings } = useManagedBuildings();
  // Dual-persona lens: an admin browsing "My home" gets their own statement.
  const isManager = (isPlatformAdmin || canAny('finance.view')) && !residentLens;

  const [compounds, setCompounds] = useState<Compound[]>([]);
  useEffect(() => { supabase.from('compounds').select('*').then(({ data }) => setCompounds((data as Compound[]) ?? [])); }, []);

  // build selectable entities: one per compound (grouping its blocks) + each standalone building
  const entities = useMemo<Entity[]>(() => {
    const out: Entity[] = [];
    const byCompound: Record<string, typeof buildings> = {};
    for (const b of buildings) {
      if (b.compound_id) (byCompound[b.compound_id] ??= []).push(b);
      else out.push({ key: `b:${b.id}`, kind: 'building', id: b.id, name: b.name, buildingIds: [b.id], blocks: [{ id: b.id, name: b.name }], billingMode: b.billing_mode ?? 'arrears' });
    }
    for (const [cid, blocks] of Object.entries(byCompound)) {
      const comp = compounds.find((c) => c.id === cid);
      // the compound governs its blocks, same cascade as effective_billing_mode()
      out.push({ key: `c:${cid}`, kind: 'compound', id: cid, name: comp?.name ?? 'Compound', buildingIds: blocks.map((b) => b.id), blocks: blocks.map((b) => ({ id: b.id, name: b.name })), billingMode: comp?.billing_mode ?? 'arrears' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [buildings, compounds]);

  // GLOBAL entity selection (sidebar) — '' = "All buildings", which Finance
  // can't aggregate across mixed entities: it shows a pick-one prompt instead.
  const { entityKey } = useAuth();
  const [blockFilters, setBlockFilters] = useState<string[]>([]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilters([]); }, [entityKey]);

  const [tab, setTab] = useState<'book' | 'expenses' | 'payments' | 'adjustments' | 'metering' | 'fund'>('book');
  // Book "as of" date — empty = today/live. Lets you pull a statement position
  // at a past date (e.g. year-end). Only affects the Book tab. (0033)
  const [asOf, setAsOf] = useState<string>('');
  // T6 + per-tenant buckets: 'combined' | 'owner' | a tenant's user id.
  // Defaults to the latest tenant once tenancy loads (see effect below).
  const [residentView, setResidentView] = useState<string>('combined');
  // void (soft-cancel) + adjustments (0034)
  const [voidTarget, setVoidTarget] = useState<{ table: 'payments' | 'charges' | 'adjustments'; id: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState({ unit_id: '', kind: 'discount' as AdjustmentKind, amount: '', effective_date: new Date().toISOString().slice(0, 10), note: '' });
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('all');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [units, setUnits] = useState<Unit[]>([]);
  // tenancy with names + date ranges → resolve who the tenant was on any date
  const [tenancy, setTenancy] = useState<TenancyRow[]>([]);
  /** Dues for the loaded units — listed on exported statements under the party
   *  they fall on (0070). Obligations, never part of the balance. */
  const [dues, setDues] = useState<Dues[]>([]);
  // days-to-pay prefill (0076): compound governs, default 7
  const effectiveDueDays = useMemo(() => {
    if (!entity) return 7;
    if (entity.kind === 'compound') return compounds.find((c) => c.id === entity.id)?.payment_due_days ?? 7;
    const b = buildings.find((x) => x.id === entity.id);
    const comp = b?.compound_id ? compounds.find((c) => c.id === b.compound_id) : null;
    return comp?.payment_due_days ?? b?.payment_due_days ?? 7;
  }, [entity, buildings, compounds]);

  // LBP form prefill (0086): the compound's rate governs its blocks. Frozen
  // per row on save — changing the setting never rewrites old entries.
  const effectiveLbpRate = useMemo(() => {
    if (!entity) return null;
    if (entity.kind === 'compound') return compounds.find((c) => c.id === entity.id)?.lbp_rate ?? null;
    const b = buildings.find((x) => x.id === entity.id);
    const comp = b?.compound_id ? compounds.find((c) => c.id === b.compound_id) : null;
    return comp?.lbp_rate ?? b?.lbp_rate ?? null;
  }, [entity, buildings, compounds]);

  // the entity's expense catalog (0085); compound catalog governs its blocks
  const { activeTypes, types: allTypes } = useExpenseTypes(entity?.kind, entity?.id);
  /** Display name for an expense: its catalog type (custom names included),
   *  falling back to the legacy enum label. Without this every custom type
   *  renders as "Other" across the tab. */
  const typeLabel = (e: { expense_type_id?: string | null; category: string }) => {
    const ty = e.expense_type_id ? allTypes.find((x) => x.id === e.expense_type_id) : undefined;
    if (ty && !ty.key) return ty.name;
    return t(`finance.cats.${ty?.key ?? e.category}`);
  };
  // Ad-hoc arrears collection (0076)
  const [reqOpen, setReqOpen] = useState(false);
  const [reqLabel, setReqLabel] = useState('');
  const [reqDays, setReqDays] = useState('7');
  const [reqBusy, setReqBusy] = useState(false);
  const [openRequestLines, setOpenRequestLines] = useState<PaymentRequestLine[]>([]);
  // '' = live balances; a date = "settle the period UP TO here" (0088). The
  // preview and the RPC share the same rule, so what is shown is what is asked.
  const [reqAsOf, setReqAsOf] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  // building_id → Whish account (0059) — shown to residents who owe money.
  // Names ride along: a resident with units in several buildings needs their
  // tenant buckets labelled per building, and `buildings` (managed) is empty
  // for a pure resident.
  const [whishByBuilding, setWhishByBuilding] = useState<Record<string, string>>({});
  const [nameByBuilding, setNameByBuilding] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = [...new Set(units.map((u) => u.building_id))];
    if (!ids.length) { setWhishByBuilding({}); setNameByBuilding({}); return; }
    supabase.from('buildings').select('id, name, whish_number').in('id', ids)
      .then(({ data }) => {
        const rows = (data ?? []) as { id: string; name: string; whish_number: string | null }[];
        setWhishByBuilding(Object.fromEntries(rows.filter((b) => b.whish_number).map((b) => [b.id, b.whish_number as string])));
        setNameByBuilding(Object.fromEntries(rows.map((b) => [b.id, b.name])));
      });
  }, [units]);
  const [unitGroups, setUnitGroups] = useState<{ group_id: string; unit_id: string }[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState<ExpForm>(newExpForm());

  // ── Fund (0106): cash on hand, apart from what residents owe ──
  const [fund, setFund] = useState<Fund | null>(null);
  // 0109: open projects in scope, offered on the expense form
  const [projects, setProjects] = useState<Project[]>([]);
  const [fundEntries, setFundEntries] = useState<FundEntry[]>([]);
  const [fundEntryOpen, setFundEntryOpen] = useState(false);
  const [fundEntryForm, setFundEntryForm] = useState<FundEntryForm>(newFundEntryForm());
  const [fundEntryFile, setFundEntryFile] = useState<File | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingForm, setOpeningForm] = useState({ amount: '', date: '', note: '' });

  function openFundEntry(kind: FundEntryKind) {
    setFundEntryForm({ ...newFundEntryForm(), kind, lbp_rate: effectiveLbpRate ? String(effectiveLbpRate) : '' });
    setFundEntryFile(null); setFundEntryOpen(true);
  }
  function openOpening() {
    setOpeningForm({ amount: fund ? String(fund.opening_balance_usd) : '', date: fund?.opening_date ?? '', note: fund?.note ?? '' });
    setOpeningOpen(true);
  }
  async function saveFundEntry() {
    if (!entity) return;
    const lbpPart = Number(fundEntryForm.amount_lbp) || 0;
    const rate = Number(fundEntryForm.lbp_rate) || 0;
    if (lbpPart > 0 && rate <= 0) { toast.error(t('finance.lbpNeedsRate')); return; }
    const amount = composeUsdTotal(Number(fundEntryForm.amount) || 0, lbpPart, rate);
    if (!(amount > 0) || !fundEntryForm.description.trim()) return;
    setSaving(true);
    const attachment_url = fundEntryFile ? await uploadFile('attachments', `${entity.id}/fund`, fundEntryFile) : null;
    const { error } = await supabase.from('fund_entries').insert({
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      kind: fundEntryForm.kind, amount_usd: amount,
      amount_lbp: lbpPart > 0 ? lbpPart : null, lbp_rate: lbpPart > 0 ? rate : null,
      entry_date: fundEntryForm.entry_date, description: fundEntryForm.description.trim(),
      counterparty: fundEntryForm.counterparty.trim() || null, attachment_url, created_by: profile?.id,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('fund.entrySaved')); setFundEntryOpen(false); loadScope();
  }
  async function voidFundEntry(id: string) {
    const reason = window.prompt(t('fund.voidReason'));
    if (reason === null) return;
    const { error } = await supabase.from('fund_entries').update({ voided_at: new Date().toISOString(), voided_by: profile?.id, void_reason: reason || null }).eq('id', id);
    if (error) toast.error(error.message); else { toast.success(t('fund.entryVoided')); loadScope(); }
  }
  async function saveOpening() {
    if (!entity) return;
    const amount = Number(openingForm.amount) || 0;
    setSaving(true);
    const row = {
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      opening_balance_usd: amount, opening_date: openingForm.date || null, note: openingForm.note.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = fund
      ? await supabase.from('funds').update(row).eq('id', fund.id)
      : await supabase.from('funds').insert({ ...row, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('fund.openingSaved')); setOpeningOpen(false); loadScope();
  }
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
  }, [entityKey, entities.length, isManager, residentUnitId]);

  async function loadScope() {
    if (!entity) return;
    setLoading(true);
    const blocks = entity.buildingIds;
    // Row tables go through fetchAll: PostgREST silently caps responses at
    // 1000 rows — unpaged, a building with real history would compute WRONG
    // totals from truncated data. (Ordering includes id as a stable tiebreaker.)
    const [{ data: u }, { data: g }, chargeRows, paymentRows, expenseRows, adjRows] = await Promise.all([
      supabase.from('units').select('*').in('building_id', blocks).order('label'),
      supabase.from('groups').select('*').in('building_id', blocks).order('name'),
      fetchAll<Charge>((f, t) => supabase.from('charges').select('*').in('building_id', blocks).order('charge_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
      fetchAll<Payment>((f, t) => supabase.from('payments').select('*').in('building_id', blocks).order('paid_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
      entity.kind === 'compound'
        ? fetchAll<Expense>((f, t) => supabase.from('expenses').select('*').or(`compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`).order('expense_date', { ascending: false }).order('id').range(f, t))
        : fetchAll<Expense>((f, t) => supabase.from('expenses').select('*').eq('building_id', entity.id).order('expense_date', { ascending: false }).order('id').range(f, t)),
      fetchAll<Adjustment>((f, t) => supabase.from('adjustments').select('*').in('building_id', blocks).order('effective_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
    ]);
    const unitList = (u as Unit[]) ?? [];
    setUnits(unitList);
    setGroups((g as Group[]) ?? []);
    setCharges(chargeRows);
    setPayments(paymentRows);
    setExpenses(expenseRows);
    setAdjustments(adjRows);
    // 0106: the fund row and its entries live at the entity level (compound
    // or standalone block), never per block inside a compound.
    {
      const scopeCol = entity.kind === 'compound' ? 'compound_id' : 'building_id';
      const [{ data: fr }, { data: fe }] = await Promise.all([
        supabase.from('funds').select('*').eq(scopeCol, entity.id).maybeSingle(),
        supabase.from('fund_entries').select('*').eq(scopeCol, entity.id).order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      setFund((fr as Fund | null) ?? null);
      setFundEntries((fe as FundEntry[]) ?? []);
      // 0109: projects an expense can be tagged to — the whole entity's, not
      // just the block's, since a compound project takes block expenses
      const pFilter = entity.kind === 'compound'
        ? `compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`
        : `building_id.eq.${entity.id}`;
      const { data: pr } = await supabase.from('projects').select('*').or(pFilter).order('created_at', { ascending: false });
      setProjects((pr as Project[]) ?? []);
    }
    const ids = unitList.map((x) => x.id);
    if (ids.length) {
      const [{ data: ug }, { data: mem }] = await Promise.all([
        supabase.from('unit_groups').select('group_id, unit_id').in('unit_id', ids),
        // include ENDED memberships too, so a unit that once had a tenant still shows the split
        supabase.from('memberships').select('unit_id, user_id, tenure, created_at, ended_at, profiles(full_name)').in('unit_id', ids),
      ]);
      setUnitGroups((ug as { group_id: string; unit_id: string }[]) ?? []);
      setTenancy((mem as unknown as TenancyRow[]) ?? []);
      // dues ride along so an exported statement lists the party's obligations
      // next to its ledger (0070)
      const [{ data: dus }, { data: prl }] = await Promise.all([
        supabase.from('dues').select('*').in('unit_id', ids),
        supabase.from('payment_request_lines').select('*').in('unit_id', ids).is('cancelled_at', null),
      ]);
      setDues((dus as Dues[]) ?? []);
      setOpenRequestLines((prl as PaymentRequestLine[]) ?? []);
    } else { setUnitGroups([]); setTenancy([]); setDues([]); setOpenRequestLines([]); }
    setLoading(false);
  }

  async function loadResident() {
    setLoading(true);
    const [{ data: u }, chargeRows, paymentRows, adjRows] = await Promise.all([
      supabase.from('units').select('*').in('id', myUnitIds),
      fetchAll<Charge>((f, t) => supabase.from('charges').select('*').in('unit_id', myUnitIds).order('charge_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
      fetchAll<Payment>((f, t) => supabase.from('payments').select('*').in('unit_id', myUnitIds).order('paid_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
      fetchAll<Adjustment>((f, t) => supabase.from('adjustments').select('*').in('unit_id', myUnitIds).order('effective_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t)),
    ]);
    setUnits((u as Unit[]) ?? []);
    setCharges(chargeRows);
    setPayments(paymentRows);
    setAdjustments(adjRows);
    const [{ data: mem }, { data: dus }] = await Promise.all([
      supabase.from('memberships').select('unit_id, user_id, tenure, created_at, ended_at, profiles(full_name)').in('unit_id', myUnitIds),
      supabase.from('dues').select('*').in('unit_id', myUnitIds),
    ]);
    setTenancy((mem as unknown as TenancyRow[]) ?? []);
    setDues((dus as Dues[]) ?? []);
    setLoading(false);
  }

  const unitById = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units]);

  // Two tenant signals (see owner-tenant-ledger memory):
  //  · active  → drives NEW-money form prompts (can only route to a current tenant)
  //  · ever    → drives the split display / sub-rows / reports (history stays split)
  // Derivations live in lib/reportData (shared with the Reports tab, #62).
  const th = useMemo(() => tenancyHelpers(tenancy, charges, payments, adjustments),
    [tenancy, charges, payments, adjustments]);
  const { activeTenantIds, nameById, activeTenantId } = th;
  const hasTenant = (uid: string) => activeTenantIds.has(uid);        // forms (active tenant)
  // display/split uses everTenantIds.has(unitId) directly (has or had a tenant)

  // Who was the tenant of this unit on a given date — so tenant-attributed rows
  // (charges/payments/adjustments) show the name, even after move-out.
  const tenantNameAt = (unitId: string, date: string): string | null => {
    const d = new Date(date);
    const periods = tenancy.filter((m) => m.unit_id === unitId && m.tenure === 'tenant');
    if (!periods.length) return null;
    const hit = periods.find((m) => new Date(m.created_at) <= d && (!m.ended_at || new Date(m.ended_at) >= d));
    return (hit ?? periods[periods.length - 1])?.profiles?.full_name ?? null;
  };
  // The tag label for a tenant-attributed row: prefer the row's explicit
  // tenant_id (0066), fall back to whoever occupied the unit on that date.
  const tenantLabelFor = (tenant_id: string | null | undefined, unitId: string, date: string): string =>
    nameById(tenant_id) ?? tenantNameAt(unitId, date) ?? t('finance.tenantTag');
  // every tenant a unit has had, oldest→newest, for per-tenant buckets/toggle
  const tenantsOf = (unitId: string) =>
    tenancy.filter((m) => m.unit_id === unitId && m.tenure === 'tenant')
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .map((m) => ({ id: m.user_id, name: m.profiles?.full_name ?? t('finance.tenant'), ended: !!m.ended_at }));

  // Owner / current-tenant / former-tenant buckets for a unit's PDF statement.
  // Logic lives in lib/reportData (shared with the Reports tab, #62).
  const buildUnitBuckets = (u: Unit, cAll: Charge[], pAll: Payment[], aAll: Adjustment[], only?: Set<string>) =>
    buildUnitBucketsShared(u, cAll, pAll, aAll, th,
      { owner: t('finance.owner'), tenant: t('finance.currentTenant'), formerTenant: t('finance.formerTenant') }, only,
      dues.filter((d) => d.unit_id === u.id));

  // Owner's resident finance defaults to the Combined view (residentView's
  // initial state); they can switch to Owner / a specific tenant via the toggle.
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
  // Last day of the selected period; null = all time. A filtered balance is the
  // running balance ON that date, not a sum of the window (0033's as-of model).
  const asOfDate = range?.to ?? null;
  const asOfLabel = asOfDate ? fmtDate(asOfDate, 'MMM d, yyyy') : '';
  const periodLabel = period === 'month' ? new Date(`${monthValue}-01`).toLocaleString(undefined, { month: 'long', year: 'numeric' }) : period === 'year' ? t('finance.thisYear') : t('finance.allTime');

  // voided charges/payments never count toward cash or the book
  const pCharges = vCharges.filter((c) => !c.voided_at && inRange(c.charge_date));
  const pPayments = vPayments.filter((p) => !p.voided_at && inRange(p.paid_on));
  const pExpenses = vExpenses.filter((e) => inRange(e.expense_date));
  // adjustments filtered by the top period filter too (voided kept, shown dimmed)
  const pAdjustments = adjustments.filter((a) => inRange(a.effective_date));

  const collectedP = round2(pPayments.reduce((s, p) => s + Number(p.amount_usd), 0));
  const billedP = round2(pCharges.reduce((s, c) => s + Number(c.amount_usd), 0));
  const netP = round2(collectedP - billedP);

  // 0106: the position as of the period end, from the rows already loaded.
  // Same pure function the tests pin; SQL fund_position() is its twin for the
  // dashboard, where rows are not fetched.
  const position = useMemo(() => fundPosition({
    units, charges, payments, adjustments, expenses, entries: fundEntries,
    opening: Number(fund?.opening_balance_usd ?? 0), openingDate: fund?.opening_date ?? null,
  }, asOfDate), [units, charges, payments, adjustments, expenses, fundEntries, fund, asOfDate]);
  // the guard list: expenses whose charges + fund part do not explain the amount
  const unreconciledExpenses = useMemo(() => {
    const billed = new Map<string, number>();
    charges.forEach((c) => { if (c.expense_id && !c.voided_at) billed.set(c.expense_id, (billed.get(c.expense_id) ?? 0) + Number(c.amount_usd)); });
    return expenses.filter((e) => Math.abs(Number(e.amount_usd) - (billed.get(e.id) ?? 0) - Number(e.funded_by_fund_usd ?? 0)) > 0.005);
  }, [charges, expenses]);
  const pFundEntries = fundEntries.filter((e) => inRange(e.entry_date));

  // per-unit book. Balance folds in the opening balance and, when an "as of"
  // date is set, only counts transactions up to that date. The row math lives
  // in lib/reportData (shared with the Reports tab, #62).
  const book = useMemo(() => buildBook(vUnits, vCharges, vPayments, adjustments, asOf || null, th),
    [vUnits, vCharges, vPayments, adjustments, asOf, th]);

  // T1: the Outstanding KPI follows the TOP period filter (as of the end of the
  // selected period), like Collected/Billed next to it — NOT the Book tab's
  // separate "as of" date picker. period 'all' → outstanding right now.
  const outstanding = useMemo(() => {
    const periodEnd = range ? range.to : null;
    return round2(vUnits.reduce((s, u) => {
      const bal = computeBalance(
        u,
        vCharges.filter((c) => c.unit_id === u.id),
        vPayments.filter((p) => p.unit_id === u.id),
        periodEnd,
        adjustments.filter((a) => a.unit_id === u.id),
      );
      return s + (bal < 0 ? -bal : 0);
    }, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vUnits, vCharges, vPayments, adjustments, period, monthValue]);

  // category breakdown (charges → block-sliceable)
  const breakdown = useMemo(() => {
    // a charge's type comes through its expense (charges only carry the legacy
    // category string); dues-less manual charges fall back to that string
    const typeOfExpense = new Map(expenses.map((e) => [e.id, e.expense_type_id ?? null]));
    const acc = new Map<string, number>();
    for (const c of pCharges) {
      const tid = c.expense_id ? typeOfExpense.get(c.expense_id) : null;
      const ty = tid ? allTypes.find((x) => x.id === tid) : undefined;
      const label = ty && !ty.key ? ty.name : t(`finance.cats.${ty?.key ?? c.category}`);
      acc.set(label, round2((acc.get(label) ?? 0) + Number(c.amount_usd)));
    }
    return [...acc.entries()].map(([label, value]) => ({ label, value })).filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pCharges, expenses, allTypes, t]);

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

  function openExpense() { setEditingExpenseId(null); setExpForm({ ...newExpForm(), scope: 'all', lbp_rate: effectiveLbpRate ? String(effectiveLbpRate) : '' }); setCustom({}); setExpFile(null); setExpOpen(true); }
  function openPayment() { setEditingPaymentId(null); setPayForm({ ...newPayForm(), lbp_rate: effectiveLbpRate ? String(effectiveLbpRate) : '' }); setPayFile(null); setPayOpen(true); }
  function openAdjustment() { setAdjForm({ unit_id: '', kind: 'discount', amount: '', effective_date: new Date().toISOString().slice(0, 10), note: '' }); setAdjOpen(true); }
  function openExpenseEdit(e: Expense) {
    if (e.meter_cycle_id) { toast.error(t('finance.meteredNoEdit')); return; }
    const myCharges = charges.filter((c) => c.expense_id === e.id);
    setEditingExpenseId(e.id); setDetailExpense(null); setExpFile(null);
    setExpForm({ category: e.category, expense_type_id: e.expense_type_id ?? '', description: e.description, extraordinary: false, amount: String(usdPartOf(e)), amount_lbp: e.amount_lbp ? String(e.amount_lbp) : '', lbp_rate: e.lbp_rate ? String(e.lbp_rate) : (effectiveLbpRate ? String(effectiveLbpRate) : ''), expense_date: e.expense_date, scope: 'units', method: e.method, block_id: '', group_id: '', unit_id: '', selectedUnits: myCharges.map((c) => c.unit_id), leasedTo: myCharges.some((c) => c.billed_to === 'tenant') ? 'tenant' : 'owner', funding: fundingOf(e), project_id: e.project_id ?? '' });
    setCustom(Object.fromEntries(myCharges.map((c) => [c.unit_id, String(c.amount_usd)])));
    setExpOpen(true);
  }
  function openPaymentEdit(p: Payment) {
    setEditingPaymentId(p.id); setPayFile(null);
    setPayForm({ unit_id: p.unit_id, amount: String(usdPartOf(p)), amount_lbp: p.amount_lbp ? String(p.amount_lbp) : '', lbp_rate: p.lbp_rate ? String(p.lbp_rate) : (effectiveLbpRate ? String(effectiveLbpRate) : ''), method: p.method, paid_on: p.paid_on, note: p.note ?? '', paid_by: p.paid_by ?? 'owner' });
    setPayOpen(true);
  }

  async function saveExpense() {
    const lbpPart = Number(expForm.amount_lbp) || 0;
    const rate = Number(expForm.lbp_rate) || 0;
    if (lbpPart > 0 && rate <= 0) { toast.error(t('finance.lbpNeedsRate')); return; }
    const amount = composeUsdTotal(Number(expForm.amount) || 0, lbpPart, rate);
    // 0106: a fund-paid expense targets nobody; the others need units and a
    // split that is fully explained (C1 — a short custom split is never saved
    // silently; the form makes the user name the remainder first).
    const fromFund = expForm.funding === 'fund';
    if (!entity || !amount || amount <= 0 || (!fromFund && targetUnits.length === 0)) return;
    const allocatedNow = fromFund ? 0 : round2(allocate(amount, targetUnits, expForm.method, custom).reduce((s, r) => s + r.amount, 0));
    if (!fromFund && allocatedNow - amount > 0.005) { toast.error(t('finance.fundOverAllocated')); return; }
    if (expForm.funding === 'residents' && amount - allocatedNow > 0.005) { toast.error(t('finance.fundRemainderUnnamed')); return; }
    const funded_by_fund_usd = fromFund ? amount : round2(Math.max(0, amount - allocatedNow));
    setSaving(true);
    const chosenType = activeTypes.find((x) => x.id === expForm.expense_type_id);
    const desc = expForm.description.trim()
      || (chosenType && !chosenType.key ? chosenType.name : CAT_LABEL[expForm.category]);
    const invoice_url = expFile ? await uploadFile('attachments', `${entity.id}/expenses`, expFile) : null;

    // expense-level tagging: compound entities carry compound_id; single-block keeps building_id
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (expForm.scope === 'block' ? expForm.block_id : null);
    const scope_type: AllocationScope = expForm.scope === 'all' ? (entity.kind === 'compound' ? 'compound' : 'block') : (expForm.scope as AllocationScope);

    let expenseId = editingExpenseId;
    if (editingExpenseId) {
      const patch: Record<string, unknown> = { category: expForm.category, expense_type_id: expForm.expense_type_id || null, description: desc, amount_usd: amount, amount_lbp: lbpPart > 0 ? lbpPart : null, lbp_rate: lbpPart > 0 ? rate : null, expense_date: expForm.expense_date, scope_type, method: expForm.method, funded_by_fund_usd, project_id: expForm.project_id || null };
      if (invoice_url) patch.invoice_url = invoice_url;
      await supabase.from('expenses').update(patch).eq('id', editingExpenseId);
      await supabase.from('charges').delete().eq('expense_id', editingExpenseId);
    } else {
      const { data: exp, error } = await supabase.from('expenses').insert({
        building_id, compound_id, category: expForm.category, description: desc, amount_usd: amount,
        expense_date: expForm.expense_date, scope_type, method: expForm.method, invoice_url, created_by: profile?.id,
        expense_type_id: expForm.expense_type_id || null,
        amount_lbp: lbpPart > 0 ? lbpPart : null, lbp_rate: lbpPart > 0 ? rate : null,
        is_extraordinary: !editingExpenseId && !fromFund && expForm.extraordinary,
        funded_by_fund_usd,
        project_id: expForm.project_id || null,
      }).select().single();
      if (error || !exp) { setSaving(false); toast.error(error?.message ?? 'Could not save expense'); return; }
      expenseId = (exp as Expense).id;
    }

    // each charge carries the UNIT's own block_id → compound book slices by block
    const rows = (fromFund ? [] : allocate(amount, targetUnits, expForm.method, custom)).filter((r) => r.amount !== 0).map((r) => {
      // owner-only units → owner; leased units → the chosen party (T5).
      // Tenant charges are stamped with the current tenant's id (0066).
      const billedTo = hasTenant(r.unit_id) ? expForm.leasedTo : 'owner';
      return {
        expense_id: expenseId, unit_id: r.unit_id, building_id: unitById[r.unit_id]?.building_id,
        category: expForm.category, description: desc, amount_usd: r.amount, charge_date: expForm.expense_date,
        billed_to: billedTo, tenant_id: billedTo === 'tenant' ? activeTenantId(r.unit_id) : null, created_by: profile?.id,
      };
    });
    if (rows.length) await supabase.from('charges').insert(rows);

    // Extraordinary (0089): collect it NOW instead of at the next cycle. The
    // ask is mode-branched — a ledger request in a prepay building finds
    // nobody (0081), so dues mode issues a FLAT one-line budget instead. The
    // netting rule keeps the two books straight: the outstanding due absorbs
    // the ledger arrears this charge just created, and one payment settles both.
    if (!editingExpenseId && expForm.extraordinary && expenseId && rows.length) {
      if (entity.billingMode === 'dues') {
        const label = `${t('finance.extraordinaryTag')}: ${desc}`;
        const { data: bud, error: bErr } = await supabase.from('budgets').insert({
          building_id: entity.kind === 'building' ? entity.id : null,
          compound_id: entity.kind === 'compound' ? entity.id : null,
          label, period_start: expForm.expense_date, period_end: expForm.expense_date,
          expense_id: expenseId,
          due_date: new Date(Date.now() + effectiveDueDays * 864e5).toISOString().slice(0, 10), method: 'custom',
          billed_to: expForm.leasedTo === 'tenant' ? 'tenant_where_leased' : 'owner',
          true_up: false, created_by: profile?.id,
        }).select().single();
        if (bErr || !bud) { toast.error(bErr?.message ?? 'Could not issue the extraordinary ask'); }
        else {
          const budgetId = (bud as { id: string }).id;
          await supabase.from('budget_lines').insert({
            budget_id: budgetId, expense_type_id: expForm.expense_type_id || null,
            note: desc, amount_usd: amount,
            amount_lbp: lbpPart > 0 ? lbpPart : null, lbp_rate: lbpPart > 0 ? rate : null,
          });
          const { error: dErr } = await supabase.from('dues').insert(rows.map((r) => ({
            budget_id: budgetId, building_id: r.building_id, unit_id: r.unit_id,
            period_label: label,
            // a due date is what makes the reminder cron chase it
            due_date: new Date(Date.now() + effectiveDueDays * 864e5).toISOString().slice(0, 10),
            base_amount: r.amount_usd, carry_in: 0, amount_due: r.amount_usd,
            billed_to: r.billed_to === 'tenant' ? 'tenant' : 'owner',
            tenant_id: r.billed_to === 'tenant' ? r.tenant_id : null,
            kind: 'off_budget', label, created_by: profile?.id,
          })));
          if (dErr) toast.error(dErr.message);
          else toast.success(t('finance.extraordinaryIssuedDues'));
        }
      } else {
        const { error: rErr } = await supabase.rpc('request_payment_for_expense', { p_expense: expenseId });
        if (rErr) toast.error(rErr.message);
        else toast.success(t('finance.extraordinaryIssued'));
      }
    }

    toast.success(t('finance.expenseSaved'));
    setSaving(false); setExpOpen(false); loadScope();
  }

  async function deleteExpense(id: string) {
    const e = expenses.find((x) => x.id === id);
    const msg = e?.is_extraordinary
      ? t('finance.deleteExtraordinaryConfirm')
      : e?.meter_cycle_id
        ? t('finance.deleteMeteredConfirm')
        : 'Delete this expense and the charges it created?';
    if (!confirm(msg)) return;
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
    if (isManager) loadScope(); else loadResident();
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
    const lbpPart = Number(payForm.amount_lbp) || 0;
    const rate = Number(payForm.lbp_rate) || 0;
    if (lbpPart > 0 && rate <= 0) { toast.error(t('finance.lbpNeedsRate')); return; }
    const amount = composeUsdTotal(Number(payForm.amount) || 0, lbpPart, rate);
    if (!payForm.unit_id || !amount || amount <= 0) return;
    setSaving(true);
    const receipt_url = payFile ? await uploadFile('attachments', `${payForm.unit_id}/payments`, payFile) : null;
    // T8: leased units record who paid; owner-only units are always the owner
    const paid_by = hasTenant(payForm.unit_id) ? payForm.paid_by : 'owner';
    const base: Record<string, unknown> = { unit_id: payForm.unit_id, amount_usd: amount, amount_lbp: lbpPart > 0 ? lbpPart : null, lbp_rate: lbpPart > 0 ? rate : null, method: payForm.method, paid_on: payForm.paid_on, note: payForm.note.trim() || null, paid_by, tenant_id: paid_by === 'tenant' ? activeTenantId(payForm.unit_id) : null };
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

  async function exportUnitStatement(unit: Unit, unitCharges: Charge[], unitPayments: Payment[], unitAdjustments: Adjustment[] = [], only?: Set<string>) {
    try {
      const { UnitStatementDoc, downloadPdf } = await import('@/lib/pdf');
      const { buckets, combined } = buildUnitBuckets(unit, unitCharges, unitPayments, unitAdjustments, only);
      const el = (
        <UnitStatementDoc
          unitLabel={unit.label}
          buildingName={entity?.name ?? ''}
          period={periodLabel}
          generatedOn={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          buckets={buckets}
          combinedBalance={combined}
        />
      );
      await downloadPdf(el, `statement-unit-${unit.label.replace(/\s+/g, '-')}.pdf`);
    } catch (e) {
      toast.error(t('finance.exportFailed', { defaultValue: 'Could not generate the statement. Please refresh and try again.' }));
      console.error('statement export failed:', e);
    }
  }

  // (the building report export moved to the Reports tab — #62)

  // ================= RESIDENT VIEW =================
  if (!isManager) {
    if (!myUnitIds.length) return <EmptyState title={t('finance.noStatement')} body={t('finance.noStatementBody')} />;

    // Per-unit rows for a chosen "view": 'combined' | 'owner' | a tenant's id.
    // A specific tenant is a BUCKET — only that tenant's rows, netting to their
    // own balance (past tenants net to 0 via the move-out offload).
    const round2n = (n: number) => Math.round(n * 100) / 100;
    // The period filters the STATEMENT and the charged/paid totals. The balance
    // is deliberately computed from the UNFILTERED rows: "you owe" has to mean
    // what you owe right now, not what you happened to owe inside a window.
    // Is this the unit's CURRENT tenant (active membership), or someone before?
    const isCurTenant = (unitId: string, tid?: string | null) => !!tid && tenancy.some(
      (m) => m.unit_id === unitId && m.user_id === tid && m.tenure === 'tenant' && !m.ended_at);

    // A view is 'combined' | 'owner' | `cur:<buildingId>` | `fmr:<buildingId>`.
    // Tenant buckets are scoped to a BUILDING so a resident with units in two
    // buildings never sees one building's tenant mixed into the other's.
    const viewBuilding = (view: string) => view.includes(':') ? view.split(':')[1] : null;

    const rowsForView = (u: Unit, view: string) => {
      // live = every non-voided row (drives the BALANCE)
      const cLive = charges.filter((c) => c.unit_id === u.id && !c.voided_at);
      const pLive = payments.filter((p) => p.unit_id === u.id && !p.voided_at);
      const aLive = adjustments.filter((a) => a.unit_id === u.id && !a.voided_at);
      // shown = the slice inside the selected period (drives the STATEMENT)
      const cAll = cLive.filter((c) => inRange(c.charge_date));
      const pAll = pLive.filter((p) => inRange(p.paid_on));
      const aAll = aLive.filter((a) => inRange(a.effective_date));
      // Balance AS OF the end of the selected period — a running balance on that
      // date, not a sum of the window. With no period it is today's balance.
      const bal = computeUnitBalances(u, cLive, pLive, aLive, asOfDate);
      const upTo = (d: string) => !asOfDate || new Date(d) <= asOfDate;
      const bucketBal = (want: (tid?: string | null) => boolean) => round2n(
        pLive.filter((x) => x.paid_by === 'tenant' && want(x.tenant_id) && upTo(x.paid_on)).reduce((s, x) => s + Number(x.amount_usd), 0)
        - cLive.filter((x) => x.billed_to === 'tenant' && want(x.tenant_id) && upTo(x.charge_date)).reduce((s, x) => s + Number(x.amount_usd), 0)
        + aLive.filter((x) => x.party === 'tenant' && want(x.tenant_id) && upTo(x.effective_date)).reduce((s, x) => s + adjustmentEffect(x.kind, Number(x.amount_usd)), 0));

      if (view === 'combined') return { c: cAll, p: pAll, a: aAll, balance: bal.total };
      if (view === 'owner') return {
        c: cAll.filter((c) => c.billed_to !== 'tenant'), p: pAll.filter((p) => p.paid_by !== 'tenant'),
        a: aAll.filter((a) => a.party !== 'tenant'), balance: bal.owner };

      // tenant bucket — empty for units outside the bucket's building
      // 'self:<id>' — a tenant viewing their own account: strictly their rows.
      if (view.startsWith('self:')) {
        const me = view.slice(5);
        const mine = (tid?: string | null) => tid === me;
        return {
          c: cAll.filter((x) => x.billed_to === 'tenant' && mine(x.tenant_id)),
          p: pAll.filter((x) => x.paid_by === 'tenant' && mine(x.tenant_id)),
          a: aAll.filter((x) => x.party === 'tenant' && mine(x.tenant_id)),
          balance: bucketBal(mine),
        };
      }
      const wantCur = view.startsWith('cur:');
      if (viewBuilding(view) !== u.building_id) return { c: [], p: [], a: [], balance: 0 };
      const want = (tid?: string | null) => isCurTenant(u.id, tid) === wantCur;
      return {
        c: cAll.filter((x) => x.billed_to === 'tenant' && want(x.tenant_id)),
        p: pAll.filter((x) => x.paid_by === 'tenant' && want(x.tenant_id)),
        a: aAll.filter((x) => x.party === 'tenant' && want(x.tenant_id)),
        balance: bucketBal(want),
      };
    };

    // Toggle options: Combined, Owner, then per building a current- and a
    // former-tenant bucket. The building name is only shown when the resident
    // actually spans several buildings — with one, it is noise.
    const ownedUnits = units.filter((u) => myOwnerUnitIds.includes(u.id));
    const ownedBuildingIds = [...new Set(ownedUnits.map((u) => u.building_id))];
    const multiBuilding = ownedBuildingIds.length > 1;
    const bucketLabel = (bid: string, current: boolean, names: string[]) => {
      const base = tenantTitle(
        current ? t('finance.currentTenant') : (names.length > 1 ? t('finance.formerTenants') : t('finance.formerTenant')),
        names.join(', ') || null);
      return multiBuilding ? `${nameByBuilding[bid] ?? ''} · ${base}` : base;
    };
    const tenantBuckets = ownedBuildingIds.flatMap((bid) => {
      const bUnits = ownedUnits.filter((u) => u.building_id === bid);
      const namesFor = (current: boolean) => Array.from(new Set(
        bUnits.flatMap((u) => tenantsOf(u.id).filter((x) => x.ended !== current).map((x) => x.name))));
      const curNames = namesFor(true);
      const fmrNames = namesFor(false);
      // a former bucket also exists when money is tagged to a departed tenant
      const hasFmr = fmrNames.length > 0 || bUnits.some((u) =>
        charges.some((c) => c.unit_id === u.id && c.billed_to === 'tenant' && !isCurTenant(u.id, c.tenant_id)));
      return [
        ...(curNames.length ? [{ key: `cur:${bid}`, label: bucketLabel(bid, true, curNames) }] : []),
        ...(hasFmr ? [{ key: `fmr:${bid}`, label: bucketLabel(bid, false, fmrNames) }] : []),
      ];
    });
    const viewerIsTenantOnly = units.every((u) => myTenantUnitIds.includes(u.id) && !myOwnerUnitIds.includes(u.id));

    // A bucket the resident selected may not exist any more (they switched the
    // building scope). Fall back to Combined rather than showing empty cards.
    const effView = residentView !== 'combined' && residentView !== 'owner'
      && !tenantBuckets.some((b) => b.key === residentView) ? 'combined' : residentView;

    const rBook = units.map((u) => {
      const viewerIsTenant = myTenantUnitIds.includes(u.id) && !myOwnerUnitIds.includes(u.id);
      // A tenant viewer is pinned to their OWN rows — never the unit's other
      // current tenants, and never the owner's.
      const view = viewerIsTenant ? `self:${profile?.id ?? ''}` : effView;
      const r = rowsForView(u, view);
      return {
        unit: u, view, viewerIsTenant, balance: r.balance,
        charged: r.c.reduce((s, c) => s + Number(c.amount_usd), 0),
        paid: r.p.reduce((s, p) => s + Number(p.amount_usd), 0),
        unitCharges: r.c, unitPayments: r.p, unitAdjustments: r.a,
        // this unit's own tenants, so a multi-unit resident can tell the cards apart
        curTenantNames: tenantsOf(u.id).filter((x) => !x.ended).map((x) => x.name),
      };
    });
    const showToggle = !viewerIsTenantOnly && tenantBuckets.length > 0;
    return (
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('finance.myAccount')}</h1>
          <div className="flex items-center gap-2 flex-wrap">
          {/* Residents get the same period control as managers. It scopes the
              statement rows AND the balance, which becomes the running balance
              as of the last day of the period. */}
          <RadixSelect value={period} onValueChange={(v) => setPeriod(v as 'month' | 'year' | 'all')}>
            <SelectTrigger className="min-w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('finance.allTime')}</SelectItem>
              <SelectItem value="year">{t('finance.thisYear')}</SelectItem>
              <SelectItem value="month">{t('finance.month')}</SelectItem>
            </SelectContent>
          </RadixSelect>
          {period === 'month' && <MonthPicker value={monthValue} onChange={setMonthValue} />}
          {rBook.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => {
              const r = rBook[0];
              // Combined → all buckets. Otherwise translate the selected view
              // into the bucket keys buildUnitBuckets understands: 'owner', or
              // the tenant ids behind a current/former bucket for THIS unit.
              const tidsFor = (wantCur: boolean) => Array.from(new Set(
                [...charges.filter((c) => c.unit_id === r.unit.id && c.billed_to === 'tenant').map((c) => c.tenant_id),
                 ...payments.filter((p) => p.unit_id === r.unit.id && p.paid_by === 'tenant').map((p) => p.tenant_id),
                 ...tenancy.filter((m) => m.unit_id === r.unit.id && m.tenure === 'tenant').map((m) => m.user_id)]
                  .filter((id): id is string => !!id)
                  .filter((id) => isCurTenant(r.unit.id, id) === wantCur)));
              const only = r.view === 'combined' ? undefined
                : r.view === 'owner' ? new Set(['owner'])
                : r.view.startsWith('self:') ? new Set([profile?.id ?? ''])
                : new Set(tidsFor(r.view.startsWith('cur:')));
              exportUnitStatement(
                r.unit,
                charges.filter((c) => c.unit_id === r.unit.id && !c.voided_at),
                payments.filter((p) => p.unit_id === r.unit.id && !p.voided_at),
                adjustments.filter((a) => a.unit_id === r.unit.id && !a.voided_at),
                only);
            }}>
              <Download size={15} /> {t('finance.exportStatement')}
            </Button>
          )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-1">{t('finance.myAccountSub')}</p>
        {period !== 'all' && (
          <p className="text-xs text-muted-foreground mb-4">{t('finance.periodHint')}</p>
        )}

        {/* Owner picks Combined / Owner / a building's current or former tenants.
            Tenant buckets are per BUILDING so two buildings never comingle. */}
        {showToggle && (
          <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5 mb-5 text-sm gap-0.5">
            <button onClick={() => setResidentView('combined')} className={`px-3 py-1.5 rounded-md transition ${effView === 'combined' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{t('finance.view.combined')}</button>
            <button onClick={() => setResidentView('owner')} className={`px-3 py-1.5 rounded-md transition ${effView === 'owner' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{t('finance.view.owner')}</button>
            {tenantBuckets.map((tn) => (
              <button key={tn.key} onClick={() => setResidentView(tn.key)} className={`px-3 py-1.5 rounded-md transition ${effView === tn.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {tn.label}
              </button>
            ))}
          </div>
        )}

        {rBook.map((r) => (
          <Card key={r.unit.id} className="mb-4"><CardBody>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t('finance.unit')} {r.unit.label}
                  {/* name the unit's own tenant when the account spans several */}
                  {rBook.length > 1 && r.curTenantNames.length > 0 && (
                    <span className="text-muted-foreground/70"> · {tenantTitle(t('finance.currentTenant'), r.curTenantNames.join(', '))}</span>
                  )}
                </p>
                <p className={`text-3xl font-bold tnum ${r.balance < 0 ? 'text-red-400 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(r.balance)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {r.balance < 0 ? t('finance.youOwe') : t('finance.creditBalance')}
                  {asOfLabel && <> · {t('finance.asOf', { date: asOfLabel })}</>}
                </p>
                {r.balance < 0 && whishByBuilding[r.unit.building_id] && (
                  <p className="text-xs font-medium text-primary mt-1.5">
                    {t('finance.payViaWhish', { number: whishByBuilding[r.unit.building_id] })}
                  </p>
                )}
              </div>
              <div className="text-end text-sm space-y-0.5">
                <p className="text-muted-foreground">{t('finance.charged')} <span className="font-medium text-foreground tnum">{money(r.charged)}</span></p>
                <p className="text-muted-foreground">{t('finance.paid')} <span className="font-medium text-foreground tnum">{money(r.paid)}</span></p>
              </div>
            </div>
          </CardBody></Card>
        ))}
        <ResidentDuesCard
          unitIds={myUnitIds}
          viewFor={(unitId) => {
            const viewerIsTenant = myTenantUnitIds.includes(unitId) && !myOwnerUnitIds.includes(unitId);
            return viewerIsTenant ? `self:${profile?.id ?? ''}` : effView;
          }}
          buildingOf={(unitId) => units.find((u) => u.id === unitId)?.building_id ?? ''}
          isCurrentTenantOf={isCurTenant}
          nameById={(id) => tenancy.find((m) => m.user_id === id)?.profiles?.full_name ?? null}
          isCurrentTenant={(unitId, tenantId) => !!tenantId && tenancy.some(
            (m) => m.unit_id === unitId && m.user_id === tenantId && m.tenure === 'tenant' && !m.ended_at)}
          // dues are dated obligations — a period hides the ones outside it
          inPeriod={(d) => d.due_date ? inRange(d.due_date) : period === 'all'}
        />
        <ResidentRequestsCard
          unitIds={myUnitIds}
          viewFor={(unitId) => {
            const viewerIsTenant = myTenantUnitIds.includes(unitId) && !myOwnerUnitIds.includes(unitId);
            return viewerIsTenant ? `self:${profile?.id ?? ''}` : effView;
          }}
          buildingOf={(unitId) => units.find((u) => u.id === unitId)?.building_id ?? ''}
          unitLabel={Object.fromEntries(units.map((u) => [u.id, u.label]))}
          payments={payments}
        />
        <StatementList
          charges={rBook.flatMap(r => r.unitCharges)}
          payments={rBook.flatMap(r => r.unitPayments)}
          adjustments={rBook.flatMap(r => r.unitAdjustments)}
          // The opening balance is a dated line like any other: it belongs in
          // the statement only when its date falls inside the period. An
          // undated opening predates everything, so it shows on All time only.
          openings={(effView === 'owner' || effView === 'combined')
            ? units.filter((u) => myOwnerUnitIds.includes(u.id))
                .filter((u) => u.opening_balance_date ? inRange(u.opening_balance_date) : period === 'all')
                .map((u) => ({ unit_id: u.id, amount: Number(u.opening_balance), date: u.opening_balance_date }))
            : []}
          tenantName={tenantLabelFor}
          unitLabel={Object.fromEntries(units.map((u) => [u.id, u.label]))}
        />
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
          {/* Entity selection moved to the sidebar (global). Block drill-down stays local. */}
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

      {!entity ? <Empty body={entities.length ? t('common.pickEntity') : t('finance.noBuildings')} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <Kpi label={t('finance.collected')} value={money(collectedP)} icon={TrendingUp} tone="emerald" hint={periodLabel} desc={t('finance.collectedDesc')} />
            <Kpi label={t('finance.billed')} value={money(billedP)} icon={Receipt} tone="slate" hint={periodLabel} desc={t('finance.billedDesc')} />
            <Kpi label={t('finance.net')} value={money(netP)} icon={Wallet} tone={netP >= 0 ? 'indigo' : 'rose'} hint={periodLabel} desc={t('finance.netDesc')} />
            <Kpi label={t('finance.outstanding')} value={money(outstanding)} icon={AlertCircle} tone={outstanding > 0 ? 'amber' : 'slate'} hint={period === 'all' ? t('finance.owedNow') : periodLabel} desc={t('finance.outstandingDesc')} />
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

          {/* Balance as-of sits ABOVE the tab strip: it scopes the Book the tabs
              switch between, so it reads as a scope control, not a table option. */}
          {tab === 'book' && (
            <div className="flex items-center justify-end gap-2 mb-3">
              <label className="text-xs text-muted-foreground">{t('finance.balanceAsOf')}</label>
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="rounded-lg border border-border bg-background text-foreground px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              {asOf && (
                <button onClick={() => setAsOf('')} className="text-xs text-primary hover:underline cursor-pointer">
                  {t('finance.backToLive')}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <SegmentedTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: 'book', label: t('finance.book'), icon: BookOpen },
                { key: 'expenses', label: t('finance.expenses'), icon: Receipt },
                { key: 'payments', label: t('finance.payments'), icon: HandCoins },
                { key: 'adjustments', label: t('finance.adjustments'), icon: Scale },
                { key: 'metering', label: t('metering.tab'), icon: Gauge },
                { key: 'fund', label: t('fund.tab'), icon: Landmark },
              ]}
            />
            {/* Contextual toolbar: each tab shows ITS action. Record Payment
                (the calm primary) also lives on Book — that's where you see a
                balance and take the money; never hide it behind a tab switch. */}
            <div className="flex gap-2">
              {canManageFinance && (
                <>
                  {tab === 'adjustments' && (
                    <Button variant="secondary" onClick={openAdjustment} disabled={units.length === 0}><Scale size={16} /> {t('finance.recordAdjustment')}</Button>
                  )}
                  {tab === 'fund' && (
                    <>
                      <Button variant="secondary" onClick={() => openFundEntry('outflow')}><ArrowUpFromLine size={16} /> {t('fund.recordOutflow')}</Button>
                      <Button variant="tinted" onClick={() => openFundEntry('income')}><ArrowDownToLine size={16} /> {t('fund.recordIncome')}</Button>
                    </>
                  )}
                  {(tab === 'expenses' || tab === 'book') && (
                    <Button variant="secondary" onClick={openExpense} disabled={units.length === 0}><Plus size={16} /> {t('finance.recordExpense')}</Button>
                  )}
                  {/* ARREARS only (0081). A prepay building sits in credit, so a
                      ledger-based request finds nobody — and where it does find
                      arrears, the outstanding dues are already collecting them.
                      A dues one-off is Generate dues with the true-up off. */}
                  {tab === 'book' && entity && entity.billingMode !== 'dues' && (
                    <Button variant="secondary" onClick={() => setReqOpen(true)} disabled={units.length === 0}>
                      <Send size={16} /> {t('finance.requestPayment')}
                    </Button>
                  )}
                  {(tab === 'book' || tab === 'payments') && (
                    <Button variant="tinted" onClick={openPayment} disabled={units.length === 0}>
                      <HandCoins size={16} /> {t('finance.recordPayment')}
                    </Button>
                  )}
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
              {/* ── Fund (0106): the drawer, apart from what residents owe ── */}
              {tab === 'fund' && entity && (
                <div className="space-y-4">
                  <Card><CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('fund.cashOnHand')}{asOfLabel ? ` · ${t('finance.asOf', { date: asOfLabel })}` : ''}
                        </p>
                        <p className={`text-4xl font-bold tracking-tight mt-1 tnum ${position.cash < 0 ? 'text-red-500' : 'text-foreground'}`}>{money(position.cash)}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t('fund.cashHint')}</p>
                      </div>
                      {canManageFinance && (
                        <Button variant="secondary" size="sm" onClick={openOpening}>
                          <Pencil size={14} /> {fund ? t('fund.editOpening') : t('fund.setOpening')}
                        </Button>
                      )}
                    </div>
                    {/* the breakdown, one line each, signs shown as they read */}
                    <div className="mt-5 rounded-xl border border-border divide-y divide-border text-sm">
                      {[
                        { k: 'fund.lineCredits', v: -position.credits, hint: entity.billingMode === 'dues' ? t('fund.creditsHintDues') : t('fund.creditsHintArrears') },
                        { k: 'fund.lineAvailable', v: position.available, strong: true },
                        { k: 'fund.lineArrears', v: position.arrears },
                        { k: 'fund.lineReserve', v: position.reserve, strong: true },
                      ].map((r) => (
                        <div key={r.k} className={`flex items-center justify-between gap-3 px-3 py-2 ${r.strong ? 'bg-secondary/60' : ''}`}>
                          <div>
                            <p className={`${r.strong ? 'font-semibold text-foreground' : 'text-foreground'}`}>{t(r.k)}</p>
                            {r.hint && <p className="text-xs text-muted-foreground">{r.hint}</p>}
                          </div>
                          <span className={`tnum ${r.strong ? 'font-semibold' : ''} ${r.v < 0 ? 'text-red-500' : 'text-foreground'}`}>{money(r.v)}</span>
                        </div>
                      ))}
                    </div>
                    {/* how the cash got there */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 text-xs">
                      {[
                        ['fund.flowOpening', position.opening], ['fund.flowPayments', position.payments_in], ['fund.flowOtherIn', position.other_in],
                        ['fund.flowExpenses', -position.expenses_out], ['fund.flowOtherOut', -position.other_out], ['fund.flowRefunds', -position.refunds_out],
                      ].map(([k, v]) => (
                        <div key={k as string} className="rounded-lg bg-secondary px-3 py-2 flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">{t(k as string)}</span>
                          <span className={`tnum font-medium ${(v as number) < 0 ? 'text-red-500' : 'text-foreground'}`}>{money(v as number)}</span>
                        </div>
                      ))}
                    </div>
                    {position.fund_paid > 0 && (
                      <p className="text-xs text-muted-foreground mt-3">{t('fund.fundPaidNote', { amount: money(position.fund_paid) })}</p>
                    )}
                  </CardBody></Card>

                  {/* the guard: expenses nobody explained. Empty after the 0106 backfill. */}
                  {unreconciledExpenses.length > 0 && (
                    <Card className="border-amber-300 dark:border-amber-800"><CardBody>
                      <p className="text-sm font-semibold text-foreground">{t('fund.unreconciledTitle', { count: unreconciledExpenses.length })}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('fund.unreconciledHint')}</p>
                      <div className="divide-y divide-border rounded-xl border border-border">
                        {unreconciledExpenses.slice(0, 20).map((e) => (
                          <button key={e.id} type="button" onClick={() => openExpenseEdit(e)} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-start hover:bg-accent">
                            <span className="text-foreground">{fmtDate(e.expense_date, 'MMM d, yyyy')} · {e.description}</span>
                            <span className="tnum text-muted-foreground">{money(Number(e.amount_usd))}</span>
                          </button>
                        ))}
                      </div>
                    </CardBody></Card>
                  )}

                  {/* entries: money that is not a unit payment or an expense */}
                  {pFundEntries.length === 0 ? <Empty body={t('fund.noEntries')} /> : (
                    <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                      <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                        <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                        <th className="px-5 py-3 text-start font-medium">{t('finance.description')}</th>
                        <th className="px-5 py-3 text-start font-medium">{t('fund.counterparty')}</th>
                        <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                        {canManageFinance && <th className="px-5 py-3" />}
                      </tr></thead>
                      <tbody className="divide-y divide-slate-50">
                        {pFundEntries.map((e) => (
                          <tr key={e.id} className={e.voided_at ? 'opacity-50' : ''}>
                            <td className="px-5 py-3 text-foreground dark:text-white whitespace-nowrap">{fmtDate(e.entry_date, 'MMM d, yyyy')}</td>
                            <td className="px-5 py-3 font-medium text-foreground dark:text-white">
                              <span className="inline-flex items-center gap-1.5">
                                {e.description}
                                {e.attachment_url && <AttachmentLink url={e.attachment_url} label="" icon={Paperclip} className="text-muted-foreground" />}
                                {e.voided_at && <Badge variant="slate">{t('finance.voided')}</Badge>}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-muted-foreground">{e.counterparty ?? '—'}</td>
                            <td className={`px-5 py-3 text-end font-semibold tnum ${e.kind === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
                              {currencyTag(e) && <span className="me-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{currencyTag(e)}</span>}
                              {e.kind === 'income' ? '+' : '−'}{money(Number(e.amount_usd))}
                            </td>
                            {canManageFinance && (
                              <td className="px-5 py-3 text-end">
                                {!e.voided_at && <button type="button" onClick={() => voidFundEntry(e.id)} className="text-xs text-muted-foreground hover:text-red-500 inline-flex items-center gap-1"><Ban size={12} /> {t('finance.void')}</button>}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table></div></Card>
                  )}
                </div>
              )}

              {tab === 'metering' && entity && (
                <MeteringPanel
                  entity={{ kind: entity.kind, id: entity.id, name: entity.name }}
                  rateBuildingId={entity.buildingIds[0]}
                  units={units}
                  canManage={canManageFinance}
                  hasTenant={hasTenant}
                  activeTenantId={activeTenantId}
                  profileId={profile?.id}
                  onPosted={loadScope}
                />
              )}
              {tab === 'book' && (
                <>
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                    <th className="px-5 py-3 text-start font-medium w-40">{t('finance.collectedCol')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.billed')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.paid')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.adjustmentsCol')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.balance')}</th>
                    <th className="px-3 py-3 w-8" />
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {book.map((r) => {
                      const pct = r.charged > 0 ? (r.paid / r.charged) * 100 : (r.paid > 0 ? 100 : 0);
                      const balCls = (n: number) => n < 0 ? 'text-red-400 dark:text-red-300' : n > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground dark:text-white';
                      return (
                        <Fragment key={r.unit.id}>
                        <tr className="hover:bg-slate-50/60">
                          <td className="px-5 py-3 font-semibold text-foreground dark:text-white">{unitDisplay(r.unit.id)}</td>
                          <td className="px-5 py-3"><div className="flex items-center gap-2"><MiniBar pct={pct} color={pct >= 100 ? '#10b981' : pct > 0 ? '#f59e0b' : '#e2e8f0'} /><span className="text-xs text-foreground dark:text-white tnum w-9 text-end">{Math.round(pct)}%</span></div></td>
                          <td className="px-5 py-3 text-end text-foreground dark:text-white tnum">{money(r.charged)}</td>
                          <td className="px-5 py-3 text-end text-foreground dark:text-white tnum">{money(r.paid)}</td>
                          <td className={`px-5 py-3 text-end tnum ${r.adj === 0 ? 'text-muted-foreground' : balCls(r.adj)}`}>{r.adj === 0 ? '—' : money(r.adj)}</td>
                          <td className={`px-5 py-3 text-end font-semibold tnum ${balCls(r.balance)}`}>{money(r.balance)}</td>
                          <td className="px-3 py-3">
                            <button title={t('finance.exportStatement')} onClick={() => exportUnitStatement(r.unit, vCharges.filter(c => c.unit_id === r.unit.id && !c.voided_at), vPayments.filter(p => p.unit_id === r.unit.id && !p.voided_at), adjustments.filter(a => a.unit_id === r.unit.id && !a.voided_at))} className="text-primary hover:text-primary/70 transition cursor-pointer">
                              <Download size={14} />
                            </button>
                          </td>
                        </tr>
                        {/* T9: owner/tenant sub-rows — mirror the main columns
                            (collected % · billed · paid · balance), shaded + indented */}
                        {r.split && (() => {
                          const sub = (label: React.ReactNode, ch: number, pd: number, ad: number, bal: number, last: boolean) => {
                            const p = ch > 0 ? (pd / ch) * 100 : (pd > 0 ? 100 : 0);
                            return (
                              <tr className={`text-xs bg-primary/[0.04] ${last ? 'border-b-2 border-border/70' : ''}`}>
                                <td className="ps-5 pe-5 py-1.5 text-muted-foreground"><span className="inline-block border-s-2 border-primary/30 ps-4">{label}</span></td>
                                <td className="px-5 py-1.5"><div className="flex items-center gap-2"><MiniBar pct={p} color={p >= 100 ? '#10b981' : p > 0 ? '#f59e0b' : '#e2e8f0'} /><span className="text-[11px] text-muted-foreground tnum w-9 text-end">{Math.round(p)}%</span></div></td>
                                <td className="px-5 py-1.5 text-end text-muted-foreground tnum">{money(ch)}</td>
                                <td className="px-5 py-1.5 text-end text-muted-foreground tnum">{money(pd)}</td>
                                <td className={`px-5 py-1.5 text-end tnum ${ad === 0 ? 'text-muted-foreground' : balCls(ad)}`}>{ad === 0 ? '—' : money(ad)}</td>
                                <td className={`px-5 py-1.5 text-end tnum ${balCls(bal)}`}>{money(bal)}</td>
                                <td />
                              </tr>
                            );
                          };
                          return (<>
                            {sub(t('finance.owner'), r.ownerCharged, r.ownerPaid, r.ownerAdj, r.owner, !r.hasActiveTenant && !r.showFormer)}
                            {r.hasActiveTenant && sub(
                              <>{t('finance.currentTenant')}: <TenantTag label={r.activeTenantName ?? t('finance.tenantTag')} /></>,
                              r.curTenantCharged, r.curTenantPaid, r.curTenantAdj, r.curTenant, !r.showFormer)}
                            {r.showFormer && sub(
                              <>{r.fmrTenantNames.length > 1 ? t('finance.formerTenants') : t('finance.formerTenant')}
                                {r.fmrTenantNames.length > 0 && <span className="text-muted-foreground/70">: {r.fmrTenantNames.join(', ')}</span>}</>,
                              r.fmrTenantCharged, r.fmrTenantPaid, r.fmrTenantAdj, r.fmrTenant, true)}
                          </>);
                        })()}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table></div></Card>
                </>
              )}

              {tab === 'expenses' && (pExpenses.length === 0 ? <Empty body={t('finance.noExpenses', { period: periodLabel })} /> : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.description')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.category')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.split')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {pExpenses.map((e) => (
                      <tr key={e.id} onClick={() => setDetailExpense(e)} className="hover:bg-primary/5 cursor-pointer">
                        <td className="px-5 py-3 text-foreground dark:text-white whitespace-nowrap">{fmtDate(e.expense_date, 'MMM d, yyyy')}</td>
                        <td className="px-5 py-3 font-medium text-foreground dark:text-white"><span className="inline-flex items-center gap-1.5">{e.description}{e.invoice_url && <Paperclip size={13} className="text-muted-foreground" />}
                          {/* 0106: who bore it. Only shown when the fund did, fully or partly. */}
                          {e.project_id && projects.find((p) => p.id === e.project_id) && (
                            <Badge variant="indigo">{projects.find((p) => p.id === e.project_id)?.title}</Badge>
                          )}
                          {Number(e.funded_by_fund_usd ?? 0) > 0 && (
                            <Badge variant="yellow">{fundingOf(e) === 'fund' ? t('fund.paidFromFund') : t('fund.partFromFund', { amount: money(Number(e.funded_by_fund_usd)) })}</Badge>
                          )}</span></td>
                        <td className="px-5 py-3"><Badge>{typeLabel(e)}</Badge></td>
                        <td className="px-5 py-3 text-foreground dark:text-white text-xs">{e.building_id ? blockName[e.building_id] ?? t('finance.aBlock') : (e.compound_id ? t('finance.wholeCompound') : e.scope_type)} · {e.method.replace('_', ' ')}</td>
                        <td className="px-5 py-3 text-end font-semibold text-foreground dark:text-white tnum">{currencyTag(e) && <span className="me-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{currencyTag(e)}</span>}{money(Number(e.amount_usd))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div></Card>
              ))}

              {tab === 'payments' && (pPayments.length === 0 ? <Empty body={t('finance.noPayments', { period: periodLabel })} /> : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.method')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.note')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                    {canManageFinance && <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {/* T3: voided payments stay VISIBLE (dimmed + VOIDED badge) for transparency,
                        but are excluded from every total and the downloaded report. */}
                    {vPayments.filter((p) => inRange(p.paid_on)).map((p) => (
                      <tr key={p.id} onClick={() => !p.voided_at && setDetailPayment(p)} className={`${p.voided_at ? 'opacity-45' : 'hover:bg-primary/5 cursor-pointer'}`}>
                        <td className="px-5 py-3 text-foreground dark:text-white whitespace-nowrap">{fmtDate(p.paid_on, 'MMM d, yyyy')}</td>
                        <td className="px-5 py-3 font-semibold text-foreground dark:text-white">
                          {unitDisplay(p.unit_id)}
                          {p.paid_by === 'tenant' && <TenantTag label={tenantLabelFor(p.tenant_id, p.unit_id, p.paid_on)} />}
                          {p.voided_at && <span className="ms-2 text-[10px] uppercase tracking-wide bg-slate-500/15 text-slate-400 rounded px-1.5 py-0.5">{t('finance.voidedBadge')}</span>}
                        </td>
                        <td className="px-5 py-3 text-foreground dark:text-white">{t(`finance.methods.${p.method}`)}</td>
                        <td className="px-5 py-3 text-foreground dark:text-white"><span className="inline-flex items-center gap-2">{p.note ?? '—'}{p.receipt_url && <AttachmentLink url={p.receipt_url} className="text-primary hover:text-primary/80 inline-flex" icon={Paperclip} />}</span></td>
                        <td className={`px-5 py-3 text-end font-semibold tnum ${p.voided_at ? 'line-through text-slate-400' : 'text-foreground dark:text-white'}`}>{currencyTag(p) && <span className="me-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{currencyTag(p)}</span>}{money(Number(p.amount_usd))}</td>
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

              {tab === 'adjustments' && (pAdjustments.length === 0 ? <Empty body={t('finance.noAdjustments')} /> : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.adjKind')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('finance.note')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('finance.effect')}</th>
                    {canManageFinance && <th className="px-5 py-3 w-8" />}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {pAdjustments.map((a) => {
                      const eff = adjustmentEffect(a.kind, Number(a.amount_usd));
                      return (
                        <tr key={a.id} className={a.voided_at ? 'opacity-45' : ''}>
                          <td className="px-5 py-3 text-foreground dark:text-white whitespace-nowrap">{fmtDate(a.effective_date, 'MMM d, yyyy')}</td>
                          <td className="px-5 py-3 font-semibold text-foreground dark:text-white">
                            {unitDisplay(a.unit_id)}
                            {a.party === 'tenant' && <TenantTag label={tenantLabelFor(a.tenant_id, a.unit_id, a.effective_date)} />}
                            {a.voided_at && <span className="ms-2 text-[10px] uppercase tracking-wide bg-slate-500/15 text-slate-400 rounded px-1.5 py-0.5">{t('finance.voidedBadge')}</span>}
                          </td>
                          <td className="px-5 py-3"><Badge>{t(`finance.adjKinds.${a.kind}`)}</Badge></td>
                          <td className="px-5 py-3 text-muted-foreground text-xs">{a.note ?? '—'}{a.counterparty_name ? ` · ${a.counterparty_name}` : ''}</td>
                          <td className={`px-5 py-3 text-end font-semibold tnum ${a.voided_at ? 'line-through text-slate-400' : eff < 0 ? 'text-red-400 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(eff)}</td>
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
            <SelectField label={t('finance.category')} value={expForm.expense_type_id || expForm.category}
              onValueChange={(v) => {
                const ty = activeTypes.find((x) => x.id === v);
                const cat = legacyCategoryFor(ty) as ExpenseCategory;
                setExpForm({ ...expForm, expense_type_id: ty?.id ?? '', category: cat, leasedTo: defaultLeasedTo(cat) });
              }}>
              {activeTypes.map((ty) => <SelectItem key={ty.id} value={ty.id}>{ty.key ? t(`finance.cats.${ty.key}`) : ty.name}</SelectItem>)}
              {/* legacy fallback while the catalog loads */}
              {activeTypes.length === 0 && CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`finance.cats.${c}`)}</SelectItem>)}
            </SelectField>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('finance.amountUsd')} type="number" step="0.01" min="0" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
                <Input label={t('finance.amountLbp')} type="number" step="1" min="0" value={expForm.amount_lbp} onChange={(e) => setExpForm({ ...expForm, amount_lbp: e.target.value })} />
              </div>
              {Number(expForm.amount_lbp) > 0 && (
                <div className="grid grid-cols-2 gap-3 items-end">
                  <Input label={t('finance.lbpRate')} type="number" step="0.01" min="0" value={expForm.lbp_rate} onChange={(e) => setExpForm({ ...expForm, lbp_rate: e.target.value })} />
                  <p className="text-sm text-muted-foreground pb-2.5">
                    {t('finance.totalUsd')}: <span className="font-semibold text-foreground tnum">
                      {Number.isNaN(composeUsdTotal(Number(expForm.amount) || 0, Number(expForm.amount_lbp) || 0, Number(expForm.lbp_rate) || 0))
                        ? '—' : money(composeUsdTotal(Number(expForm.amount) || 0, Number(expForm.amount_lbp) || 0, Number(expForm.lbp_rate) || 0))}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
          <Input label={t('finance.description')} value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.date')} type="date" value={expForm.expense_date} onChange={(e) => setExpForm({ ...expForm, expense_date: e.target.value })} />
            {!editingExpenseId && expForm.funding !== 'fund' && (
              <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-border p-3">
                <input type="checkbox" checked={expForm.extraordinary}
                  onChange={(e) => setExpForm({ ...expForm, extraordinary: e.target.checked })}
                  className="mt-0.5 accent-primary" />
                <span>
                  <span className="text-sm font-medium text-foreground">{t('finance.extraordinaryLabel')}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {entity?.billingMode === 'dues' ? t('finance.extraordinaryHintDues') : t('finance.extraordinaryHintArrears')}
                  </span>
                </span>
              </label>
            )}
            <SelectField label={t('finance.applyTo')} value={expForm.scope} onValueChange={(v) => setExpForm({ ...expForm, scope: v as ExpScope })}>
              <SelectItem value="all">{entity?.kind === 'compound' ? t('finance.wholeCompound') : t('finance.allUnits')}</SelectItem>
              {entity?.kind === 'compound' && multiBlock && <SelectItem value="block">{t('finance.aBlock')}</SelectItem>}
              <SelectItem value="group">{t('finance.aGroup')}</SelectItem>
              <SelectItem value="units">{t('finance.selectedUnits')}</SelectItem>
              <SelectItem value="unit">{t('finance.singleUnit')}</SelectItem>
            </SelectField>
          </div>

          {/* T5: only matters when some target unit has a tenant. Owner-only units
              always bill the owner; here you choose who pays on leased units. */}
          {targetUnits.some((u) => hasTenant(u.id)) && (
            <div>
              <SelectField label={t('finance.leasedChargeTo')} value={expForm.leasedTo} onValueChange={(v) => setExpForm({ ...expForm, leasedTo: v as Tenure })}>
                <SelectItem value="owner">{t('finance.billedToOptions.owner')}</SelectItem>
                <SelectItem value="tenant">{t('finance.billedToOptions.tenant')}</SelectItem>
              </SelectField>
              <p className="text-xs text-muted-foreground mt-1">{t('finance.leasedChargeHint')}</p>
            </div>
          )}

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

          {/* 0109: tag it to a project, so estimate-vs-actual is the book's number */}
          {projects.length > 0 && (
            <SelectField label={t('projects.linkLabel')} value={expForm.project_id || '__none__'} onValueChange={(v) => setExpForm({ ...expForm, project_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('projects.linkNone')}</SelectItem>
              {projects.filter((p) => p.status !== 'cancelled' && (p.status !== 'done' || p.id === expForm.project_id)).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
              ))}
            </SelectField>
          )}

          {/* 0106: who bears it. Their three buttons, our wording. 'mixed' is
              reached from the remainder prompt below rather than chosen up
              front — you only split once you have seen what is left over. */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('fund.whoPays')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['residents', 'fund'] as const).map((k) => {
                const on = expForm.funding === k || (k === 'residents' && expForm.funding === 'mixed');
                return (
                  <button key={k} type="button"
                    onClick={() => setExpForm({ ...expForm, funding: k, extraordinary: k === 'fund' ? false : expForm.extraordinary })}
                    className={`rounded-xl border px-3 py-2.5 text-start transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}>
                    <span className="block text-sm font-medium text-foreground">{t(`fund.pay_${k}`)}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{t(`fund.pay_${k}_hint`)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {expForm.funding !== 'fund' && (
            <SelectField label={t('finance.splitMethod')} value={expForm.method} onValueChange={(v) => setExpForm({ ...expForm, method: v as AllocationMethod })}>
              <SelectItem value="by_shares">{t('finance.byShares')}</SelectItem>
              <SelectItem value="equal">{t('finance.equally')}</SelectItem>
              <SelectItem value="custom">{t('finance.customAmounts')}</SelectItem>
            </SelectField>
          )}

          {expForm.funding !== 'fund' && targetUnits.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground">
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

          {/* 0106 — the remainder is never silent. Allocated less than the
              amount? Say whether the fund bears the rest, or go back and fix
              the split. Allocated more? That is simply an error. */}
          {expForm.funding !== 'fund' && targetUnits.length > 0 && (() => {
            const total = composeUsdTotal(Number(expForm.amount) || 0, Number(expForm.amount_lbp) || 0, Number(expForm.lbp_rate) || 0);
            const rest = round2(total - previewSum);
            if (Math.abs(rest) <= 0.005) return null;
            if (rest < 0) return (
              <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
                {t('finance.fundOverAllocated')}
              </div>
            );
            return (
              <div className={`rounded-xl border px-3 py-3 ${expForm.funding === 'mixed' ? 'border-primary/40 bg-primary/5' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800'}`}>
                <p className="text-sm font-medium text-foreground">{t('fund.remainderTitle', { amount: money(rest) })}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {expForm.funding === 'mixed' ? t('fund.remainderNamed') : t('fund.remainderAsk')}
                </p>
                {expForm.funding !== 'mixed' && (
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <Button size="sm" variant="secondary" onClick={() => setExpForm({ ...expForm, funding: 'mixed' })}>{t('fund.remainderFromFund')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setExpForm({ ...expForm, method: 'by_shares', funding: 'residents' })}>{t('fund.remainderFixSplit')}</Button>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('finance.invoiceOptional')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setExpFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setExpOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveExpense} loading={saving}
              disabled={(expForm.funding !== 'fund' && targetUnits.length === 0) || !(Number(expForm.amount) > 0)}>
              {editingExpenseId ? t('finance.saveChanges')
                : expForm.funding === 'fund' ? t('fund.recordFromFund')
                : `${t('finance.createAndBill')} ${targetUnits.length || ''}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Payment modal */}
      <RequestPaymentModal
        open={reqOpen}
        onClose={() => setReqOpen(false)}
        lines={requestLinesAsOf(
          units.filter((u) => entity?.buildingIds.includes(u.building_id)),
          charges, payments, adjustments, th, reqAsOf || null)}
        entityName={entity?.name ?? ''}
        busy={reqBusy}
        label={reqLabel} setLabel={setReqLabel}
        days={reqDays} setDays={setReqDays}
        asOf={reqAsOf} setAsOf={setReqAsOf}
        hasRecipient={(unitId, party) => tenancy.some(
          (m) => m.unit_id === unitId && !m.ended_at && m.tenure === party)}
        hasOpen={openRequestLines.length > 0}
        tenantName={(id) => tenancy.find((m) => m.user_id === id)?.profiles?.full_name ?? null}
        t={t}
        onIssue={async () => {
          if (!entity) return;
          setReqBusy(true);
          const { error } = await supabase.rpc('request_payment', {
            p_scope_type: entity.kind,
            p_scope_id: entity.id,
            p_label: reqLabel.trim() || null,
            p_due_days: Number(reqDays) || null,
            p_as_of: reqAsOf || null,
          });
          setReqBusy(false);
          if (error) { toast.error(error.message); return; }
          toast.success(t('finance.requestIssued'));
          setReqOpen(false); setReqLabel(''); setReqAsOf('');
          loadScope();
        }}
      />

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={editingPaymentId ? t('finance.editPayment') : t('finance.recordPayment')}>
        <div className="space-y-4">
          <SelectField label={t('finance.unit')} value={payForm.unit_id || '__none__'} onValueChange={(v) => setPayForm({ ...payForm, unit_id: v === '__none__' ? '' : v })}>
            <SelectItem value="__none__">{t('finance.selectUnit')}</SelectItem>
            {book.map((r) => <SelectItem key={r.unit.id} value={r.unit.id}>{unitDisplay(r.unit.id)} ({money(r.balance)})</SelectItem>)}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('finance.amountUsd')} type="number" step="0.01" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                <Input label={t('finance.amountLbp')} type="number" step="1" min="0" value={payForm.amount_lbp} onChange={(e) => setPayForm({ ...payForm, amount_lbp: e.target.value })} />
              </div>
              {Number(payForm.amount_lbp) > 0 && (
                <div className="grid grid-cols-2 gap-3 items-end">
                  <Input label={t('finance.lbpRate')} type="number" step="0.01" min="0" value={payForm.lbp_rate} onChange={(e) => setPayForm({ ...payForm, lbp_rate: e.target.value })} />
                  <p className="text-sm text-muted-foreground pb-2.5">
                    {t('finance.totalUsd')}: <span className="font-semibold text-foreground tnum">
                      {Number.isNaN(composeUsdTotal(Number(payForm.amount) || 0, Number(payForm.amount_lbp) || 0, Number(payForm.lbp_rate) || 0))
                        ? '—' : money(composeUsdTotal(Number(payForm.amount) || 0, Number(payForm.amount_lbp) || 0, Number(payForm.lbp_rate) || 0))}
                    </span>
                  </p>
                </div>
              )}
            </div>
            <SelectField label={t('finance.method')} value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v as PaymentMethod })}>
              {PAY_METHODS.map((m) => <SelectItem key={m} value={m}>{t(`finance.methods.${m}`)}</SelectItem>)}
            </SelectField>
          </div>
          <Input label={t('finance.date')} type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} />
          {/* T8: only leased units ask who paid */}
          {hasTenant(payForm.unit_id) && (
            <SelectField label={t('finance.paidBy')} value={payForm.paid_by} onValueChange={(v) => setPayForm({ ...payForm, paid_by: v as Tenure })}>
              <SelectItem value="owner">{t('finance.billedToOptions.owner')}</SelectItem>
              <SelectItem value="tenant">{t('finance.billedToOptions.tenant')}</SelectItem>
            </SelectField>
          )}
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
      {/* 0106: a fund entry — money that is not a unit payment or an expense */}
      <Modal open={fundEntryOpen} onClose={() => setFundEntryOpen(false)} title={fundEntryForm.kind === 'income' ? t('fund.recordIncome') : t('fund.recordOutflow')}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{fundEntryForm.kind === 'income' ? t('fund.incomeHint') : t('fund.outflowHint')}</p>
          <Input label={t('finance.description')} value={fundEntryForm.description} onChange={(e) => setFundEntryForm({ ...fundEntryForm, description: e.target.value })} placeholder={fundEntryForm.kind === 'income' ? t('fund.incomeExample') : t('fund.outflowExample')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.amountUsd')} type="number" step="0.01" min="0" value={fundEntryForm.amount} onChange={(e) => setFundEntryForm({ ...fundEntryForm, amount: e.target.value })} />
            <Input label={t('finance.date')} type="date" value={fundEntryForm.entry_date} onChange={(e) => setFundEntryForm({ ...fundEntryForm, entry_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.amountLbp')} type="number" step="1" min="0" value={fundEntryForm.amount_lbp} onChange={(e) => setFundEntryForm({ ...fundEntryForm, amount_lbp: e.target.value })} />
            <Input label={t('finance.lbpRate')} type="number" step="1" min="0" value={fundEntryForm.lbp_rate} onChange={(e) => setFundEntryForm({ ...fundEntryForm, lbp_rate: e.target.value })} />
          </div>
          <Input label={t('fund.counterparty')} value={fundEntryForm.counterparty} onChange={(e) => setFundEntryForm({ ...fundEntryForm, counterparty: e.target.value })} placeholder={t('fund.counterpartyExample')} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('finance.invoiceOptional')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFundEntryFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setFundEntryOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveFundEntry} loading={saving} disabled={!(Number(fundEntryForm.amount) > 0 || Number(fundEntryForm.amount_lbp) > 0) || !fundEntryForm.description.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* 0106: the opening cash — what was in the drawer the day the book started */}
      <Modal open={openingOpen} onClose={() => setOpeningOpen(false)} title={t('fund.openingTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('fund.openingHint')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('finance.amountUsd')} type="number" step="0.01" value={openingForm.amount} onChange={(e) => setOpeningForm({ ...openingForm, amount: e.target.value })} />
            <Input label={t('fund.openingDate')} type="date" value={openingForm.date} onChange={(e) => setOpeningForm({ ...openingForm, date: e.target.value })} />
          </div>
          <Input label={t('finance.note')} value={openingForm.note} onChange={(e) => setOpeningForm({ ...openingForm, note: e.target.value })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpeningOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveOpening} loading={saving}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!detailExpense} onClose={() => setDetailExpense(null)} title={detailExpense?.description ?? t('finance.expenses')} size="lg">
        {detailExpense && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { l: t('finance.amount'), v: money(Number(detailExpense.amount_usd)) + (currencyBreakdown(detailExpense) ? ` (${currencyBreakdown(detailExpense)})` : '') },
                { l: t('finance.category'), v: allTypes.find((x) => x.id === detailExpense.expense_type_id)?.key == null && detailExpense.expense_type_id ? (allTypes.find((x) => x.id === detailExpense.expense_type_id)?.name ?? t(`finance.cats.${detailExpense.category}`)) : t(`finance.cats.${detailExpense.category}`) },
                { l: t('finance.date'), v: fmtDate(detailExpense.expense_date, 'MMM d, yyyy') },
                { l: t('finance.split'), v: detailExpense.building_id ? (blockName[detailExpense.building_id] ?? t('finance.aBlock')) : (detailExpense.compound_id ? t('finance.wholeCompound') : detailExpense.scope_type) },
                // 0106: only when the fund bore some of it — a fully billed expense says nothing extra
                ...(Number(detailExpense.funded_by_fund_usd ?? 0) > 0
                  ? [{ l: t('fund.fundPart'), v: money(Number(detailExpense.funded_by_fund_usd)) }] : []),
                ...(detailExpense.project_id
                  ? [{ l: t('projects.one'), v: projects.find((p) => p.id === detailExpense.project_id)?.title ?? '—' }] : []),
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-secondary px-3 py-2"><p className="text-[11px] text-muted-foreground uppercase tracking-wide">{x.l}</p><p className="text-sm font-semibold text-foreground mt-0.5 capitalize">{x.v}</p></div>
              ))}
            </div>
            {/* Through AttachmentLink like every other attachment: the bucket is
                private, so a stored URL opened directly is a dead link. This one
                was the last raw href left. */}
            {detailExpense.invoice_url && (
              <AttachmentLink
                url={detailExpense.invoice_url}
                label={t('finance.viewInvoice')}
                icon={FileText}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              />
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('finance.billedToUnits')}</p>
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border max-h-72 overflow-y-auto">
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
            <div className="rounded-2xl bg-emerald-500/10 px-4 py-3"><p className="text-xs text-emerald-600 dark:text-emerald-400">{t('finance.amount')}</p><p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 tnum">{money(Number(detailPayment.amount_usd))}</p>{currencyBreakdown(detailPayment) && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{currencyBreakdown(detailPayment)}</p>}</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { l: t('finance.unit'), v: unitDisplay(detailPayment.unit_id) },
                { l: t('finance.method'), v: t(`finance.methods.${detailPayment.method}`) },
                { l: t('finance.date'), v: fmtDate(detailPayment.paid_on, 'MMM d, yyyy') },
                { l: t('finance.note'), v: detailPayment.note || '—' },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-secondary px-3 py-2"><p className="text-[11px] text-muted-foreground uppercase tracking-wide">{x.l}</p><p className="text-sm font-semibold text-foreground mt-0.5 capitalize">{x.v}</p></div>
              ))}
            </div>
            {detailPayment.receipt_url && <AttachmentLink url={detailPayment.receipt_url} label={t('finance.viewReceipt')} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline" />}
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

function Kpi({ label, value, icon: Icon, tone, hint, desc }: { label: string; value: string; icon: ElementType; tone?: string; hint?: string; desc?: string }) {
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
      <div className="min-w-0"><p className="text-xs text-muted-foreground font-medium">{label}</p><p className={`text-xl lg:text-2xl font-bold tnum mt-1 truncate ${tone === 'rose' ? 'text-red-400 dark:text-red-300' : 'text-foreground'}`}>{value}</p>{hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}{desc && <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-snug">{desc}</p>}</div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${gradient} text-white shadow-sm`}><Icon size={18} /></div>
    </div></CardBody></Card>
  );
}

/** Preview + issue an arrears payment request. The preview and the RPC share
 *  requestLinesAsOf(), so what is shown is exactly what is asked — including
 *  the as-of rule: the balance AT the cutoff, net of payments made after it. */
function RequestPaymentModal({ open, onClose, lines, entityName, onIssue, busy, label, setLabel, days, setDays, asOf, setAsOf, hasRecipient, hasOpen, tenantName, t }: {
  open: boolean; onClose: () => void;
  lines: import('@/lib/reportData').RequestLinePreview[];
  entityName: string;
  onIssue: () => void; busy: boolean;
  label: string; setLabel: (v: string) => void;
  days: string; setDays: (v: string) => void;
  asOf: string; setAsOf: (v: string) => void;
  hasRecipient: (unitId: string, party: 'owner' | 'tenant') => boolean;
  hasOpen: boolean;
  tenantName: (id: string) => string | null;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const rows = lines.map((l) => ({
    ...l,
    partyLabel: l.party === 'owner'
      ? t('finance.owner')
      : tenantTitle(t('finance.currentTenant'), l.tenantId ? tenantName(l.tenantId) : null),
    reachable: hasRecipient(l.unit.id, l.party),
  }));
  const total = rows.reduce((s, l) => s + l.amount, 0);
  const unreachable = rows.filter((l) => !l.reachable).length;
  const due = new Date(Date.now() + (Number(days) || 7) * 864e5);

  return (
    <Modal open={open} onClose={onClose} title={t('finance.requestPayment')} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('finance.requestPaymentNote')}</p>
        {hasOpen && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('finance.requestReplacesOpen')}</p>
        )}
        <Input label={t('finance.requestLabel')} value={label} onChange={(e) => setLabel(e.target.value)}
               placeholder={t('finance.requestLabelPlaceholder')} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <SelectField label={t('buildings.dueDays')} value={days} onValueChange={setDays}>
              {[3, 5, 7, 10, 14, 21, 30, 45, 60, 90].map((d) => (
                <SelectItem key={d} value={String(d)}>{t('buildings.dueDaysN', { count: d })}</SelectItem>
              ))}
            </SelectField>
            <p className="text-xs text-muted-foreground mt-1">
              {t('finance.requestDueBy', { date: fmtDate(due, 'MMM d, yyyy') })}
            </p>
          </div>
          <div>
            <Input label={t('finance.requestAsOf')} type="date" value={asOf}
                   max={new Date().toISOString().slice(0, 10)}
                   onChange={(e) => setAsOf(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              {asOf ? t('finance.requestAsOfHint', { date: fmtDate(asOf, 'MMM d, yyyy') }) : t('finance.requestAsOfLive')}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-3 py-2 bg-secondary/50 text-xs font-medium text-muted-foreground flex justify-between">
            <span>{entityName}</span>
            <span className="tnum">{t('finance.requestTotal', { count: rows.length, amount: money(total) })}</span>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-border/60">
            {rows.length === 0
              ? <p className="text-sm text-muted-foreground text-center py-6">{t('finance.requestNobodyOwes')}</p>
              : rows.map((l, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="text-foreground">{l.unit.label}
                    <span className="text-muted-foreground/70"> · {l.partyLabel}</span>
                    {!l.reachable && (
                      <span className="text-amber-600 dark:text-amber-400"> · {t('finance.requestNoRecipient')}</span>
                    )}</span>
                  <span className="font-semibold text-foreground tnum">{money(l.amount)}</span>
                </div>
              ))}
          </div>
        </div>
        {unreachable > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('finance.requestNoRecipientHint', { count: unreachable })}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={onIssue} loading={busy} disabled={rows.length === 0}>{t('finance.requestIssue')}</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Open payment requests, listed ONE BY ONE rather than summed (0076).
 *
 * A request is a snapshot: "you owed $500 on 1 Aug". If charges land after it,
 * the balance moves but the request does not — so a single merged number would
 * leave a resident unable to explain why the two disagree mid-cycle. Each row
 * shows what was asked, what has been paid against it since, and what is left.
 */
function ResidentRequestsCard({ unitIds, viewFor, buildingOf, unitLabel, payments }: {
  unitIds: string[];
  viewFor: (unitId: string) => string;
  buildingOf: (unitId: string) => string;
  unitLabel: Record<string, string>;
  payments: Payment[];
}) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<(PaymentRequestLine & { request: PaymentRequest })[]>([]);
  const key = unitIds.join(',');
  useEffect(() => {
    if (!unitIds.length) { setLines([]); return; }
    supabase.from('payment_request_lines')
      .select('*, request:payment_requests(*)')
      .in('unit_id', unitIds)
      .is('cancelled_at', null)
      .then(({ data }) => setLines((data as unknown as (PaymentRequestLine & { request: PaymentRequest })[]) ?? []));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Paid by this line's party since the request went out — the settlement rule
   *  from request_line_outstanding(), mirrored so the screen matches the cron. */
  const paidSince = (l: PaymentRequestLine & { request: PaymentRequest }) =>
    payments.filter((p) =>
      p.unit_id === l.unit_id && !p.voided_at && p.created_at >= l.request.created_at
      && (l.party === 'tenant'
        ? p.paid_by === 'tenant' && (!l.tenant_id || p.tenant_id === l.tenant_id)
        : p.paid_by !== 'tenant'))
      .reduce((s, p) => s + Number(p.amount_usd), 0);

  const visible = lines
    .map((l) => ({ l, left: Math.max(0, Math.round((Number(l.amount_requested) - paidSince(l)) * 100) / 100) }))
    .filter(({ l, left }) => {
      if (left <= 0) return false;                       // settled: stop showing it
      const view = viewFor(l.unit_id);
      if (view === 'combined') return true;
      if (view === 'owner') return l.party === 'owner';
      if (view.startsWith('self:')) return l.party === 'tenant' && l.tenant_id === view.slice(5);
      if (buildingOf(l.unit_id) !== view.split(':')[1]) return false;
      return view.startsWith('cur:') ? l.party === 'tenant' : l.party === 'owner';
    })
    .sort((a, b) => a.l.request.due_date.localeCompare(b.l.request.due_date));

  if (!visible.length) return null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card className="mb-4"><CardBody>
      <p className="text-sm font-semibold text-primary mb-3">{t('finance.requestsTitle')}</p>
      <div className="space-y-2.5">
        {visible.map(({ l, left }) => {
          const paid = Math.round((Number(l.amount_requested) - left) * 100) / 100;
          const overdue = l.request.due_date < today;
          return (
            <div key={l.id} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground min-w-0">
                  {l.request.label || t('finance.requestDefaultLabel')}
                  <span className="text-muted-foreground/70"> · {unitLabel[l.unit_id] ?? ''}</span>
                </span>
                <span className="font-semibold text-foreground tnum shrink-0">{money(left)}</span>
              </div>
              <p className={`text-xs ${overdue ? 'text-red-500 dark:text-red-300' : 'text-muted-foreground'}`}>
                {overdue
                  ? t('finance.requestOverdue', { date: fmtDate(l.request.due_date, 'MMM d, yyyy') })
                  : t('finance.requestDueBy', { date: fmtDate(l.request.due_date, 'MMM d, yyyy') })}
                {' · '}
                {t('finance.requestAsked', { amount: money(Number(l.amount_requested)), date: fmtDate(l.request.requested_on, 'MMM d') })}
                {paid > 0 && <> · {t('finance.requestPaidSoFar', { amount: money(paid) })}</>}
                {l.offloaded_from_tenant_id && <> · {t('finance.requestFromFormerTenant')}</>}
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">{t('finance.requestsHint')}</p>
    </CardBody></Card>
  );
}

/** Resident dues, filtered by the same lens as the statement (0070).
 *  Before the party split this listed every dues row on the unit, so a tenant
 *  saw the owner's dues and vice versa. Now a tenant sees only their own rows,
 *  an owner sees whichever bucket the toggle is on, and Combined tags each row
 *  with the party it falls on. */
function ResidentDuesCard({ unitIds, viewFor, nameById, isCurrentTenant, buildingOf, isCurrentTenantOf, inPeriod }: {
  unitIds: string[];
  /** 'combined' | 'owner' | 'self:<id>' | 'cur:<buildingId>' | 'fmr:<buildingId>' */
  viewFor: (unitId: string) => string;
  nameById: (id: string) => string | null;
  isCurrentTenant: (unitId: string, tenantId: string | null) => boolean;
  buildingOf: (unitId: string) => string;
  isCurrentTenantOf: (unitId: string, tenantId?: string | null) => boolean;
  inPeriod: (d: Dues) => boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Dues[]>([]);
  const key = unitIds.join(',');
  useEffect(() => {
    if (!unitIds.length) return;
    supabase.from('dues').select('*').in('unit_id', unitIds).order('due_date', { ascending: false }).limit(24)
      .then(({ data }) => setRows((data as Dues[]) ?? []));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = rows.filter((d) => {
    if (!inPeriod(d)) return false;
    const view = viewFor(d.unit_id);
    if (view === 'combined') return true;
    if (view === 'owner') return d.billed_to !== 'tenant';
    if (d.billed_to !== 'tenant') return false;
    // a tenant viewing their own account: strictly their own dues
    if (view.startsWith('self:')) return d.tenant_id === view.slice(5);
    // a building-scoped current/former bucket
    if (buildingOf(d.unit_id) !== view.split(':')[1]) return false;
    return isCurrentTenantOf(d.unit_id, d.tenant_id) === view.startsWith('cur:');
  }).slice(0, 8);

  if (!visible.length) return null;

  /** In Combined, say whose obligation each row is — always qualifying a tenant
   *  as current or former, never a bare "Tenant". */
  const partyTag = (d: Dues) => {
    if (viewFor(d.unit_id) !== 'combined') return null;
    if (d.billed_to !== 'tenant') return t('finance.owner');
    const name = d.tenant_id ? nameById(d.tenant_id) : null;
    const current = isCurrentTenant(d.unit_id, d.tenant_id);
    return tenantTitle(current ? t('finance.currentTenant') : t('finance.formerTenant'), name);
  };

  return (
    <Card className="mb-4"><CardBody>
      <p className="text-sm font-semibold text-primary mb-3">{t('dues.residentTitle')}</p>
      <div className="space-y-2">
        {visible.map((d) => {
          const tag = partyTag(d);
          return (
            <div key={d.id} className="flex items-center justify-between text-sm gap-3">
              <span className="text-muted-foreground min-w-0">
                {d.period_label}{d.due_date ? ` · ${fmtDate(d.due_date, 'MMM d, yyyy')}` : ''}
                {d.kind === 'off_budget' && (
                  <span className="ms-1.5 text-xs text-muted-foreground/70">· {d.label || t('dues.offBudget')}</span>
                )}
                {tag && <span className="ms-1.5 text-xs text-muted-foreground/70">· {tag}</span>}
              </span>
              <span className="font-semibold text-foreground tnum shrink-0">{money(Number(d.amount_due))}</span>
            </div>
          );
        })}
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
function StatementList({ charges, payments, adjustments = [], openings = [], tenantName, unitLabel }: { charges: Charge[]; payments: Payment[]; adjustments?: Adjustment[]; openings?: { unit_id: string; amount: number; date: string | null }[]; tenantName?: (tenant_id: string | null | undefined, unitId: string, date: string) => string | null; unitLabel: Record<string, string> }) {
  const { t } = useTranslation();
  type Row = { date: string; label: string; unit: string; amount: number; tenant?: string | null };
  // tenant name suffix for a tenant-attributed row — prefers the row's tenant_id
  const tn = (tenant_id: string | null | undefined, unitId: string, date: string) => (tenantName ? tenantName(tenant_id, unitId, date) : null);
  const rows: Row[] = [
    // opening / carried-in balance shows as its own line (T: initial balance visible)
    ...openings.filter((o) => Number(o.amount) !== 0).map((o) => ({ date: o.date ?? '1970-01-01', label: t('finance.openingBalance'), unit: unitLabel[o.unit_id] ?? '', amount: Number(o.amount) })),
    ...charges.map((c) => ({ date: c.charge_date, label: c.description || t(`finance.cats.${c.category}`), unit: unitLabel[c.unit_id] ?? '', amount: -Number(c.amount_usd), tenant: c.billed_to === 'tenant' ? tn(c.tenant_id, c.unit_id, c.charge_date) : null })),
    ...payments.map((p) => ({ date: p.paid_on, label: t('finance.payment'), unit: unitLabel[p.unit_id] ?? '', amount: Number(p.amount_usd), tenant: p.paid_by === 'tenant' ? tn(p.tenant_id, p.unit_id, p.paid_on) : null })),
    // adjustments (credit notes / discounts / write-offs / penalties / refunds / transfers)
    ...adjustments.map((a) => ({ date: a.effective_date, label: t(`finance.adjKinds.${a.kind}`) + (a.note ? ` · ${a.note}` : '') + (a.counterparty_name ? ` · ${a.counterparty_name}` : ''), unit: unitLabel[a.unit_id] ?? '', amount: adjustmentEffect(a.kind, Number(a.amount_usd)), tenant: a.party === 'tenant' ? tn(a.tenant_id, a.unit_id, a.effective_date) : null })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (rows.length === 0) return <Empty body={t('finance.noTransactions')} />;
  return (
    <Card><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
        <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
        <th className="px-5 py-3 text-start font-medium">{t('finance.description')}</th>
        <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
      </tr></thead>
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-muted/40">
            <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(r.date, 'MMM d, yyyy')}</td>
            <td className="px-5 py-3 text-foreground">{r.label} <span className="text-muted-foreground text-xs">· {t('finance.unit')} {r.unit}</span>{r.tenant && <TenantTag label={r.tenant} />}</td>
            <td className={`px-5 py-3 text-end font-semibold tnum ${r.amount < 0 ? 'text-red-400 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-400'}`}>{r.amount < 0 ? money(r.amount) : `+${money(r.amount)}`}</td>
          </tr>
        ))}
      </tbody>
    </table></div></Card>
  );
}
