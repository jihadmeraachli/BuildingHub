import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { ScrollText, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { fmtDate } from '@/lib/dateFmt';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Platform-admin view over audit_log (0137). English-only, like the other
 * operator tools (Platform Licensing) — this is a back-office screen, not a
 * tenant-facing one. RLS already restricts audit_log to platform admins; the
 * route + sidebar are gated too so nobody else even reaches it.
 */
type AuditRow = {
  id: number; at: string; actor_id: string | null; actor_aal: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE'; entity: string; entity_id: string | null;
  building_id: string | null; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null;
};

const PAGE = 50;
const ENTITIES = ['buildings', 'compounds', 'units', 'organizations', 'grants', 'memberships',
  'membership_invites', 'subscriptions', 'profiles', 'charges', 'payments', 'adjustments',
  'dues', 'invoices', 'budgets'];
const VERB: Record<string, string> = { INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' };
const ACTION_CLS: Record<string, string> = {
  INSERT: 'bg-emerald-500/15 text-emerald-500',
  UPDATE: 'bg-amber-500/15 text-amber-500',
  DELETE: 'bg-rose-500/15 text-rose-500',
};
const NOISE = new Set(['updated_at', 'created_at']);

function nameOf(row: Record<string, unknown> | null): string {
  if (!row) return '';
  return String(row.name ?? row.label ?? row.full_name ?? row.title ?? row.description ?? '') || '';
}
function short(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? s.slice(0, 57) + '…' : s;
}

export default function Activity() {
  const { isPlatformAdmin } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [entityF, setEntityF] = useState('');
  const [actionF, setActionF] = useState('');
  const [buildingF, setBuildingF] = useState('');
  const [buildingOpts, setBuildingOpts] = useState<{ value: string; label: string }[]>([{ value: '', label: 'All buildings' }]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const load = useCallback(async (reset: boolean) => {
    reset ? setLoading(true) : setMore(true);
    const from = reset ? 0 : rows.length;
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).range(from, from + PAGE - 1);
    if (entityF) q = q.eq('entity', entityF);
    if (actionF) q = q.eq('action', actionF);
    if (buildingF) q = q.eq('building_id', buildingF);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setLoading(false); setMore(false); return; }
    const batch = (data as AuditRow[]) ?? [];
    setHasMore(batch.length === PAGE);
    const next = reset ? batch : [...rows, ...batch];
    setRows(next);
    // Resolve every uuid we might show — the actor AND any uuid VALUE in the
    // before/after (deleted_by, created_by, user_id, tenant_id…) — to a name.
    // Non-profile uuids (building ids etc.) simply won't match and fall back.
    const ids = new Set<string>();
    next.forEach((r) => {
      if (r.actor_id) ids.add(r.actor_id);
      [r.old_row, r.new_row].forEach((obj) => {
        if (obj) Object.values(obj).forEach((v) => { if (typeof v === 'string' && UUID_RE.test(v)) ids.add(v); });
      });
    });
    if (ids.size) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', [...ids]);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: { id: string; full_name: string }) => { map[p.id] = p.full_name; });
      setNames(map);
    }
    setLoading(false); setMore(false);
  }, [entityF, actionF, buildingF, rows]);

  // building filter options
  useEffect(() => {
    supabase.from('buildings').select('id, name').order('name').then(({ data }) => {
      setBuildingOpts([{ value: '', label: 'All buildings' }, ...((data ?? []) as { id: string; name: string }[]).map((b) => ({ value: b.id, label: b.name }))]);
    });
  }, []);

  // reload on filter change
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityF, actionF, buildingF]);

  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const display = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) && names[v]) ? names[v] : short(v);

  function changedFields(r: AuditRow): [string, unknown, unknown][] {
    if (r.action !== 'UPDATE' || !r.old_row || !r.new_row) return [];
    return Object.keys(r.new_row)
      .filter((k) => !NOISE.has(k) && JSON.stringify(r.old_row![k]) !== JSON.stringify(r.new_row![k]))
      .map((k) => [k, r.old_row![k], r.new_row![k]]);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <ScrollText size={22} /> Activity log
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every privilege change, deletion and financial edit across the platform, with who did it and when.
          Append-only and tamper-evident. Platform admins only.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={entityF} onChange={(e) => setEntityF(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">All tables</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <SearchableSelect options={buildingOpts} value={buildingF} onChange={setBuildingF}
          placeholder="All buildings" searchPlaceholder="Search building…" emptyText="No building" className="min-w-[190px]" />
        <div className="flex gap-1">
          {['', 'INSERT', 'UPDATE', 'DELETE'].map((a) => (
            <button key={a} onClick={() => setActionF(a)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                actionF === a ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:text-foreground'}`}>
              {a === '' ? 'All' : VERB[a][0].toUpperCase() + VERB[a].slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonCards />
      ) : rows.length === 0 ? (
        <Card className="text-center py-16">
          <ShieldAlert size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No activity recorded yet for this filter.</p>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const actor = r.actor_id ? (names[r.actor_id] ?? 'Unknown user') : 'System';
            const label = nameOf(r.new_row) || nameOf(r.old_row);
            const changes = changedFields(r);
            const expandable = r.action !== 'UPDATE' ? !!(r.old_row || r.new_row) : changes.length > 0;
            const isOpen = open.has(r.id);
            return (
              <Card key={r.id} className="px-4 py-3">
                <div className={`flex items-start gap-3 ${expandable ? 'cursor-pointer' : ''}`} onClick={() => expandable && toggle(r.id)}>
                  {expandable
                    ? <span className="mt-0.5 text-muted-foreground">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                    : <span className="w-[15px]" />}
                  <span className={`shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${ACTION_CLS[r.action]}`}>{VERB[r.action]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{actor}</span> {VERB[r.action]}{' '}
                      <span className="font-medium">{r.entity.replace(/_/g, ' ')}</span>
                      {label ? <span className="text-muted-foreground"> · {label}</span> : ''}
                      {r.actor_aal === 'aal1' ? <span className="ms-2 text-[10px] text-amber-500 border border-amber-500/40 rounded px-1">no 2FA</span> : ''}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(r.at, 'dd-MM-yyyy · HH:mm')}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}
                    </p>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-2.5 ms-[26px] rounded-lg bg-accent/40 border border-border p-3 text-xs font-mono overflow-x-auto">
                    {r.action === 'UPDATE' ? (
                      changes.length ? changes.map(([k, o, n]) => (
                        <div key={k} className="whitespace-nowrap">
                          <span className="text-muted-foreground">{k}:</span>{' '}
                          <span className="text-rose-500">{display(o)}</span> → <span className="text-emerald-500">{display(n)}</span>
                        </div>
                      )) : <span className="text-muted-foreground">No field changes recorded.</span>
                    ) : (
                      <pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.action === 'DELETE' ? r.old_row : r.new_row, null, 2)}</pre>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          {hasMore && (
            <div className="pt-3 text-center">
              <Button variant="secondary" onClick={() => load(false)} loading={more}>Load more</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
