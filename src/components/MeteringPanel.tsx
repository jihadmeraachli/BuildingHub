// ============================================================
// Metering (0090) — a Finance tab for expense types flagged `is_metered`
// (generator, water). Record a cycle: stock in/bought/out + start/end readings
// per unit and for the common areas. Finalizing posts ONE ordinary expense with
// custom per-unit charges (math in lib/metering, tested), so the book, the
// party model and the reminders treat metered money like any other expense.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Gauge, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useExpenseTypes, legacyCategoryFor } from '@/lib/expenseTypes';
import { computeMeterCycle, type MeterReadingDraft } from '@/lib/metering';
import { composeUsdTotal } from '@/lib/currency';
import { fmtDate } from '@/lib/dateFmt';
import type { Unit, Tenure } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface CycleRow {
  id: string; expense_type_id: string; period_start: string; period_end: string;
  opening_stock: number; added_qty: number; added_cost_usd: number; closing_stock: number;
  added_cost_lbp: number | null; lbp_rate: number | null;
  common_method: 'equal' | 'by_shares'; billed_to: 'tenant_where_leased' | 'owner';
  status: string; expense_id: string | null; created_at: string;
}

export function MeteringPanel({ entity, units, canManage, hasTenant, activeTenantId, profileId, onPosted, rateBuildingId }: {
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
  const metered = types.filter((ty) => ty.active && ty.is_metered);

  const [typeId, setTypeId] = useState('');
  useEffect(() => { if (!typeId && metered.length) setTypeId(metered[0].id); }, [metered, typeId]);
  const type = metered.find((ty) => ty.id === typeId);

  const [cycles, setCycles] = useState<CycleRow[]>([]);
  async function loadCycles() {
    if (!typeId) { setCycles([]); return; }
    const q = entity.kind === 'compound'
      ? supabase.from('meter_cycles').select('*').eq('compound_id', entity.id)
      : supabase.from('meter_cycles').select('*').eq('building_id', entity.id);
    const { data } = await q.eq('expense_type_id', typeId).order('period_end', { ascending: false });
    setCycles((data as CycleRow[]) ?? []);
  }
  useEffect(() => { loadCycles(); }, [typeId, entity.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the new-cycle form ────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // editing an existing cycle re-derives and RE-POSTS: the expense amount and
  // its charges are replaced, exactly like editing an ordinary expense
  const [editingCycle, setEditingCycle] = useState<CycleRow | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [addedQty, setAddedQty] = useState('');
  const [addedUsd, setAddedUsd] = useState('');
  const [addedLbp, setAddedLbp] = useState('');
  const [lbpRate, setLbpRate] = useState('');
  const [closingStock, setClosingStock] = useState('');
  const [commonMethod, setCommonMethod] = useState<'equal' | 'by_shares'>('by_shares');
  const [billedTo, setBilledTo] = useState<'tenant_where_leased' | 'owner'>('tenant_where_leased');
  const [reads, setReads] = useState<Record<string, { start: string; end: string }>>({});
  const COMMON = '__common__';

  async function openCycle() {
    setEditingCycle(null);
    setFrom(''); setTo(''); setAddedQty(''); setAddedUsd(''); setAddedLbp('');
    setCommonMethod('by_shares'); setBilledTo('tenant_where_leased');
    // prefill: last cycle's closing stock and end readings become the starts
    const last = cycles[0];
    setOpeningStock(last ? String(last.closing_stock) : '');
    const init: Record<string, { start: string; end: string }> = { [COMMON]: { start: '', end: '' } };
    for (const u of units) init[u.id] = { start: '', end: '' };
    if (last) {
      const { data } = await supabase.from('meter_readings').select('unit_id, end_reading').eq('cycle_id', last.id);
      for (const r of ((data ?? []) as { unit_id: string | null; end_reading: number }[])) {
        init[r.unit_id ?? COMMON] = { start: String(r.end_reading), end: '' };
      }
    }
    setReads(init);
    // effective_lbp_rate cascades block → compound, so any block id works
    const bid = entity.kind === 'building' ? entity.id : rateBuildingId;
    if (bid) {
      const { data } = await supabase.rpc('effective_lbp_rate', { p_building: bid });
      setLbpRate(data ? String(data) : '');
    } else setLbpRate('');
    setOpen(true);
  }

  async function openCycleEdit(c: CycleRow) {
    setEditingCycle(c);
    setFrom(c.period_start); setTo(c.period_end);
    setOpeningStock(String(c.opening_stock)); setAddedQty(String(c.added_qty));
    // split the stored cost back into the USD part + the LBP log (0086)
    const lbp = Number(c.added_cost_lbp ?? 0);
    const rate = Number(c.lbp_rate ?? 0);
    setAddedLbp(lbp > 0 ? String(lbp) : '');
    setLbpRate(rate > 0 ? String(rate) : '');
    setAddedUsd(String(Math.round((Number(c.added_cost_usd) - (lbp > 0 && rate > 0 ? lbp / rate : 0)) * 100) / 100));
    setClosingStock(String(c.closing_stock));
    setCommonMethod(c.common_method); setBilledTo(c.billed_to);
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
    if (!confirm(t('metering.deleteConfirm'))) return;
    if (c.expense_id) {
      const { error } = await supabase.from('expenses').delete().eq('id', c.expense_id);
      if (error) { toast.error(error.message); return; }
    }
    const { error } = await supabase.from('meter_cycles').delete().eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('metering.deleted'));
    loadCycles(); onPosted();
  }

  const readingDrafts: MeterReadingDraft[] = useMemo(() =>
    Object.entries(reads)
      .filter(([, v]) => v.start !== '' || v.end !== '')
      .map(([k, v]) => ({ unitId: k === COMMON ? null : k, start: Number(v.start) || 0, end: Number(v.end) || 0 })),
    [reads]);

  const totalCostUsd = composeUsdTotal(Number(addedUsd) || 0, Number(addedLbp) || 0, Number(lbpRate) || 0);
  const result = useMemo(() => computeMeterCycle({
    units,
    readings: readingDrafts,
    openingStock: Number(openingStock) || 0,
    addedQty: Number(addedQty) || 0,
    addedCostUsd: Number.isNaN(totalCostUsd) ? 0 : totalCostUsd,
    closingStock: Number(closingStock) || 0,
    commonMethod,
  }), [units, readingDrafts, openingStock, addedQty, totalCostUsd, closingStock, commonMethod]);

  async function finalize() {
    if (!type || !from || !to) return;
    if ((Number(addedLbp) || 0) > 0 && (Number(lbpRate) || 0) <= 0) { toast.error(t('finance.lbpNeedsRate')); return; }
    if (result.chargesTotal <= 0) { toast.error(t('metering.nothingToPost')); return; }
    setSaving(true);
    const lbp = Number(addedLbp) || 0;
    const cycleFields = {
      expense_type_id: type.id, period_start: from, period_end: to,
      opening_stock: Number(openingStock) || 0, added_qty: Number(addedQty) || 0,
      added_cost_usd: Number.isNaN(totalCostUsd) ? 0 : totalCostUsd,
      added_cost_lbp: lbp > 0 ? lbp : null, lbp_rate: lbp > 0 ? Number(lbpRate) : null,
      closing_stock: Number(closingStock) || 0,
      common_method: commonMethod, billed_to: billedTo, status: 'final',
    };

    let cycleId: string;
    if (editingCycle) {
      const { error } = await supabase.from('meter_cycles').update(cycleFields).eq('id', editingCycle.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      cycleId = editingCycle.id;
      // readings are replaced wholesale — they ARE the new derivation
      await supabase.from('meter_readings').delete().eq('cycle_id', cycleId);
    } else {
      const { data: cyc, error: cErr } = await supabase.from('meter_cycles').insert({
        building_id: entity.kind === 'building' ? entity.id : null,
        compound_id: entity.kind === 'compound' ? entity.id : null,
        ...cycleFields, created_by: profileId,
      }).select().single();
      if (cErr || !cyc) { toast.error(cErr?.message ?? 'Could not save the cycle'); setSaving(false); return; }
      cycleId = (cyc as { id: string }).id;
    }

    await supabase.from('meter_readings').insert(readingDrafts.map((r) => ({
      cycle_id: cycleId, unit_id: r.unitId, start_reading: r.start, end_reading: r.end,
    })));

    const typeName = type.key ? t(`finance.cats.${type.key}`) : type.name;
    const desc = `${typeName} · ${fmtDate(from, 'MMM d')} – ${fmtDate(to, 'MMM d, yyyy')}`;
    const expenseFields = {
      category: legacyCategoryFor(type), expense_type_id: type.id,
      description: desc, amount_usd: result.chargesTotal,
      amount_lbp: lbp > 0 ? lbp : null, lbp_rate: lbp > 0 ? Number(lbpRate) : null,
      expense_date: to, scope_type: entity.kind === 'compound' ? 'compound' : 'block',
      method: 'custom',
    };

    let expenseId = editingCycle?.expense_id ?? null;
    if (expenseId) {
      // re-post: the expense is updated and its charges rebuilt, the same
      // delete-and-recreate the ordinary expense editor uses
      const { error } = await supabase.from('expenses').update(expenseFields).eq('id', expenseId);
      if (error) { toast.error(error.message); setSaving(false); return; }
      await supabase.from('charges').delete().eq('expense_id', expenseId);
    } else {
      const { data: exp, error: eErr } = await supabase.from('expenses').insert({
        building_id: entity.kind === 'building' ? entity.id : null,
        compound_id: entity.kind === 'compound' ? entity.id : null,
        ...expenseFields, created_by: profileId, meter_cycle_id: cycleId,
      }).select().single();
      if (eErr || !exp) { toast.error(eErr?.message ?? 'Could not post the expense'); setSaving(false); return; }
      expenseId = (exp as { id: string }).id;
      await supabase.from('meter_cycles').update({ expense_id: expenseId }).eq('id', cycleId);
    }

    const unitById = Object.fromEntries(units.map((u) => [u.id, u]));
    const charges = result.perUnit.filter((p) => p.amount > 0).map((p) => {
      const bt: Tenure = billedTo === 'tenant_where_leased' && hasTenant(p.unitId) ? 'tenant' : 'owner';
      return {
        expense_id: expenseId, unit_id: p.unitId, building_id: unitById[p.unitId]?.building_id,
        category: legacyCategoryFor(type), description: desc, amount_usd: p.amount,
        charge_date: to, billed_to: bt,
        tenant_id: bt === 'tenant' ? activeTenantId(p.unitId) : null, created_by: profileId,
      };
    });
    if (charges.length) {
      const { error: chErr } = await supabase.from('charges').insert(charges);
      if (chErr) { toast.error(chErr.message); setSaving(false); return; }
    }
    toast.success(t(editingCycle ? 'metering.reposted' : 'metering.posted', { amount: money(result.chargesTotal) }));
    setSaving(false); setOpen(false); setEditingCycle(null);
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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <SelectField label="" value={typeId} onValueChange={setTypeId}>
          {metered.map((ty) => <SelectItem key={ty.id} value={ty.id}>{ty.key ? t(`finance.cats.${ty.key}`) : ty.name}</SelectItem>)}
        </SelectField>
        {canManage && <Button onClick={openCycle}><Plus size={16} /> {t('metering.newCycle')}</Button>}
      </div>

      {cycles.length === 0
        ? <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('metering.noCycles')}</p></CardBody></Card>
        : (
          <Card><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
              <th className="px-5 py-3 text-start font-medium">{t('metering.period')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.opening')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.bought')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('metering.closing')}</th>
              <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
              {canManage && <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>}
            </tr></thead>
            <tbody className="divide-y divide-border/60">
              {cycles.map((c) => (
                <tr key={c.id} className={canManage ? 'hover:bg-secondary/40 cursor-pointer' : ''} onClick={() => canManage && openCycleEdit(c)}>
                  <td className="px-5 py-3 text-foreground">{fmtDate(c.period_start, 'MMM d')} – {fmtDate(c.period_end, 'MMM d, yyyy')}</td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{Number(c.opening_stock).toLocaleString()}</td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{Number(c.added_qty).toLocaleString()} · {money(Number(c.added_cost_usd))}</td>
                  <td className="px-5 py-3 text-end text-muted-foreground tnum">{Number(c.closing_stock).toLocaleString()}</td>
                  <td className="px-5 py-3 text-end font-semibold text-foreground tnum">
                    {money(Math.max(0, (Number(c.opening_stock) + Number(c.added_qty) - Number(c.closing_stock))) * (Number(c.added_qty) > 0 ? Number(c.added_cost_usd) / Number(c.added_qty) : 0))}
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-end">
                      <button onClick={(ev) => { ev.stopPropagation(); deleteCycle(c); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div></Card>
        )}

      {/* ── new cycle ── */}
      <Modal open={open} onClose={() => { setOpen(false); setEditingCycle(null); }} title={t(editingCycle ? 'metering.editCycle' : 'metering.newCycle')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.periodFrom')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label={t('dues.periodTo')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t('metering.stockTitle')}</p>
            <div className="grid grid-cols-3 gap-3">
              <Input label={t('metering.opening')} type="number" step="0.001" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
              <Input label={t('metering.boughtQty')} type="number" step="0.001" value={addedQty} onChange={(e) => setAddedQty(e.target.value)} />
              <Input label={t('metering.closing')} type="number" step="0.001" value={closingStock} onChange={(e) => setClosingStock(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <Input label={t('metering.boughtUsd')} type="number" step="0.01" value={addedUsd} onChange={(e) => setAddedUsd(e.target.value)} />
              <Input label={t('finance.amountLbp')} type="number" step="1" value={addedLbp} onChange={(e) => setAddedLbp(e.target.value)} />
              <Input label={t('finance.lbpRate')} type="number" step="0.01" value={lbpRate} onChange={(e) => setLbpRate(e.target.value)} disabled={!(Number(addedLbp) > 0)} />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {t('metering.stockMath', {
                consumed: result.consumed.toLocaleString(),
                unitCost: result.unitCost.toFixed(2),
                total: money(result.totalCost),
              })}
            </p>
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

          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('metering.commonSplit')} value={commonMethod} onValueChange={(v) => setCommonMethod(v as 'equal' | 'by_shares')}>
              <SelectItem value="by_shares">{t('dues.methods.by_shares')}</SelectItem>
              <SelectItem value="equal">{t('dues.methods.equal')}</SelectItem>
            </SelectField>
            <SelectField label={t('dues.billTo')} value={billedTo} onValueChange={(v) => setBilledTo(v as 'tenant_where_leased' | 'owner')}>
              <SelectItem value="tenant_where_leased">{t('dues.billToTenant')}</SelectItem>
              <SelectItem value="owner">{t('dues.billToOwner')}</SelectItem>
            </SelectField>
          </div>

          {/* preview: the same math that posts */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2 bg-secondary/50 text-xs font-medium text-muted-foreground flex justify-between">
              <span>{t('metering.previewHead', { rate: result.costPerUnitOfConsumption.toFixed(4) })}</span>
              <span className="tnum">{money(result.chargesTotal)}</span>
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
    </div>
  );
}
