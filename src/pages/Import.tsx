import { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, FileText, CheckCircle2, AlertCircle,
  Loader2, ChevronRight, Building2, X, Trash2, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'mapping' | 'importing' | 'done';
type OwnerInviteStatus = 'pending' | 'inviting' | 'invited' | 'exists' | 'error';

interface PdfRow {
  unit_label:  string;
  balance_due: number;
  owner_name:  string;
  owner_phone: string;
  notes:       string;
}

interface OwnerRow {
  unit_id:     string;
  unit_label:  string;
  owner_name:  string;
  owner_phone: string;
}

const IMPORT_FIELDS = [
  { value: 'unit_label',   label: 'Unit / Apt No.' },
  { value: 'balance_due',  label: 'Balance Due (USD)' },
  { value: 'share_weight', label: 'Share Weight' },
  { value: 'occupancy',    label: 'Occupancy' },
  { value: 'owner_name',   label: 'Owner Name' },
  { value: 'owner_phone',  label: 'Owner Phone' },
  { value: 'notes',        label: 'Notes' },
  { value: 'SKIP',         label: '— Skip column —' },
] as const;

type FieldValue = typeof IMPORT_FIELDS[number]['value'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeNumber(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const s = String(val ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\d.-]/g, '');
  return parseFloat(s) || 0;
}

function normalizeOccupancy(val: string): 'occupied' | 'vacant' | 'abroad' {
  const v = val.toLowerCase();
  if (/vacant|empty|شاغر|فارغ|خالي/.test(v)) return 'vacant';
  if (/abroad|outside|خارج|سفر/.test(v)) return 'abroad';
  return 'occupied';
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Import() {
  const { user, isPlatformAdmin, grants } = useAuth();
  const { buildings } = useManagedBuildings();

  const canImport = isPlatformAdmin || grants.some(g =>
    ['building_admin', 'org_admin', 'compound_admin'].includes(g.role)
  );

  // ── State ──────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Upload
  const [fileName, setFileName]       = useState('');
  const [isPdf, setIsPdf]             = useState(false);
  const [pdfBase64, setPdfBase64]     = useState('');
  const [sheetNames, setSheetNames]   = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [workbookData, setWorkbookData]   = useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders]         = useState<string[]>([]);
  const [rows, setRows]               = useState<Record<string, unknown>[]>([]);
  const [buildingId, setBuildingId]   = useState('');

  // Mapping (Excel) / Review (PDF)
  const [mapping, setMapping]         = useState<Record<string, FieldValue>>({});
  const [pdfRows, setPdfRows]         = useState<PdfRow[]>([]);
  const [aiLoading, setAiLoading]     = useState(false);

  // Import progress
  const [progress, setProgress]       = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [results, setResults]         = useState({ units: 0, balances: 0, skipped: 0, errors: 0 });

  // Owner assignment (done step)
  const [ownerRows, setOwnerRows]         = useState<OwnerRow[]>([]);
  const [ownerEmails, setOwnerEmails]     = useState<Record<string, string>>({});
  const [ownerStatuses, setOwnerStatuses] = useState<Record<string, OwnerInviteStatus>>({});
  const [inviting, setInviting]           = useState(false);

  // ── File helpers ───────────────────────────────────────────────────────────

  function resetFile() {
    setFileName(''); setIsPdf(false); setPdfBase64('');
    setHeaders([]); setRows([]);
    setSheetNames([]); setSelectedSheet(''); setWorkbookData(null);
    setPdfRows([]);
  }

  function loadSheet(wb: XLSX.WorkBook, sheet: string) {
    const ws = wb.Sheets[sheet];
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    if (data.length === 0) { toast.error('This sheet appears to be empty.'); return; }
    setHeaders(Object.keys(data[0]));
    setRows(data);
    setSelectedSheet(sheet);
  }

  function handleFile(file: File) {
    if (!/\.(xlsx|xls|csv|pdf)$/i.test(file.name)) {
      toast.error('Supported formats: .xlsx, .xls, .csv, .pdf');
      return;
    }
    resetFile();
    setFileName(file.name);

    if (/\.pdf$/i.test(file.name)) {
      if (file.size > 4 * 1024 * 1024) {
        toast.error('PDF must be under 4 MB. Try splitting or compressing it first.');
        setFileName('');
        return;
      }
      setIsPdf(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target!.result as string;
        setPdfBase64(dataUrl.split(',')[1]);
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target!.result, { type: 'array' });
          setWorkbookData(wb);
          setSheetNames(wb.SheetNames);
          loadSheet(wb, wb.SheetNames[0]);
        } catch {
          toast.error('Could not read this file. Make sure it is a valid Excel or CSV file.');
          setFileName('');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analysis ───────────────────────────────────────────────────────────────

  async function analyzeFile() {
    if (!fileName || !buildingId) {
      toast.error('Please select a file and a building first.');
      return;
    }
    setAiLoading(true);
    isPdf ? await analyzePdf() : await analyzeExcel();
    setAiLoading(false);
  }

  async function analyzePdf() {
    try {
      const { data, error } = await supabase.functions.invoke('ai-pdf-import', {
        body: { pdf: pdfBase64 },
      });
      if (error) throw error;
      const extracted: PdfRow[] = data?.rows ?? [];
      if (extracted.length === 0) {
        toast.error('No unit data could be extracted from this PDF. Check the file and try again.');
        return;
      }
      setPdfRows(extracted);
      setStep('mapping');
    } catch {
      toast.error('PDF extraction failed — check that the ai-pdf-import function is deployed.');
    }
  }

  async function analyzeExcel() {
    if (!rows.length) { toast.error('File is empty.'); return; }
    const samples = rows.slice(0, 5).map(r =>
      Object.fromEntries(headers.map(h => [h, String(r[h] ?? '')]))
    );
    try {
      const { data, error } = await supabase.functions.invoke('ai-import-mapping', {
        body: { headers, samples },
      });
      if (error) throw error;
      const aiMappings: Record<string, string> = data?.mappings ?? {};
      const full: Record<string, FieldValue> = {};
      for (const h of headers) {
        const s = aiMappings[h] as FieldValue | undefined;
        full[h] = IMPORT_FIELDS.some(f => f.value === s) ? s! : 'SKIP';
      }
      setMapping(full);
    } catch {
      toast.error('AI mapping unavailable — please map columns manually below.');
      setMapping(Object.fromEntries(headers.map(h => [h, 'SKIP' as FieldValue])));
    }
    setStep('mapping');
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  function getKey(field: FieldValue): string {
    return Object.entries(mapping).find(([, v]) => v === field)?.[0] ?? '';
  }

  async function runImport() {
    setOwnerRows([]);
    setOwnerEmails({});
    setOwnerStatuses({});
    isPdf ? await runPdfImport() : await runExcelImport();
  }

  async function runPdfImport() {
    setStep('importing');
    setProgress(0);
    setImportTotal(pdfRows.length);
    let units = 0, balances = 0, skipped = 0, errors = 0;
    const collected: OwnerRow[] = [];

    for (let i = 0; i < pdfRows.length; i++) {
      setProgress(i + 1);
      const row = pdfRows[i];
      if (!row.unit_label.trim()) { skipped++; continue; }

      const { data: unit, error: unitErr } = await supabase
        .from('units')
        .insert({ building_id: buildingId, label: row.unit_label.trim() })
        .select('id').single();

      if (unitErr) { errors++; continue; }
      units++;

      if (row.owner_name.trim()) {
        collected.push({
          unit_id:     (unit as { id: string }).id,
          unit_label:  row.unit_label.trim(),
          owner_name:  row.owner_name.trim(),
          owner_phone: row.owner_phone,
        });
      }

      if (row.balance_due > 0) {
        const desc = row.notes
          ? `Opening balance — ${row.notes}`
          : 'Opening balance (imported)';
        const { error: chargeErr } = await supabase.from('charges').insert({
          unit_id:     (unit as { id: string }).id,
          building_id: buildingId,
          category:    'other',
          description: desc,
          amount_usd:  row.balance_due,
          charge_date: new Date().toISOString().split('T')[0],
          created_by:  user?.id ?? null,
        });
        if (!chargeErr) balances++;
      }
    }
    setOwnerRows(collected);
    setResults({ units, balances, skipped, errors });
    setStep('done');
  }

  async function runExcelImport() {
    const labelKey      = getKey('unit_label');
    const balanceKey    = getKey('balance_due');
    const shareKey      = getKey('share_weight');
    const occupancyKey  = getKey('occupancy');
    const ownerNameKey  = getKey('owner_name');
    const ownerPhoneKey = getKey('owner_phone');

    if (!labelKey) {
      toast.error('No column mapped to "Unit / Apt No." — cannot import.');
      return;
    }
    setStep('importing');
    setProgress(0);
    setImportTotal(rows.length);
    let units = 0, balances = 0, skipped = 0, errors = 0;
    const collected: OwnerRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      setProgress(i + 1);
      const row = rows[i];
      const label = String(row[labelKey] ?? '').trim();
      if (!label) { skipped++; continue; }

      const unitData: Record<string, unknown> = { building_id: buildingId, label };
      if (shareKey) {
        const sw = normalizeNumber(row[shareKey]);
        if (sw > 0) unitData.share_weight = sw;
      }
      if (occupancyKey) {
        unitData.occupancy = normalizeOccupancy(String(row[occupancyKey] ?? ''));
      }

      const { data: unit, error: unitErr } = await supabase
        .from('units').insert(unitData).select('id').single();

      if (unitErr) { errors++; continue; }
      units++;

      const oName = ownerNameKey ? String(row[ownerNameKey] ?? '').trim() : '';
      if (oName) {
        collected.push({
          unit_id:     (unit as { id: string }).id,
          unit_label:  label,
          owner_name:  oName,
          owner_phone: ownerPhoneKey ? String(row[ownerPhoneKey] ?? '') : '',
        });
      }

      if (balanceKey) {
        const balance = normalizeNumber(row[balanceKey]);
        if (balance > 0) {
          const { error: chargeErr } = await supabase.from('charges').insert({
            unit_id:     (unit as { id: string }).id,
            building_id: buildingId,
            category:    'other',
            description: 'Opening balance (imported)',
            amount_usd:  balance,
            charge_date: new Date().toISOString().split('T')[0],
            created_by:  user?.id ?? null,
          });
          if (!chargeErr) balances++;
        }
      }
    }
    setOwnerRows(collected);
    setResults({ units, balances, skipped, errors });
    setStep('done');
  }

  // ── Owner assignment ───────────────────────────────────────────────────────

  async function inviteOwners() {
    setInviting(true);
    const newStatuses = { ...ownerStatuses };

    for (const row of ownerRows) {
      const email = ownerEmails[row.unit_id]?.trim();
      if (!email) continue;
      if (ownerStatuses[row.unit_id] === 'invited' || ownerStatuses[row.unit_id] === 'exists') continue;

      newStatuses[row.unit_id] = 'inviting';
      setOwnerStatuses({ ...newStatuses });

      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email, full_name: row.owner_name, phone: row.owner_phone || null, mode: 'import' },
      });

      if (error || !data?.user_id) {
        newStatuses[row.unit_id] = 'error';
        setOwnerStatuses({ ...newStatuses });
        continue;
      }

      const { error: memErr } = await supabase.from('memberships').insert({
        user_id: data.user_id,
        unit_id: row.unit_id,
        tenure:  'owner',
      });

      newStatuses[row.unit_id] = memErr ? 'error' : (data.existing ? 'exists' : 'invited');
      setOwnerStatuses({ ...newStatuses });
    }

    setInviting(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!canImport) {
    return (
      <Card><CardBody>
        <p className="text-sm text-muted-foreground text-center py-10">
          You don't have permission to import data.
        </p>
      </CardBody></Card>
    );
  }

  const building = buildings.find(b => b.id === buildingId);

  const steps: { id: Step; label: string }[] = [
    { id: 'upload',    label: 'Upload' },
    { id: 'mapping',   label: isPdf ? 'Review Data' : 'Map Columns' },
    { id: 'importing', label: 'Import' },
    { id: 'done',      label: 'Done' },
  ];
  const stepIndex = steps.findIndex(s => s.id === step);

  const pendingInvites = ownerRows.filter(r =>
    ownerEmails[r.unit_id]?.trim() &&
    ownerStatuses[r.unit_id] !== 'invited' &&
    ownerStatuses[r.unit_id] !== 'exists'
  );
  const invitedCount = Object.values(ownerStatuses).filter(s => s === 'invited').length;
  const existingCount = Object.values(ownerStatuses).filter(s => s === 'exists').length;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Import Building Data</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload an Excel, CSV, or PDF file — Arabic content fully supported.
        </p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-1 mb-8">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            <div className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full',
              i < stepIndex   ? 'bg-primary/10 text-primary' :
              i === stepIndex ? 'bg-primary text-primary-foreground' :
              'bg-muted text-muted-foreground'
            )}>
              {i < stepIndex ? <CheckCircle2 size={12} /> : <span>{i + 1}</span>}
              {s.label}
            </div>
            {i < steps.length - 1 && <ChevronRight size={12} className="text-muted-foreground/40" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-5">
          <Card>
            <CardBody>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <div
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => !fileName && fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
                  dragging  ? 'border-primary bg-primary/5' :
                  fileName  ? 'border-border bg-muted/20 cursor-default' :
                  'border-border hover:border-primary/60 hover:bg-muted/10 cursor-pointer'
                )}
              >
                {fileName ? (
                  <div className="flex items-center justify-center gap-3">
                    {isPdf
                      ? <FileText size={24} className="text-primary shrink-0" />
                      : <FileSpreadsheet size={24} className="text-primary shrink-0" />
                    }
                    <div className="text-left">
                      <p className="text-sm font-medium text-foreground">{fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {isPdf
                          ? 'PDF ready — AI will extract the data'
                          : `${rows.length} rows · ${headers.length} columns`
                        }
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); resetFile(); }}
                      className="ml-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={28} className="mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm font-medium text-foreground">Drop your file here</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      or click to browse — .xlsx · .xls · .csv · .pdf
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Arabic content is fully supported</p>
                  </>
                )}
              </div>

              {/* Sheet selector — Excel only */}
              {!isPdf && sheetNames.length > 1 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Sheet</label>
                  <div className="flex flex-wrap gap-2">
                    {sheetNames.map(s => (
                      <button
                        key={s}
                        onClick={() => workbookData && loadSheet(workbookData, s)}
                        className={cn(
                          'text-xs px-3 py-1.5 rounded-md border transition-colors cursor-pointer',
                          selectedSheet === s
                            ? 'border-primary bg-primary/5 text-primary font-medium'
                            : 'border-border text-muted-foreground hover:border-primary/40'
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Building selector */}
          <Card>
            <CardBody>
              <label className="block text-sm font-medium text-foreground mb-3">
                Which building is this data for?
              </label>
              <div className="grid sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                {buildings.filter(b => b.is_active).map(b => (
                  <button
                    key={b.id}
                    onClick={() => setBuildingId(b.id)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer',
                      buildingId === b.id
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/40 hover:bg-muted/30'
                    )}
                  >
                    <Building2 size={14} className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{b.city}</p>
                    </div>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Raw preview — Excel only */}
          {!isPdf && headers.length > 0 && (
            <Card>
              <CardBody>
                <p className="text-xs font-medium text-muted-foreground mb-2">File preview (first 3 rows)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        {headers.map(h => (
                          <th key={h} className="text-left text-muted-foreground font-medium px-2 py-1.5 border-b border-border whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          {headers.map(h => (
                            <td key={h} className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[140px] truncate">
                              {String(row[h] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              onClick={analyzeFile}
              disabled={!fileName || !buildingId || aiLoading}
              loading={aiLoading}
            >
              {aiLoading
                ? (isPdf ? 'Extracting…' : 'Analyzing…')
                : (isPdf ? 'Extract with AI →' : 'Analyze with AI →')
              }
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2a: Excel — Map Columns ── */}
      {step === 'mapping' && !isPdf && (
        <div className="space-y-5">
          <Card>
            <CardBody>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Review column mapping</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    AI mapped {Object.values(mapping).filter(v => v !== 'SKIP').length} of {headers.length} columns.
                    Adjust any that look wrong.
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <p className="font-medium text-foreground">{building?.name}</p>
                  <p>{rows.length} rows</p>
                </div>
              </div>

              <div className="space-y-2">
                {headers.map(h => {
                  const sampleVals = rows.slice(0, 3).map(r => String(r[h] ?? '')).filter(Boolean);
                  return (
                    <div key={h} className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg border',
                      mapping[h] !== 'SKIP' ? 'border-primary/30 bg-primary/5' : 'border-border'
                    )}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate" dir="auto">{h}</p>
                        <p className="text-xs text-muted-foreground truncate" dir="auto">
                          {sampleVals.join(' · ') || 'no data'}
                        </p>
                      </div>
                      <select
                        value={mapping[h] ?? 'SKIP'}
                        onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value as FieldValue }))}
                        className="text-xs rounded-md border border-border bg-background text-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring/50 cursor-pointer shrink-0"
                      >
                        {IMPORT_FIELDS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {!getKey('unit_label') && (
                <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <AlertCircle size={14} className="text-yellow-600 shrink-0" />
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    Map at least one column to "Unit / Apt No." to proceed.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          {getKey('unit_label') && (
            <Card>
              <CardBody>
                <p className="text-xs font-medium text-muted-foreground mb-2">What will be imported</p>
                <div className="flex gap-6">
                  <div>
                    <p className="text-2xl font-bold text-foreground">{rows.length}</p>
                    <p className="text-xs text-muted-foreground">units</p>
                  </div>
                  {getKey('balance_due') && (
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {rows.filter(r => normalizeNumber(r[getKey('balance_due')]) > 0).length}
                      </p>
                      <p className="text-xs text-muted-foreground">with opening balances</p>
                    </div>
                  )}
                  {getKey('owner_name') && (
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {rows.filter(r => String(r[getKey('owner_name')] ?? '').trim()).length}
                      </p>
                      <p className="text-xs text-muted-foreground">with owner names</p>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>← Back</Button>
            <Button onClick={runImport} disabled={!getKey('unit_label')}>
              Import {rows.length} rows →
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2b: PDF — Review Extracted Data ── */}
      {step === 'mapping' && isPdf && (
        <div className="space-y-5">
          <Card>
            <CardBody>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Review extracted data</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    AI found {pdfRows.length} units. Edit or remove any rows before importing.
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <p className="font-medium text-foreground">{building?.name}</p>
                  <p>{pdfRows.filter(r => r.balance_due > 0).length} with balances</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-muted-foreground font-medium px-2 py-2">Unit No.</th>
                      <th className="text-left text-muted-foreground font-medium px-2 py-2">Balance (USD)</th>
                      <th className="text-left text-muted-foreground font-medium px-2 py-2 hidden sm:table-cell">Owner</th>
                      <th className="text-left text-muted-foreground font-medium px-2 py-2 hidden md:table-cell">Phone</th>
                      <th className="text-left text-muted-foreground font-medium px-2 py-2 hidden lg:table-cell">Notes</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {pdfRows.map((row, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                        <td className="px-2 py-1.5">
                          <input
                            value={row.unit_label}
                            dir="auto"
                            onChange={e => setPdfRows(prev => prev.map((r, idx) =>
                              idx === i ? { ...r, unit_label: e.target.value } : r
                            ))}
                            className="w-20 text-xs rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring/50"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.balance_due}
                            onChange={e => setPdfRows(prev => prev.map((r, idx) =>
                              idx === i ? { ...r, balance_due: parseFloat(e.target.value) || 0 } : r
                            ))}
                            className="w-24 text-xs rounded border border-border bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring/50"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground hidden sm:table-cell" dir="auto">
                          {row.owner_name || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground hidden md:table-cell">
                          {row.owner_phone || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground hidden lg:table-cell max-w-[160px] truncate">
                          {row.notes || <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => setPdfRows(prev => prev.filter((_, idx) => idx !== i))}
                            className="p-1 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pdfRows.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">All rows removed.</p>
              )}
            </CardBody>
          </Card>

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>← Back</Button>
            <Button onClick={runImport} disabled={pdfRows.length === 0}>
              Import {pdfRows.length} units →
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Importing ── */}
      {step === 'importing' && (
        <Card>
          <CardBody>
            <div className="py-8 text-center">
              <Loader2 size={32} className="mx-auto text-primary mb-4 animate-spin" />
              <p className="text-base font-medium text-foreground">Importing data…</p>
              <p className="text-sm text-muted-foreground mt-1">
                {progress} of {importTotal} rows
              </p>
              <div className="w-full max-w-xs mx-auto mt-4 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-200"
                  style={{ width: `${importTotal > 0 ? (progress / importTotal) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-3">Please don't close this tab.</p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Step 4: Done ── */}
      {step === 'done' && (
        <div className="space-y-5">
          {/* Results */}
          <Card>
            <CardBody>
              <div className="flex items-center gap-3 mb-5">
                <CheckCircle2 size={24} className="text-green-500 shrink-0" />
                <div>
                  <p className="text-base font-semibold text-foreground">Import complete</p>
                  <p className="text-xs text-muted-foreground">{building?.name}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-xl bg-green-500/10 p-4 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{results.units}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">units created</p>
                </div>
                <div className="rounded-xl bg-primary/10 p-4 text-center">
                  <p className="text-2xl font-bold text-primary">{results.balances}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">opening balances</p>
                </div>
                <div className="rounded-xl bg-muted p-4 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{results.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">rows skipped</p>
                </div>
                <div className={cn('rounded-xl p-4 text-center', results.errors > 0 ? 'bg-red-500/10' : 'bg-muted')}>
                  <p className={cn('text-2xl font-bold', results.errors > 0 ? 'text-red-500' : 'text-muted-foreground')}>
                    {results.errors}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">errors</p>
                </div>
              </div>
              {results.errors > 0 && (
                <p className="text-xs text-muted-foreground mt-4">
                  Rows with errors were skipped. Re-import is safe — duplicate labels will error and skip automatically.
                </p>
              )}
            </CardBody>
          </Card>

          {/* Owner assignment */}
          {ownerRows.length > 0 && (
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-1">
                  <UserPlus size={16} className="text-primary shrink-0" />
                  <p className="text-sm font-semibold text-foreground">Assign owners to units</p>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  {ownerRows.length} units have owner names from the file. Enter each owner's email to invite
                  them and link them to their unit. Leave blank to skip — you can always invite later from the
                  Users page.
                </p>

                {(invitedCount > 0 || existingCount > 0) && (
                  <div className="flex gap-4 mb-4 text-xs">
                    {invitedCount > 0 && (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <CheckCircle2 size={12} /> {invitedCount} invited
                      </span>
                    )}
                    {existingCount > 0 && (
                      <span className="flex items-center gap-1 text-primary">
                        <CheckCircle2 size={12} /> {existingCount} linked to existing account
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {ownerRows.map(row => {
                    const status = ownerStatuses[row.unit_id] ?? 'pending';
                    const isDone = status === 'invited' || status === 'exists';
                    return (
                      <div key={row.unit_id} className="flex items-center gap-3">
                        <div className="w-24 shrink-0">
                          <p className="text-xs font-medium text-foreground truncate">{row.unit_label}</p>
                          <p className="text-xs text-muted-foreground truncate" dir="auto">{row.owner_name}</p>
                          {row.owner_phone && (
                            <p className="text-xs text-muted-foreground/60">{row.owner_phone}</p>
                          )}
                        </div>
                        <input
                          type="email"
                          placeholder="owner@email.com"
                          disabled={isDone || inviting}
                          value={ownerEmails[row.unit_id] ?? ''}
                          onChange={e => setOwnerEmails(prev => ({ ...prev, [row.unit_id]: e.target.value }))}
                          className={cn(
                            'flex-1 text-xs rounded-md border bg-background px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring/50 transition-colors',
                            isDone
                              ? 'border-border/40 text-muted-foreground cursor-not-allowed'
                              : 'border-border text-foreground'
                          )}
                        />
                        <div className="w-5 shrink-0 flex items-center justify-center">
                          {status === 'inviting' && <Loader2 size={14} className="animate-spin text-primary" />}
                          {status === 'invited'  && <CheckCircle2 size={14} className="text-green-500" />}
                          {status === 'exists'   && <CheckCircle2 size={14} className="text-primary" />}
                          {status === 'error'    && <AlertCircle  size={14} className="text-red-500" />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 flex justify-end">
                  <Button
                    onClick={inviteOwners}
                    disabled={inviting || pendingInvites.length === 0}
                    loading={inviting}
                    variant="secondary"
                  >
                    {inviting
                      ? 'Inviting…'
                      : `Invite & Assign${pendingInvites.length > 0 ? ` (${pendingInvites.length})` : ''}`
                    }
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setStep('upload');
                resetFile();
                setBuildingId('');
                setMapping({});
                setProgress(0);
                setOwnerRows([]);
                setOwnerEmails({});
                setOwnerStatuses({});
              }}
            >
              Import another file
            </Button>
            <Button onClick={() => { window.location.href = '/structure'; }}>
              View structure →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
