import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, PackageSearch, Camera, Trash2, CheckCheck } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { uploadFile, getSignedUrl } from '@/lib/upload';
import { useConfirm } from '@/lib/useConfirm';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

// 0154: anyone in the building posts a found item (photo straight from the
// camera); every member is notified; any member can claim it through the
// sealed RPC. Everyone sees "claimed" - managers also see BY WHOM.

interface LostItem {
  id: string; building_id: string; title: string; description: string | null;
  photo_url: string | null; found_where: string | null;
  status: 'open' | 'claimed' | 'returned';
  created_by: string | null; created_at: string;
  claimed_by: string | null; claimed_at: string | null;
}

const statusColor: Record<LostItem['status'], 'orange' | 'slate' | 'green'> = {
  open: 'orange', claimed: 'slate', returned: 'green',
};

export default function LostFound() {
  const { t } = useTranslation();
  const { user, can, canAny, isPlatformAdmin, residentLens } = useAuth();
  const { buildings: viewable } = useViewableBuildings();
  const { confirmAsync, ConfirmDialog } = useConfirm();

  const [items, setItems] = useState<LostItem[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ building_id: '', title: '', found_where: '', description: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<LostItem | null>(null);
  const [preview, setPreview] = useState<string>('');

  const buildingName = useMemo(
    () => Object.fromEntries(viewable.map(b => [b.id, b.name])) as Record<string, string>,
    [viewable],
  );
  const idsKey = viewable.map(b => b.id).sort().join(',');
  // managers see WHO claimed; residents only see "claimed"
  const isManagerAnywhere = (isPlatformAdmin || canAny('issue.update')) && !residentLens;
  const canManageItem = (i: LostItem) => (isPlatformAdmin || can('issue.update', i.building_id)) && !residentLens;

  async function load() {
    const ids = idsKey ? idsKey.split(',') : [];
    if (!ids.length) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('lost_items').select('*')
      .in('building_id', ids).order('created_at', { ascending: false });
    const rows = (data ?? []) as LostItem[];
    setItems(rows);
    // 0105 scoped the bucket - raw public URLs 400 now; sign like AttachmentLink
    const signed: Record<string, string> = {};
    await Promise.all(rows.filter(r => r.photo_url).map(async r => {
      signed[r.id] = await getSignedUrl(r.photo_url as string);
    }));
    setPhotos(signed);
    // names for "reported by" (everyone); RLS decides what resolves
    const uids = [...new Set(rows.flatMap(r => [r.claimed_by, r.created_by]).filter(Boolean))] as string[];
    if (uids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', uids);
      setNames(Object.fromEntries(((profs ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name ?? ''])));
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idsKey]);

  function openReport() {
    setForm({ building_id: viewable[0]?.id ?? '', title: '', found_where: '', description: '' });
    setPhoto(null); setPreview('');
    setOpen(true);
  }
  function onPickPhoto(f: File | null) {
    setPhoto(f);
    setPreview(prev => { if (prev) URL.revokeObjectURL(prev); return f ? URL.createObjectURL(f) : ''; });
  }

  async function submit() {
    if (!form.building_id || !form.title.trim() || !user) return;
    setSaving(true);
    const photo_url = photo ? await uploadFile('attachments', `${form.building_id}/lostfound`, photo) : null;
    const { error } = await supabase.from('lost_items').insert({
      building_id: form.building_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      found_where: form.found_where.trim() || null,
      photo_url,
      created_by: user.id,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('lostfound.posted'));
    setOpen(false); load();
  }

  async function claim(item: LostItem) {
    if (!(await confirmAsync(t('lostfound.claimTitle'), t('lostfound.claimBody', { title: item.title })))) return;
    const { error } = await supabase.rpc('claim_lost_item', { p_item: item.id });
    if (error) { toast.error(error.message); return; }
    toast.success(t('lostfound.claimed'));
    load();
  }
  async function markReturned(item: LostItem) {
    const { error } = await supabase.from('lost_items').update({ status: 'returned' }).eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('lostfound.returnedDone'));
    load();
  }
  async function remove(item: LostItem) {
    if (!(await confirmAsync(t('common.delete'), t('lostfound.deleteBody', { title: item.title })))) return;
    const { error } = await supabase.from('lost_items').delete().eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('lostfound.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('lostfound.subtitle')}</p>
        </div>
        {viewable.length > 0 && (
          <Button onClick={openReport}><Plus size={15} /> {t('lostfound.report')}</Button>
        )}
      </div>

      {loading ? <SkeletonCards count={3} /> : items.length === 0 ? (
        <Card><CardBody>
          <div className="text-center py-10 text-muted-foreground">
            <PackageSearch size={28} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">{t('lostfound.empty')}</p>
          </div>
        </CardBody></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(item => (
            <Card key={item.id} className={`cursor-pointer hover:bg-primary/5 transition-colors ${item.status !== 'open' ? 'opacity-80' : ''}`} onClick={() => setDetail(item)}>
              {item.photo_url && photos[item.id] ? (
                <img src={photos[item.id]} alt={item.title} className="w-full h-44 object-cover rounded-t-xl" />
              ) : (
                <div className="w-full h-44 rounded-t-xl bg-secondary flex items-center justify-center">
                  <PackageSearch size={32} className="text-muted-foreground/40" />
                </div>
              )}
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <Badge variant={statusColor[item.status]}>{t(`lostfound.status_${item.status}`)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {viewable.length > 1 && <>{buildingName[item.building_id] ?? ''} · </>}
                  {item.found_where && <>{item.found_where} · </>}
                  {fmtDate(item.created_at)}
                  {item.created_by && names[item.created_by] && <> · {t('lostfound.reportedBy', { name: names[item.created_by] })}</>}
                </p>
                {item.description && <p className="text-sm text-muted-foreground mt-2">{item.description}</p>}
                {/* managers see who claimed; residents only that it is claimed */}
                {item.claimed_by && canManageItem(item) && (
                  <p className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                    {t('lostfound.claimedBy', { name: names[item.claimed_by] || '—' })}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                  {item.status === 'open' && (
                    <Button size="sm" variant="outline" onClick={() => claim(item)}>{t('lostfound.thisIsMine')}</Button>
                  )}
                  {item.status === 'claimed' && canManageItem(item) && (
                    <Button size="sm" variant="ghost" onClick={() => markReturned(item)}>
                      <CheckCheck size={14} /> {t('lostfound.markReturned')}
                    </Button>
                  )}
                  {canManageItem(item) && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ms-auto" onClick={() => remove(item)}>
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''} size="lg">
        {detail && (
          <div className="space-y-4">
            {detail.photo_url && photos[detail.id] && (
              <img src={photos[detail.id]} alt={detail.title} className="w-full max-h-96 object-contain rounded-xl bg-secondary" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusColor[detail.status]}>{t(`lostfound.status_${detail.status}`)}</Badge>
              <span className="text-xs text-muted-foreground">
                {viewable.length > 1 && <>{buildingName[detail.building_id] ?? ''} · </>}
                {detail.found_where && <>{detail.found_where} · </>}
                {fmtDate(detail.created_at)}
                {detail.created_by && names[detail.created_by] && <> · {t('lostfound.reportedBy', { name: names[detail.created_by] })}</>}
              </span>
            </div>
            {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}
            {detail.claimed_by && canManageItem(detail) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('lostfound.claimedBy', { name: names[detail.claimed_by] || '—' })}</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              {detail.status === 'open' && (
                <Button size="sm" variant="outline" onClick={() => { claim(detail); setDetail(null); }}>{t('lostfound.thisIsMine')}</Button>
              )}
              {detail.status === 'claimed' && canManageItem(detail) && (
                <Button size="sm" variant="ghost" onClick={() => { markReturned(detail); setDetail(null); }}>
                  <CheckCheck size={14} /> {t('lostfound.markReturned')}
                </Button>
              )}
              {canManageItem(detail) && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ms-auto" onClick={() => { remove(detail); setDetail(null); }}>
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={t('lostfound.reportTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('lostfound.reportHint')}</p>
          {viewable.length > 1 && (
            <SelectField label={t('lostfound.building')} value={form.building_id} onValueChange={v => setForm({ ...form, building_id: v })}>
              {viewable.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          )}
          <Input label={t('lostfound.itemTitle')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t('lostfound.itemTitleExample')} />
          <Input label={t('lostfound.foundWhere')} value={form.found_where} onChange={e => setForm({ ...form, found_where: e.target.value })} placeholder={t('lostfound.foundWhereExample')} />
          <Input label={t('lostfound.description')} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t('lostfound.photo')}</label>
            <label className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground cursor-pointer hover:border-primary/50">
              <Camera size={16} className="text-primary/70" />
              {photo ? photo.name : t('lostfound.photoHint')}
              {/* capture="environment": on a phone this opens the camera directly */}
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => onPickPhoto(e.target.files?.[0] ?? null)} />
            </label>
            {preview && <img src={preview} alt="" className="mt-2 h-32 rounded-lg object-cover" />}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={submit} loading={saving} disabled={!form.title.trim() || !form.building_id}>{t('lostfound.post')}</Button>
          </div>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
