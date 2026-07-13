import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import { Plus, CalendarPlus, ChevronDown, ChevronUp, Paperclip, Trash2, Search, X, Video, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { Meeting, Profile } from '@/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
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
  const [entityKey, setEntityKey] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [createBuildingId, setCreateBuildingId] = useState('');

  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  useEffect(() => { setBlockFilter(''); }, [entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const effectiveBuildingIds = entity ? (blockFilter ? [blockFilter] : entity.buildingIds) : [];
  const idsKey = effectiveBuildingIds.join(',');
  const legacyManager = profile?.role === 'super_admin' || profile?.role === 'building_admin';
  const isManager = isPlatformAdmin || canAny('meeting.manage') || legacyManager;

  const scheduleForm = useForm<{ title: string; meeting_date: string; meeting_time: string; summary: string }>();
  const addForm = useForm<{ title: string; meeting_date: string; meeting_time: string; summary: string }>();

  useEffect(() => { if (effectiveBuildingIds.length) loadMeetings(); else setMeetings([]); }, [idsKey, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!effectiveBuildingIds.length) { setBuildingUsers([]); return; }
    supabase.from('profiles').select('*').in('building_id', effectiveBuildingIds).eq('status', 'active').order('full_name').then(({ data }) => setBuildingUsers(data ?? []));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function openSchedule() { setCreateBuildingId(blockFilter || (entity?.kind === 'building' ? entity.id : (entity?.blocks[0]?.id ?? ''))); setSelectedAttendees([]); setScheduleOnline(false); setScheduleUrl(''); setScheduleFiles([]); setScheduleOpen(true); }
  function openAdd() { setCreateBuildingId(blockFilter || (entity?.kind === 'building' ? entity.id : (entity?.blocks[0]?.id ?? ''))); setSelectedAttendees([]); setAddFiles([]); setAddOpen(true); }

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
    setMeetings(data ?? []);
    setLoading(false);
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
    const { error } = await supabase.from('meetings').insert(payload);
    if (error) { toast.error(`Could not schedule meeting: ${error.message}`); return; }
    toast.success('Meeting scheduled — invite sent to residents.');
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
    if (!error) { toast.success('Meeting record saved.'); setAddOpen(false); addForm.reset(); setSelectedAttendees([]); setAddFiles([]); loadMeetings(); }
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
          {entities.length > 1 && (
            <Select value={entityKey} onChange={(e) => setEntityKey(e.target.value)} className="min-w-[160px]">
              {entities.map((e) => <option key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</option>)}
            </Select>
          )}
          {entity?.kind === 'compound' && multiBlock && (
            <Select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}>
              <option value="">{t('finance.allBlocks')}</option>
              {entity.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          {isManager && entity && (
            <>
              <Button variant="secondary" onClick={openAdd}><Plus size={16} /> {t('meetings.addMeeting')}</Button>
              <Button onClick={openSchedule}><CalendarPlus size={16} /> Schedule</Button>
            </>
          )}
        </div>
      </div>

      {!entity ? (
        <Card><CardBody>
          <p className="text-sm text-slate-500 text-center py-8">{t('finance.noBuildings')}</p>
        </CardBody></Card>
      ) : (<>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {(['scheduled', 'past'] as Tab[]).map(t2 => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${tab === t2 ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            {t2 === 'scheduled' ? 'Scheduled' : 'Past Meetings'}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonCards count={3} />
      ) : meetings.length === 0 ? (
        <Card><CardBody><p className="text-sm text-slate-500 text-center py-8">
          {tab === 'scheduled' ? 'No upcoming meetings scheduled.' : 'No past meetings recorded.'}
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
                      <p className="text-xs text-indigo-500 font-medium uppercase">{format(new Date(m.meeting_date), 'MMM')}</p>
                      <p className="text-2xl font-bold text-indigo-700 leading-none">{format(new Date(m.meeting_date), 'd')}</p>
                      <p className="text-xs text-indigo-500">{format(new Date(m.meeting_date), 'yyyy')}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{m.title}</p>
                      {m.meeting_time && (
                        <p className="text-sm text-slate-500 mt-0.5">🕐 {m.meeting_time.slice(0, 5)}</p>
                      )}
                      {m.summary && <p className="text-sm text-slate-600 mt-1">{m.summary}</p>}
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        {m.attendees?.length > 0 && <span className="text-xs text-slate-400">{m.attendees.length} attendee{m.attendees.length === 1 ? '' : 's'}</span>}
                        {m.meeting_url && (
                          <a href={m.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                            <Video size={13} /> Join online <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
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
                              {format(new Date(m.meeting_date), 'MMMM d, yyyy')}
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
                                <a key={i} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-blue-700 hover:underline">
                                  <Paperclip size={13} /> Attachment {i + 1}
                                </a>
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
      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule Meeting">
        <form onSubmit={scheduleForm.handleSubmit(onSchedule)} className="space-y-4">
          {(entity?.blocks.length ?? 0) > 1 && (
            <Select label={t('finance.block')} value={createBuildingId} onChange={(e) => setCreateBuildingId(e.target.value)}>
              {entity!.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Input label="Meeting Title" {...scheduleForm.register('title', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" {...scheduleForm.register('meeting_date', { required: true })} />
            <Input label="Time" type="time" {...scheduleForm.register('meeting_time')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Notes (optional)</label>
            <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]" {...scheduleForm.register('summary')} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">Attendees</label>
            <AttendeePicker users={buildingUsers} selected={selectedAttendees} setSelected={setSelectedAttendees} />
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input type="checkbox" checked={scheduleOnline} onChange={(e) => setScheduleOnline(e.target.checked)} className="rounded" />
              <Video size={15} className="text-indigo-600" /> Online meeting (Zoom / Teams) for those abroad
            </label>
            {scheduleOnline && (
              <input
                type="url"
                value={scheduleUrl}
                onChange={(e) => setScheduleUrl(e.target.value)}
                placeholder="Paste the Zoom / Teams / Meet link"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">Attachments (agenda, minutes, recording)</label>
            <input type="file" multiple onChange={(e) => setScheduleFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-sm file:bg-white file:cursor-pointer" />
          </div>
          <p className="text-xs text-slate-400 bg-indigo-50 rounded-lg px-3 py-2">
            📅 A calendar invite (.ics) will be emailed to all building residents.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setScheduleOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={scheduleForm.formState.isSubmitting}>Schedule & Send Invite</Button>
          </div>
        </form>
      </Modal>

      {/* Add Past Meeting modal */}
      <Modal open={addOpen} onClose={() => { setAddOpen(false); setSelectedAttendees([]); setAddFiles([]); }} title="Add Meeting Record" size="lg">
        <form onSubmit={addForm.handleSubmit(onAddMeeting)} className="space-y-4">
          {(entity?.blocks.length ?? 0) > 1 && (
            <Select label={t('finance.block')} value={createBuildingId} onChange={(e) => setCreateBuildingId(e.target.value)}>
              {entity!.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Input label="Meeting Title" {...addForm.register('title', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date" type="date" {...addForm.register('meeting_date', { required: true })} />
            <Input label="Time" type="time" {...addForm.register('meeting_time')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('meetings.summary')}</label>
            <textarea className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]" {...addForm.register('summary', { required: true })} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('meetings.attendees')}</label>
            <AttendeePicker users={buildingUsers} selected={selectedAttendees} setSelected={setSelectedAttendees} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">Attachments (minutes, recording, PDF)</label>
            <input type="file" multiple onChange={(e) => setAddFiles(Array.from(e.target.files ?? []))}
              className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-sm file:bg-white file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => { setAddOpen(false); setSelectedAttendees([]); setAddFiles([]); }}>{t('common.cancel')}</Button>
            <Button type="submit" loading={addForm.formState.isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Meeting" size="sm">
        <p className="text-sm text-slate-600 mb-6">
          Are you sure you want to delete <strong>{deleteTarget?.title}</strong>? This cannot be undone.
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
              {format(new Date(detailMeeting.meeting_date), 'EEEE, MMMM d, yyyy')}{detailMeeting.meeting_time ? ` · ${detailMeeting.meeting_time.slice(0, 5)}` : ''}
            </p>
            {detailMeeting.meeting_url && (
              <a href={detailMeeting.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline">
                <Video size={15} /> Join online <ExternalLink size={12} />
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
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                    <Paperclip size={13} /> {t('meetings.attachments')} {i + 1}
                  </a>
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
        <span className="text-xs text-slate-400">{selected.length} of {users.length} selected</span>
        <button type="button" onClick={() => setSelected(allOn ? [] : users.map(u => u.id))} className="text-xs font-medium text-indigo-600 hover:underline cursor-pointer">
          {allOn ? 'Clear all' : 'Select all'}
        </button>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-slate-50 rounded-xl border border-slate-200">
          {users.filter(u => selected.includes(u.id)).map(u => (
            <span key={u.id} className="flex items-center gap-1 text-xs bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded-full">
              {u.full_name}{u.apartment_number ? ` (${u.apartment_number})` : ''}
              <button type="button" onClick={() => toggle(u.id)} className="text-slate-400 hover:text-rose-500 cursor-pointer"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" placeholder="Search residents…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
      </div>
      <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-50">
        {filtered.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-3">No residents found</p>
        ) : filtered.map(u => (
          <button key={u.id} type="button" onClick={() => toggle(u.id)}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition cursor-pointer ${selected.includes(u.id) ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}>
            <span>{u.full_name}{u.apartment_number ? ` — Apt ${u.apartment_number}` : ''}</span>
            {selected.includes(u.id) && <span className="text-xs text-indigo-500">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
