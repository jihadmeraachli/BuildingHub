import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Plus, Wallet, Settings2, Trash2, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import type { Unit, Charge, Payment, DuesPlan, Dues as DuesItem, DuesCadence, DuesMethod, DuesPlanType } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/ui/Skeleton';

const CADENCES: DuesCadence[] = ['monthly', 'quarterly', 'semiannual', 'annual'];
const METHODS: DuesMethod[] = ['by_shares', 'equal', 'custom'];
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function Dues() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useManagedBuildings();
  const entities = useEntities(buildings);
  const [entityKey, setEntityKey] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  const canManage = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('expense.manage', id));
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  const [units, setUnits] = useState<Unit[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [plan, setPlan] = useState<DuesPlan | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [items, setItems] = useState<DuesItem[]>([]);
  const [loading, setLoading] = useState(false);

  // plan form
  const [planOpen, setPlanOpen] = useState(false);
  const [pCadence, setPCadence] = useState<DuesCadence>('quarterly');
  const [pMethod, setPMethod] = useState<DuesMethod>('by_shares');
  const [pPool, setPPool] = useState('');
  const [pCustom, setPCustom] = useState<Record<string, string>>({});
  const [pPlanType, setPPlanType] = useState<DuesPlanType>('b1');
  const [saving, setSaving] = useState(false);

  // generate form
  const [genOpen, setGenOpen] = useState(false);
  const [genPeriod, setGenPeriod] = useState('');
  const [genDue, setGenDue] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { if (entity) load(); }, [entityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity) return;
    setLoading(true);
    const blocks = entity.buildingIds;
    const planQ = entity.kind === 'compound'
      ? supabase.from('dues_plans').select('*').eq('compound_id', entity.id).maybeSingle()
      : supabase.from('dues_plans').select('*').eq('building_id', entity.id).maybeSingle();
    const [{ data: u }, { data: c }, { data: p }, { data: pl }] = await Promise.all([
      supabase.from('units').select('*').in('building_id', blocks).order('label'),
      supabase.from('charges').select('*').in('building_id', blocks),
      supabase.from('payments').select('*').in('building_id', blocks),
      planQ,
    ]);
    setUnits((u as Unit[]) ?? []);
    setCharges((c as Charge[]) ?? []);
    setPayments((p as Payment[]) ?? []);
    const planRow = (pl as DuesPlan) ?? null;
    setPlan(planRow);
    const ids = ((u as Unit[]) ?? []).map((x) => x.id);
    if (ids.length) {
      const { data: d } = await supabase.from('dues').select('*').in('building_id', blocks).order('created_at', { ascending: false });
      setItems((d as DuesItem[]) ?? []);
    } else setItems([]);
    if (planRow && planRow.method === 'custom') {
      const { data: ca } = await supabase.from('dues_unit_amounts').select('unit_id, amount').eq('plan_id', planRow.id);
      setCustomAmounts(Object.fromEntries(((ca as { unit_id: string; amount: number }[]) ?? []).map((r) => [r.unit_id, String(r.amount)])));
    } else setCustomAmounts({});
    setLoading(false);
  }

  const balanceOf = useMemo(() => {
    const m: Record<string, number> = {};
    units.forEach((u) => {
      const ch = charges.filter((c) => c.unit_id === u.id).reduce((s, c) => s + Number(c.amount_usd), 0);
      const pa = payments.filter((p) => p.unit_id === u.id).reduce((s, p) => s + Number(p.amount_usd), 0);
      m[u.id] = round2(pa - ch);
    });
    return m;
  }, [units, charges, payments]);

  function baseFor(u: Unit, method: DuesMethod, pool: number, custom: Record<string, string>): number {
    if (method === 'custom') return round2(Number(custom[u.id]) || 0);
    if (method === 'equal') return round2(pool / (units.length || 1));
    const total = units.reduce((s, x) => s + Number(x.share_weight), 0) || 1;
    return round2((pool * Number(u.share_weight)) / total);
  }

  function openPlan() {
    if (plan) { setPCadence(plan.cadence); setPMethod(plan.method); setPPool(plan.pool_amount != null ? String(plan.pool_amount) : ''); setPCustom(customAmounts); setPPlanType(plan.plan_type ?? 'b1'); }
    else { setPCadence('quarterly'); setPMethod('by_shares'); setPPool(''); setPCustom({}); setPPlanType('b1'); }
    setPlanOpen(true);
  }

  async function savePlan() {
    if (!entity) return;
    setSaving(true);
    const payload = {
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      cadence: pCadence, method: pMethod, pool_amount: pMethod === 'custom' ? null : (Number(pPool) || 0), plan_type: pPlanType, active: true,
    };
    let planId = plan?.id;
    if (plan) await supabase.from('dues_plans').update(payload).eq('id', plan.id);
    else { const { data } = await supabase.from('dues_plans').insert(payload).select().single(); planId = (data as DuesPlan)?.id; }
    if (planId && pMethod === 'custom') {
      await supabase.from('dues_unit_amounts').delete().eq('plan_id', planId);
      const rows = units.map((u) => ({ plan_id: planId, unit_id: u.id, amount: Number(pCustom[u.id]) || 0 }));
      if (rows.length) await supabase.from('dues_unit_amounts').insert(rows);
    }
    toast.success(t('dues.planSaved'));
    setSaving(false); setPlanOpen(false); load();
  }

  const isB2 = plan?.plan_type === 'b2';
  const preview = useMemo(() => {
    if (!plan) return [];
    return units.map((u) => {
      const base = baseFor(u, plan.method, Number(plan.pool_amount) || 0, customAmounts);
      if (plan.plan_type === 'b2') return { unit: u, base, carry: 0, amount_due: base };
      const bal = balanceOf[u.id] ?? 0;
      return { unit: u, base, carry: round2(-bal), amount_due: Math.max(0, round2(base - bal)) };
    });
  }, [plan, units, customAmounts, balanceOf]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (!entity || !plan || !genPeriod.trim()) return;
    setSaving(true);
    const rows = preview.filter((r) => r.amount_due > 0 || r.base > 0).map((r) => ({
      plan_id: plan.id, building_id: r.unit.building_id, unit_id: r.unit.id, period_label: genPeriod.trim(),
      due_date: genDue || null, base_amount: r.base, carry_in: r.carry, amount_due: r.amount_due, created_by: profile?.id,
    }));
    if (rows.length) { const { error } = await supabase.from('dues').insert(rows); if (error) { toast.error(error.message); setSaving(false); return; } }
    toast.success(t('dues.generated'));
    setSaving(false); setGenOpen(false); load();
  }

  async function removeItem(id: string) {
    if (!confirm('Delete this dues item?')) return;
    await supabase.from('dues').delete().eq('id', id);
    load();
  }

  const vItems = items.filter((d) => !blockFilter || d.building_id === blockFilter);
  const unitLabel = (uid: string) => {
    const u = units.find((x) => x.id === uid); if (!u) return 'â€”';
    return multiBlock ? `${blockName[u.building_id] ?? ''} Â· ${u.label}` : u.label;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('dues.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('dues.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 1 && (
            <RadixSelect value={entityKey} onValueChange={setEntityKey}>
              <SelectTrigger className="min-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => <SelectItem key={e.key} value={e.key}>{e.kind === 'compound' ? `â–£ ${e.name}` : e.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
          )}
          {entity?.kind === 'compound' && multiBlock && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={(v) => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {entity.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
          )}
          {canManage && entity && <Button variant="secondary" onClick={openPlan}><Settings2 size={16} /> {plan ? t('dues.editPlan') : t('dues.setupPlan')}</Button>}
          {canManage && entity && plan && <Button onClick={() => { setGenPeriod(''); setGenOpen(true); }}><Plus size={16} /> {t('dues.generate')}</Button>}
        </div>
      </div>

      {entity && entity.billingMode !== 'dues' && (
        <Card className="mb-4"><CardBody>
          <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2"><Info size={15} /> This {entity.kind} uses the arrears model. Switch it to &ldquo;Dues&rdquo; in <Link to="/buildings" className="underline">Buildings</Link> to use prepayments.</p>
        </CardBody></Card>
      )}

      {!entity ? <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{t('finance.noBuildings')}</p></CardBody></Card>
        : !plan ? (
          <Card><CardBody><div className="text-center py-10">
            <Wallet className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground mb-3">{t('dues.noPlan')}</p>
            {canManage && <Button variant="secondary" size="sm" onClick={openPlan}>{t('dues.setupPlan')}</Button>}
          </div></CardBody></Card>
        ) : (
          <>
            <Card className="mb-4"><CardBody>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isB2 ? 'bg-violet-100 text-violet-700' : 'bg-indigo-100 text-indigo-700'}`}>{t(`dues.planTypes.${plan.plan_type ?? 'b1'}`)}</span>
                <span className="text-slate-500">{t('dues.cadence')}: <span className="font-medium text-slate-800">{t(`dues.cadences.${plan.cadence}`)}</span></span>
                <span className="text-slate-500">{t('dues.method')}: <span className="font-medium text-slate-800">{t(`dues.methods.${plan.method}`)}</span></span>
                {plan.pool_amount != null && <span className="text-slate-500">{t('dues.pool')}: <span className="font-medium text-slate-800 tnum">{money(Number(plan.pool_amount))}</span></span>}
              </div>
              <p className="text-xs text-slate-400 mt-2">{isB2 ? t('dues.flatFeeNote') : t('dues.reconcileNote')}</p>
            </CardBody></Card>

            {loading ? <SkeletonTable rows={5} cols={6} />
              : vItems.length === 0 ? <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{t('dues.noDues')}</p></CardBody></Card>
              : (
                <Card><div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wide">
                    <th className="px-5 py-3 text-start font-medium">{t('dues.period')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('dues.unit')}</th>
                    <th className="px-5 py-3 text-end font-medium">{t('dues.base')}</th>
                    {!isB2 && <th className="px-5 py-3 text-end font-medium">{t('dues.carry')}</th>}
                    <th className="px-5 py-3 text-end font-medium">{t('dues.amountDue')}</th>
                    <th className="px-5 py-3 text-start font-medium">{t('dues.dueDate')}</th>
                    {canManage && <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-50">
                    {vItems.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 text-slate-500">{d.period_label}</td>
                        <td className="px-5 py-3 font-semibold text-slate-900">{unitLabel(d.unit_id)}</td>
                        <td className="px-5 py-3 text-end text-slate-600 tnum">{money(Number(d.base_amount))}</td>
                        {!isB2 && <td className={`px-5 py-3 text-end tnum ${Number(d.carry_in) < 0 ? 'text-emerald-600' : Number(d.carry_in) > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{money(Number(d.carry_in))}</td>}
                        <td className="px-5 py-3 text-end font-semibold text-slate-900 tnum">{money(Number(d.amount_due))}</td>
                        <td className="px-5 py-3 text-slate-500">{d.due_date ? format(new Date(d.due_date), 'MMM d, yyyy') : 'â€”'}</td>
                        {canManage && <td className="px-5 py-3 text-end"><button onClick={() => removeItem(d.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 size={15} /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table></div></Card>
              )}
          </>
        )}

      {/* Plan modal */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title={plan ? t('dues.editPlan') : t('dues.setupPlan')} size="lg">
        <div className="space-y-4">
          <SelectField label={t('dues.planType')} value={pPlanType} onValueChange={(v) => setPPlanType(v as DuesPlanType)}>
            <SelectItem value="b1">{t('dues.planTypes.b1')}</SelectItem>
            <SelectItem value="b2">{t('dues.planTypes.b2')}</SelectItem>
          </SelectField>
          <p className="text-xs text-slate-400 -mt-2">{pPlanType === 'b2' ? t('dues.flatFeeNote') : t('dues.reconcileNote')}</p>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('dues.cadence')} value={pCadence} onValueChange={(v) => setPCadence(v as DuesCadence)}>
              {CADENCES.map((c) => <SelectItem key={c} value={c}>{t(`dues.cadences.${c}`)}</SelectItem>)}
            </SelectField>
            <SelectField label={t('dues.method')} value={pMethod} onValueChange={(v) => setPMethod(v as DuesMethod)}>
              {METHODS.map((m) => <SelectItem key={m} value={m}>{t(`dues.methods.${m}`)}</SelectItem>)}
            </SelectField>
          </div>
          {pMethod !== 'custom'
            ? <Input label={t('dues.pool')} type="number" step="0.01" min="0" value={pPool} onChange={(e) => setPPool(e.target.value)} />
            : (
              <div>
                <label className="text-sm font-medium text-slate-600">{t('dues.customAmounts')}</label>
                <div className="mt-1.5 max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-50">
                  {units.map((u) => (
                    <div key={u.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-slate-700">{unitLabel(u.id)}</span>
                      <input type="number" step="0.01" min="0" value={pCustom[u.id] ?? ''} placeholder="0.00" onChange={(e) => setPCustom({ ...pCustom, [u.id]: e.target.value })} className="w-28 text-end rounded-lg border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPlanOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={savePlan} loading={saving}>{t('dues.savePlan')}</Button>
          </div>
        </div>
      </Modal>

      {/* Generate modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title={t('dues.generateTitle')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('dues.period')} value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} placeholder={t('dues.periodPlaceholder')} />
            <Input label={t('dues.dueDate')} type="date" value={genDue} onChange={(e) => setGenDue(e.target.value)} />
          </div>
          <p className="text-xs text-slate-400">{isB2 ? t('dues.flatFeeNote') : t('dues.reconcileNote')}</p>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 text-xs font-medium text-slate-500">{t('dues.amountDue')} â€” {preview.length} units</div>
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
              {preview.map((r) => (
                <div key={r.unit.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="text-slate-700">{unitLabel(r.unit.id)}</span>
                  {isB2
                    ? <span className="font-semibold text-slate-900 tnum">{money(r.amount_due)}</span>
                    : <span className="text-slate-500 text-xs">{money(r.base)} {r.carry !== 0 && <>{r.carry < 0 ? 'âˆ’' : '+'} {money(Math.abs(r.carry))}</>} = <span className="font-semibold text-slate-900">{money(r.amount_due)}</span></span>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setGenOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={generate} loading={saving} disabled={!genPeriod.trim()}>{t('dues.generate')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

