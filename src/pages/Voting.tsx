import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, Vote as VoteIcon, X, Lock, SlidersHorizontal, Users, Check, MinusCircle, Clock } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import { useConfirm } from '@/lib/useConfirm';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

// 0155: the committee puts a question to the building. Creation is
// poll.manage (admins); voting is for residents, through the sealed
// cast_vote() RPC; results come from poll_results() aggregates only.
// 0156: the ballot RULES are building policy - set once under "Voting
// rules", applied to every new vote, editable any time. Each poll stores
// its own copy at creation, so a rules change never rewrites a live ballot.

interface Poll {
  id: string; building_id: string | null; compound_id: string | null;
  title: string; description: string | null;
  status: 'open' | 'closed'; closes_at: string; closed_at: string | null;
  anonymous: boolean;
  eligibility: 'all_residents' | 'owners_only' | 'one_per_unit';
  weighting: 'per_person' | 'by_share';
  choice_type: 'single' | 'multiple'; max_choices: number;
  allow_abstain: boolean; quorum_pct: number; pass_threshold_pct: number;
  results_visibility: 'live' | 'after_close';
  created_by: string | null; created_at: string;
}
interface PollOption { id: string; poll_id: string; label: string; position: number; }
/** 0169: one line of the roll call - a voter (or a unit) and what they did. */
interface BallotRow {
  voter_id: string | null;
  voter_name: string;
  unit_label: string;
  status: 'voted' | 'abstained' | 'pending';
  choices: string[];
  weight: number;
  voted_at: string | null;
}

interface ResultRow {
  option_id: string | null; label: string;
  votes: number | null; vote_weight: number | null;
  eligible: number; cast_count: number; cast_weight: number; hidden: boolean;
}
interface Rules {
  anonymous: boolean;
  eligibility: Poll['eligibility'];
  weighting: Poll['weighting'];
  choice_type: Poll['choice_type'];
  max_choices: number;
  allow_abstain: boolean;
  quorum_pct: number;
  pass_threshold_pct: number;
  results_visibility: Poll['results_visibility'];
}
type DefaultsRow = Rules & { id: string; building_id: string | null; compound_id: string | null };

const RULE_DEFAULTS: Rules = {
  anonymous: true, eligibility: 'all_residents', weighting: 'per_person',
  choice_type: 'single', max_choices: 1, allow_abstain: true,
  quorum_pct: 0, pass_threshold_pct: 50, results_visibility: 'live',
};

const textarea = 'w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 min-h-[72px]';

export default function Voting() {
  const { t } = useTranslation();
  const { user, canAny, isPlatformAdmin, residentLens } = useAuth();
  const { buildings: viewable } = useViewableBuildings();
  const { buildings: managed } = useManagedBuildings();
  const entities = useEntities(managed as Parameters<typeof useEntities>[0]);
  const { confirmAsync, ConfirmDialog } = useConfirm();

  const canCreate = (isPlatformAdmin || canAny('poll.manage')) && !residentLens;
  const isPollManager = canCreate;

  const [polls, setPolls] = useState<Poll[]>([]);
  const [options, setOptions] = useState<Record<string, PollOption[]>>({});
  const [results, setResults] = useState<Record<string, ResultRow[]>>({});
  const [myVotes, setMyVotes] = useState<Record<string, { optionIds: string[]; abstain: boolean }>>({});
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [defaults, setDefaults] = useState<Record<string, DefaultsRow>>({});  // entityKey -> saved rules
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const bIds = useMemo(() => viewable.map(b => b.id), [viewable]);
  const cIds = useMemo(() => [...new Set(viewable.map(b => b.compound_id).filter(Boolean))] as string[], [viewable]);
  const idsKey = [...bIds, ...cIds].sort().join(',');
  const scopeName = (p: Poll) =>
    p.compound_id ? (entities.find(e => e.id === p.compound_id)?.name ?? t('voting.wholeCompound'))
      : (viewable.find(b => b.id === p.building_id)?.name ?? '');

  const rollIcon = (st: BallotRow['status']) =>
    st === 'voted' ? <Check size={13} className="text-emerald-500" />
    : st === 'abstained' ? <MinusCircle size={13} className="text-amber-500" />
    : <Clock size={13} className="text-muted-foreground" />;

  const effectiveStatus = (p: Poll): 'open' | 'closed' =>
    p.status === 'closed' || new Date(p.closes_at) <= new Date() ? 'closed' : 'open';

  const effectiveRules = (entityKey: string): Rules => defaults[entityKey] ?? RULE_DEFAULTS;

  // ── the roll call (0169): who voted what, who abstained, who is pending.
  //    Server-side by design - a SECRET ballot returns nothing to anyone, so
  //    this button can never leak one.
  const [rollOpen, setRollOpen] = useState<string | null>(null);
  const [roll, setRoll] = useState<Record<string, BallotRow[]>>({});
  const [rollBusy, setRollBusy] = useState(false);

  async function toggleRoll(pollId: string) {
    if (rollOpen === pollId) { setRollOpen(null); return; }
    setRollOpen(pollId);
    if (roll[pollId]) return;
    setRollBusy(true);
    const { data, error } = await supabase.rpc('poll_ballots', { p_poll: pollId });
    setRollBusy(false);
    if (error) { toast.error(error.message); return; }
    setRoll(prev => ({ ...prev, [pollId]: (data ?? []) as BallotRow[] }));
  }

  async function loadResults(pollIds: string[]) {
    const pairs = await Promise.all(pollIds.map(async id => {
      const { data } = await supabase.rpc('poll_results', { p_poll: id });
      return [id, (data ?? []) as ResultRow[]] as const;
    }));
    setResults(Object.fromEntries(pairs));
  }

  async function loadDefaults() {
    if (!entities.length) return;
    const eb = entities.filter(e => e.kind === 'building').map(e => e.id);
    const ec = entities.filter(e => e.kind === 'compound').map(e => e.id);
    const filters = [
      ...(eb.length ? [`building_id.in.(${eb.join(',')})`] : []),
      ...(ec.length ? [`compound_id.in.(${ec.join(',')})`] : []),
    ].join(',');
    if (!filters) return;
    const { data } = await supabase.from('poll_defaults').select('*').or(filters);
    const map: Record<string, DefaultsRow> = {};
    ((data ?? []) as DefaultsRow[]).forEach(r => {
      const key = r.compound_id ? `c:${r.compound_id}` : `b:${r.building_id}`;
      map[key] = r;
    });
    setDefaults(map);
  }

  async function load() {
    if (!bIds.length && !cIds.length) { setPolls([]); setLoading(false); return; }
    setLoading(true);
    const filters = [
      ...(bIds.length ? [`building_id.in.(${bIds.join(',')})`] : []),
      ...(cIds.length ? [`compound_id.in.(${cIds.join(',')})`] : []),
    ].join(',');
    const { data: ps } = await supabase.from('polls').select('*').or(filters).order('created_at', { ascending: false });
    const rows = (ps ?? []) as Poll[];
    setPolls(rows);
    const ids = rows.map(p => p.id);
    if (ids.length) {
      const [{ data: opts }, { data: votes }] = await Promise.all([
        supabase.from('poll_options').select('*').in('poll_id', ids).order('position'),
        supabase.from('poll_votes').select('poll_id, option_id, abstain').in('poll_id', ids).eq('user_id', user?.id ?? ''),
      ]);
      const om: Record<string, PollOption[]> = {};
      ((opts ?? []) as PollOption[]).forEach(o => { (om[o.poll_id] ??= []).push(o); });
      setOptions(om);
      const vm: Record<string, { optionIds: string[]; abstain: boolean }> = {};
      ((votes ?? []) as { poll_id: string; option_id: string | null; abstain: boolean }[]).forEach(v => {
        const e = (vm[v.poll_id] ??= { optionIds: [], abstain: false });
        if (v.abstain) e.abstain = true; else if (v.option_id) e.optionIds.push(v.option_id);
      });
      setMyVotes(vm);
      setSelection(Object.fromEntries(Object.entries(vm).map(([k, v]) => [k, v.optionIds])));
      await loadResults(ids);
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idsKey, user?.id]);
  useEffect(() => { loadDefaults(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entities.length]);

  function toggle(poll: Poll, optionId: string) {
    setSelection(prev => {
      const cur = prev[poll.id] ?? [];
      if (poll.choice_type === 'single') return { ...prev, [poll.id]: [optionId] };
      const next = cur.includes(optionId) ? cur.filter(x => x !== optionId)
        : cur.length < poll.max_choices ? [...cur, optionId] : cur;
      return { ...prev, [poll.id]: next };
    });
  }

  async function cast(poll: Poll, abstain = false) {
    const picks = selection[poll.id] ?? [];
    if (!abstain && !picks.length) { toast.error(t('voting.pickOne')); return; }
    const { error } = await supabase.rpc('cast_vote', { p_poll: poll.id, p_option_ids: abstain ? [] : picks, p_abstain: abstain });
    if (error) { toast.error(error.message); return; }
    toast.success(t('voting.voted'));
    load();
  }
  async function closeNow(poll: Poll) {
    if (!(await confirmAsync(t('voting.closeTitle'), t('voting.closeBody')))) return;
    const { error } = await supabase.rpc('close_poll', { p_poll: poll.id });
    if (error) { toast.error(error.message); return; }
    load();
  }
  async function removePoll(poll: Poll) {
    if (!(await confirmAsync(t('common.delete'), t('voting.deleteBody', { title: poll.title })))) return;
    const { error } = await supabase.from('polls').delete().eq('id', poll.id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  // ── the rules, in words (used in the rules card and the create modal) ────
  function ruleSummary(r: Rules): string {
    const parts = [
      t(`voting.elig_${r.eligibility}`),
      r.weighting === 'by_share' ? t('voting.weight_by_share') : t('voting.weight_per_person'),
      r.choice_type === 'multiple' ? `${t('voting.choice_multiple')} (≤${r.max_choices})` : t('voting.choice_single'),
      r.anonymous ? t('voting.secretBallot') : t('voting.openBallot'),
      r.results_visibility === 'after_close' ? t('voting.results_after_close') : t('voting.results_live'),
    ];
    if (r.quorum_pct > 0) parts.push(t('voting.quorumTarget', { pct: r.quorum_pct }));
    parts.push(t('voting.thresholdShort', { pct: r.pass_threshold_pct }));
    return parts.join(' · ');
  }

  // ── rules modal (0156): set once per scope ───────────────────────────────
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesForm, setRulesForm] = useState<{ entityKey: string } & Rules>({ entityKey: '', ...RULE_DEFAULTS });
  function openRules(entityKey?: string) {
    const key = entityKey ?? entities[0]?.key ?? '';
    setRulesForm({ entityKey: key, ...effectiveRules(key) });
    setRulesOpen(true);
  }
  function switchRulesEntity(key: string) {
    setRulesForm({ entityKey: key, ...effectiveRules(key) });
  }
  async function saveRules() {
    const entity = entities.find(e => e.key === rulesForm.entityKey);
    if (!entity) return;
    setSaving(true);
    const row = {
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      anonymous: rulesForm.anonymous,
      eligibility: rulesForm.weighting === 'by_share' ? 'one_per_unit' : rulesForm.eligibility,
      weighting: rulesForm.weighting,
      choice_type: rulesForm.choice_type,
      max_choices: rulesForm.choice_type === 'multiple' ? Math.max(2, rulesForm.max_choices) : 1,
      allow_abstain: rulesForm.allow_abstain,
      quorum_pct: rulesForm.quorum_pct,
      pass_threshold_pct: rulesForm.pass_threshold_pct,
      results_visibility: rulesForm.results_visibility,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const existing = defaults[rulesForm.entityKey];
    const { error } = existing
      ? await supabase.from('poll_defaults').update(row).eq('id', existing.id)
      : await supabase.from('poll_defaults').insert(row);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('voting.rulesSaved'));
    setRulesOpen(false);
    loadDefaults();
  }

  // ── create modal: just the question - the rules come from the defaults ──
  const [open, setOpen] = useState(false);
  const defaultCloses = () => {
    const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  };
  const [form, setForm] = useState({ entityKey: '', title: '', description: '', opts: ['', ''], closes_at: '' });
  function openCreate() {
    setForm({ entityKey: entities[0]?.key ?? '', title: '', description: '', opts: ['', ''], closes_at: defaultCloses() });
    setOpen(true);
  }
  async function create() {
    const entity = entities.find(e => e.key === form.entityKey);
    const opts = form.opts.map(o => o.trim()).filter(Boolean);
    if (!entity || !form.title.trim() || opts.length < 2) { toast.error(t('voting.needTwoOptions')); return; }
    if (!form.closes_at || new Date(form.closes_at) <= new Date()) { toast.error(t('voting.closesInFuture')); return; }
    const r = effectiveRules(form.entityKey);
    setSaving(true);
    const { data: poll, error } = await supabase.from('polls').insert({
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      title: form.title.trim(), description: form.description.trim() || null,
      closes_at: new Date(form.closes_at).toISOString(),
      // snapshot of the scope's rules at creation (0156)
      anonymous: r.anonymous,
      eligibility: r.weighting === 'by_share' ? 'one_per_unit' : r.eligibility,
      weighting: r.weighting,
      choice_type: r.choice_type,
      max_choices: r.choice_type === 'multiple' ? Math.max(2, r.max_choices) : 1,
      allow_abstain: r.allow_abstain,
      quorum_pct: r.quorum_pct, pass_threshold_pct: r.pass_threshold_pct,
      results_visibility: r.results_visibility,
      created_by: user?.id,
    }).select('id').single();
    if (error || !poll) { setSaving(false); toast.error(error?.message ?? 'Failed'); return; }
    const { error: oErr } = await supabase.from('poll_options').insert(
      opts.map((label, i) => ({ poll_id: (poll as { id: string }).id, label, position: i })));
    setSaving(false);
    if (oErr) { toast.error(oErr.message); return; }
    toast.success(t('voting.created'));
    setOpen(false); load();
  }

  // ── result helpers ────────────────────────────────────────────────────────
  function bars(poll: Poll) {
    const rows = results[poll.id] ?? [];
    const opts = rows.filter(r => r.option_id);
    const abst = rows.find(r => !r.option_id);
    const byShare = poll.weighting === 'by_share';
    const val = (r: ResultRow) => byShare ? Number(r.vote_weight ?? 0) : Number(r.votes ?? 0);
    const total = opts.reduce((s, r) => s + val(r), 0) || 1;
    const hidden = rows[0]?.hidden ?? false;
    const eligible = Number(rows[0]?.eligible ?? 0);
    const castN = byShare ? Number(rows[0]?.cast_weight ?? 0) : Number(rows[0]?.cast_count ?? 0);
    const turnoutPct = eligible > 0 ? Math.round((castN / eligible) * 100) : 0;
    const leader = opts.reduce<ResultRow | null>((best, r) => (best === null || val(r) > val(best) ? r : best), null);
    return { opts, abst, val, total, hidden, eligible, castN, turnoutPct, leader };
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('voting.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('voting.subtitle')}</p>
        </div>
        {canCreate && entities.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => openRules()}>
              <SlidersHorizontal size={14} /> {t('voting.rulesButton')}
            </Button>
            <Button onClick={openCreate}><Plus size={15} /> {t('voting.newVote')}</Button>
          </div>
        )}
      </div>

      {/* the standing rules, visible to the admins at a glance */}
      {isPollManager && entities.length > 0 && (
        <Card><CardBody className="py-3">
          <div className="space-y-1">
            {entities.map(e => (
              <p key={e.key} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{e.name}:</span>{' '}
                {ruleSummary(effectiveRules(e.key))}
                {!defaults[e.key] && <span className="ms-1 opacity-70">({t('voting.rulesDefault')})</span>}
              </p>
            ))}
          </div>
        </CardBody></Card>
      )}

      {loading ? <SkeletonCards count={2} /> : polls.length === 0 ? (
        <Card><CardBody>
          <div className="text-center py-10 text-muted-foreground">
            <VoteIcon size={28} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">{t('voting.empty')}</p>
          </div>
        </CardBody></Card>
      ) : (
        <div className="space-y-4">
          {polls.map(poll => {
            const st = effectiveStatus(poll);
            const { opts, abst, val, total, hidden, eligible, castN, turnoutPct, leader } = bars(poll);
            const mine = myVotes[poll.id];
            const sel = selection[poll.id] ?? [];
            const quorumMet = poll.quorum_pct <= 0 || turnoutPct >= poll.quorum_pct;
            const nonAbstain = total;
            const leaderShare = leader && nonAbstain > 0 ? (val(leader) / nonAbstain) * 100 : 0;
            return (
              <Card key={poll.id}><CardBody>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground flex items-center gap-2 flex-wrap">
                      {poll.title}
                      <Badge variant={st === 'open' ? 'green' : 'slate'}>
                        {st === 'open' ? t('voting.openUntil', { date: fmtDate(poll.closes_at) }) : t('voting.closed')}
                      </Badge>
                      {poll.anonymous && <Badge variant="slate">{t('voting.secretBallot')}</Badge>}
                      {mine && <Badge variant="blue">{t('voting.youVoted')}</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {scopeName(poll)} · {t(`voting.elig_${poll.eligibility}`)}
                      {poll.weighting === 'by_share' && <> · {t('voting.byShare')}</>}
                    </p>
                    {poll.description && <p className="text-sm text-muted-foreground mt-2">{poll.description}</p>}
                  </div>
                  {isPollManager && (
                    <div className="flex items-center gap-1 shrink-0">
                      {st === 'open' && (
                        <Button size="sm" variant="ghost" onClick={() => closeNow(poll)}><Lock size={13} /> {t('voting.closeNow')}</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removePoll(poll)}><X size={14} /></Button>
                    </div>
                  )}
                </div>

                {/* options: vote controls while open, result bars where visible */}
                <div className="mt-4 space-y-2">
                  {opts.map(r => {
                    const o = (options[poll.id] ?? []).find(x => x.id === r.option_id);
                    if (!o) return null;
                    const picked = sel.includes(o.id);
                    const isLeader = st === 'closed' && leader?.option_id === o.id && val(r) > 0;
                    const pct = hidden ? 0 : Math.round((val(r) / total) * 100);
                    return (
                      <button key={o.id} type="button" disabled={st !== 'open'}
                        onClick={() => st === 'open' && toggle(poll, o.id)}
                        className={`relative w-full text-start rounded-lg border px-3 py-2.5 text-sm transition overflow-hidden ${
                          picked && st === 'open' ? 'border-primary/50 bg-primary/10' : 'border-border'
                        } ${st === 'open' ? 'cursor-pointer hover:border-primary/40' : 'cursor-default'}`}>
                        {!hidden && (
                          <span className="absolute inset-y-0 start-0 bg-primary/10" style={{ width: `${pct}%` }} />
                        )}
                        <span className="relative flex items-center justify-between gap-2">
                          <span className={`flex items-center gap-2 ${isLeader ? 'font-semibold' : ''}`}>
                            {st === 'open' && (
                              <span className={`inline-block w-3.5 h-3.5 shrink-0 ${poll.choice_type === 'single' ? 'rounded-full' : 'rounded'} border ${picked ? 'bg-primary border-primary' : 'border-muted-foreground/50'}`} />
                            )}
                            {o.label}
                            {isLeader && <Badge variant={leaderShare >= poll.pass_threshold_pct && quorumMet ? 'green' : 'yellow'}>
                              {!quorumMet ? t('voting.noQuorum') : leaderShare >= poll.pass_threshold_pct ? t('voting.passed') : t('voting.noMajority')}
                            </Badge>}
                          </span>
                          {!hidden && (
                            <span className="tnum text-xs text-muted-foreground shrink-0">
                              {poll.weighting === 'by_share' ? Number(r.vote_weight ?? 0).toLocaleString() : (r.votes ?? 0)} · {pct}%
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {hidden && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Lock size={12} /> {t('voting.resultsAfterClose')}</p>}
                  {!hidden && poll.allow_abstain && Number(abst?.votes ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">{t('voting.abstained', { count: Number(abst?.votes ?? 0) })}</p>
                  )}
                </div>

                {/* turnout + quorum */}
                <p className="text-xs text-muted-foreground mt-3">
                  {t('voting.turnout', {
                    cast: poll.weighting === 'by_share' ? castN.toLocaleString() : castN,
                    eligible: poll.weighting === 'by_share' ? eligible.toLocaleString() : eligible,
                    pct: turnoutPct,
                  })}
                  {poll.quorum_pct > 0 && <> · {t('voting.quorumTarget', { pct: poll.quorum_pct })}{quorumMet ? ' ✓' : ''}</>}
                </p>

                {/* 0169: the roll call - managers only, open ballots only */}
                {isPollManager && !poll.anonymous && (
                  <div className="mt-3">
                    <button type="button" onClick={() => toggleRoll(poll.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer">
                      <Users size={13} /> {rollOpen === poll.id ? t('voting.hideRoll') : t('voting.showRoll')}
                    </button>
                    {rollOpen === poll.id && (
                      <div className="mt-2 rounded-xl border border-border divide-y divide-border/60">
                        {rollBusy && !roll[poll.id] ? (
                          <p className="text-xs text-muted-foreground px-3 py-2.5">{t('common.loading')}</p>
                        ) : (roll[poll.id] ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground px-3 py-2.5">{t('voting.rollEmpty')}</p>
                        ) : (
                          (roll[poll.id] ?? []).map((b, i) => (
                            <div key={`${b.voter_id ?? 'x'}-${b.unit_label}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                              <span className="flex items-center gap-2 min-w-0">
                                {rollIcon(b.status)}
                                <span className="text-sm text-foreground truncate">{b.voter_name || t('voting.rollNobody')}</span>
                                {b.unit_label && <span className="text-xs text-muted-foreground truncate">{b.unit_label}</span>}
                              </span>
                              <span className="text-xs shrink-0 text-end">
                                {b.status === 'voted'
                                  ? <span className="text-foreground">{b.choices.join(', ')}</span>
                                  : b.status === 'abstained'
                                    ? <span className="text-amber-600 dark:text-amber-400">{t('voting.rollAbstained')}</span>
                                    : <span className="text-muted-foreground">{t('voting.rollPending')}</span>}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                    {rollOpen === poll.id && (roll[poll.id] ?? []).length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {t('voting.rollSummary', {
                          voted: (roll[poll.id] ?? []).filter(b => b.status === 'voted').length,
                          abstained: (roll[poll.id] ?? []).filter(b => b.status === 'abstained').length,
                          pending: (roll[poll.id] ?? []).filter(b => b.status === 'pending').length,
                        })}
                      </p>
                    )}
                  </div>
                )}

                {st === 'open' && (
                  <div className="flex items-center gap-2 mt-3">
                    <Button size="sm" onClick={() => cast(poll)} disabled={!sel.length}>
                      {mine && !mine.abstain ? t('voting.updateVote') : t('voting.castVote')}
                    </Button>
                    {poll.allow_abstain && (
                      <Button size="sm" variant="ghost" onClick={() => cast(poll, true)}>
                        {mine?.abstain ? t('voting.abstainedYou') : t('voting.abstain')}
                      </Button>
                    )}
                  </div>
                )}
              </CardBody></Card>
            );
          })}
        </div>
      )}

      {/* ── create: just the question; the rules come from the standing setup ── */}
      <Modal open={open} onClose={() => setOpen(false)} title={t('voting.newVote')} size="lg">
        <div className="space-y-4">
          {entities.length > 1 && (
            <SelectField label={t('voting.scope')} value={form.entityKey} onValueChange={v => setForm({ ...form, entityKey: v })}>
              {entities.map(e => <SelectItem key={e.key} value={e.key}>{e.name}</SelectItem>)}
            </SelectField>
          )}
          <Input label={t('voting.question')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t('voting.questionExample')} />
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t('finance.description')}</label>
            <textarea className={textarea} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t('voting.options')}</label>
            <div className="space-y-2">
              {form.opts.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input className="flex-1" value={o} placeholder={t('voting.optionPlaceholder', { n: i + 1 })}
                    onChange={e => setForm({ ...form, opts: form.opts.map((x, j) => j === i ? e.target.value : x) })} />
                  {form.opts.length > 2 && (
                    <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2 text-muted-foreground"
                      onClick={() => setForm({ ...form, opts: form.opts.filter((_, j) => j !== i) })}>×</Button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setForm({ ...form, opts: [...form.opts, ''] })}>
              {t('voting.addOption')}
            </Button>
          </div>
          <Input label={t('voting.closesAt')} type="datetime-local" value={form.closes_at} onChange={e => setForm({ ...form, closes_at: e.target.value })} />

          {/* the rules that will apply, read-only + one click to edit */}
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('voting.rulesApplied')}</p>
                <p className="text-sm text-foreground mt-1">{ruleSummary(effectiveRules(form.entityKey))}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="shrink-0"
                onClick={() => { setOpen(false); openRules(form.entityKey); }}>
                {t('voting.editRules')}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={create} loading={saving}>{t('voting.publish')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── voting rules (0156): set once, applies to every new vote ── */}
      <Modal open={rulesOpen} onClose={() => setRulesOpen(false)} title={t('voting.rulesButton')} size="lg">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('voting.rulesIntro')}</p>
          {entities.length > 1 && (
            <SelectField label={t('voting.scope')} value={rulesForm.entityKey} onValueChange={switchRulesEntity}>
              {entities.map(e => <SelectItem key={e.key} value={e.key}>{e.name}</SelectItem>)}
            </SelectField>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <SelectField label={t('voting.whoVotes')} value={rulesForm.eligibility} onValueChange={v => setRulesForm({ ...rulesForm, eligibility: v as Poll['eligibility'] })}
              disabled={rulesForm.weighting === 'by_share'}>
              <SelectItem value="all_residents">{t('voting.elig_all_residents')}</SelectItem>
              <SelectItem value="owners_only">{t('voting.elig_owners_only')}</SelectItem>
              <SelectItem value="one_per_unit">{t('voting.elig_one_per_unit')}</SelectItem>
            </SelectField>
            <SelectField label={t('voting.weighting')} value={rulesForm.weighting} onValueChange={v => setRulesForm({ ...rulesForm, weighting: v as Poll['weighting'], ...(v === 'by_share' ? { eligibility: 'one_per_unit' as const } : {}) })}>
              <SelectItem value="per_person">{t('voting.weight_per_person')}</SelectItem>
              <SelectItem value="by_share">{t('voting.weight_by_share')}</SelectItem>
            </SelectField>
            <SelectField label={t('voting.choiceType')} value={rulesForm.choice_type} onValueChange={v => setRulesForm({ ...rulesForm, choice_type: v as Poll['choice_type'] })}>
              <SelectItem value="single">{t('voting.choice_single')}</SelectItem>
              <SelectItem value="multiple">{t('voting.choice_multiple')}</SelectItem>
            </SelectField>
            {rulesForm.choice_type === 'multiple' && (
              <Input label={t('voting.maxChoices')} type="number" min="2" value={String(rulesForm.max_choices)}
                onChange={e => setRulesForm({ ...rulesForm, max_choices: Number(e.target.value) || 2 })} />
            )}
            <SelectField label={t('voting.resultsWhen')} value={rulesForm.results_visibility} onValueChange={v => setRulesForm({ ...rulesForm, results_visibility: v as Poll['results_visibility'] })}>
              <SelectItem value="live">{t('voting.results_live')}</SelectItem>
              <SelectItem value="after_close">{t('voting.results_after_close')}</SelectItem>
            </SelectField>
            <Input label={t('voting.quorum')} type="number" min="0" max="100" value={String(rulesForm.quorum_pct)}
              onChange={e => setRulesForm({ ...rulesForm, quorum_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />
            <Input label={t('voting.passThreshold')} type="number" min="1" max="100" value={String(rulesForm.pass_threshold_pct)}
              onChange={e => setRulesForm({ ...rulesForm, pass_threshold_pct: Math.min(100, Math.max(1, Number(e.target.value) || 50)) })} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-primary" checked={rulesForm.anonymous} onChange={e => setRulesForm({ ...rulesForm, anonymous: e.target.checked })} />
              {t('voting.anonymous')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="accent-primary" checked={rulesForm.allow_abstain} onChange={e => setRulesForm({ ...rulesForm, allow_abstain: e.target.checked })} />
              {t('voting.allowAbstain')}
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{t('voting.rulesHint')} {t('voting.rulesSnapshotNote')}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setRulesOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveRules} loading={saving}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
      {ConfirmDialog}
    </div>
  );
}
