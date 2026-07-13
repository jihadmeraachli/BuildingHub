import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import { Plus, Download, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { BillingEntry, BillingCategory, Building } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/ui/Skeleton';

const CATEGORIES: BillingCategory[] = ['water', 'electricity', 'common_expenses', 'projects', 'contracts'];

export default function Billing() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [entries, setEntries] = useState<BillingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');

  const isAdmin = profile?.role === 'building_admin' || profile?.role === 'super_admin';
  const isSuperAdmin = profile?.role === 'super_admin';
  const activeBuildingId = isSuperAdmin ? selectedBuildingId : (profile?.building_id ?? '');

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{
    category: BillingCategory; description: string; amount_usd: number;
    due_date: string; apartment_number: string; invoice: FileList;
  }>();

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from('buildings').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setBuildings(data ?? []));
  }, [isSuperAdmin]);

  useEffect(() => {
    if (activeBuildingId) loadEntries(); else setEntries([]);
  }, [activeBuildingId, categoryFilter, statusFilter]);

  async function loadEntries() {
    if (!activeBuildingId) return;
    setLoading(true);
    let q = supabase.from('billing_entries').select('*').eq('building_id', activeBuildingId);
    if (categoryFilter !== 'all') q = q.eq('category', categoryFilter);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    if (profile?.role === 'resident') q = q.eq('apartment_number', profile.apartment_number ?? '');
    q = q.order('created_at', { ascending: false });
    const { data } = await q;
    setEntries(data ?? []);
    setLoading(false);
  }

  async function onSubmit(data: { category: BillingCategory; description: string; amount_usd: number; due_date: string; apartment_number: string; invoice: FileList }) {
    setUploading(true);
    let invoice_url: string | null = null;

    if (data.invoice?.[0]) {
      const file = data.invoice[0];
      const path = `${activeBuildingId}/billing/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from('invoices').upload(path, file);
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('invoices').getPublicUrl(path);
        invoice_url = urlData.publicUrl;
      }
    }

    setUploading(false);
    const { error } = await supabase.from('billing_entries').insert({
      building_id: activeBuildingId,
      category: data.category,
      description: data.description,
      amount_usd: Number(data.amount_usd),
      due_date: data.due_date || null,
      apartment_number: data.apartment_number || null,
      invoice_url,
      created_by: profile?.id,
    });

    if (!error) { setModalOpen(false); reset(); loadEntries(); }
  }

  async function markPaid(id: string) {
    await supabase.from('billing_entries').update({ status: 'paid' }).eq('id', id);
    toast.success(t('billing.markedPaid'));
    loadEntries();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('billing.title')}</h1>
        {isAdmin && activeBuildingId && (
          <Button onClick={() => setModalOpen(true)}>
            <Plus size={16} /> {t('billing.addEntry')}
          </Button>
        )}
      </div>

      {/* Super admin: building selector */}
      {isSuperAdmin && (
        <div className="mb-4">
          <select
            value={selectedBuildingId}
            onChange={e => setSelectedBuildingId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[240px]"
          >
            <option value="">— Select a building —</option>
            {buildings.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.city})</option>
            ))}
          </select>
        </div>
      )}

      {!activeBuildingId ? (
        <Card><CardBody>
          <p className="text-sm text-slate-500 text-center py-8">Select a building above to view its billing entries.</p>
        </CardBody></Card>
      ) : (<>
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t('billing.category')}: All</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{t(`billing.categories.${c}`)}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">{t('billing.status')}: All</option>
            <option value="unpaid">{t('billing.unpaid')}</option>
            <option value="paid">{t('billing.paid')}</option>
          </select>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : entries.length === 0 ? (
          <Card><CardBody><p className="text-sm text-slate-500 text-center py-8">{t('billing.noEntries')}</p></CardBody></Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-start font-medium">{t('billing.description')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('billing.category')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('billing.amount')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('billing.dueDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('billing.status')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-900 font-medium">
                        {e.description}
                        {e.apartment_number && <span className="text-xs text-slate-400 ms-1.5">({e.apartment_number})</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t(`billing.categories.${e.category}`)}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">${Number(e.amount_usd).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-500">{e.due_date ? format(new Date(e.due_date), 'MMM d, yyyy') : '—'}</td>
                      <td className="px-4 py-3">
                        <Badge color={e.status === 'paid' ? 'green' : 'red'}>
                          {t(`billing.${e.status}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {e.invoice_url && (
                            <a href={e.invoice_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 transition" title={t('billing.viewInvoice')}>
                              <FileText size={16} />
                            </a>
                          )}
                          {e.invoice_url && (
                            <a href={e.invoice_url} download className="text-slate-500 hover:text-slate-800 transition" title={t('common.download')}>
                              <Download size={16} />
                            </a>
                          )}
                          {isAdmin && e.status === 'unpaid' && (
                            <Button size="sm" variant="ghost" onClick={() => markPaid(e.id)}>{t('billing.markPaid')}</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </>)}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('billing.addEntry')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Select label={t('billing.category')} {...register('category', { required: true })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{t(`billing.categories.${c}`)}</option>)}
          </Select>
          <Input label={t('billing.description')} {...register('description', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('billing.amount')} type="number" step="0.01" min="0" {...register('amount_usd', { required: true })} />
            <Input label={t('billing.dueDate')} type="date" {...register('due_date')} />
          </div>
          <Input label={`${t('billing.apartment')} (optional)`} {...register('apartment_number')} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('billing.invoice')}</label>
            <input type="file" accept="application/pdf,image/*" className="text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-sm file:bg-white file:cursor-pointer" {...register('invoice')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting || uploading}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
