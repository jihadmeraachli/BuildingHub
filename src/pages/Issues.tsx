import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import { Plus, Image } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Issue, IssueStatus, IssuePriority, Building } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

const priorityColor: Record<IssuePriority, 'slate' | 'yellow' | 'red'> = {
  low: 'slate', medium: 'yellow', urgent: 'red',
};
const statusColor: Record<IssueStatus, 'orange' | 'blue' | 'green'> = {
  open: 'orange', in_progress: 'blue', resolved: 'green',
};

export default function Issues() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [myOnly, setMyOnly] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [units, setUnits] = useState<{ id: string; label: string }[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>('all');

  const isAdmin = profile?.role === 'building_admin' || profile?.role === 'super_admin';
  const isSuperAdmin = profile?.role === 'super_admin';
  const activeBuildingId = isSuperAdmin ? selectedBuildingId : (profile?.building_id ?? '');

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{
    title: string; description: string; location: string; priority: IssuePriority; apartment_number: string; photos: FileList;
  }>();

  const { register: registerUpdate, handleSubmit: handleUpdate, setValue } = useForm<{
    status: IssueStatus; resolution_notes: string;
  }>();

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from('buildings').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setBuildings(data ?? []));
  }, [isSuperAdmin]);

  useEffect(() => {
    if (activeBuildingId) loadIssues(); else setIssues([]);
  }, [activeBuildingId, myOnly, statusFilter]);

  useEffect(() => {
    if (!activeBuildingId) { setUnits([]); return; }
    supabase.from('units').select('id, label').eq('building_id', activeBuildingId).order('label')
      .then(({ data }) => setUnits((data as { id: string; label: string }[]) ?? []));
  }, [activeBuildingId]);

  async function loadIssues() {
    if (!activeBuildingId) return;
    setLoading(true);
    let q = supabase.from('issues').select('*, reporter:profiles(full_name, apartment_number)')
      .eq('building_id', activeBuildingId);
    if (myOnly || profile?.role === 'resident') q = q.eq('reported_by', profile?.id);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    q = q.order('created_at', { ascending: false });
    const { data } = await q;
    setIssues((data as Issue[]) ?? []);
    setLoading(false);
  }

  async function onSubmit(data: { title: string; description: string; location: string; priority: IssuePriority; apartment_number: string; photos: FileList }) {
    const photoUrls: string[] = [];
    if (data.photos?.length) {
      for (const file of Array.from(data.photos)) {
        const path = `${activeBuildingId}/issues/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('attachments').upload(path, file);
        if (!error) {
          const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path);
          photoUrls.push(urlData.publicUrl);
        }
      }
    }
    const payload: Record<string, unknown> = {
      building_id: activeBuildingId,
      reported_by: profile?.id,
      title: data.title,
      description: data.description,
      location: data.location,
      priority: data.priority,
      photo_urls: photoUrls,
    };
    if (data.apartment_number?.trim()) payload.apartment_number = data.apartment_number.trim();
    const { error } = await supabase.from('issues').insert(payload);
    if (error) { alert(`Could not log issue: ${error.message}`); return; }
    setModalOpen(false); reset(); loadIssues();
  }

  async function onUpdateStatus(data: { status: IssueStatus; resolution_notes: string }) {
    if (!selectedIssue) return;
    await supabase.from('issues').update({
      status: data.status,
      resolution_notes: data.resolution_notes,
      resolved_at: data.status === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', selectedIssue.id);
    setSelectedIssue(null);
    loadIssues();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('issues.title')}</h1>
        <div className="flex items-center gap-2">
          {isAdmin && activeBuildingId && (
            <button
              onClick={() => setMyOnly(!myOnly)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition cursor-pointer ${myOnly ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
            >
              {myOnly ? t('issues.allIssues') : t('issues.myIssues')}
            </button>
          )}
          {activeBuildingId && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'open' | 'in_progress' | 'resolved')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <option value="all">{t('issues.allIssues')}</option>
              <option value="open">{t('issues.statuses.open')}</option>
              <option value="in_progress">{t('issues.statuses.in_progress')}</option>
              <option value="resolved">{t('issues.statuses.resolved')}</option>
            </select>
          )}
          {activeBuildingId && (
            <Button onClick={() => setModalOpen(true)}>
              <Plus size={16} /> {t('issues.logIssue')}
            </Button>
          )}
        </div>
      </div>

      {/* Super admin: building selector */}
      {isSuperAdmin && (
        <div className="mb-4">
          <select
            value={selectedBuildingId}
            onChange={e => { setSelectedBuildingId(e.target.value); setMyOnly(false); }}
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
          <p className="text-sm text-slate-500 text-center py-8">Select a building above to view its issues.</p>
        </CardBody></Card>
      ) : loading ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : issues.length === 0 ? (
        <Card><CardBody><p className="text-sm text-slate-500 text-center py-8">{t('issues.noIssues')}</p></CardBody></Card>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => (
            <Card key={issue.id}>
              <CardBody>
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
                      {issue.apartment_number && <><span>•</span><span>Apt {issue.apartment_number}</span></>}
                      <span>•</span>
                      <span>{t('issues.reportedBy')}: {issue.reporter?.full_name} ({issue.reporter?.apartment_number})</span>
                      <span>•</span>
                      <span>{format(new Date(issue.created_at), 'MMM d, yyyy')}</span>
                      {issue.photo_urls?.length > 0 && (
                        <><span>•</span><span className="flex items-center gap-0.5"><Image size={11} /> {issue.photo_urls.length}</span></>
                      )}
                    </div>
                    {issue.resolution_notes && (
                      <p className="mt-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{issue.resolution_notes}</p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button size="sm" variant="secondary" onClick={() => { setSelectedIssue(issue); setValue('status', issue.status); setValue('resolution_notes', issue.resolution_notes ?? ''); }}>
                      {t('issues.updateStatus')}
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('issues.logIssue')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label={t('issues.issueTitle')} {...register('title', { required: true })} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('issues.description')}</label>
            <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" {...register('description', { required: true })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('issues.location')} {...register('location', { required: true })} />
            {units.length > 0 && (
              <Select label={t('billing.apartment')} {...register('apartment_number')}>
                <option value="">—</option>
                {units.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
              </Select>
            )}
          </div>
          <Select label={t('issues.priority')} {...register('priority', { required: true })}>
            <option value="low">{t('issues.priorities.low')}</option>
            <option value="medium">{t('issues.priorities.medium')}</option>
            <option value="urgent">{t('issues.priorities.urgent')}</option>
          </Select>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('issues.photos')}</label>
            <input type="file" accept="image/*" multiple className="text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-sm file:bg-white file:cursor-pointer" {...register('photos')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.submit')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selectedIssue} onClose={() => setSelectedIssue(null)} title={t('issues.updateStatus')} size="sm">
        <form onSubmit={handleUpdate(onUpdateStatus)} className="space-y-4">
          <Select label={t('issues.status')} {...registerUpdate('status')}>
            <option value="open">{t('issues.statuses.open')}</option>
            <option value="in_progress">{t('issues.statuses.in_progress')}</option>
            <option value="resolved">{t('issues.statuses.resolved')}</option>
          </Select>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('issues.resolutionNotes')}</label>
            <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" {...registerUpdate('resolution_notes')} />
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
