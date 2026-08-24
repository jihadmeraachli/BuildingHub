import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { HandCoins, Paperclip } from 'lucide-react';
import { fmtDate } from '@/lib/dateFmt';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { composeUsdTotal, currencyTag } from '@/lib/currency';
import { fmtMoney } from '@/lib/money';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import type { Building, Unit, Payment, PaymentMethod } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';

/**
 * Collect (0110) — the collector's only screen. Pick a unit, write the
 * receipt, see what you wrote. No balances, no book, no other receipts: RLS
 * gives a collector the units and their own payments, nothing more, so this
 * page could not show anything else even if it tried.
 *
 * Managers can use it too as a quick cash screen; it is just Finance's
 * Record-payment modal with everything else taken away.
 */
const METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'cheque', 'other'];
const money = (n: number) => fmtMoney(n);
const today = () => new Date().toISOString().slice(0, 10);

export default function Collect() {
  const { t } = useTranslation();
  const { profile, canAny, manageableBuildingIds, isPlatformAdmin } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [mine, setMine] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [buildingId, setBuildingId] = useState('');
  const [form, setForm] = useState({ unit_id: '', amount: '', amount_lbp: '', lbp_rate: '', method: 'cash' as PaymentMethod, paid_on: today(), note: '' });
  const [file, setFile] = useState<File | null>(null);

  const allowed = isPlatformAdmin || canAny('payment.record');

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      setLoading(true);
      const q = isPlatformAdmin
        ? supabase.from('buildings').select('*').eq('is_active', true).order('name')
        : supabase.from('buildings').select('*').in('id', manageableBuildingIds.length ? manageableBuildingIds : ['00000000-0000-0000-0000-000000000000']).order('name');
      const { data: b } = await q;
      const list = (b as Building[]) ?? [];
      setBuildings(list);
      setBuildingId((cur) => cur || list[0]?.id || '');
      setLoading(false);
    })();
  }, [allowed, isPlatformAdmin, manageableBuildingIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!buildingId) return;
    (async () => {
      const [{ data: u }, { data: p }] = await Promise.all([
        supabase.from('units').select('*').eq('building_id', buildingId).order('label'),
        // RLS: a collector gets only the rows they recorded
        supabase.from('payments').select('*').eq('building_id', buildingId).eq('recorded_by', profile?.id ?? '').is('voided_at', null)
          .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      ]);
      setUnits((u as Unit[]) ?? []);
      setMine((p as Payment[]) ?? []);
      const rate = (buildings.find((x) => x.id === buildingId)?.lbp_rate ?? null);
      setForm((f) => ({ ...f, unit_id: '', lbp_rate: rate ? String(rate) : f.lbp_rate }));
    })();
  }, [buildingId, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitLabel = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u.label])), [units]);
  const todayTotal = mine.filter((p) => p.paid_on === today()).reduce((s, p) => s + Number(p.amount_usd), 0);

  async function save() {
    const lbpPart = Number(form.amount_lbp) || 0;
    const rate = Number(form.lbp_rate) || 0;
    if (lbpPart > 0 && rate <= 0) { toast.error(t('finance.lbpNeedsRate')); return; }
    const amount = composeUsdTotal(Number(form.amount) || 0, lbpPart, rate);
    if (!form.unit_id || !(amount > 0)) return;
    setSaving(true);
    const receipt_url = file ? await uploadFile('attachments', `${form.unit_id}/payments`, file) : null;
    // A collector cannot see tenancies, so a receipt lands on the owner's
    // ledger; finance can move it to the tenant afterwards if that is who paid.
    const { error } = await supabase.from('payments').insert({
      unit_id: form.unit_id, building_id: buildingId, amount_usd: amount,
      amount_lbp: lbpPart > 0 ? lbpPart : null, lbp_rate: lbpPart > 0 ? rate : null,
      method: form.method, paid_on: form.paid_on, note: form.note.trim() || null,
      paid_by: 'owner', receipt_url, recorded_by: profile?.id,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('collect.saved', { unit: unitLabel[form.unit_id] ?? '', amount: money(amount) }));
    setForm((f) => ({ ...f, unit_id: '', amount: '', amount_lbp: '', note: '' })); setFile(null);
    const { data: p } = await supabase.from('payments').select('*').eq('building_id', buildingId).eq('recorded_by', profile?.id ?? '').is('voided_at', null)
      .order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    setMine((p as Payment[]) ?? []);
  }

  if (!allowed) return <Navigate to="/dashboard" replace />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('collect.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('collect.subtitle')}</p>
        </div>
        {buildings.length > 1 && (
          <div className="w-56">
            <SelectField label={t('finance.block')} value={buildingId} onValueChange={setBuildingId}>
              {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          </div>
        )}
      </div>

      {loading ? <SkeletonTable rows={4} cols={3} /> : (
        <div className="grid lg:grid-cols-5 gap-4">
          <Card className="lg:col-span-2"><CardBody>
            <p className="font-semibold text-foreground mb-3 inline-flex items-center gap-2"><HandCoins size={16} className="text-primary" /> {t('collect.record')}</p>
            <div className="space-y-3">
              <SelectField label={t('finance.unit')} value={form.unit_id || '__none__'} onValueChange={(v) => setForm({ ...form, unit_id: v === '__none__' ? '' : v })}>
                <SelectItem value="__none__">—</SelectItem>
                {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}
              </SelectField>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('finance.amountUsd')} type="number" step="0.01" min="0" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <Input label={t('finance.date')} type="date" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('finance.amountLbp')} type="number" step="1" min="0" inputMode="numeric" value={form.amount_lbp} onChange={(e) => setForm({ ...form, amount_lbp: e.target.value })} />
                <Input label={t('finance.lbpRate')} type="number" step="1" min="0" value={form.lbp_rate} onChange={(e) => setForm({ ...form, lbp_rate: e.target.value })} />
              </div>
              <SelectField label={t('finance.method')} value={form.method} onValueChange={(v) => setForm({ ...form, method: v as PaymentMethod })}>
                {METHODS.map((m) => <SelectItem key={m} value={m}>{t(`finance.methods.${m}`, { defaultValue: m.replace('_', ' ') })}</SelectItem>)}
              </SelectField>
              <Input label={t('finance.note')} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-muted-foreground">{t('collect.photo')}</label>
                <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
              </div>
              <Button onClick={save} loading={saving} disabled={!form.unit_id || !(Number(form.amount) > 0 || Number(form.amount_lbp) > 0)} className="w-full">
                <HandCoins size={16} /> {t('collect.save')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('collect.ownerNote')}</p>
            </div>
          </CardBody></Card>

          <Card className="lg:col-span-3">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <p className="font-semibold text-foreground">{t('collect.mine')}</p>
              <p className="text-sm text-muted-foreground">{t('collect.todayTotal', { amount: money(todayTotal) })}</p>
            </div>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">{t('collect.none')}</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 text-primary text-xs uppercase tracking-wide">
                  <th className="px-5 py-3 text-start font-medium">{t('finance.date')}</th>
                  <th className="px-5 py-3 text-start font-medium">{t('finance.unit')}</th>
                  <th className="px-5 py-3 text-start font-medium">{t('finance.method')}</th>
                  <th className="px-5 py-3 text-end font-medium">{t('finance.amount')}</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {mine.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-3 whitespace-nowrap text-foreground">{fmtDate(p.paid_on, 'MMM d, yyyy')}</td>
                      <td className="px-5 py-3 font-medium text-foreground">{unitLabel[p.unit_id] ?? '—'}{p.note && <span className="block text-xs text-muted-foreground font-normal">{p.note}</span>}</td>
                      <td className="px-5 py-3 text-muted-foreground">{t(`finance.methods.${p.method}`, { defaultValue: p.method.replace('_', ' ') })}{p.receipt_url && <AttachmentLink url={p.receipt_url} label="" icon={Paperclip} className="ms-2 inline-flex text-muted-foreground" />}</td>
                      <td className="px-5 py-3 text-end font-semibold tnum text-foreground">{currencyTag(p) && <span className="me-1.5 text-[10px] font-medium text-amber-600">{currencyTag(p)}</span>}{money(Number(p.amount_usd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
