import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtDate } from '@/lib/dateFmt';
import * as XLSX from 'xlsx';
import {
  Upload, Download, Users, Building2, Home, BarChart3,
  CheckCircle2, Loader2, X, RefreshCw, Undo2,
} from 'lucide-react';
import type { Grant } from '@/types';
import { toast } from '@/lib/toast';
import { isEmail, isPhone, normalizePhone } from '@/lib/validate';
import { supabase } from '@/lib/supabase';

import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import type { Entity } from '@/lib/entities';
import { Button } from '@/components/ui/Button';
import { RadixSelect, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectSeparator } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/lib/useConfirm';

// ─── Types ───────────────────────────────────────────────────────────────────

type ImportTab = 'users' | 'buildings' | 'units' | 'balances';
type StepState = 'upload' | 'preview' | 'running' | 'done';
type RowStatus = 'pending' | 'processing' | 'done' | 'exists' | 'skipped' | 'error';

interface ProgressRow { label: string; detail?: string; status: RowStatus; error?: string; }
interface UserRow { name: string; email: string; phone: string; role: string; }
interface BuildingRow { name: string; address: string; city: string; compound_name: string; }
interface UnitRow { label: string; floor: string; building_name: string; compound_name: string; owner_email: string; owner_name: string; owner_phone: string; tenant_email: string; tenant_name: string; tenant_phone: string; share_weight: string; invalid?: string; building_id?: string | null; existing?: { id: string; label: string }; }
interface DbUnit { id: string; label: string; share_weight: number; building_id: string; opening_balance?: number | null; }


interface ImportBatch { id: string; file_name: string | null; n_expenses: number; n_charges: number; n_payments: number; created_at: string; reversed_at: string | null; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
  if (raw.length < 2) return [];
  const headers = (raw[0] as unknown[]).map(h => String(h ?? '').trim());
  return raw.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String((row as unknown[])[i] ?? '').trim(); });
    return obj;
  }).filter(row => Object.values(row).some(v => v !== ''));
}

function pickCol(row: Record<string, string>, ...candidates: string[]): string {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  for (const c of candidates) {
    const v = lower[c.toLowerCase()];
    if (v !== undefined) return v;
  }
  return '';
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

/** Money from a spreadsheet cell - STRICT. Accepts 1234.56 / 1,234.56 / -150;
 *  rejects the locale traps that would silently import the WRONG number
 *  (European "1.234,56" -> 1.23; comma-decimal "12,5" -> 125; SAP-style
 *  trailing minus "150-" -> +150). NaN = show the row as invalid. */
function parseMoney(raw: string): number {
  const s = raw.trim().replace(/^\$/, '').trim();
  if (!/^-?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(s)) return NaN;
  return Math.round(parseFloat(s.replace(/,/g, '')) * 100) / 100;
}

/** One label normalizer for "same unit" everywhere (dup detection, AI matcher). */
const normLabel = (s: string) => s.toLowerCase().replace(/\s+/g, '');

function findBuildingId(entities: Entity[], buildingName: string, compoundName: string): string | null {
  const norm = (s: string) => s.toLowerCase().trim();
  const bNorm = norm(buildingName);
  const cNorm = norm(compoundName);
  if (cNorm) {
    const entity = entities.find(e => e.kind === 'compound' && norm(e.name) === cNorm);
    if (entity) return entity.blocks.find(b => norm(b.name) === bNorm)?.id ?? null;
  }
  for (const entity of entities) {
    const block = entity.blocks.find(b => norm(b.name) === bNorm);
    if (block) return block.id;
  }
  return null;
}

// ─── Status chip ─────────────────────────────────────────────────────────────

function StatusChip({ status, error }: { status: RowStatus; error?: string }) {
  if (status === 'pending')    return <span className="text-muted-foreground text-xs">Pending</span>;
  if (status === 'processing') return <Loader2 size={14} className="animate-spin text-primary" />;
  if (status === 'done')       return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (status === 'exists')     return <span className="text-xs text-amber-300">Already exists</span>;
  if (status === 'skipped')    return <span className="text-xs text-muted-foreground">Skipped</span>;
  return <span className="text-xs text-red-400 truncate max-w-[120px]" title={error}>{error ?? 'Error'}</span>;
}

// ─── Drop zone ───────────────────────────────────────────────────────────────

function DropZone({ onFile, accept, hint }: { onFile: (f: File) => void; accept?: string; hint?: string }) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);
  return (
    <div
      onDrop={onDrop}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onClick={() => ref.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors',
        dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
      )}
    >
      <Upload size={32} className="text-primary/60" />
      <p className="text-sm text-muted-foreground text-center">
        Drop file here or <span className="text-primary font-medium">click to browse</span>
      </p>
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ''; } }} />
    </div>
  );
}

// ─── Progress table ──────────────────────────────────────────────────────────

function ProgressTable({ rows, title }: { rows: ProgressRow[]; title?: string }) {
  const done = rows.filter(r => r.status === 'done' || r.status === 'exists').length;
  const errs = rows.filter(r => r.status === 'error').length;
  return (
    <div className="space-y-2">
      {title && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{title}</p>}
      <div className="rounded-lg border border-border overflow-hidden text-sm">
        <div className="divide-y divide-border max-h-72 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2">
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{r.label}</span>
                {r.detail && <span className="text-xs text-muted-foreground">{r.detail}</span>}
              </div>
              <StatusChip status={r.status} error={r.error} />
            </div>
          ))}
        </div>
      </div>
      {rows.some(r => r.status !== 'pending' && r.status !== 'processing') && (
        <p className="text-xs text-muted-foreground">{done} of {rows.length} succeeded{errs > 0 ? `, ${errs} failed` : ''}</p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Import() {
  const { grants, isPlatformAdmin } = useAuth();
  const { buildings } = useManagedBuildings();
  const entities = useEntities(buildings as Parameters<typeof useEntities>[0]);
  // FINAL DESIGN: building/compound admins get exactly two tabs - Structure
  // (units + people, one spreadsheet) and Expenses & Balances. Users and
  // Buildings imports are portfolio tools for org/platform scope.
  const portfolioScope = isPlatformAdmin || grants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const [activeTab, setActiveTab] = useState<ImportTab>(portfolioScope ? 'users' : 'units');

  const canImport = isPlatformAdmin || grants.some(g =>
    ['building_admin', 'org_admin', 'compound_admin'].includes(g.role)
  );

  if (!canImport) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          You don't have permission to import data.
        </CardContent>
      </Card>
    );
  }

  const TABS: { key: ImportTab; label: string; Icon: React.ElementType }[] = [
    ...(portfolioScope ? [
      { key: 'users' as ImportTab, label: 'Users', Icon: Users },
      { key: 'buildings' as ImportTab, label: 'Buildings', Icon: Building2 },
    ] : []),
    { key: 'units',     label: 'Structure',           Icon: Home },
    { key: 'balances',  label: 'Balances',            Icon: BarChart3 },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bulk Import</h1>
        <p className="text-sm text-muted-foreground mt-1">Onboard clients, buildings, units, and financial data at scale.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0',
              activeTab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'users'     && <UsersTab />}
      {activeTab === 'buildings' && portfolioScope && <BuildingsTab isPlatformAdmin={isPlatformAdmin} grants={grants} />}
      {activeTab === 'units'     && <UnitsTab entities={entities} />}
      {activeTab === 'balances'  && <BalancesTab entities={entities} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 1 — USERS
// ════════════════════════════════════════════════════════════════════════════

function UsersTab() {
  const [step, setStep] = useState<StepState>('upload');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);

  const TEMPLATE = [
    ['Name', 'Email', 'Phone', 'Role'],
    ['Sami Karam', 'sami@example.com', '+9611234567', 'owner'],
    ['Dana Saab', 'dana@example.com', '+9619876543', 'tenant'],
  ];

  async function handleFile(file: File) {
    try {
      const data = await parseSpreadsheet(file);
      if (!data.length) { toast.error('File appears empty'); return; }
      const parsed: UserRow[] = data.map(row => ({
        name:  pickCol(row, 'name', 'full name', 'client name', 'الاسم'),
        email: pickCol(row, 'email', 'email address', 'البريد'),
        phone: pickCol(row, 'phone', 'mobile', 'telephone', 'الهاتف'),
        role:  pickCol(row, 'role', 'type', 'الدور').toLowerCase().includes('tenant') ? 'tenant' : 'owner',
      })).filter(r => r.email.includes('@'));
      if (!parsed.length) { toast.error('No valid email rows found'); return; }
      setRows(parsed);
      setStep('preview');
    } catch { toast.error('Could not read file'); }
  }

  async function runImport() {
    setProgress(rows.map(r => ({ label: r.name || r.email, detail: r.email, status: 'pending' })));
    setStep('running');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'processing' } : p));
      try {
        const { data, error } = await supabase.functions.invoke('invite-user', {
          body: { email: row.email.trim().toLowerCase(), full_name: row.name || row.email, phone: row.phone || null, mode: 'import' },
        });
        if (error) throw new Error(error.message);
        const st: RowStatus = data?.existing ? 'exists' : 'done';
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: st } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'error', error: msg } : p));
      }
    }
    setStep('done');
  }

  function reset() { setStep('upload'); setRows([]); setProgress([]); }

  if (step === 'upload') return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">Upload a spreadsheet of users to bulk-invite them. Each user receives a magic-link email to set up their account.</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv('users-template.csv', TEMPLATE)}>
        <Download size={14} /> Download template
      </Button>
      <DropZone onFile={handleFile} accept=".csv,.xlsx,.xls" hint="CSV or Excel • Name, Email, Phone, Role" />
    </div>
  );

  if (step === 'preview') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{rows.length} user{rows.length !== 1 ? 's' : ''} ready to invite</p>
        <Button variant="ghost" size="sm" onClick={reset}><X size={14} /></Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden text-sm">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>{['Name', 'Email', 'Phone', 'Role'].map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.email}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.phone}</td>
                <td className="px-4 py-2 capitalize">{r.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button onClick={runImport}>Send {rows.length} invitation{rows.length !== 1 ? 's' : ''}</Button>
        <Button variant="outline" onClick={reset}>Cancel</Button>
      </div>
    </div>
  );

  if (step === 'running' || step === 'done') return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{step === 'running' ? 'Sending invitations…' : 'Done'}</p>
        {step === 'done' && <Button variant="ghost" size="sm" onClick={reset}><RefreshCw size={14} className="me-1" />Import more</Button>}
      </div>
      <ProgressTable rows={progress} />
      {step === 'done' && (
        <p className="text-xs text-muted-foreground">Users who already have an account show as "Already exists". No duplicate invite was sent.</p>
      )}
    </div>
  );

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 2 — BUILDINGS
// ════════════════════════════════════════════════════════════════════════════

function BuildingsTab({ isPlatformAdmin, grants }: { isPlatformAdmin: boolean; grants: Grant[] }) {
  const [step, setStep] = useState<StepState>('upload');
  const [rows, setRows] = useState<BuildingRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);

  const TEMPLATE = [
    ['Building Name', 'Address', 'City', 'Compound Name'],
    ['Block A', '123 Hamra St', 'Beirut', 'Sunset Gardens'],
    ['Block B', '125 Hamra St', 'Beirut', 'Sunset Gardens'],
    ['Tower C', '55 Verdun Ave', 'Beirut', ''],
  ];

  // Auto-detect org for org admins
  useEffect(() => {
    const grant = grants.find(g => g.scope_type === 'org' && g.role === 'org_admin');
    if (grant?.org_id) setOrgId(grant.org_id);
  }, [grants]);

  // Platform admins see org picker
  useEffect(() => {
    if (!isPlatformAdmin) return;
    supabase.from('organizations').select('id, name').order('name').then(({ data }) => setOrgs(data ?? []));
  }, [isPlatformAdmin]);

  async function handleFile(file: File) {
    try {
      const data = await parseSpreadsheet(file);
      if (!data.length) { toast.error('File appears empty'); return; }
      const parsed: BuildingRow[] = data.map(row => ({
        name:          pickCol(row, 'building name', 'name', 'الاسم', 'building'),
        address:       pickCol(row, 'address', 'العنوان') || '-',
        city:          pickCol(row, 'city', 'المدينة') || 'Beirut',
        compound_name: pickCol(row, 'compound name', 'compound', 'المجمع'),
      })).filter(r => r.name);
      if (!parsed.length) { toast.error('No valid building rows found'); return; }
      setRows(parsed);
      setStep('preview');
    } catch { toast.error('Could not read file'); }
  }

  async function runImport() {
    setProgress(rows.map(r => ({ label: r.name, detail: r.compound_name ? `Compound: ${r.compound_name}` : 'Standalone', status: 'pending' })));
    setStep('running');

    // Cache compound name → id
    const compoundCache: Record<string, string> = {};

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'processing' } : p));
      try {
        let compound_id: string | null = null;

        if (row.compound_name) {
          if (compoundCache[row.compound_name]) {
            compound_id = compoundCache[row.compound_name];
          } else {
            // Find or create compound
            const { data: existing } = await supabase
              .from('compounds')
              .select('id')
              .ilike('name', row.compound_name)
              .maybeSingle();
            if (existing) {
              compound_id = existing.id;
            } else {
              const { data: created, error: cErr } = await supabase
                .from('compounds')
                .insert({ name: row.compound_name, city: row.city, country: 'Lebanon', ...(orgId ? { org_id: orgId } : {}) })
                .select('id').single();
              if (cErr) throw new Error(`Compound: ${cErr.message}`);
              compound_id = created.id;
            }
            compoundCache[row.compound_name] = compound_id!;
          }
        }

        const { data: bld, error: bErr } = await supabase
          .from('buildings')
          .insert({ name: row.name, address: row.address, city: row.city, country: 'Lebanon', compound_id })
          .select('id').single();
        if (bErr) throw new Error(bErr.message);

        // Link to org
        if (orgId && bld?.id) {
          await supabase.from('org_buildings').insert({ org_id: orgId, building_id: bld.id });
        }

        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'done' } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'error', error: msg } : p));
      }
    }
    setStep('done');
  }

  function reset() { setStep('upload'); setRows([]); setProgress([]); }

  if (step === 'upload') return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">Import buildings and compounds. Use the Compound Name column to group blocks under a compound. Leave it blank for standalone buildings.</p>
      {isPlatformAdmin && orgs.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Assign to org (optional)</label>
          <RadixSelect value={orgId || '__none__'} onValueChange={v => setOrgId(v === '__none__' ? '' : v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No org</SelectItem>
              {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </RadixSelect>
        </div>
      )}
      <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv('buildings-template.csv', TEMPLATE)}>
        <Download size={14} /> Download template
      </Button>
      <DropZone onFile={handleFile} accept=".csv,.xlsx,.xls" hint="CSV or Excel • Building Name, Address, City, Compound Name" />
    </div>
  );

  if (step === 'preview') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{rows.length} building{rows.length !== 1 ? 's' : ''} ready to import</p>
        <Button variant="ghost" size="sm" onClick={reset}><X size={14} /></Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden text-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>{['Building Name', 'Compound', 'Address', 'City'].map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.compound_name || '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.address}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.city}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button onClick={runImport}>Import {rows.length} building{rows.length !== 1 ? 's' : ''}</Button>
        <Button variant="outline" onClick={reset}>Cancel</Button>
      </div>
    </div>
  );

  if (step === 'running' || step === 'done') return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{step === 'running' ? 'Importing buildings…' : 'Done'}</p>
        {step === 'done' && <Button variant="ghost" size="sm" onClick={reset}><RefreshCw size={14} className="me-1" />Import more</Button>}
      </div>
      <ProgressTable rows={progress} />
    </div>
  );

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 3 — UNITS
// ════════════════════════════════════════════════════════════════════════════

function UnitsTab({ entities }: { entities: Entity[] }) {
  const [step, setStep] = useState<StepState>('upload');
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  // Duplicate matching: the key is (RESOLVED building, label) — so in a
  // compound the block is part of the identity, in a standalone building the
  // label alone is. 'update' rewrites share weight + links; 'skip' leaves them.
  const [dupMode, setDupMode] = useState<'update' | 'skip'>('update');
  // Licence pool per subscription (blocks of a compound SHARE one pool):
  // buildingId -> subscriptionId, subscriptionId -> seats left.
  const [subByBuilding, setSubByBuilding] = useState<Record<string, string>>({});
  const [poolLeft, setPoolLeft] = useState<Record<string, number>>({});

  // ── Scope-aware template: a building admin never needs Building/Compound
  // columns (their one building is implied); a compound admin names the BLOCK;
  // only org/platform scope needs the full addressing columns.
  const soleStandalone = entities.length === 1 && entities[0].kind === 'building' ? entities[0] : null;
  const soleCompound   = entities.length === 1 && entities[0].kind === 'compound' ? entities[0] : null;

  // Guidance convention: any row whose Unit Label starts with "e.g." is
  // template scaffolding (the guide row) and is skipped on import, so leaving
  // it in the file can never create junk units.
  const GUIDE = 'e.g. (guide row - your data starts on the next row)';
  // [header, guide] pairs, each written ONCE - only the addressing columns
  // vary by scope. TEMPLATE = header row + guide row; data starts on row 3.
  const scopeCols: [string, string][] = soleStandalone ? []
    : soleCompound ? [
      ['Block Name', 'Required. Must match one of your blocks: ' + soleCompound.blocks.map(b => b.name).join(', ')],
    ] : [
      ['Building Name', 'Required. Must match an existing building/block name'],
      ['Compound Name', 'Only for blocks inside a compound, else leave empty'],
    ];
  const COLS: [string, string][] = [
    ['Unit Label', GUIDE],
    ['Floor', 'Optional'],
    ...scopeCols,
    ['Share Weight', 'Optional, default 1. Relative share of common expenses'],
    ['Owner Email', 'Optional. Invites and links the owner'],
    ['Owner Name', 'Optional. Their real name (else the email is used)'],
    ['Owner Phone', 'Optional. With country code, e.g. +9613123456'],
    ['Tenant Email', 'Optional. Invites and links the tenant'],
    ['Tenant Name', 'Optional. Their real name (else the email is used)'],
    ['Tenant Phone', 'Optional. With country code, e.g. +9613123456'],
  ];
  const TEMPLATE: string[][] = [COLS.map(c => c[0]), COLS.map(c => c[1])];

  /** Where a row's unit lands, honoring the admin's scope: a sole standalone
   *  building is always implied; inside a sole compound the Block Name column
   *  resolves against that compound (and a single-block compound implies it). */
  function resolveBuildingId(r: UnitRow): string | null {
    if (soleStandalone) return soleStandalone.buildingIds[0] ?? null;
    if (soleCompound) {
      if (!r.building_name && soleCompound.blocks.length === 1) return soleCompound.blocks[0].id;
      return findBuildingId(entities, r.building_name, r.compound_name || soleCompound.name);
    }
    return findBuildingId(entities, r.building_name, r.compound_name);
  }

  const dupKey = (bid: string | null, label: string) => `${bid}|${normLabel(label)}`;

  async function handleFile(file: File) {
    try {
      const data = await parseSpreadsheet(file);
      if (!data.length) { toast.error('File appears empty'); return; }
      const all: UnitRow[] = data.map(row => ({
        label:         pickCol(row, 'unit label', 'unit', 'apt', 'apartment', 'رقم الشقة', 'الوحدة'),
        floor:         pickCol(row, 'floor', 'الطابق'),
        building_name: pickCol(row, 'building name', 'building', 'block name', 'block', 'المبنى'),
        compound_name: pickCol(row, 'compound name', 'compound', 'tower', 'المجمع'),
        owner_email:   pickCol(row, 'owner email', 'owner', 'المالك'),
        owner_name:    pickCol(row, 'owner name', 'اسم المالك'),
        owner_phone:   pickCol(row, 'owner phone', 'owner mobile', 'هاتف المالك'),
        tenant_email:  pickCol(row, 'tenant email', 'tenant', 'المستأجر'),
        tenant_name:   pickCol(row, 'tenant name', 'اسم المستأجر'),
        tenant_phone:  pickCol(row, 'tenant phone', 'tenant mobile', 'هاتف المستأجر'),
        share_weight:  pickCol(row, 'share weight', 'share', 'الحصة') || '1',
      })).filter(r => r.label);
      // guidance rows travel with the template; never let them import
      const parsed = all.filter(r => !/^e\.g\./i.test(r.label));
      // Field checks: catch swapped columns and malformed contacts BEFORE the
      // import runs. A bad row is shown with its reason and refuses to import.
      const emailOk = (v: string) => !v || isEmail(v);
      const phoneOk = (v: string) => !v || isPhone(v);
      for (const r of parsed) {
        if (r.owner_name && /^\d+$/.test(r.owner_name.trim())) r.invalid = 'Owner name is all digits - did the phone land in the name column?';
        else if (r.tenant_name && /^\d+$/.test(r.tenant_name.trim())) r.invalid = 'Tenant name is all digits - did the phone land in the name column?';
        else if (!emailOk(r.owner_email)) r.invalid = `"${r.owner_email}" is not a valid email`;
        else if (!emailOk(r.tenant_email)) r.invalid = `"${r.tenant_email}" is not a valid email`;
        else if (!phoneOk(r.owner_phone)) r.invalid = `Owner phone must include the country code, e.g. +9613123456 (got "${r.owner_phone}")`;
        else if (!phoneOk(r.tenant_phone)) r.invalid = `Tenant phone must include the country code, e.g. +9613123456 (got "${r.tenant_phone}")`;
      }
      const skipped = all.length - parsed.length;
      if (skipped > 0) toast.success('Skipped ' + skipped + ' template guide row' + (skipped !== 1 ? 's' : ''));
      if (!parsed.length) { toast.error('No valid unit rows found'); return; }
      // Existing units in every destination building (duplicate detection) +
      // the licence pool per subscription (seat auto-assignment).
      // Resolve each row's destination ONCE here - the preview and the import
      // read plain fields instead of re-scanning entities every render.
      for (const r of parsed) r.building_id = resolveBuildingId(r);
      const bids = [...new Set(parsed.map(r => r.building_id).filter(Boolean))] as string[];
      const exMap: Record<string, { id: string; label: string }> = {};
      const sMap: Record<string, string> = {};
      const pMap: Record<string, number> = {};
      if (bids.length) {
        const { data: ex } = await supabase.from('units').select('id, label, building_id').in('building_id', bids);
        (ex ?? []).forEach(u => { exMap[dupKey(u.building_id, u.label)] = { id: u.id, label: u.label }; });
        // one parallel burst - each destination building's pool is independent
        const subs = await Promise.all(bids.map(async bid => {
          const { data: si } = await supabase.rpc('get_building_subscription', { p_building_id: bid });
          return { bid, si };
        }));
        for (const { bid, si } of subs) {
          const sub = Array.isArray(si) ? si[0] : si;
          if (sub?.id) {
            sMap[bid] = sub.id;
            if (!(sub.id in pMap)) pMap[sub.id] = sub.status === 'trial' ? 1e9 : Number(sub.available_count ?? 0);
          }
        }
      }
      for (const r of parsed) r.existing = exMap[dupKey(r.building_id ?? null, r.label)];
      setSubByBuilding(sMap); setPoolLeft(pMap);
      setRows(parsed);
      setStep('preview');
    } catch { toast.error('Could not read file'); }
  }

  /** Invite (or find) the person and link them to the unit — skipping the
   *  insert when an identical live membership already exists, so re-imports
   *  never duplicate links. `cache` (email -> user id) spans one run: a
   *  landlord owning 20 units costs one invite-user call, not 20. */
  async function linkParty(cache: Map<string, string>, unitId: string, buildingId: string, email: string, name: string, phone: string, tenure: 'owner' | 'tenant') {
    if (!email.includes('@')) return;
    const key = email.trim().toLowerCase();
    let userId = cache.get(key);
    if (!userId) {
      const { data: inv } = await supabase.functions.invoke('invite-user', {
        body: { email: key, full_name: name.trim() || email, mode: 'import', building_id: buildingId,
                phone: normalizePhone(phone) || null },
      });
      if (!inv?.user_id) return;
      userId = inv.user_id as string;
      cache.set(key, userId);
    }
    const { data: already } = await supabase.from('memberships').select('id')
      .eq('unit_id', unitId).eq('user_id', userId).eq('tenure', tenure).is('ended_at', null).limit(1);
    if (!already?.length) {
      await supabase.from('memberships').insert({ user_id: userId, unit_id: unitId, tenure });
    }
  }

  async function runImport() {
    setProgress(rows.map(r => ({ label: r.label, detail: r.compound_name ? `${r.compound_name} › ${r.building_name}` : r.building_name, status: 'pending' })));
    setStep('running');
    const left = { ...poolLeft };   // seats remaining per subscription, this run
    const invited = new Map<string, string>();   // email -> user id, one invite call per person

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'processing' } : p));
      try {
        if (row.invalid) throw new Error(row.invalid);
        const buildingId = row.building_id ?? null;
        if (!buildingId) {
          throw new Error(soleCompound
            ? `Block "${row.building_name}" not found. Your blocks: ${soleCompound.blocks.map(b => b.name).join(', ')}. Blocks are defined at registration; rename them in Buildings.`
            : `Building "${row.building_name}"${row.compound_name ? ` in "${row.compound_name}"` : ''} not found`);
        }

        const ex = row.existing;
        if (ex && dupMode === 'skip') {
          setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'skipped' } : p));
          continue;
        }

        if (ex) {
          // UPDATE path: refresh the share weight, (re)link people. Licensing untouched.
          const { error: upErr } = await supabase.from('units')
            .update({ share_weight: parseFloat(row.share_weight) || 1 }).eq('id', ex.id);
          if (upErr) throw new Error(upErr.message);
          await Promise.all([
            linkParty(invited, ex.id, buildingId, row.owner_email, row.owner_name, row.owner_phone, 'owner'),
            linkParty(invited, ex.id, buildingId, row.tenant_email, row.tenant_name, row.tenant_phone, 'tenant'),
          ]);
          setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'done', detail: 'updated existing unit' } : p));
          continue;
        }

        const { data: unit, error: uErr } = await supabase
          .from('units')
          .insert({
            building_id:  buildingId,
            label:        row.label,
            share_weight: parseFloat(row.share_weight) || 1,
          })
          .select('id').single();
        if (uErr) throw new Error(uErr.message);

        await Promise.all([
          linkParty(invited, unit.id, buildingId, row.owner_email, row.owner_name, row.owner_phone, 'owner'),
          linkParty(invited, unit.id, buildingId, row.tenant_email, row.tenant_name, row.tenant_phone, 'tenant'),
        ]);

        // Seat auto-assignment (Structure parity): consume a licence while the
        // pool has one; past that the unit is created UNLICENSED and says so.
        let note = '';
        const sid = subByBuilding[buildingId];
        if (sid && (left[sid] ?? 0) > 0) {
          const { error: licErr } = await supabase.from('license_assignments').insert({
            subscription_id: sid, unit_id: unit.id,
          });
          if (!licErr) {
            left[sid] = (left[sid] ?? 0) - 1;
            await supabase.from('subscription_events').insert({
              subscription_id: sid, event_type: 'license_assigned',
              metadata: { unit_id: unit.id, unit_label: row.label, via: 'import' },
            });
          } else { note = licErr.message.includes('LICENSE_POOL_EMPTY') ? ' · unlicensed (pool empty)' : ' · unlicensed (assignment failed)'; }
        } else if (sid) {
          note = ' · unlicensed (pool empty)';
        }
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'done', detail: (p.detail ?? '') + note } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'error', error: msg } : p));
      }
    }
    setStep('done');
  }

  function reset() { setStep('upload'); setRows([]); setProgress([]); }

  if (step === 'upload') return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">One spreadsheet for your whole structure: units with their owners and tenants (name, email, phone). People are invited automatically and linked to their units; licences are assigned from your pool as units are created.</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv('structure-template.csv', TEMPLATE)}>
        <Download size={14} /> Download template
      </Button>
      <DropZone onFile={handleFile} accept=".csv,.xlsx,.xls"
        hint={soleStandalone ? 'CSV or Excel • Unit Label, Floor, Share Weight, Owner Email, Tenant Email'
          : soleCompound ? 'CSV or Excel • Unit Label, Floor, Block Name, Share Weight, Owner Email, Tenant Email'
          : 'CSV or Excel • Unit Label, Floor, Building Name, Compound Name, Owner Email, Share Weight'} />
    </div>
  );

  const dupCount = rows.filter(r => r.existing).length;

  if (step === 'preview') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {rows.length} unit{rows.length !== 1 ? 's' : ''} ready to import
          {dupCount > 0 && (
            <span className="ms-2 text-xs font-normal text-amber-600 dark:text-amber-400">
              {dupCount} already exist
            </span>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={reset}><X size={14} /></Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden text-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>{(soleStandalone ? ['Unit', 'Floor', 'Owner', 'Tenant', 'Share Wt']
                : soleCompound ? ['Unit', 'Floor', 'Block', 'Owner', 'Tenant', 'Share Wt']
                : ['Unit', 'Floor', 'Building', 'Compound', 'Owner', 'Tenant', 'Share Wt']
              ).map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={!r.building_id || r.invalid ? 'opacity-40' : ''}>
                <td className="px-4 py-2 font-medium">
                  {r.label}
                  {r.existing && <span className="ms-1.5 text-[10px] rounded-full px-1.5 py-0.5 bg-amber-400/15 text-amber-600 dark:text-amber-400 align-middle">exists</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.floor || '—'}</td>
                {soleCompound && (
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.building_name || soleCompound.blocks[0]?.name || '—'}
                    {r.building_name.trim() && !r.building_id && (
                      <span className="ms-1.5 text-[10px] rounded-full px-1.5 py-0.5 bg-red-400/15 text-red-500 dark:text-red-400 align-middle">unknown block</span>
                    )}
                  </td>
                )}
                {!soleStandalone && !soleCompound && <td className="px-4 py-2 text-muted-foreground">{r.building_name}</td>}
                {!soleStandalone && !soleCompound && <td className="px-4 py-2 text-muted-foreground text-xs">{r.compound_name || '—'}</td>}
                <td className="px-4 py-2 text-xs">
                  {r.owner_name && <span className="block text-foreground">{r.owner_name}</span>}
                  <span className="text-muted-foreground">{r.owner_email || '—'}</span>
                </td>
                <td className="px-4 py-2 text-xs">
                  {r.tenant_name && <span className="block text-foreground">{r.tenant_name}</span>}
                  <span className="text-muted-foreground">{r.tenant_email || '—'}</span>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.share_weight || '1'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {soleCompound && rows.some(r => r.building_name.trim() && !r.building_id) && (
        <div className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2">
          <span className="text-red-500 dark:text-red-400">Some rows name a block that does not exist.</span>
          <span className="text-muted-foreground">Your blocks: {soleCompound.blocks.map(b => b.name).join(', ')}. Fix the file, or rename blocks in Buildings.</span>
        </div>
      )}
      {rows.some(r => r.invalid) && (
        <div className="rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-sm space-y-1">
          {rows.filter(r => r.invalid).map((r, i) => (
            <p key={i} className="text-red-500 dark:text-red-400">Row "{r.label}": {r.invalid}</p>
          ))}
        </div>
      )}
      {dupCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2">
          <span className="text-muted-foreground">Units that already exist:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={dupMode === 'update'} onChange={() => setDupMode('update')} className="accent-primary" />
            Update them (share weight + people)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={dupMode === 'skip'} onChange={() => setDupMode('skip')} className="accent-primary" />
            Skip them
          </label>
        </div>
      )}
      {entities.length === 0 && (
        <p className="text-xs text-amber-300">⚠ No buildings found. Import buildings first or ensure you have access to at least one building.</p>
      )}
      <div className="flex gap-2">
        <Button onClick={runImport} disabled={entities.length === 0}>Import {rows.length} unit{rows.length !== 1 ? 's' : ''}</Button>
        <Button variant="outline" onClick={reset}>Cancel</Button>
      </div>
    </div>
  );

  if (step === 'running' || step === 'done') return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{step === 'running' ? 'Importing units…' : 'Done'}</p>
        {step === 'done' && <Button variant="ghost" size="sm" onClick={reset}><RefreshCw size={14} className="me-1" />Import more</Button>}
      </div>
      <ProgressTable rows={progress} />
    </div>
  );

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// TAB 4 — BALANCES
// ════════════════════════════════════════════════════════════════════════════
// FINAL DESIGN (Jey, 2026-08-27): admins import BALANCES ONLY - the AI
// expenses/charges/payments import confused people. One number per unit:
// positive = the unit holds a credit, negative = the unit owes.
// FINANCE REVIEW (2026-08-28): the number lands in units.opening_balance -
// the book's carry-in - NOT as charge/payment rows. Charges/payments would
// have inflated cash on hand and the Collected/Billed KPIs with history that
// is not this period's money; opening_balance moves balances only (0033),
// and the drawer is counted separately in the Fund tab. Re-importing a unit
// REPLACES its opening. Units must already exist; nothing imports until
// every row matches. (Batch undo does not apply - re-import to correct.)

interface BalanceRow { label: string; block_hint: string; balance: number; raw: string; unit?: DbUnit; invalid?: string; }

function BalancesTab({ entities }: { entities: Entity[] }) {
  const [entityKey, setEntityKey] = useState('');
  const [dbUnits, setDbUnits] = useState<DbUnit[]>([]);
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [step, setStep] = useState<StepState>('upload');
  const [batches, setBatches] = useState<ImportBatch[]>([]);  // legacy batches (still undoable)
  const [reversingId, setReversingId] = useState<string>('');
  const { confirmAsync, ConfirmDialog } = useConfirm();

  const selectedEntity = entities.find(e => e.key === entityKey) ?? null;

  const GUIDE = 'e.g. (guide row - your data starts on the next row)';
  const TEMPLATE: string[][] = [
    ['Unit Label', 'Balance (USD)', 'Block Name'],
    [GUIDE, 'Positive = credit the unit holds, negative = amount due. e.g. -150.00', 'Only for compounds, when the same unit label exists in more than one block'],
  ];

  async function loadBatches(entity: Entity | null) {
    if (!entity) { setBatches([]); return; }
    const col = entity.kind === 'compound' ? 'compound_id' : 'building_id';
    const { data } = await supabase.from('import_batches').select('*')
      .eq(col, entity.id).order('created_at', { ascending: false }).limit(10);
    setBatches((data ?? []) as ImportBatch[]);
  }

  // Load units for all blocks + recent import batches when entity selected
  useEffect(() => {
    setRows([]); setStep('upload');
    if (!selectedEntity) { setDbUnits([]); setBatches([]); return; }
    supabase.from('units').select('id, label, share_weight, building_id, opening_balance')
      .in('building_id', selectedEntity.buildingIds)
      .then(({ data }) => setDbUnits((data ?? []) as DbUnit[]));
    loadBatches(selectedEntity);
  }, [entityKey]);

  async function undoBatch(id: string) {
    if (!(await confirmAsync('Undo import', 'Undo this import? Every charge and payment it created will be removed.'))) return;
    setReversingId(id);
    const { error } = await supabase.rpc('reverse_import_batch', { p_batch: id });
    setReversingId('');
    if (error) { toast.error(error.message); return; }
    toast.success('Import reversed');
    loadBatches(selectedEntity);
  }

  async function handleFile(file: File) {
    if (!entityKey || !selectedEntity) { toast.error('Select a building or compound first'); return; }
    try {
      const data = await parseSpreadsheet(file);
      if (!data.length) { toast.error('File appears empty'); return; }
      const all: BalanceRow[] = data.map(row => {
        const raw = pickCol(row, 'balance (usd)', 'balance', 'amount', 'الرصيد');
        return {
          label:      pickCol(row, 'unit label', 'unit', 'apt', 'apartment', 'رقم الشقة', 'الوحدة'),
          block_hint: pickCol(row, 'block name', 'block', 'building', 'المبنى'),
          balance:    parseMoney(raw),
          raw,
        };
      }).filter(r => r.label);
      // guidance rows travel with the template; never let them import
      const parsed = all.filter(r => !/^e\.g\./i.test(r.label));

      // "Make sure units exist BEFORE importing": every row must resolve to
      // exactly one existing unit, or the import stays disabled.
      const blockByName = Object.fromEntries(selectedEntity.blocks.map(b => [b.name.toLowerCase().trim(), b.id]));
      for (const r of parsed) {
        if (Number.isNaN(r.balance)) { r.invalid = `"${r.raw}" is not a valid amount - use the format 1234.56 (or -1234.56 for a due)`; continue; }
        let pool = dbUnits;
        if (r.block_hint.trim()) {
          const bid = blockByName[r.block_hint.toLowerCase().trim()];
          if (!bid) { r.invalid = `Block "${r.block_hint}" not found. Your blocks: ${selectedEntity.blocks.map(b => b.name).join(', ')}`; continue; }
          pool = dbUnits.filter(u => u.building_id === bid);
        }
        const matches = pool.filter(u => normLabel(u.label) === normLabel(r.label));
        if (matches.length === 0) { r.invalid = `Unit "${r.label}" does not exist${r.block_hint ? ` in block "${r.block_hint}"` : ''}. Import your structure first.`; continue; }
        if (matches.length > 1) { r.invalid = `Unit "${r.label}" exists in more than one block - add its Block Name to the row`; continue; }
        r.unit = matches[0];
      }

      const skipped = all.length - parsed.length;
      if (skipped > 0) toast.success('Skipped ' + skipped + ' template guide row' + (skipped !== 1 ? 's' : ''));
      if (!parsed.length) { toast.error('No valid balance rows found'); return; }
      setRows(parsed);
      setStep('preview');
    } catch { toast.error('Could not read file'); }
  }

  const money = (n: number) => '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invalidRows = rows.filter(r => r.invalid);
  const dueRows    = rows.filter(r => !r.invalid && r.balance < 0);
  const creditRows = rows.filter(r => !r.invalid && r.balance > 0);
  const blockName = (u?: DbUnit) => selectedEntity?.blocks.find(b => b.id === u?.building_id)?.name ?? '';

  async function runImport() {
    if (!selectedEntity || invalidRows.length) return;

    setProgress(rows.map(r => ({
      label: r.label,
      detail: r.balance === 0 ? 'zero balance' : `${money(r.balance)} ${r.balance < 0 ? 'due' : 'credit'}`,
      status: 'pending' as RowStatus,
    })));
    setStep('running');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'processing' } : p));
      try {
        if (!row.unit) throw new Error(row.invalid ?? 'Unmatched unit');
        if (row.balance === 0) {
          // zero is SKIPPED on purpose: importing it would silently wipe a
          // pre-existing opening on a unit the admin left at 0 in the sheet
          setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'skipped' } : p));
          continue;
        }
        // The number IS the unit's opening balance (positive = credit,
        // negative = due), the same sign the book uses. SET, not add - a
        // re-import of a corrected file is the undo.
        const { error } = await supabase.from('units')
          .update({ opening_balance: row.balance, opening_balance_date: todayStr() })
          .eq('id', row.unit.id);
        if (error) throw new Error(error.message);
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'done' } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'error', error: msg } : p));
      }
    }
    setStep('done');
  }

  function reset() { setStep('upload'); setRows([]); setProgress([]); }

  if (step === 'upload') return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">Bring each unit's opening balance across from your old books: positive means the unit holds a credit, negative means they owe. The number becomes the unit's opening balance - the book starts from it, and cash on hand stays untouched (count the drawer in the Fund tab). Re-importing a unit replaces its opening.</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv('balances-template.csv', TEMPLATE)}>
        <Download size={14} /> Download template
      </Button>

      {entities.length === 0 ? (
        <p className="text-sm text-amber-300">Import your structure first - balances attach to existing units.</p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Building / Compound *</label>
            <RadixSelect value={entityKey} onValueChange={v => setEntityKey(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a building or compound…" />
              </SelectTrigger>
              <SelectContent>
                {entities.some(e => e.kind === 'compound') && (
                  <SelectGroup>
                    <SelectLabel>Compounds</SelectLabel>
                    {entities.filter(e => e.kind === 'compound').map(e => (
                      <SelectItem key={e.key} value={e.key}>{e.name} ({e.blocks.length} blocks)</SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {entities.some(e => e.kind === 'compound') && entities.some(e => e.kind === 'building') && (
                  <SelectSeparator />
                )}
                {entities.some(e => e.kind === 'building') && (
                  <SelectGroup>
                    <SelectLabel>Buildings</SelectLabel>
                    {entities.filter(e => e.kind === 'building').map(e => (
                      <SelectItem key={e.key} value={e.key}>{e.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </RadixSelect>
          </div>
          {selectedEntity?.kind === 'compound' && (
            <p className="text-xs text-muted-foreground/70">
              Blocks: {selectedEntity.blocks.map(b => b.name).join(' · ')} · {dbUnits.length} units loaded
            </p>
          )}
          <DropZone onFile={handleFile} accept=".csv,.xlsx,.xls" hint="CSV or Excel • Unit Label, Balance (USD), Block Name" />

          {/* Recent imports — undo a batch (removes exactly what it created) */}
          {batches.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Recent imports</p>
              <div className="space-y-1.5">
                {batches.map(b => (
                  <div key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.file_name ?? 'Import'}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(b.created_at)}{b.n_expenses > 0 ? ` · ${b.n_expenses} exp` : ''} · {b.n_charges} due · {b.n_payments} credit
                        {b.reversed_at && <span className="ms-1.5 text-muted-foreground/70">· reversed</span>}
                      </p>
                    </div>
                    {b.reversed_at
                      ? <span className="text-[10px] uppercase tracking-wide bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0">Reversed</span>
                      : <Button variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive" disabled={reversingId === b.id} onClick={() => undoBatch(b.id)}>
                          {reversingId === b.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Undo
                        </Button>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {ConfirmDialog}
    </div>
  );

  if (step === 'preview') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {rows.length} balance{rows.length !== 1 ? 's' : ''} · {dueRows.length} due · {creditRows.length} credit
        </p>
        <Button variant="ghost" size="sm" onClick={reset}><X size={14} /></Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden text-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>{['Unit', ...(selectedEntity?.kind === 'compound' ? ['Block'] : []), 'Current', 'Balance', ''].map((h, i) => <th key={i} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={r.invalid ? 'opacity-40' : ''}>
                <td className="px-4 py-2 font-medium">{r.label}</td>
                {selectedEntity?.kind === 'compound' && <td className="px-4 py-2 text-muted-foreground">{blockName(r.unit) || r.block_hint || '—'}</td>}
                <td className="px-4 py-2 tnum text-muted-foreground text-xs">
                  {r.unit && Number(r.unit.opening_balance ?? 0) !== 0
                    ? `${Number(r.unit.opening_balance) < 0 ? '-' : ''}${money(Number(r.unit.opening_balance))}`
                    : '—'}
                </td>
                <td className={`px-4 py-2 tnum ${r.invalid ? 'text-muted-foreground' : r.balance < 0 ? 'text-red-500 dark:text-red-400' : r.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {Number.isNaN(r.balance) ? '—' : `${r.balance < 0 ? '-' : ''}${money(r.balance)}`}
                </td>
                <td className="px-4 py-2">
                  {r.invalid
                    ? <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-red-400/15 text-red-500 dark:text-red-400">{r.unit ? '' : 'no match'}</span>
                    : r.balance === 0
                      ? <span className="text-[10px] text-muted-foreground">will skip</span>
                      : <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${r.balance < 0 ? 'bg-red-400/15 text-red-500 dark:text-red-400' : 'bg-emerald-400/15 text-emerald-600 dark:text-emerald-400'}`}>{r.balance < 0 ? 'due' : 'credit'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invalidRows.length > 0 && (
        <div className="rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-sm space-y-1">
          <p className="text-red-500 dark:text-red-400 font-medium">Nothing imports until every row matches an existing unit:</p>
          {invalidRows.map((r, i) => (
            <p key={i} className="text-red-500 dark:text-red-400">Row "{r.label}": {r.invalid}</p>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={runImport} disabled={invalidRows.length > 0}>Import {rows.length - invalidRows.length} balance{rows.length - invalidRows.length !== 1 ? 's' : ''}</Button>
        <Button variant="outline" onClick={reset}>Cancel</Button>
      </div>
      {ConfirmDialog}
    </div>
  );

  if (step === 'running' || step === 'done') return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{step === 'running' ? 'Importing balances…' : 'Done'}</p>
        {step === 'done' && <Button variant="ghost" size="sm" onClick={reset}><RefreshCw size={14} className="me-1" />Import more</Button>}
      </div>
      <ProgressTable rows={progress} />
    </div>
  );

  return null;
}
