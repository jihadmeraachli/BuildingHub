import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, Download, Users, Building2, Home, BarChart3,
  CheckCircle2, Loader2, X, RefreshCw,
} from 'lucide-react';
import type { Grant } from '@/types';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { useEntities } from '@/lib/entities';
import type { Entity } from '@/lib/entities';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type ImportTab = 'users' | 'buildings' | 'units' | 'expenses';
type StepState = 'upload' | 'preview' | 'running' | 'done';
type RowStatus = 'pending' | 'processing' | 'done' | 'exists' | 'skipped' | 'error';

interface ProgressRow { label: string; detail?: string; status: RowStatus; error?: string; }
interface UserRow { name: string; email: string; phone: string; role: string; }
interface BuildingRow { name: string; address: string; city: string; compound_name: string; }
interface UnitRow { label: string; floor: string; building_name: string; owner_email: string; tenant_email: string; share_weight: string; }
interface DbUnit { id: string; label: string; share_weight: number; building_id: string; }
interface DbBuilding { id: string; name: string; }

interface AiExpenseRow { description: string; category: string; amount_usd: number; expense_date: string | null; block?: string | null; }
interface AiUnitCharge { unit_label: string; description: string; amount_usd: number; charge_date: string | null; unit_id?: string; building_id?: string; }
interface AiUnitPayment { unit_label: string; amount_usd: number; paid_on: string | null; unit_id?: string; method?: string; building_id?: string; }

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

function matchUnit(units: DbUnit[], label: string): DbUnit | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  return units.find(u => norm(u.label) === norm(label));
}

function matchBlock(blocks: { id: string; name: string }[], hint: string | null | undefined): string {
  if (!blocks.length) return '';
  if (!hint || blocks.length === 1) return blocks[0].id;
  const h = hint.trim().toUpperCase();
  return blocks.find(b => b.name.toUpperCase() === h)?.id
    ?? blocks.find(b => b.name.toUpperCase().includes(h) || h.includes(b.name.toUpperCase()))?.id
    ?? blocks[0].id;
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
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
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
  const [activeTab, setActiveTab] = useState<ImportTab>('users');

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
    { key: 'users',     label: 'Users',              Icon: Users },
    { key: 'buildings', label: 'Buildings',           Icon: Building2 },
    { key: 'units',     label: 'Units',               Icon: Home },
    { key: 'expenses',  label: 'Expenses & Balances', Icon: BarChart3 },
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
      {activeTab === 'buildings' && <BuildingsTab isPlatformAdmin={isPlatformAdmin} grants={grants} />}
      {activeTab === 'units'     && <UnitsTab buildings={buildings as DbBuilding[]} />}
      {activeTab === 'expenses'  && <ExpensesTab entities={entities} />}
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
    ['Ahmad Hassan', 'ahmad@example.com', '+9611234567', 'owner'],
    ['Lara Khoury', 'lara@example.com', '+9619876543', 'tenant'],
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
        <p className="text-xs text-muted-foreground">Users who already have an account show as "Already exists" — no duplicate invite was sent.</p>
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
    supabase.from('orgs').select('id, name').order('name').then(({ data }) => setOrgs(data ?? []));
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
      <p className="text-sm text-muted-foreground">Import buildings and compounds. Use the Compound Name column to group blocks under a compound — leave it blank for standalone buildings.</p>
      {isPlatformAdmin && orgs.length > 0 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Assign to org (optional)</label>
          <select
            value={orgId}
            onChange={e => setOrgId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">— No org —</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
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

function UnitsTab({ buildings }: { buildings: DbBuilding[] }) {
  const [step, setStep] = useState<StepState>('upload');
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);

  const TEMPLATE = [
    ['Unit Label', 'Floor', 'Building Name', 'Owner Email', 'Tenant Email', 'Share Weight'],
    ['A101', '1', 'Block A', 'owner@email.com', '', '1.0'],
    ['A102', '1', 'Block A', '', '', '1.0'],
    ['B201', '2', 'Block B', 'owner2@email.com', 'tenant@email.com', '1.5'],
  ];

  async function handleFile(file: File) {
    try {
      const data = await parseSpreadsheet(file);
      if (!data.length) { toast.error('File appears empty'); return; }
      const parsed: UnitRow[] = data.map(row => ({
        label:         pickCol(row, 'unit label', 'unit', 'apt', 'apartment', 'رقم الشقة', 'الوحدة'),
        floor:         pickCol(row, 'floor', 'الطابق'),
        building_name: pickCol(row, 'building name', 'building', 'block', 'المبنى'),
        owner_email:   pickCol(row, 'owner email', 'owner', 'المالك'),
        tenant_email:  pickCol(row, 'tenant email', 'tenant', 'المستأجر'),
        share_weight:  pickCol(row, 'share weight', 'share', 'الحصة') || '1',
      })).filter(r => r.label);
      if (!parsed.length) { toast.error('No valid unit rows found'); return; }
      setRows(parsed);
      setStep('preview');
    } catch { toast.error('Could not read file'); }
  }

  async function runImport() {
    setProgress(rows.map(r => ({ label: r.label, detail: r.building_name, status: 'pending' })));
    setStep('running');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'processing' } : p));
      try {
        const building = buildings.find(b => b.name.toLowerCase() === row.building_name.toLowerCase());
        if (!building) throw new Error(`Building "${row.building_name}" not found`);

        const { data: unit, error: uErr } = await supabase
          .from('units')
          .insert({
            building_id:  building.id,
            label:        row.label,
            share_weight: parseFloat(row.share_weight) || 1,
          })
          .select('id').single();
        if (uErr) throw new Error(uErr.message);

        // Link owner
        if (row.owner_email.includes('@')) {
          const { data: inv } = await supabase.functions.invoke('invite-user', {
            body: { email: row.owner_email.trim().toLowerCase(), full_name: row.owner_email, mode: 'import' },
          });
          if (inv?.user_id) {
            await supabase.from('memberships').insert({ user_id: inv.user_id, unit_id: unit.id, tenure: 'owner' });
          }
        }

        // Link tenant
        if (row.tenant_email.includes('@')) {
          const { data: inv } = await supabase.functions.invoke('invite-user', {
            body: { email: row.tenant_email.trim().toLowerCase(), full_name: row.tenant_email, mode: 'import' },
          });
          if (inv?.user_id) {
            await supabase.from('memberships').insert({ user_id: inv.user_id, unit_id: unit.id, tenure: 'tenant' });
          }
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
      <p className="text-sm text-muted-foreground">Import units and automatically link them to owners or tenants by email. Users who haven't accepted their invitation yet are still linked — their status (active/inactive) reflects acceptance only.</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv('units-template.csv', TEMPLATE)}>
        <Download size={14} /> Download template
      </Button>
      <DropZone onFile={handleFile} accept=".csv,.xlsx,.xls" hint="CSV or Excel • Unit Label, Floor, Building Name, Owner Email, Share Weight" />
    </div>
  );

  if (step === 'preview') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{rows.length} unit{rows.length !== 1 ? 's' : ''} ready to import</p>
        <Button variant="ghost" size="sm" onClick={reset}><X size={14} /></Button>
      </div>
      <div className="rounded-lg border border-border overflow-hidden text-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>{['Unit', 'Floor', 'Building', 'Owner Email', 'Tenant Email', 'Share Wt'].map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.floor || '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.building_name}</td>
                <td className="px-4 py-2 text-muted-foreground text-xs">{r.owner_email || '—'}</td>
                <td className="px-4 py-2 text-muted-foreground text-xs">{r.tenant_email || '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.share_weight || '1'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {buildings.length === 0 && (
        <p className="text-xs text-amber-300">⚠ No buildings found — import buildings first or ensure you have access to at least one building.</p>
      )}
      <div className="flex gap-2">
        <Button onClick={runImport} disabled={buildings.length === 0}>Import {rows.length} unit{rows.length !== 1 ? 's' : ''}</Button>
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
// TAB 4 — EXPENSES & BALANCES (AI)
// ════════════════════════════════════════════════════════════════════════════

function ExpensesTab({ entities }: { entities: Entity[] }) {
  const { user } = useAuth();
  const [entityKey, setEntityKey] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<{ expenses: AiExpenseRow[]; unit_charges: AiUnitCharge[]; unit_payments: AiUnitPayment[] } | null>(null);
  const [dbUnits, setDbUnits] = useState<DbUnit[]>([]);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [step, setStep] = useState<StepState>('upload');
  const [fileName, setFileName] = useState('');

  const selectedEntity = entities.find(e => e.key === entityKey) ?? null;

  // Load units for all blocks when entity selected
  useEffect(() => {
    if (!selectedEntity) { setDbUnits([]); return; }
    supabase.from('units').select('id, label, share_weight, building_id')
      .in('building_id', selectedEntity.buildingIds)
      .then(({ data }) => setDbUnits((data ?? []) as DbUnit[]));
  }, [entityKey]);

  async function handleFile(file: File) {
    if (!entityKey) { toast.error('Select a building or compound first'); return; }
    setFileName(file.name);

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) { toast.error('File too large (max 10 MB)'); return; }

    setAnalyzing(true);
    try {
      let content: string, format: string;

      if (ext === 'pdf') {
        const buf = await file.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        content = b64; format = 'pdf';
      } else if (['jpg', 'jpeg'].includes(ext)) {
        const buf = await file.arrayBuffer();
        content = btoa(String.fromCharCode(...new Uint8Array(buf)));
        format = 'jpeg';
      } else if (ext === 'png') {
        const buf = await file.arrayBuffer();
        content = btoa(String.fromCharCode(...new Uint8Array(buf)));
        format = 'png';
      } else {
        // Excel / CSV — convert to CSV text
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        content = XLSX.utils.sheet_to_csv(ws);
        format = 'excel';
      }

      const { data, error } = await supabase.functions.invoke('ai-expense-import', {
        body: { content, format, filename: file.name },
      });
      if (error) throw new Error(error.message);

      // Match unit labels to DB units (spans all blocks for compound)
      const expenses: AiExpenseRow[] = data.expenses ?? [];
      const unit_charges: AiUnitCharge[] = (data.unit_charges ?? []).map((c: AiUnitCharge) => {
        const unit = matchUnit(dbUnits, c.unit_label);
        return { ...c, unit_id: unit?.id, building_id: unit?.building_id };
      });
      const unit_payments: AiUnitPayment[] = (data.unit_payments ?? []).map((p: AiUnitPayment) => {
        const unit = matchUnit(dbUnits, p.unit_label);
        return { ...p, unit_id: unit?.id, building_id: unit?.building_id };
      });

      if (!expenses.length && !unit_charges.length && !unit_payments.length) {
        toast.error('AI could not extract any data from this file');
        return;
      }

      setAiResult({ expenses, unit_charges, unit_payments });
      setStep('preview');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function runImport() {
    if (!aiResult || !selectedEntity) return;
    const { expenses, unit_charges, unit_payments } = aiResult;

    const allRows: ProgressRow[] = [
      ...expenses.map(e => ({ label: e.description, detail: `$${e.amount_usd.toFixed(2)} · expense${e.block ? ` · Block ${e.block}` : ''}`, status: 'pending' as RowStatus })),
      ...unit_charges.filter(c => c.unit_id).map(c => ({ label: c.unit_label, detail: `$${c.amount_usd.toFixed(2)} charge`, status: 'pending' as RowStatus })),
      ...unit_payments.filter(p => p.unit_id).map(p => ({ label: p.unit_label, detail: `$${p.amount_usd.toFixed(2)} payment`, status: 'pending' as RowStatus })),
    ];
    setProgress(allRows);
    setStep('running');

    let idx = 0;

    // Group units by building for per-block expense allocation
    const unitsByBuilding = dbUnits.reduce((acc, u) => {
      (acc[u.building_id] ??= []).push(u);
      return acc;
    }, {} as Record<string, DbUnit[]>);

    // Expenses — route to correct block, allocate by share weight within that block
    for (const exp of expenses) {
      setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'processing' } : p));
      try {
        const validCategory = ['water','electricity','common_expenses','projects','contracts','fines','other'].includes(exp.category)
          ? exp.category : 'other';

        const buildingId = matchBlock(selectedEntity.blocks, exp.block);
        const blockUnits = unitsByBuilding[buildingId] ?? [];
        const totalWeight = blockUnits.reduce((s, u) => s + Number(u.share_weight), 0) || 1;

        const { data: expRow, error: eErr } = await supabase.from('expenses').insert({
          building_id:  buildingId,
          category:     validCategory,
          description:  exp.description,
          amount_usd:   exp.amount_usd,
          expense_date: exp.expense_date ?? todayStr(),
          scope_type:   'block',
          method:       'by_shares',
          created_by:   user?.id,
        }).select('id').single();
        if (eErr) throw new Error(eErr.message);

        if (blockUnits.length > 0) {
          const chargeRows = blockUnits.map(u => ({
            expense_id:  expRow.id,
            unit_id:     u.id,
            building_id: buildingId,
            category:    validCategory,
            description: exp.description,
            amount_usd:  Math.round((exp.amount_usd * Number(u.share_weight) / totalWeight) * 100) / 100,
            charge_date: exp.expense_date ?? todayStr(),
            billed_to:   'both',
            created_by:  user?.id,
          })).filter(c => c.amount_usd > 0);
          if (chargeRows.length) await supabase.from('charges').insert(chargeRows);
        }

        setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'done' } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'error', error: msg } : p));
      }
      idx++;
    }

    // Unit charges — building_id comes from the matched unit
    for (const charge of unit_charges.filter(c => c.unit_id)) {
      setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'processing' } : p));
      try {
        const { error } = await supabase.from('charges').insert({
          unit_id:     charge.unit_id,
          building_id: charge.building_id ?? selectedEntity.buildingIds[0],
          category:    'other',
          description: charge.description,
          amount_usd:  charge.amount_usd,
          charge_date: charge.charge_date ?? todayStr(),
          billed_to:   'both',
          created_by:  user?.id,
        });
        if (error) throw new Error(error.message);
        setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'done' } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'error', error: msg } : p));
      }
      idx++;
    }

    // Unit payments — building_id comes from the matched unit
    for (const pmt of unit_payments.filter(p => p.unit_id)) {
      setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'processing' } : p));
      try {
        const { error } = await supabase.from('payments').insert({
          unit_id:     pmt.unit_id,
          building_id: pmt.building_id ?? selectedEntity.buildingIds[0],
          amount_usd:  pmt.amount_usd,
          method:      (pmt.method ?? 'other') as 'cash' | 'bank_transfer' | 'cheque' | 'other',
          paid_on:     pmt.paid_on ?? todayStr(),
          note:        'Imported',
          recorded_by: user?.id,
        });
        if (error) throw new Error(error.message);
        setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'done' } : p));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => prev.map((p, j) => j === idx ? { ...p, status: 'error', error: msg } : p));
      }
      idx++;
    }

    setStep('done');
  }

  function reset() { setStep('upload'); setAiResult(null); setProgress([]); setFileName(''); }

  function downloadExpensesTemplate() {
    const wb = XLSX.utils.book_new();

    const expenses = XLSX.utils.aoa_to_sheet([
      ['Description', 'Category', 'Amount (USD)', 'Date (YYYY-MM-DD)'],
      ['Security services', 'common_expenses', 500.00, '2024-01-31'],
      ['Water & generator diesel', 'water', 320.00, '2024-01-31'],
      ['Electricity', 'electricity', 210.00, '2024-01-31'],
      ['Elevator maintenance contract', 'contracts', 150.00, '2024-01-31'],
    ]);
    expenses['!cols'] = [{ wch: 35 }, { wch: 20 }, { wch: 16 }, { wch: 20 }];

    const balances = XLSX.utils.aoa_to_sheet([
      ['Unit Label', 'Outstanding Balance (USD)', 'Payment Amount (USD)', 'Payment Date (YYYY-MM-DD)', 'Payment Method (cash / cheque / bank_transfer)'],
      ['A101', 150.00, 100.00, '2024-01-15', 'cash'],
      ['A102', 200.00, 200.00, '2024-01-10', 'cheque'],
      ['B201', 75.00, '', '', ''],
      ['B202', 0, 300.00, '2024-01-20', 'bank_transfer'],
    ]);
    balances['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 22 }, { wch: 28 }, { wch: 44 }];

    XLSX.utils.book_append_sheet(wb, expenses, 'Building Expenses');
    XLSX.utils.book_append_sheet(wb, balances, 'Unit Balances & Payments');
    XLSX.writeFile(wb, 'expenses-template.xlsx');
  }

  const unmatched_charges = aiResult?.unit_charges.filter(c => !c.unit_id).length ?? 0;
  const unmatched_payments = aiResult?.unit_payments.filter(p => !p.unit_id).length ?? 0;

  if (step === 'upload') return (
    <div className="space-y-4 max-w-xl">
      <p className="text-sm text-muted-foreground">Upload any financial document — Trial Balance, payments spreadsheet, or scanned statement. The AI will extract expenses and per-unit balances automatically.</p>
      <Button variant="outline" size="sm" className="gap-2" onClick={downloadExpensesTemplate}>
        <Download size={14} /> Download template
      </Button>
      <p className="text-xs text-muted-foreground/70">Supports: Excel, CSV, PDF, JPEG, PNG · For compounds, unit prefix (A101 → Block A) determines the block.</p>

      {entities.length === 0 ? (
        <p className="text-sm text-amber-300">Import buildings and units first before importing expenses.</p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Building / Compound *</label>
            <select
              value={entityKey}
              onChange={e => { setEntityKey(e.target.value); setAiResult(null); }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a building or compound…</option>
              {entities.some(e => e.kind === 'compound') && (
                <optgroup label="Compounds">
                  {entities.filter(e => e.kind === 'compound').map(e => (
                    <option key={e.key} value={e.key}>{e.name} ({e.blocks.length} blocks)</option>
                  ))}
                </optgroup>
              )}
              {entities.some(e => e.kind === 'building') && (
                <optgroup label="Buildings">
                  {entities.filter(e => e.kind === 'building').map(e => (
                    <option key={e.key} value={e.key}>{e.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {selectedEntity?.kind === 'compound' && (
            <p className="text-xs text-muted-foreground/70">
              Blocks: {selectedEntity.blocks.map(b => b.name).join(' · ')} — {dbUnits.length} units loaded
            </p>
          )}
          {analyzing ? (
            <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
              <Loader2 size={20} className="animate-spin text-primary" />
              <span className="text-sm">AI is reading your document…</span>
            </div>
          ) : (
            <DropZone
              onFile={handleFile}
              accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png"
              hint="Excel, CSV, PDF, JPEG, or PNG"
            />
          )}
        </>
      )}
    </div>
  );

  if (step === 'preview' && aiResult) {
    const { expenses, unit_charges, unit_payments } = aiResult;
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">AI extracted from: <span className="text-primary">{fileName}</span></p>
            {(unmatched_charges > 0 || unmatched_payments > 0) && (
              <p className="text-xs text-amber-300 mt-1">⚠ {unmatched_charges + unmatched_payments} unit(s) could not be matched — they will be skipped. Check unit labels match exactly.</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={reset}><X size={14} /></Button>
        </div>

        {expenses.length > 0 && (
          <PreviewSection title={`Building Expenses (${expenses.length})`} hint="Will be allocated to all units in each block by share weight">
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr>
                {['Category', 'Description', 'Amount (USD)', 'Date', ...(selectedEntity?.kind === 'compound' ? ['Block'] : [])].map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 capitalize text-xs text-muted-foreground">{e.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2">{e.description}</td>
                    <td className="px-4 py-2 tnum font-medium">${e.amount_usd.toFixed(2)}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{e.expense_date ?? 'Today'}</td>
                    {selectedEntity?.kind === 'compound' && (
                      <td className="px-4 py-2 text-xs font-medium text-primary">{e.block ?? <span className="text-muted-foreground">auto</span>}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </PreviewSection>
        )}

        {unit_charges.length > 0 && (
          <PreviewSection title={`Unit Balances (${unit_charges.filter(c => c.unit_id).length} matched, ${unmatched_charges} skipped)`}>
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr>
                {['Unit', 'Description', 'Amount (USD)', 'Match'].map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {unit_charges.map((c, i) => (
                  <tr key={i} className={!c.unit_id ? 'opacity-40' : ''}>
                    <td className="px-4 py-2 font-medium">{c.unit_label}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{c.description}</td>
                    <td className="px-4 py-2 tnum">${c.amount_usd.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      {c.unit_id
                        ? <CheckCircle2 size={14} className="text-emerald-400" />
                        : <span className="text-xs text-amber-300">No match</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PreviewSection>
        )}

        {unit_payments.length > 0 && (
          <PreviewSection title={`Unit Payments (${unit_payments.filter(p => p.unit_id).length} matched, ${unmatched_payments} skipped)`}>
            <table className="w-full text-sm">
              <thead className="bg-muted/40"><tr>
                {['Unit', 'Amount (USD)', 'Date', 'Match'].map(h => <th key={h} className="text-start px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {unit_payments.map((p, i) => (
                  <tr key={i} className={!p.unit_id ? 'opacity-40' : ''}>
                    <td className="px-4 py-2 font-medium">{p.unit_label}</td>
                    <td className="px-4 py-2 tnum">${p.amount_usd.toFixed(2)}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{p.paid_on ?? 'Today'}</td>
                    <td className="px-4 py-2">
                      {p.unit_id
                        ? <CheckCircle2 size={14} className="text-emerald-400" />
                        : <span className="text-xs text-amber-300">No match</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PreviewSection>
        )}

        <div className="flex gap-2">
          <Button onClick={runImport}>Import data</Button>
          <Button variant="outline" onClick={reset}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (step === 'running' || step === 'done') return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{step === 'running' ? 'Importing…' : 'Done'}</p>
        {step === 'done' && <Button variant="ghost" size="sm" onClick={reset}><RefreshCw size={14} className="me-1" />Import more</Button>}
      </div>
      <ProgressTable rows={progress} />
    </div>
  );

  return null;
}

function PreviewSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{title}</p>
        {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      </div>
      <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">{children}</div>
    </div>
  );
}
