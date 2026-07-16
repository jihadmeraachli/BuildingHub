import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { format } from 'date-fns';
import { Plus, Image } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { Issue, IssueStatus, IssuePriority } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

const priorityColor: Record<IssuePriority, 'slate' | 'yellow' | 'red'> = { low: 'slate', medium: 'yellow', urgent: 'red' };
const statusColor: Record<IssueStatus, 'orange' | 'blue' | 'green'> = { open: 'orange', in_progress: 'blue', resolved: 'green' };

export default function Issues() {
  const { t } = useTranslation();
  const { profile, canAny, isPlatformAdmin } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);

  const isManager = isPlatformAdmin || canAny('issue.view_all');

  const [entityKey, setEntityKey] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  useEffect(() => { setBlockFilter(''); }, [entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const effectiveBuildingIds = useMemo(() => (entity ? (blockFilter ? [blockFilter] : entity.buildingIds) : []), [entity, blockFilter]);
  const idsKey = effectiveBuildingIds.join(',');
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [myOnly, setMyOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');
  const [createBuildingId, setCreateBuildingId] = useState('');
  const [units, setUnits] = useState<{ id: string; label: string }[]>([]);

  const { register, handleSubmit, reset, control, formState: { isSubmitting } } = useForm<{
    title: string; description: string; location: string; priority: IssuePriority; apartment_number: string; photos: FileList;
  }>();
  const { register: registerUpdate, handleSubmit: handleUpdate, setValue, control: controlUpdate } = useForm<{ status: IssueStatus; resolution_notes: string }>();

  useEffect(() => { if (effectiveBuildingIds.length) loadIssues(); else setIssues([]); }, [idsKey, myOnly, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // units for the create modal (depends on chosen block)
  useEffect(() => {
    const bid = createBuildingId || (entity?.kind === 'building' ? entity.id : (blockFilter || ''));
    if (!bid) { setUnits([]); return; }
    supabase.from('units').select('id, label').eq('building_id', bid).order('label').then(({ data }) => setUnits((data as { id: string; label: string }[]) ?? []));
  }, [createBuildingId, entityKey, blockFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadIssues() {
    setLoading(true);
    let q = supabase.from('issues').select('*, reporter:profiles(full_name, apartment_number)').in('building_id', effectiveBuildingIds);
    if (myOnly) q = q.eq('reported_by', profile?.id);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data } = await q.order('created_at', { ascending: false });
    setIssues((data as Issue[]) ?? []);
    setLoading(false);
  }

  function openCreate() {
    const def = blockFilter || (entity?.kind === 'building' ? entity.id : (entity?.blocks[0]?.id ?? ''));
    setCreateBuildingId(def);
    setModalOpen(true);
  }

  async function onSubmit(data: { title: string; description: string; location: string; priority: IssuePriority; apartment_number: string; photos: FileList }) {
    const buildingId = createBuildingId;
    if (!buildingId) { toast.error('Pick a building/block'); return; }
    const photoUrls: string[] = [];
    if (data.photos?.length) {
      for (const file of Array.from(data.photos)) {
        const path = `${buildingId}/issues/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('attachments').upload(path, file);
        if (!error) photoUrls.push(supabase.storage.from('attachments').getPublicUrl(path).data.publicUrl);
      }
    }
    const payload: Record<string, unknown> = {
      building_id: buildingId, reported_by: profile?.id, title: data.title, description: data.description,
      location: data.location, priority: data.priority, photo_urls: photoUrls,
    };
    if (data.apartment_number?.trim()) payload.apartment_number = data.apartment_number.trim();
    const { error } = await supabase.from('issues').insert(payload);
    if (error) { toast.error(`Could not log issue: ${error.message}`); return; }
    toast.success(t('issues.issueLogged'));
    setModalOpen(false); reset(); loadIssues();
  }

  async function onUpdateStatus(data: { status: IssueStatus; resolution_notes: string }) {
    if (!selectedIssue) return;
    await supabase.from('issues').update({
      status: data.status, resolution_notes: data.resolution_notes,
      resolved_at: data.status === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', selectedIssue.id);
    toast.success(t('issues.statusUpdated'));
    setSelectedIssue(null); loadIssues();
  }

  const blockOptions = entity?.blocks ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('issues.title')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 1 && (
            <RadixSelect value={entityKey} onValueChange={setEntityKey}>
              <SelectTrigger className="min-w-[160px]">
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
          {isManager && (
            <button onClick={() => setMyOnly(!myOnly)} className={`text-sm px-3 py-1.5 rounded-xl border transition cursor-pointer ${myOnly ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}>
              {myOnly ? t('issues.allIssues') : t('issues.myIssues')}
            </button>
          )}
          <RadixSelect value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'open' | 'in_progress' | 'resolved')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('issues.allIssues')}</SelectItem>
              <SelectItem value="open">{t('issues.statuses.open')}</SelectItem>
              <SelectItem value="in_progress">{t('issues.statuses.in_progress')}</SelectItem>
              <SelectItem value="resolved">{t('issues.statuses.resolved')}</SelectItem>
            </SelectContent>
          </RadixSelect>
          {entity && <Button onClick={openCreate}><Plus size={16} /> {t('issues.logIssue')}</Button>}
        </div>
      </div>

      {!entity ? (
        <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('finance.noBuildings')}</p></CardBody></Card>
      ) : loading ? <SkeletonCards count={3} />
        : issues.length === 0 ? <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('issues.noIssues')}</p></CardBody></Card>
        : (
          <div className="space-y-3">
            {issues.map((issue) => (
              <Card key={issue.id}><CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-medium text-slate-900">{issue.title}</h3>
                      <Badge color={priorityColor[issue.priority]}>{t(`issues.priorities.${issue.priority}`)}</Badge>
                      <Badge color={statusColor[issue.status]}>{t(`issues.statuses.${issue.status}`)}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 mb-2">{issue.description}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>{issue.location}</span>
                      {multiBlock && <><span>â€¢</span><span>{blockName[issue.building_id]}</span></>}
                      {issue.apartment_number && <><span>â€¢</span><span>Apt {issue.apartment_number}</span></>}
                      <span>â€¢</span>
                      <span>{t('issues.reportedBy')}: {issue.reporter?.full_name} ({issue.reporter?.apartment_number})</span>
                      <span>â€¢</span>
                      <span>{format(new Date(issue.created_at), 'MMM d, yyyy')}</span>
                      {issue.photo_urls?.length > 0 && <><span>â€¢</span><span className="flex items-center gap-0.5"><Image size={11} /> {issue.photo_urls.length}</span></>}
                    </div>
                    {issue.resolution_notes && <p className="mt-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{issue.resolution_notes}</p>}
                  </div>
                  {isManager && (
                    <Button size="sm" variant="secondary" onClick={() => { setSelectedIssue(issue); setValue('status', issue.status); setValue('resolution_notes', issue.resolution_notes ?? ''); }}>
                      {t('issues.updateStatus')}
                    </Button>
                  )}
                </div>
              </CardBody></Card>
            ))}
          </div>
        )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('issues.logIssue')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {blockOptions.length > 1 && (
            <SelectField label={t('finance.block')} value={createBuildingId} onValueChange={setCreateBuildingId}>
              {blockOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          )}
          <Input label={t('issues.issueTitle')} {...register('title', { required: true })} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('issues.description')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[80px]" {...register('description', { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('issues.location')} {...register('location', { required: true })} />
            {units.length > 0 && (
              <Controller name="apartment_number" control={control} render={({ field }) => (
                <SelectField label={t('billing.apartment')} value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
                  <SelectItem value="__none__">&#8212;</SelectItem>
                  {units.map((u) => <SelectItem key={u.id} value={u.label}>{u.label}</SelectItem>)}
                </SelectField>
              )} />
            )}
          </div>
          <Controller name="priority" control={control} rules={{ required: true }} render={({ field }) => (
            <SelectField label={t('issues.priority')} value={field.value ?? 'low'} onValueChange={field.onChange}>
              <SelectItem value="low">{t('issues.priorities.low')}</SelectItem>
              <SelectItem value="medium">{t('issues.priorities.medium')}</SelectItem>
              <SelectItem value="urgent">{t('issues.priorities.urgent')}</SelectItem>
            </SelectField>
          )} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('issues.photos')}</label>
            <input type="file" accept="image/*" multiple className="text-sm text-muted-foreground file:me-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" {...register('photos')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.submit')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selectedIssue} onClose={() => setSelectedIssue(null)} title={t('issues.updateStatus')} size="sm">
        <form onSubmit={handleUpdate(onUpdateStatus)} className="space-y-4">
          <Controller name="status" control={controlUpdate} render={({ field }) => (
            <SelectField label={t('issues.status')} value={field.value ?? 'open'} onValueChange={field.onChange}>
              <SelectItem value="open">{t('issues.statuses.open')}</SelectItem>
              <SelectItem value="in_progress">{t('issues.statuses.in_progress')}</SelectItem>
              <SelectItem value="resolved">{t('issues.statuses.resolved')}</SelectItem>
            </SelectField>
          )} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('issues.resolutionNotes')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[80px]" {...registerUpdate('resolution_notes')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setSelectedIssue(null)}>{t('common.cancel')}</Button>
            <Button type="submit">{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
