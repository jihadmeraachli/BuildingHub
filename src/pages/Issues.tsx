import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, Image } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { isDemoEmail } from '@/lib/demo';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { Issue, IssueStatus, IssuePriority } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useAmenities, amenityLabel } from '@/lib/amenities';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

const priorityColor: Record<IssuePriority, 'slate' | 'yellow' | 'red'> = { low: 'slate', medium: 'yellow', urgent: 'red' };
const statusColor: Record<IssueStatus, 'orange' | 'blue' | 'green'> = { open: 'orange', in_progress: 'blue', resolved: 'green' };

/** Which language a free-text blob is (mostly) written in — Arabic script
 *  past ~30% of its letters means Arabic. */
function langOf(s: string): 'ar' | 'en' {
  const arabic = (s.match(/[؀-ۿ]/g) ?? []).length;
  const letters = s.replace(/[\s\d\p{P}]/gu, '').length || 1;
  return arabic / letters > 0.3 ? 'ar' : 'en';
}

export default function Issues() {
  const { t, i18n } = useTranslation();
  const { user, profile, canAny, isPlatformAdmin, residentLens, memberships, residentUnitId, manageableBuildingIds } = useAuth();
  const uiLang: 'ar' | 'en' = i18n.language.startsWith('ar') ? 'ar' : 'en';
  const isDemo = isDemoEmail(user?.email);
  const { buildings: viewable } = useViewableBuildings();

  // Dual-persona lens: an admin browsing "My home" sees only their own issues.
  const isManager = (isPlatformAdmin || canAny('issue.view_all')) && !residentLens;

  // Lens-scoping (#72): Managing shows only buildings the person MANAGES; a
  // building where they merely own an apartment belongs to the My-home lens.
  // useViewableBuildings unions both, so cut it down per lens here.
  const memberIds = useMemo(
    () => new Set(memberships.map((m) => m.unit?.building_id).filter(Boolean)),
    [memberships]);
  const buildings = useMemo(() => (
    isManager
      ? (isPlatformAdmin ? viewable : viewable.filter((b) => manageableBuildingIds.includes(b.id)))
      : viewable.filter((b) => memberIds.has(b.id))
  ), [isManager, isPlatformAdmin, viewable, manageableBuildingIds, memberIds]);
  const entities = useEntities(buildings);

  // Units the person belongs to (active memberships) — what they may log for.
  const myUnits = useMemo(() => {
    const seen = new Set<string>();
    return memberships
      .map((m) => m.unit)
      .filter((u): u is NonNullable<typeof u> => !!u && !seen.has(u.id) && (seen.add(u.id), true));
  }, [memberships]);

  // GLOBAL entity selection (sidebar). '' = across ALL viewable buildings —
  // issues aggregate cleanly, so no entity is required here.
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  useEffect(() => { setBlockFilter(''); }, [entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const multiBlock = entity ? entity.blocks.length > 1 : buildings.length > 1;
  const effectiveBuildingIds = useMemo(
    () => (entity ? (blockFilter ? [blockFilter] : entity.buildingIds) : (blockFilter ? [blockFilter] : buildings.map((b) => b.id))),
    [entity, blockFilter, buildings]);
  const idsKey = effectiveBuildingIds.join(',');
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [issueAmenityId, setIssueAmenityId] = useState('');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [myOnly, setMyOnly] = useState(false);
  // Deep-linkable: the dashboard's Open-issues card lands here pre-filtered.
  const urlStatus = new URLSearchParams(window.location.search).get('status');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved'>(
    urlStatus === 'open' || urlStatus === 'in_progress' || urlStatus === 'resolved' ? urlStatus : 'all');
  const [createBuildingId, setCreateBuildingId] = useState('');
  const [units, setUnits] = useState<{ id: string; label: string }[]>([]);

  // Per-issue description translation (MyMemory, free & keyless — good enough
  // for beta). Fetched once, then the button toggles translated <-> original.
  const [xl, setXl] = useState<Record<string, { text: string; shown: boolean }>>({});
  const [translating, setTranslating] = useState('');

  async function toggleTranslate(issue: Issue) {
    const cur = xl[issue.id];
    if (cur) { setXl((p) => ({ ...p, [issue.id]: { ...cur, shown: !cur.shown } })); return; }
    setTranslating(issue.id);
    try {
      const source = langOf(issue.description);
      // MyMemory caps q at ~500 bytes; Arabic is 2 bytes/char in UTF-8.
      const q = issue.description.slice(0, source === 'ar' ? 220 : 440);
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${source}|${uiLang}`);
      const j = await res.json();
      const text: string | undefined = j?.responseData?.translatedText;
      if (!res.ok || !text) throw new Error(j?.responseDetails ?? 'empty');
      setXl((p) => ({ ...p, [issue.id]: { text, shown: true } }));
    } catch {
      toast.error(t('issues.translationFailed'));
    } finally { setTranslating(''); }
  }

  // "Logging issue for" — the FIRST question (Jey's design): the common area,
  // or one of the reporter's own units. Managers pick any unit of the block.
  // Values: '__common__' (manager), 'c:<buildingId>' (resident common), '<unitId>'.
  const [loggingFor, setLoggingFor] = useState('__common__');

  const { register, handleSubmit, reset, control, formState: { isSubmitting } } = useForm<{
    title: string; description: string; location: string; priority: IssuePriority; photos: FileList;
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

  // Resident options: common area per building they live in + their units.
  const residentOptions = useMemo(() => {
    const bIds = [...new Set(myUnits.map((u) => u.building_id))];
    const multi = bIds.length > 1;
    const opts: { value: string; label: string }[] = bIds.map((bid) => ({
      value: `c:${bid}`,
      label: multi ? `${t('issues.commonArea')} · ${blockName[bid] ?? ''}` : t('issues.commonArea'),
    }));
    for (const u of myUnits) opts.push({ value: u.id, label: multi ? `${u.label} · ${blockName[u.building_id] ?? ''}` : u.label });
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUnits, buildings, t]);

  function openCreate() {
    setIssueAmenityId('');
    if (isManager) {
      const def = blockFilter || (entity?.kind === 'building' ? entity.id : (entity?.blocks[0]?.id ?? ''));
      setCreateBuildingId(def);
      setLoggingFor('__common__');
    } else {
      setLoggingFor(residentOptions[0]?.value ?? '');
    }
    setModalOpen(true);
  }

  const amenities = useAmenities(entity?.kind, entity?.id); // 0112: tag "the lift", "the generator"

  async function onSubmit(data: { title: string; description: string; location: string; priority: IssuePriority; photos: FileList }) {
    let buildingId = '';
    let unitId: string | null = null;
    let aptLabel = '';
    if (isManager) {
      buildingId = createBuildingId;
      if (loggingFor !== '__common__') {
        unitId = loggingFor;
        aptLabel = units.find((u) => u.id === loggingFor)?.label ?? '';
      }
    } else if (loggingFor.startsWith('c:')) {
      buildingId = loggingFor.slice(2);
    } else {
      const u = myUnits.find((x) => x.id === loggingFor);
      unitId = u?.id ?? null;
      buildingId = u?.building_id ?? '';
      aptLabel = u?.label ?? '';
    }
    if (!buildingId) { toast.error(t('issues.pickBuilding')); return; }
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
    // Omitted when null so common-area logging keeps working on a DB that has
    // not run 0074 yet (unknown column would reject the whole insert).
    if (unitId) payload.unit_id = unitId;
    if (aptLabel) payload.apartment_number = aptLabel;
    if (issueAmenityId) payload.amenity_id = issueAmenityId;
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

  // Create modal + block filter fall back to every viewable building in "All" mode.
  const blockOptions = entity?.blocks ?? buildings.map((b) => ({ id: b.id, name: b.name }));

  // My-home unit picker (sidebar): drill the list down to that unit's issues
  // plus its building's common-area issues.
  const vIssues = useMemo(() => {
    if (!residentLens || !residentUnitId) return issues;
    const ub = memberships.find((m) => m.unit_id === residentUnitId)?.unit?.building_id;
    return issues.filter((i) => i.unit_id === residentUnitId || (!i.unit_id && i.building_id === ub));
  }, [issues, residentLens, residentUnitId, memberships]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('issues.title')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity selection moved to the sidebar (global). Block drill-down stays local. */}
          {multiBlock && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={(v) => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {blockOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
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
          {!isDemo && (isManager ? !!entity : myUnits.length > 0) && <Button variant="tinted" onClick={openCreate}><Plus size={16} /> {t('issues.logIssue')}</Button>}
        </div>
      </div>

      {effectiveBuildingIds.length === 0 ? (
        <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('finance.noBuildings')}</p></CardBody></Card>
      ) : loading ? <SkeletonCards count={3} />
        : vIssues.length === 0 ? <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('issues.noIssues')}</p></CardBody></Card>
        : (
          <div className="space-y-3">
            {vIssues.map((issue) => (
              <Card key={issue.id}><CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-medium text-foreground">{issue.title}</h3>
                      <Badge color={priorityColor[issue.priority]}>{t(`issues.priorities.${issue.priority}`)}</Badge>
                      <Badge color={statusColor[issue.status]}>{t(`issues.statuses.${issue.status}`)}</Badge>
                    </div>
                    <div className="mb-2">
                      <p dir="auto" className="text-sm text-muted-foreground">{xl[issue.id]?.shown ? xl[issue.id].text : issue.description}</p>
                      {issue.description && langOf(issue.description) !== uiLang && (
                        <button
                          onClick={() => toggleTranslate(issue)}
                          disabled={translating === issue.id}
                          className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50 mt-0.5"
                        >
                          {translating === issue.id ? '…'
                            : xl[issue.id]?.shown ? t('issues.showOriginal')
                            : uiLang === 'ar' ? t('issues.translateAr') : t('issues.translateEn')}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{issue.location}</span>
                      {multiBlock && <><span>•</span><span>{blockName[issue.building_id]}</span></>}
                      <span>•</span>
                      <span>{issue.apartment_number ? `Apt ${issue.apartment_number}` : t('issues.commonArea')}</span>
                      <span>•</span>
                      <span>{t('issues.reportedBy')}: {issue.reporter?.full_name}{issue.reporter?.apartment_number ? ` (${issue.reporter.apartment_number})` : ''}</span>
                      <span>•</span>
                      <span>{fmtDate(issue.created_at, 'dd-MM-yyyy')}</span>
                      {issue.photo_urls?.length > 0 && <><span>•</span><span className="flex items-center gap-0.5"><Image size={11} /> {issue.photo_urls.length}</span></>}
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
          {isManager && blockOptions.length > 1 && (
            <SelectField label={t('finance.block')} value={createBuildingId} onValueChange={(v) => { setCreateBuildingId(v); setLoggingFor('__common__'); }}>
              {blockOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          )}
          {/* The first question: common area, or a unit. Residents only see
              their own units — logging for the neighbors is not a thing. */}
          {isManager ? (
            <SelectField label={t('issues.loggingFor')} value={loggingFor} onValueChange={setLoggingFor}>
              <SelectItem value="__common__">{t('issues.commonArea')}</SelectItem>
              {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}
            </SelectField>
          ) : (
            <SelectField label={t('issues.loggingFor')} value={loggingFor} onValueChange={setLoggingFor}>
              {residentOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectField>
          )}
          <Input label={t('issues.issueTitle')} {...register('title', { required: true })} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('issues.description')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[80px]" {...register('description', { required: true })} />
          </div>
          <Input label={t('issues.location')} {...register('location', { required: true })} />
          {amenities.length > 0 && (
            <SelectField label={t('amenities.linkLabel')} value={issueAmenityId || '__none__'} onValueChange={(v) => setIssueAmenityId(v === '__none__' ? '' : v)}>
              <SelectItem value="__none__">{t('amenities.linkNone')}</SelectItem>
              {amenities.filter((a) => a.active).map((a) => <SelectItem key={a.id} value={a.id}>{amenityLabel(a)}</SelectItem>)}
            </SelectField>
          )}
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
