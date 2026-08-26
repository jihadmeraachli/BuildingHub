import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { safeHttpUrl } from '@/lib/safeUrl';
import { useForm } from 'react-hook-form';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, CalendarPlus, ChevronDown, ChevronUp, Paperclip, Trash2, Search, X, Video, ExternalLink, AlertTriangle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { Meeting, Profile, Issue } from '@/types';
import { cn } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

type Tab = 'scheduled' | 'past';

export default function Meetings() {
  const { t } = useTranslation();
  const { profile, canAny, isPlatformAdmin } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const [tab, setTab] = useState<Tab>('scheduled');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Meeting | null>(null);
  const [buildingUsers, setBuildingUsers] = useState<Profile[]>([]);
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>([]);
  const [scheduleOnline, setScheduleOnline] = useState(false);
  const [scheduleUrl, setScheduleUrl] = useState('');
  const [detailMeeting, setDetailMeeting] = useState<Meeting | null>(null);
  const [scheduleFiles, setScheduleFiles] = useState<File[]>([]);
  const [addFiles, setAddFiles] = useState<File[]>([]);
  // GLOBAL entity selection (sidebar); '' = across all viewable buildings.
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  const [createBuildingId, setCreateBuildingId] = useState('');

  useEffect(() => { setBlockFilter(''); }, [entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const multiBlock = entity ? entity.blocks.length > 1 : buildings.length > 1;
  const effectiveBuildingIds = entity
    ? (blockFilter ? [blockFilter] : entity.buildingIds)
    : (blockFilter ? [blockFilter] : buildings.map((b) => b.id));
  const idsKey = effectiveBuildingIds.join(',');
  const isManager = isPlatformAdmin || canAny('meeting.manage');

  // Agenda issues (#56). Deliberately opt-in and hand-picked: pulling every
  // open issue onto every agenda would bury the ones that need discussing.
  const [agendaOn, setAgendaOn] = useState(false);
  const [openIssues, setOpenIssues] = useState<Issue[]>([]);
  const [agendaPicked, setAgendaPicked] = useState<string[]>([]);
  /** meeting_id -> the issues on its agenda, with LIVE status. */
  const [agendaByMeeting, setAgendaByMeeting] = useState<Record<string, Issue[]>>({});

  const scheduleForm = useForm<{ title: string; meeting_date: string; meeting_time: string; summary: string }>();
  const addForm = useForm<{ title: string; meeting_date: string; meeting_time: string; summary: string }>();

  useEffect(() => { if (effectiveBuildingIds.length) loadMeetings(); else setMeetings([]); }, [idsKey, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!effectiveBuildingIds.length) { setBuildingUsers([]); return; }
    supabase.from('profiles').select('*').in('building_id', effectiveBuildingIds).eq('status', 'active').order('full_name').then(({ data }) => setBuildingUsers(data ?? []));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching block inside the schedule modal must re-fetch that block's issues,
  // and drop picks that belong to the block we just left.
  useEffect(() => {
    if (!scheduleOpen) return;
    setAgendaPicked([]);
    loadOpenIssues(createBuildingId);
  }, [createBuildingId, scheduleOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function openSchedule() {
    const bid = blockFilter || (entity?.kind === 'building' ? entity.id : (entity?.blocks[0]?.id ?? buildings[0]?.id ?? ''));
    setCreateBuildingId(bid);
    setSelectedAttendees([]); setScheduleOnline(false); setScheduleUrl(''); setScheduleFiles([]);
    setAgendaOn(false); setAgendaPicked([]); setOpenIssues([]);
    loadOpenIssues(bid);
    setScheduleOpen(true);
  }
  function openAdd() { setCreateBuildingId(blockFilter || (entity?.kind === 'building' ? entity.id : (entity?.blocks[0]?.id ?? buildings[0]?.id ?? ''))); setSelectedAttendees([]); setAddFiles([]); setAddOpen(true); }

  async function loadMeetings() {
    if (!effectiveBuildingIds.length) return;
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    let q = supabase.from('meetings').select('*').in('building_id', effectiveBuildingIds);
    if (tab === 'scheduled') {
      q = q.eq('meeting_type', 'scheduled').gte('meeting_date', today).order('meeting_date', { ascending: true });
    } else {
      q = q.eq('meeting_type', 'past').order('meeting_date', { ascending: false });
    }
    const { data } = await q;
    const rows = (data ?? []) as Meeting[];
    setMeetings(rows);
    setLoading(false);
    loadAgendas(rows.map((m) => m.id));
  }

  /** Issues attached to these meetings. Read fresh every load so a status that
   *  changed since scheduling shows as it is now, not as it was. */
  async function loadAgendas(meetingIds: string[]) {
    if (!meetingIds.length) { setAgendaByMeeting({}); return; }
    const { data, error } = await supabase
      .from('meeting_issues')
      .select('meeting_id, issues(*)')
      .in('meeting_id', meetingIds);
    // Table absent (migration 0083 not run yet) — agendas just don't render.
    if (error) { setAgendaByMeeting({}); return; }
    const map: Record<string, Issue[]> = {};
    for (const row of (data ?? []) as unknown as { meeting_id: string; issues: Issue | null }[]) {
      if (!row.issues) continue;   // RLS hid it, e.g. another unit's private issue
      (map[row.meeting_id] ??= []).push(row.issues);
    }
    setAgendaByMeeting(map);
  }

  /** Open issues in the building being scheduled for, newest first. */
  async function loadOpenIssues(buildingId: string) {
    if (!buildingId) { setOpenIssues([]); return; }
    const { data } = await supabase
      .from('issues').select('*')
      .eq('building_id', buildingId)
      .in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: false });
    setOpenIssues((data as Issue[]) ?? []);
  }

  async function onSchedule(data: { title: string; meeting_date: string; meeting_time: string; summary: string }) {
    const attachment_urls: string[] = [];
    for (const f of scheduleFiles) {
      const url = await uploadFile('attachments', `${createBuildingId}/meetings`, f);
      if (url) attachment_urls.push(url);
    }
    const payload: Record<string, unknown> = {
      building_id: createBuildingId,
      title: data.title,
      meeting_date: data.meeting_date,
      meeting_time: data.meeting_time || null,
      summary: data.summary || '',
      attendees: attendeeNamesFor(selectedAttendees),
      attachment_urls,
      meeting_type: 'scheduled',
      created_by: profile?.id,
    };
    // only include meeting_url when set, so scheduling works before migration 0004
    if (scheduleOnline && scheduleUrl.trim()) payload.meeting_url = scheduleUrl.trim();
    const { data: created, error } = await supabase.from('meetings').insert(payload).select('id').single();
    if (error) { toast.error(`Could not schedule meeting: ${error.message}`); return; }

    // Attach the chosen issues. A failure here must not lose the meeting that
    // was just created, so it warns rather than throwing the whole thing away.
    if (agendaOn && agendaPicked.length && created?.id) {
      const { error: linkErr } = await supabase.from('meeting_issues')
        .insert(agendaPicked.map((issue_id) => ({ meeting_id: created.id, issue_id })));
      if (linkErr) toast.warning(t('meetings.agendaLinkFailed'));
    }
    toast.success(t('meetings.scheduledToast'));
    setScheduleOpen(false); scheduleForm.reset(); setScheduleFiles([]); setSelectedAttendees([]); setScheduleOnline(false); setScheduleUrl(''); loadMeetings();
  }

  async function onAddMeeting(data: { title: string; meeting_date: string; meeting_time: string; summary: string }) {
    const attendeeNames = buildingUsers
      .filter(u => selectedAttendees.includes(u.id))
      .map(u => `${u.full_name}${u.apartment_number ? ` (${u.apartment_number})` : ''}`);

    const attachment_urls: string[] = [];
    for (const f of addFiles) {
      const url = await uploadFile('attachments', `${createBuildingId}/meetings`, f);
      if (url) attachment_urls.push(url);
    }
    const { error } = await supabase.from('meetings').insert({
      building_id: createBuildingId,
      title: data.title,
      meeting_date: data.meeting_date,
      meeting_time: data.meeting_time || null,
      summary: data.summary,
      attendees: attendeeNames,
      attachment_urls,
      meeting_type: 'past',
      created_by: profile?.id,
    });
    if (!error) { toast.success(t('meetings.recordSaved')); setAddOpen(false); addForm.reset(); setSelectedAttendees([]); setAddFiles([]); loadMeetings(); }
  }

  async function deleteMeeting(id: string) {
    await supabase.from('meetings').delete().eq('id', id);
    setDeleteTarget(null);
    loadMeetings();
  }

  const attendeeNamesFor = (ids: string[]) => buildingUsers
    .filter(u => ids.includes(u.id))
    .map(u => `${u.full_name}${u.apartment_number ? ` (${u.apartment_number})` : ''}`);

  const grouped = meetings.reduce<Record<string, Meeting[]>>((acc, m) => {
    const year = new Date(m.meeting_date).getFullYear().toString();
    if (!acc[year]) acc[year] = [];
    acc[year].push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('meetings.title')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity selection moved to the sidebar (global). Block drill-down stays local. */}
          {multiBlock && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={(v) => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {(entity?.blocks ?? buildings.map((b) => ({ id: b.id, name: b.name }))).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
          )}
          {isManager && effectiveBuildingIds.length > 0 && (
            <>
              <Button variant="secondary" onClick={openAdd}><Plus size={16} /> {t('meetings.addMeeting')}</Button>
              <Button variant="tinted" onClick={openSchedule}><CalendarPlus size={16} /> {t('meetings.scheduleMeeting')}</Button>
            </>
          )}
        </div>
      </div>

      {!entity ? (
        <Card><CardBody>
          <p className="text-sm text-muted-foreground text-center py-8">{t('finance.noBuildings')}</p>
        </CardBody></Card>
      ) : (<>

      {/* Tabs */}
      <SegmentedTabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'scheduled', label: t('meetings.scheduled') },
          { key: 'past', label: t('meetings.pastMeetings') },
        ]}
      />

      {loading ? (
        <SkeletonCards count={3} />
      ) : meetings.length === 0 ? (
        <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">
          {tab === 'scheduled' ? t('meetings.noScheduled') : t('meetings.noPast')}
        </p></CardBody></Card>
      ) : tab === 'scheduled' ? (
        // Scheduled meetings: flat list with date/time prominent
        <div className="space-y-3">
          {meetings.map(m => (
            <Card key={m.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-4 items-start flex-1 cursor-pointer" onClick={() => setDetailMeeting(m)}>
                    <div className="flex-shrink-0 text-center bg-indigo-50 rounded-xl px-4 py-2 min-w-[64px]">
                      <p className="text-xs text-indigo-500 font-medium uppercase">{fmtDate(m.meeting_date, 'MMM')}</p>
                      <p className="text-2xl font-bold text-indigo-700 leading-none">{fmtDate(m.meeting_date, 'd')}</p>
                      <p className="text-xs text-indigo-500">{fmtDate(m.meeting_date, 'yyyy')}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{m.title}</p>
                      {m.meeting_time && (
                        <p className="text-sm text-slate-500 mt-0.5">🕐 {m.meeting_time.slice(0, 5)}</p>
                      )}
                      {m.summary && <p className="text-sm text-slate-600 mt-1">{m.summary}</p>}
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {m.attendees?.length > 0 && <span className="text-xs text-slate-400">{t('meetings.attendeeCount', { count: m.attendees.length })}</span>}
                        {safeHttpUrl(m.meeting_url) && (
                          <a href={safeHttpUrl(m.meeting_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                            <Video size={13} /> {t('meetings.joinOnline')} <ExternalLink size={11} />
                          </a>
                        )}
                      </div>

                      {/* Agenda issues, with their status as it is NOW — one may
                          well have been resolved since the meeting was booked. */}
                      {agendaByMeeting[m.id]?.length > 0 && (
                        <div className="mt-3 border-t border-border pt-2">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                            {t('meetings.agendaHeading')}
                          </p>
                          <ul className="space-y-1">
                            {agendaByMeeting[m.id].map((iss) => (
                              <li key={iss.id} className="flex items-center gap-2 text-xs">
                                <span className={cn(
                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                  iss.status === 'resolved' ? 'bg-emerald-500'
                                    : iss.status === 'in_progress' ? 'bg-blue-500' : 'bg-orange-500',
                                )} />
                                <span className={cn('truncate', iss.status === 'resolved' && 'line-through text-muted-foreground')}>
                                  {iss.title}
                                </span>
                                <span className="text-muted-foreground shrink-0">
                                  {t(`issues.statuses.${iss.status}`)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  {isManager && (
                    <button onClick={() => setDeleteTarget(m)} className="text-slate-300 hover:text-red-500 transition flex-shrink-0 cursor-pointer">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        // Past meetings: grouped by year, expandable
        <div className="space-y-6">
          {Object.entries(grouped).sort(([a], [b]) => Number(b) - Number(a)).map(([year, items]) => (
            <div key={year}>
              <h2 className="text-base font-semibold text-slate-700 mb-3">{year}</h2>
              <div className="space-y-3">
                {items.map(m => (
                  <Card key={m.id}>
                    <button className="w-full text-start" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-slate-900">{m.title}</p>
                            <p className="text-sm text-slate-500 mt-0.5">
                              {fmtDate(m.meeting_date, 'dd-MM-yyyy')}
                              {m.meeting_time && ` · ${m.meeting_time.slice(0, 5)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isManager && (
                              <button
                                onClick={e => { e.stopPropagation(); setDeleteTarget(m); }}
                                className="text-slate-300 hover:text-red-500 transition cursor-pointer p-1"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                            {expanded === m.id ? <ChevronUp size={18} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />}
                          </div>
                        </div>
                      </CardHeader>
                    </button>
                    {expanded === m.id && (
                      <CardBody>
                        <div className="space-y-3">
                          {m.summary && (
                            <div>
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('meetings.summary')}</p>
                              <p className="text-sm text-slate-700 whitespace-pre-line">{m.summary}</p>
                            </div>
                          )}
                          {m.attendees?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('meetings.attendees')}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {m.attendees.map(a => (
                                  <span key={a} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{a}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {m.attachment_urls?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('meetings.attachments')}</p>
                              {m.attachment_urls.map((url, i) => (
                                <AttachmentLink key={i} url={url} label={t('meetings.attachment', { n: i + 1 })} icon={Paperclip} className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline" />
                              ))}
                            </div>
                          )}
                        </div>
                      </CardBody>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Schedule Meeting modal */}
      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title={t('meetings.scheduleMeeting')}>
        <form onSubmit={scheduleForm.handleSubmit(onSchedule)} className="space-y-4">
          {(entity ? entity.blocks : buildings).length > 1 && (
            <SelectField label={t('finance.block')} value={createBuildingId} onValueChange={setCreateBuildingId}>
              {(entity?.blocks ?? buildings.map((b) => ({ id: b.id, name: b.name }))).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          )}
          <Input label={t('meetings.meetingTitle')} {...scheduleForm.register('title', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('meetings.meetingDate')} type="date" {...scheduleForm.register('meeting_date', { required: true })} />
            <Input label={t('meetings.meetingTime')} type="time" {...scheduleForm.register('meeting_time')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('meetings.notesOptional')}</label>
            <textarea className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[80px]" {...scheduleForm.register('summary')} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('meetings.attendees')}</label>
            <AttendeePicker users={buildingUsers} selected={selectedAttendees} setSelected={setSelectedAttendees} />
          </div>

          {/* Agenda from open issues (#56) */}
          <div className="rounded-xl border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={agendaOn}
                onChange={(e) => { setAgendaOn(e.target.checked); if (!e.target.checked) setAgendaPicked([]); }}
                className="rounded"
              />
              <AlertTriangle size={15} className="text-primary" /> {t('meetings.includeIssues')}
            </label>

            {agendaOn && (
              openIssues.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">{t('meetings.noOpenIssues')}</p>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setAgendaPicked(
                      agendaPicked.length === openIssues.length ? [] : openIssues.map((i) => i.id),
                    )}
                    className="text-xs text-primary hover:underline cursor-pointer"
                  >
                    {agendaPicked.length === openIssues.length ? t('meetings.selectNone') : t('meetings.selectAll')}
                  </button>
                  <div className="mt-2 max-h-52 overflow-y-auto space-y-1.5 pe-1">
                    {openIssues.map((iss) => (
                      <label key={iss.id} className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agendaPicked.includes(iss.id)}
                          onChange={(e) => setAgendaPicked(
                            e.target.checked
                              ? [...agendaPicked, iss.id]
                              : agendaPicked.filter((x) => x !== iss.id),
                          )}
                          className="rounded mt-0.5 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="text-foreground">{iss.title}</span>
                          <span className="text-xs text-muted-foreground ms-1.5">
                            {iss.apartment_number ? `Apt ${iss.apartment_number}` : t('issues.commonArea')}
                            {' · '}{t(`issues.statuses.${iss.status}`)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {t('meetings.agendaCount', { count: agendaPicked.length })}
                  </p>
                </div>
              )
            )}
          </div>

          <div className="rounded-xl border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
              <input type="checkbox" checked={scheduleOnline} onChange={(e) => setScheduleOnline(e.target.checked)} className="rounded" />
              <Video size={15} className="text-primary" /> {t('meetings.onlineMeeting')}
            </label>
            {scheduleOnline && (
              <input
                type="url"
                value={scheduleUrl}
                onChange={(e) => setScheduleUrl(e.target.value)}
                placeholder={t('meetings.meetingLinkPlaceholder')}
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('meetings.attachments')}</label>
            <input type="file" multiple onChange={(e) => setScheduleFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <p className="text-xs text-muted-foreground bg-primary/10 rounded-lg px-3 py-2">
            📅 {t('meetings.calendarHint')}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setScheduleOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={scheduleForm.formState.isSubmitting}>{t('meetings.scheduleAndSend')}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Past Meeting modal */}
      <Modal open={addOpen} onClose={() => { setAddOpen(false); setSelectedAttendees([]); setAddFiles([]); }} title={t('meetings.addRecord')} size="lg">
        <form onSubmit={addForm.handleSubmit(onAddMeeting)} className="space-y-4">
          {(entity ? entity.blocks : buildings).length > 1 && (
            <SelectField label={t('finance.block')} value={createBuildingId} onValueChange={setCreateBuildingId}>
              {(entity?.blocks ?? buildings.map((b) => ({ id: b.id, name: b.name }))).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectField>
          )}
          <Input label="Meeting Title" {...addForm.register('title', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('meetings.meetingDate')} type="date" {...addForm.register('meeting_date', { required: true })} />
            <Input label={t('meetings.meetingTime')} type="time" {...addForm.register('meeting_time')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-muted-foreground">{t('meetings.summary')}</label>
            <textarea className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[100px]" {...addForm.register('summary', { required: true })} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('meetings.attendees')}</label>
            <AttendeePicker users={buildingUsers} selected={selectedAttendees} setSelected={setSelectedAttendees} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('meetings.attachmentsPast')}</label>
            <input type="file" multiple onChange={(e) => setAddFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setSelectedAttendees([]); setAddFiles([]); }}>{t('common.cancel')}</Button>
            <Button type="submit" loading={addForm.formState.isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('meetings.deleteMeeting')} size="sm">
        <p className="text-sm text-slate-600 mb-6">
          {t('meetings.confirmDelete')}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => deleteTarget && deleteMeeting(deleteTarget.id)}>{t('common.delete')}</Button>
        </div>
      </Modal>

      {/* Meeting detail modal */}
      <Modal open={!!detailMeeting} onClose={() => setDetailMeeting(null)} title={detailMeeting?.title ?? ''} size="lg">
        {detailMeeting && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              {fmtDate(detailMeeting.meeting_date, 'EEEE, dd-MM-yyyy')}{detailMeeting.meeting_time ? ` · ${detailMeeting.meeting_time.slice(0, 5)}` : ''}
            </p>
            {safeHttpUrl(detailMeeting.meeting_url) && (
              <a href={safeHttpUrl(detailMeeting.meeting_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline">
                <Video size={15} /> {t('meetings.joinOnline')} <ExternalLink size={12} />
              </a>
            )}
            {detailMeeting.summary && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('meetings.summary')}</p>
                <p className="text-sm text-slate-700 whitespace-pre-line">{detailMeeting.summary}</p>
              </div>
            )}
            {detailMeeting.attendees?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('meetings.attendees')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailMeeting.attendees.map((a) => <span key={a} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{a}</span>)}
                </div>
              </div>
            )}
            {detailMeeting.attachment_urls?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{t('meetings.attachments')}</p>
                {detailMeeting.attachment_urls.map((url, i) => (
                  <AttachmentLink key={i} url={url} label={t('meetings.attachment', { n: i + 1 })} icon={Paperclip} className="flex items-center gap-1.5 text-sm text-indigo-600 hover:underline" />
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      </>)}
    </div>
  );
}

function AttendeePicker({ users, selected, setSelected }: { users: Profile[]; selected: string[]; setSelected: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (u.apartment_number ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const allOn = users.length > 0 && selected.length === users.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{t('meetings.attendeePicker', { selected: selected.length, total: users.length })}</span>
        <button type="button" onClick={() => setSelected(allOn ? [] : users.map(u => u.id))} className="text-xs font-medium text-primary hover:underline cursor-pointer">
          {allOn ? t('common.clearAll') : t('common.selectAll')}
        </button>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-accent/30 rounded-xl border border-border">
          {users.filter(u => selected.includes(u.id)).map(u => (
            <span key={u.id} className="flex items-center gap-1 text-xs bg-background border border-border text-foreground px-2 py-1 rounded-full">
              {u.full_name}{u.apartment_number ? ` (${u.apartment_number})` : ''}
              <button type="button" onClick={() => toggle(u.id)} className="text-muted-foreground hover:text-rose-500 cursor-pointer"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="text" placeholder={t('meetings.searchResidents')} value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-background text-foreground ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50" />
      </div>
      <div className="max-h-40 overflow-y-auto border border-border rounded-xl divide-y divide-border">
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">{t('meetings.noResidents')}</p>
        ) : filtered.map(u => (
          <button key={u.id} type="button" onClick={() => toggle(u.id)}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition cursor-pointer ${selected.includes(u.id) ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}>
            <span>{u.full_name}{u.apartment_number ? ` (Apt ${u.apartment_number})` : ''}</span>
            {selected.includes(u.id) && <span className="text-xs text-primary">&#10003;</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
