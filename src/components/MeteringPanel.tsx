// ============================================================
// Metering v2 (0162) — two models chosen per metered type in meter_settings:
//   'mbm' Month by Month  — bills the window's purchases, meters split them
//   'wa'  Weighted Average — bills consumption at the rolling average rate;
//                            the tank's value shows in the fund as stock
// Purchases are TYPE-BOUND fund expenses pulled by the cycle window (Ahmad's
// rule) — repairs and contracts are ordinary expenses, invisible here. The
// cycle posts CHARGES ONLY through finalize_meter_cycle(); the client math
// (lib/metering, tested) is the PREVIEW twin of that RPC.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Gauge, Trash2, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useExpenseTypes } from '@/lib/expenseTypes';
import { computeMeterCycle, type MeterReadingDraft, type MeterModel } from '@/lib/metering';
import { fmtDate } from '@/lib/dateFmt';
import { useConfirm } from '@/lib/useConfirm';
import type { Unit } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { fmtMoney } from '@/lib/money';

const money = (n: number) => fmtMoney(n);

interface CycleRow {
  id: string; expense_type_id: string; period_start: string; period_end: string;
  opening_stock: number; added_qty: number; added_cost_usd: number; closing_stock: number;
  opening_stock_value: number | null; closing_stock_value: number | null;
  model: MeterModel | null; rate_billed: number | null; rate_spot: number | null; losses_qty: number | null;
  common_method: 'equal' | 'by_shares'; billed_to: 'tenant_where_leased' | 'owner';
  status: string; expense_id: string | null; created_at: string;
}
interface SettingsRow {
  id: string; expense_type_id: string; model: MeterModel;
  purchase_expense_type_id: string; loss_alarm_pct: number;
  billed_to: 'tenant_where_leased' | 'owner'; common_method: 'equal' | 'by_shares';
  initial_stock_qty: number; initial_stock_value: number;
}
interface PurchaseRow {
  id: string; description: string; expense_date: string;
  qty: number; amount_usd: number; funded_by_fund_usd: number;
}

export function MeteringPanel({ entity, units, canManage, hasTenant: _hasTenant, activeTenantId: _activeTenantId, profileId, onPosted, rateBuildingId: _rateBuildingId }: {
  entity: { kind: 'compound' | 'building'; id: string; name: string };
  rateBuildingId?: string;
  units: Unit[];
  canManage: boolean;
  hasTenant: (unitId: string) => boolean;
  activeTenantId: (unitId: string) => string | null;
  profileId: string | undefined;
  onPosted: () => void;
}) {
  const { t } = useTranslation();
  const { types } = useExpenseTypes(entity.kind, entity.id);
  const { confirmAsync, ConfirmDialog } = useConfirm();
  const metered = types.filter((ty) => ty.active && ty.is_metered);
  const typeLabel = (id: string) => {
    const ty = types.find((x) => x.id === id);
    return ty ? (ty.key ? t(`finance.cats.${ty.key}`) : ty.name) : '—';
  };

  const [typeId, setTypeId] = useState('');
  useEffect(() => { if (!typeId && metered.length) setTypeId(metered[0].id); }, [metered, typeId]);
  const type = metered.find((ty) => ty.id === typeId);

  const scopeCol = entity.kind === 'compound' ? 'compound_id' : 'building_id';

  // ── settings (0162): the model + the bound purchase type ──────────────────
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  async function loadSettings() {
    if (!typeId) { setSettings(null); return; }
    const { data } = await supabase.from('meter_settings').select('*')
      .eq(scopeCol, entity.id).eq('expense_type_id', typeId).maybeSingle();
    setSettings((data as SettingsRow | null) ?? null);
    setSettingsLoaded(true);
  }

  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<CycleRow | null>(null);
  async function loadCycles() {
    if (!typeId) { setCycles([]); return; }
    const { data } = await supabase.from('meter_cycles').select('*')
      .eq(scopeCol, entity.id).eq('expense_type_id', typeId)
      .order('period_end', { ascending: false });
    setCycles((data as CycleRow[]) ?? []);
  }
  useEffect(() => { setSettingsLoaded(false); loadSettings(); loadCycles(); }, [typeId, entity.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── settings modal (the chooser + properties) ─────────────────────────────
  const [setupOpen, setSetupOpen] = useState(false);
  const [sForm, setSForm] = useState({
    model: 'mbm' as MeterModel, purchaseTypeId: '', lossAlarm: '10',
    billedTo: 'tenant_where_leased' as 'tenant_where_leased' | 'owner',
    commonMethod: 'by_shares' as 'equal' | 'by_shares',
    initialQty: '0', initialBilled: true, initialValue: '0',
  });
  const hasFinalCycles = cycles.some((c) => c.status === 'final');
  function openSetup() {
    setSForm({
      model: settings?.model ?? 'mbm',
      purchaseTypeId: settings?.purchase_expense_type_id ?? typeId,
      lossAlarm: String(settings?.loss_alarm_pct ?? 10),
      billedTo: settings?.billed_to ?? 'tenant_where_leased',
      commonMethod: settings?.common_method ?? 'by_shares',
      initialQty: String(settings?.initial_stock_qty ?? 0),
      initialBilled: (settings?.initial_stock_value ?? 0) === 0,
      initialValue: String(settings?.initial_stock_value ?? 0),
    });
    setSetupOpen(true);
  }
  async function saveSettings() {
    if (!typeId) return;
    // WA→MbM exit gate: the tank's fund-owned value must be gone first
    if (settings?.model === 'wa' && sForm.model === 'mbm') {
      const latest = cycles.find((c) => c.status === 'final' && c.model === 'wa');
      if (latest && Number(latest.closing_stock_value ?? 0) > 0.005) {
        toast.error(t('metering.waExitBlocked', { value: money(Number(latest.closing_stock_value)) }));
        return;
      }
    }
    const row = {
      [scopeCol]: entity.id, expense_type_id: typeId,
      model: sForm.model,
      purchase_expense_type_id: sForm.purchaseTypeId || typeId,
      loss_alarm_pct: Math.min(100, Math.max(0, Number(sForm.lossAlarm) || 10)),
      billed_to: sForm.billedTo, common_method: sForm.commonMethod,
      initial_stock_qty: hasFinalCycles ? (settings?.initial_stock_qty ?? 0) : (Number(sForm.initialQty) || 0),
      initial_stock_value: hasFinalCycles ? (settings?.initial_stock_value ?? 0)
        : (sForm.initialBilled ? 0 : Number(sForm.initialValue) || 0),
      updated_at: new Date().toISOString(),
    };
    const { error } = settings
      ? await supabase.from('meter_settings').update(row).eq('id', settings.id)
      : await supabase.from('meter_settings').insert({ ...row, created_by: profileId });
    if (error) { toast.error(error.message); return; }
    toast.success(t('metering.settingsSaved'));
    setSetupOpen(false); loadSettings();
  }

  // ── the cycle form ────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingCycle, setEditingCycle] = useState<CycleRow | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [closingStock, setClosingStock] = useState('');
  const [reads, setReads] = useState<Record<string, { start: string; end: string }>>({});
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const COMMON = '__common__';

  // Ahmad's pull, previewed live: type-bound + quantified + in window + live
  useEffect(() => {
    if (!open || !settings || !from || !to) { setPurchases([]); return; }
    const scopeFilter = entity.kind === 'compound'
      ? `compound_id.eq.${entity.id},building_id.in.(${units.map((u) => u.building_id).filter((v, i, a) => a.indexOf(v) === i).join(',')})`
      : `building_id.eq.${entity.id}`;
    supabase.from('expenses')
      .select('id, description, expense_date, qty, amount_usd, funded_by_fund_usd')
      .eq('expense_type_id', settings.purchase_expense_type_id)
      .not('qty', 'is', null).is('voided_at', null)
      .gte('expense_date', from).lte('expense_date', to)
      .or(scopeFilter)
      .order('expense_date')
      .then(({ data }) => setPurchases((data as PurchaseRow[]) ?? []));
  }, [open, settings, from, to, entity.id, entity.kind, units]);

  const fundPaid = (p: PurchaseRow) => Number(p.funded_by_fund_usd) >= Number(p.amount_usd) - 0.005;
  const pulled = purchases.filter(fundPaid);
  const addedQty = pulled.reduce((s, p) => s + Number(p.qty), 0);
  const addedCost = pulled.reduce((s, p) => s + Number(p.amount_usd), 0);

  // WA opening value, mirroring the server's bridge rules (preview only)
  const prevFinal = useMemo(() => cycles.find((c) => c.status === 'final' && c.id !== editingCycle?.id), [cycles, editingCycle]);
  const openingValue = useMemo(() => {
    if (settings?.model !== 'wa') return 0;
    const q = Number(openingStock) || 0;
    if (prevFinal && prevFinal.model === 'wa') {
      const pq = Number(prevFinal.closing_stock) || 0;
      return pq > 0 ? Math.round((q * Number(prevFinal.closing_stock_value ?? 0) / pq) * 100) / 100 : 0;
    }
    if (prevFinal) return 0;                          // MbM→WA bridge
    return Number(settings?.initial_stock_value ?? 0); // fresh WA setup
  }, [settings, openingStock, prevFinal]);

  async function openCycle() {
    setEditingCycle(null);
    const last = cycles[0];
    // the next period proposes itself: day-after-last, same span forward
    if (last) {
      const d = (x: string) => new Date(x + 'T00:00:00');
      const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      const span = Math.max(1, Math.round((d(last.period_end).getTime() - d(last.period_start).getTime()) / 864e5));
      const nf = new Date(d(last.period_end).getTime() + 864e5);
      setFrom(iso(nf)); setTo(iso(new Date(nf.getTime() + span * 864e5)));
    } else { setFrom(''); setTo(''); }
    setOpeningStock(last ? String(last.closing_stock) : String(settings?.initial_stock_qty ?? ''));
    setClosingStock('');
    const init: Record<string, { start: string; end: string }> = { [COMMON]: { start: '', end: '' } };
    for (const u of units) init[u.id] = { start: '', end: '' };
    if (last) {
      const { data } = await supabase.from('meter_readings').select('unit_id, end_reading').eq('cycle_id', last.id);
      for (const r of ((data ?? []) as { unit_id: string | null; end_reading: number }[])) {
        init[r.unit_id ?? COMMON] = { start: String(r.end_reading), end: '' };
      }
    }
    setReads(init);
    setOpen(true);
  }

  async function openCycleEdit(c: CycleRow) {
    setEditingCycle(c);
    setFrom(c.period_start); setTo(c.period_end);
    setOpeningStock(String(c.opening_stock)); setClosingStock(String(c.closing_stock));
    const init: Record<string, { start: string; end: string }> = { [COMMON]: { start: '', end: '' } };
    for (const u of units) init[u.id] = { start: '', end: '' };
    const { data } = await supabase.from('meter_readings').select('unit_id, start_reading, end_reading').eq('cycle_id', c.id);
    for (const r of ((data ?? []) as { unit_id: string | null; start_reading: number; end_reading: number }[])) {
      init[r.unit_id ?? COMMON] = { start: String(r.start_reading), end: String(r.end_reading) };
    }
    setReads(init);
    setOpen(true);
  }

  async function deleteCycle(c: CycleRow) {
    const { error } = await supabase.rpc('delete_meter_cycle', { p_cycle: c.id });
    setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('metering.deleted'));
    loadCycles(); onPosted();
  }

  const readingDrafts: MeterReadingDraft[] = useMemo(() =>
    Object.entries(reads)
      .filter(([, v]) => v.start !== '' || v.end !== '')
      .map(([k, v]) => ({ unitId: k === COMMON ? null : k, start: Number(v.start) || 0, end: Number(v.end) || 0 })),
    [reads]);

  const result = useMemo(() => computeMeterCycle({
    model: settings?.model ?? 'mbm',
    units,
    readings: readingDrafts,
    openingStock: Number(openingStock) || 0,
    openingStockValue: openingValue,
    addedQty, addedCostUsd: addedCost,
    closingStock: Number(closingStock) || 0,
    commonMethod: settings?.common_method ?? 'by_shares',
    lossAlarmPct: Number(settings?.loss_alarm_pct ?? 10),
  }), [settings, units, readingDrafts, openingStock, openingValue, addedQty, addedCost, closingStock]);

  async function finalize() {
    if (!type || !settings || !from || !to) return;
    setSaving(true);
    const cycleFields = {
      expense_type_id: type.id, period_start: from, period_end: to,
      opening_stock: Number(openingStock) || 0, closing_stock: Number(closingStock) || 0,
      common_method: settings.common_method, billed_to: settings.billed_to, status: 'draft',
    };
    let cycleId: string;
    if (editingCycle) {
      const { error } = await supabase.from('meter_cycles').update(cycleFields).eq('id', editingCycle.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      cycleId = editingCycle.id;
      await supabase.from('meter_readings').delete().eq('cycle_id', cycleId);
    } else {
      const { data: cyc, error: cErr } = await supabase.from('meter_cycles').insert({
        [scopeCol]: entity.id, ...cycleFields, created_by: profileId,
      }).select().single();
      if (cErr || !cyc) { toast.error(cErr?.message ?? 'Could not save the cycle'); setSaving(false); return; }
      cycleId = (cyc as { id: string }).id;
    }
    await supabase.from('meter_readings').insert(readingDrafts.map((r) => ({
      cycle_id: cycleId, unit_id: r.unitId, start_reading: r.start, end_reading: r.end,
    })));

    // the server recomputes everything (it is the source of truth) and posts
    // charges only; on a losses alarm it asks before billing them in
    let { error } = await supabase.rpc('finalize_meter_cycle', { p_cycle: cycleId });
    if (error && error.message.startsWith('LOSSES_ALARM|')) {
      const pct = error.message.split('|')[1] ?? '?';
      const ok = await confirmAsync(t('metering.lossAlarmTitle'), t('metering.lossAlarmBody', { pct }));
      if (ok) ({ error } = await supabase.rpc('finalize_meter_cycle', { p_cycle: cycleId, p_confirm_losses: true }));
      else { setSaving(false); return; }
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('metering.finalized', { amount: money(result.chargesTotal) }));
    setOpen(false); setEditingCycle(null);
    loadCycles(); onPosted();
  }

  if (metered.length === 0) {
    return (
      <Card><CardBody><div className="text-center py-10">
        <Gauge className="mx-auto text-primary mb-2" size={28} />
        <p className="text-sm text-muted-foreground mb-1">{t('metering.noMetered')}</p>
        <p className="text-xs text-muted-foreground">
          {t('metering.noMeteredHint')} <Link to="/buildings" className="text-primary underline">{t('nav.buildings')}</Link>
        </p>
      </div></CardBody></Card>
    );
  }

  // ── first-run: the model chooser (demo-page style cards) ──────────────────
  const needsSetup = settingsLoaded && !settings;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <SelectField label="" value={typeId} onValueChange={setTypeId}>
          {metered.map((ty) => <SelectItem key={ty.id} value={ty.id}>{ty.key ? t(`finance.cats.${ty.key}`) : ty.name}</SelectItem>)}
        </SelectField>
        <div className="flex items-center gap-2">
          {settings && (
            <Badge variant="slate">{settings.model === 'wa' ? t('metering.modelWa') : t('metering.modelMbm')}</Badge>
          )}
          {canManage && settings && (
            <Button variant="ghost" size="sm" onClick={openSetup}><Settings2 size={14} /> {t('metering.settingsBtn')}</Button>
          )}
          {canManage && settings && <Button variant="tinted" onClick={openCycle}><Plus size={16} /> {t('metering.newCycle')}</Button>}
        </div>
      </div>

      {needsSetup && (
        <Card><CardBody>
          <p className="text-sm font-semibold text-foreground">{t('metering.setupTitle', { type: type ? typeLabel(type.id) : '' })}</p>
          <p className="text-xs text-muted-foreground mt-0.5 mb-4">{t('metering.setupIntro')}</p>
          {canManage ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {(['mbm', 'wa'] as MeterModel[]).map((m) => (
                <button key={m} type="button"
                  onClick={() => { openSetup(); setSForm((f) => ({ ...f, model: m, purchaseTypeId: typeId })); }}
                  className="text-start rounded-xl border border-border p-4 hover:border-primary/50 hover:bg-primary/5 transition cursor-pointer">
                  <p className="font-semibold text-foreground">{t(m === 'mbm' ? 'metering.modelMbm' : 'metering.modelWa')}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t(m === 'mbm' ? 'metering.modelMbmDesc' : 'metering.modelWaDesc')}</p>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('metering.noCycles')}</p>}
        </CardBody></Card>
      )}

      {settings && (cycles.length === 0
        ? <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('metering.noCycles')}</p></CardBody></Card>
        : (
          <Card><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
              <th className="px-5 py-3 text-start font-medium">{t('metering.period')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.opening')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.bought')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.closing')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.rateBilled')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.losses')}</th>
              {canManage && <th className="px-5 py-3 w-8" />}
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {cycles.map((c) => (
                <tr key={c.id} className={canManage ? 'hover:bg-secondary/40 cursor-pointer' : ''} onClick={() => canManage && openCycleEdit(c)}>
                  <td className="px-5 py-3 text-foreground">
                    {fmtDate(c.period_start, 'dd-MM')} – {fmtDate(c.period_end, 'dd-MM-yyyy')}
                    {c.status === 'draft' && <Badge variant="yellow" className="ms-2">{t('metering.draft')}</Badge>}
                  </td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{Number(c.opening_stock).toLocaleString()}</td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{Number(c.added_qty).toLocaleString()} · {money(Number(c.added_cost_usd))}</td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{Number(c.closing_stock).toLocaleString()}</td>
                  <td className="px-5 py-3 text-end tnum text-foreground">
                    {c.rate_billed != null ? Number(c.rate_billed).toFixed(4) : '—'}
                    {c.rate_spot != null && <span className="text-xs text-muted-foreground"> / {Number(c.rate_spot).toFixed(4)}</span>}
                  </td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{c.losses_qty != null ? Number(c.losses_qty).toLocaleString() : '—'}</td>
                  {canManage && (
                    <td className="px-5 py-3 text-end">
                      <button onClick={(ev) => { ev.stopPropagation(); setConfirmDelete(c); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div></Card>
        ))}

      {/* ── settings ── */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title={t('metering.setupTitle', { type: type ? typeLabel(type.id) : '' })} size="lg">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            {(['mbm', 'wa'] as MeterModel[]).map((m) => (
              <button key={m} type="button" onClick={() => setSForm({ ...sForm, model: m })}
                className={`text-start rounded-xl border p-4 transition cursor-pointer ${sForm.model === m ? 'border-primary/50 bg-primary/10' : 'border-border hover:border-primary/40'}`}>
                <p className="font-semibold text-foreground">{t(m === 'mbm' ? 'metering.modelMbm' : 'metering.modelWa')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t(m === 'mbm' ? 'metering.modelMbmDesc' : 'metering.modelWaDesc')}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('metering.purchaseType')} value={sForm.purchaseTypeId} onValueChange={(v) => setSForm({ ...sForm, purchaseTypeId: v })}>
              {types.filter((ty) => ty.active).map((ty) => (
                <SelectItem key={ty.id} value={ty.id}>{ty.key ? t(`finance.cats.${ty.key}`) : ty.name}</SelectItem>
              ))}
            </SelectField>
            <Input label={t('metering.lossAlarm')} type="number" min="0" max="100" value={sForm.lossAlarm} onChange={(e) => setSForm({ ...sForm, lossAlarm: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-2">{t('metering.purchaseTypeHint')}</p>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('metering.commonSplit')} value={sForm.commonMethod} onValueChange={(v) => setSForm({ ...sForm, commonMethod: v as 'equal' | 'by_shares' })}>
              <SelectItem value="by_shares">{t('dues.methods.by_shares')}</SelectItem>
              <SelectItem value="equal">{t('dues.methods.equal')}</SelectItem>
            </SelectField>
            <SelectField label={t('dues.billTo')} value={sForm.billedTo} onValueChange={(v) => setSForm({ ...sForm, billedTo: v as 'tenant_where_leased' | 'owner' })}>
              <SelectItem value="tenant_where_leased">{t('dues.billToTenant')}</SelectItem>
              <SelectItem value="owner">{t('dues.billToOwner')}</SelectItem>
            </SelectField>
          </div>
          {sForm.model === 'wa' && !hasFinalCycles && (
            <div className="rounded-xl border border-border p-3 space-y-3">
              <p className="text-sm font-medium text-foreground">{t('metering.initialTitle')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('metering.initialQty')} type="number" step="0.001" value={sForm.initialQty} onChange={(e) => setSForm({ ...sForm, initialQty: e.target.value })} />
                {!sForm.initialBilled && (
                  <Input label={t('metering.initialValue')} type="number" step="0.01" value={sForm.initialValue} onChange={(e) => setSForm({ ...sForm, initialValue: e.target.value })} />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-primary" checked={sForm.initialBilled} onChange={(e) => setSForm({ ...sForm, initialBilled: e.target.checked })} />
                {t('metering.initialBilledQ')}
              </label>
              <p className="text-xs text-muted-foreground">{t('metering.initialHint')}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setSetupOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveSettings}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── the cycle ── */}
      <Modal open={open} onClose={() => { setOpen(false); setEditingCycle(null); }} title={t(editingCycle ? 'metering.editCycle' : 'metering.newCycle')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.periodFrom')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label={t('dues.periodTo')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          {/* Ahmad's pull, visible: the exact invoices that price this cycle */}
          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t('metering.purchases', { type: settings ? typeLabel(settings.purchase_expense_type_id) : '' })}</p>
            {purchases.length === 0
              ? <p className="text-xs text-muted-foreground">{t('metering.purchasesNone')}</p>
              : (
                <div className="rounded-xl border border-border divide-y divide-border/60 max-h-32 overflow-y-auto">
                  {purchases.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-foreground">{fmtDate(p.expense_date, 'dd-MM')} · {p.description}
                        {!fundPaid(p) && <span className="ms-1.5 text-[10px] text-amber-600 dark:text-amber-400">{t('metering.notFundPaid')}</span>}
                      </span>
                      <span className="tnum text-muted-foreground">{Number(p.qty).toLocaleString()} · {money(Number(p.amount_usd))}</span>
                    </div>
                  ))}
                </div>
              )}
            <p className="text-xs text-muted-foreground mt-1">{t('metering.purchasesTotal', { qty: addedQty.toLocaleString(), cost: money(addedCost) })}</p>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t('metering.stockTitle')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('metering.opening')} type="number" step="0.001" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
              <Input label={t('metering.closing')} type="number" step="0.001" value={closingStock} onChange={(e) => setClosingStock(e.target.value)} />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t('metering.readingsTitle')}</p>
            <div className="max-h-56 overflow-y-auto border border-border rounded-xl divide-y divide-border/60">
              {[...units.map((u) => ({ key: u.id, label: u.label })), { key: COMMON, label: t('metering.commonAreas') }].map((rowU) => (
                <div key={rowU.key} className="grid grid-cols-[1fr_6rem_6rem_7rem] gap-2 items-center px-3 py-1.5 text-sm">
                  <span className={rowU.key === COMMON ? 'font-medium text-primary' : 'text-foreground'}>{rowU.label}</span>
                  <input type="number" step="0.001" placeholder={t('metering.start')} value={reads[rowU.key]?.start ?? ''}
                    onChange={(e) => setReads({ ...reads, [rowU.key]: { ...(reads[rowU.key] ?? { start: '', end: '' }), start: e.target.value } })}
                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1 text-sm text-end focus:outline-none focus:ring-2 focus:ring-ring/40" />
                  <input type="number" step="0.001" placeholder={t('metering.end')} value={reads[rowU.key]?.end ?? ''}
                    onChange={(e) => setReads({ ...reads, [rowU.key]: { ...(reads[rowU.key] ?? { start: '', end: '' }), end: e.target.value } })}
                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1 text-sm text-end focus:outline-none focus:ring-2 focus:ring-ring/40" />
                  <span className="text-end text-xs text-muted-foreground tnum">
                    {(() => {
                      const r = reads[rowU.key]; if (!r || r.start === '' || r.end === '') return '—';
                      const d = (Number(r.end) || 0) - (Number(r.start) || 0);
                      return d < 0 ? '⚠︎' : d.toLocaleString();
                    })()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* the derivation, live: consumed / meters / losses / rates */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-secondary/50 text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>{t('metering.derivation', { consumed: result.consumed.toLocaleString(), meters: result.sumMeters.toLocaleString() })}</span>
                <span className="tnum font-medium text-foreground">{money(result.chargesTotal)}</span>
              </div>
              <div className="flex justify-between flex-wrap gap-x-4">
                <span>
                  {t('metering.rateLine', { billed: result.rateBilled.toFixed(4) })}
                  {result.rateSpot != null && <> · {t('metering.spotLine', { spot: result.rateSpot.toFixed(4) })}</>}
                </span>
                <span className={result.alarm ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                  {t('metering.lossLine', { qty: result.lossesQty.toLocaleString(), pct: result.lossPct.toFixed(1) })}
                </span>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto divide-y divide-border/60">
              {result.perUnit.filter((p) => p.amount > 0).map((p) => {
                const u = units.find((x) => x.id === p.unitId);
                return (
                  <div key={p.unitId} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-foreground">{u?.label ?? '—'}
                      <span className="text-muted-foreground/70 text-xs"> · {p.consumption.toLocaleString()} {t('metering.consumed')}{p.common > 0 && ` + ${money(p.common)} ${t('metering.commonShort')}`}</span>
                    </span>
                    <span className="font-semibold text-foreground tnum">{money(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {result.warnings.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('metering.warnings')}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={finalize} loading={saving} disabled={!from || !to || result.chargesTotal <= 0}>
              {t(editingCycle ? 'metering.refinalize' : 'metering.finalize')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteCycle(confirmDelete)}
        title={t('metering.deleteTitle')} message={t('metering.deleteConfirm')}
        confirmLabel={t('common.delete')}
      />
      {ConfirmDialog}
    </div>
  );
}
