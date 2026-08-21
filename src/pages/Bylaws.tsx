import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ScrollText, Upload, FileText, Download, History, Info, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import { uploadFile, getSignedUrl } from '@/lib/upload';
import { fmtDate } from '@/lib/dateFmt';
import type { BuildingDocument, Unit } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

/**
 * Nizam el Bineye (#60) — the building's bylaws, and the provenance of the
 * حصص each unit is charged by.
 *
 * WHY THIS IS NOT A PDF VIEWER. `units.share_weight` is the default allocation
 * method: it decides how every expense splits. Until now that number sat in the
 * database with no stated authority, so an admin asked "why is my share bigger
 * than 3B's?" had nothing in the app to point at. The Nizam is the notarized
 * document that fixes those shares, so the page shows the document AND the
 * share table it governs, side by side. That pairing is the whole feature.
 *
 * EVERYONE CAN READ IT. Bylaws are a resident's right, so this page is in the
 * primary nav rather than under management, and RLS (0103) scopes SELECT by
 * user_sees_building rather than by any admin capability. Only building.manage
 * can upload.
 *
 * IT IS A REFERENCE COPY. The legal original is at the Land Registry, and the
 * page says so — the app must not read as though it were authoritative.
 */
export default function Bylaws() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile, residentLens, entityKey } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const entity = entities.find((e) => e.key === entityKey) ?? null;

  const [docs, setDocs] = useState<BuildingDocument[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: '', effective_date: '', note: '' });

  const canManage = !residentLens
    && (isPlatformAdmin || !!entity?.buildingIds.some((id) => can('building.manage', id)));

  // One Nizam usually covers a whole compound; a standalone block has its own.
  const scope = entity
    ? (entity.kind === 'compound'
        ? { compound_id: entity.id, building_id: null }
        : { building_id: entity.id, compound_id: null })
    : null;

  useEffect(() => { if (entity) load(); }, [entityKey, entities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity || !scope) return;
    setLoading(true);
    const q = supabase.from('building_documents').select('*').eq('doc_type', 'nizam');
    const [{ data: d }, { data: u }] = await Promise.all([
      scope.compound_id
        ? q.eq('compound_id', scope.compound_id).order('version', { ascending: false })
        : q.eq('building_id', scope.building_id!).order('version', { ascending: false }),
      supabase.from('units').select('*').in('building_id', entity.buildingIds).order('label'),
    ]);
    setDocs((d as BuildingDocument[]) ?? []);
    setUnits((u as Unit[]) ?? []);
    setLoading(false);
  }

  // Current is simply the highest version — no is_current flag to drift.
  const current = docs[0] ?? null;
  const older = docs.slice(1);

  const totalShares = units.reduce((s, u) => s + Number(u.share_weight), 0);

  async function openDoc(d: BuildingDocument) {
    // The bucket is public but signed URLs keep a shared link short-lived.
    const url = await getSignedUrl(d.file_url);
    window.open(url, '_blank', 'noopener');
  }

  async function save() {
    if (!scope || !file) return;
    setSaving(true);
    const folder = scope.compound_id ? `nizam/c-${scope.compound_id}` : `nizam/b-${scope.building_id}`;
    const url = await uploadFile('attachments', folder, file);
    if (!url) { toast.error(t('bylaws.uploadFailed')); setSaving(false); return; }
    const { error } = await supabase.from('building_documents').insert({
      ...scope,
      doc_type: 'nizam',
      // A new upload always supersedes; the unique index rejects a collision
      // rather than leaving two rows claiming the same version.
      version: (current?.version ?? 0) + 1,
      title: form.title.trim() || null,
      file_url: url,
      file_name: file.name,
      effective_date: form.effective_date || null,
      note: form.note.trim() || null,
      uploaded_by: profile?.id ?? null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('bylaws.uploaded'));
    setOpen(false);
    setFile(null);
    setForm({ title: '', effective_date: '', note: '' });
    load();
  }

  async function remove(d: BuildingDocument) {
    if (!confirm(t('bylaws.confirmDelete', { version: d.version }))) return;
    const { error } = await supabase.from('building_documents').delete().eq('id', d.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('bylaws.deleted'));
    load();
  }

  if (!entity) {
    return (
      <div className="p-6">
        <Card><CardBody className="text-center text-muted-foreground py-10">
          {t('bylaws.pickEntity')}
        </CardBody></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText size={22} className="text-primary" />
            {t('bylaws.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('bylaws.subtitle', { entity: entity.name })}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Upload size={16} className="me-1.5" />
            {current ? t('bylaws.uploadNewVersion') : t('bylaws.upload')}
          </Button>
        )}
      </div>

      {/* The app holds a working copy. Saying so up front matters more than it
          looks: a resident must not read a stored PDF as the legal instrument. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
        <Info size={15} className="text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">{t('bylaws.referenceOnly')}</p>
      </div>

      {loading ? <SkeletonCards count={2} /> : (
        <>
          {current ? (
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold">{current.title || t('bylaws.title')}</h2>
                      <Badge>{t('bylaws.versionN', { n: current.version })}</Badge>
                      <Badge variant="green">{t('bylaws.current')}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {current.effective_date
                        ? t('bylaws.adopted', { date: fmtDate(current.effective_date, 'MMM d, yyyy') })
                        : t('bylaws.uploadedOn', { date: fmtDate(current.created_at, 'MMM d, yyyy') })}
                    </p>
                    {current.note && <p className="text-sm mt-2">{current.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => openDoc(current)}>
                      <Download size={15} className="me-1.5" />
                      {t('bylaws.openDoc')}
                    </Button>
                    {canManage && (
                      <Button variant="ghost" onClick={() => remove(current)} aria-label={t('common.delete')}>
                        <Trash2 size={15} />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-2.5">
                  <FileText size={13} />
                  {current.file_name ?? t('bylaws.document')}
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="text-center py-10 space-y-2">
                <ScrollText size={30} className="mx-auto text-muted-foreground/50" />
                <p className="font-medium">{t('bylaws.empty')}</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  {canManage ? t('bylaws.emptyAdminHint') : t('bylaws.emptyResidentHint')}
                </p>
              </CardBody>
            </Card>
          )}

          {older.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <History size={14} />
                {showHistory ? t('bylaws.hideHistory') : t('bylaws.showHistory', { count: older.length })}
              </button>
              {showHistory && (
                <Card className="mt-2">
                  <CardBody className="divide-y divide-border p-0">
                    {older.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{d.title || t('bylaws.title')}</span>
                            <Badge variant="secondary">{t('bylaws.versionN', { n: d.version })}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {d.effective_date
                              ? t('bylaws.adopted', { date: fmtDate(d.effective_date, 'MMM d, yyyy') })
                              : t('bylaws.uploadedOn', { date: fmtDate(d.created_at, 'MMM d, yyyy') })}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" onClick={() => openDoc(d)}>
                            <Download size={14} />
                          </Button>
                          {canManage && (
                            <Button variant="ghost" onClick={() => remove(d)}>
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* The point of the page: the shares the Nizam fixes, next to it.
              A resident can read their own number here and see the article it
              comes from, instead of taking the split on trust. */}
          {units.length > 0 && (
            <Card>
              <CardBody className="p-0">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="font-semibold text-sm">{t('bylaws.sharesTitle')}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('bylaws.sharesHint')}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-border">
                        <th className="text-start font-medium px-4 py-2">{t('structure.unit')}</th>
                        <th className="text-end font-medium px-4 py-2">{t('structure.shareWeight')}</th>
                        <th className="text-end font-medium px-4 py-2">{t('bylaws.sharePct')}</th>
                        <th className="text-start font-medium px-4 py-2">{t('bylaws.sourceRef')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {units.map((u) => {
                        const pct = totalShares > 0 ? (Number(u.share_weight) / totalShares) * 100 : 0;
                        return (
                          <tr key={u.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2 font-medium">{u.label}</td>
                            <td className="px-4 py-2 text-end tabular-nums">{Number(u.share_weight)}</td>
                            <td className="px-4 py-2 text-end tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {u.share_source_ref || <span className="opacity-50">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="text-xs font-semibold">
                        <td className="px-4 py-2">{t('bylaws.totalShares')}</td>
                        <td className="px-4 py-2 text-end tabular-nums">{totalShares}</td>
                        <td className="px-4 py-2 text-end tabular-nums">100%</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={current ? t('bylaws.uploadNewVersion') : t('bylaws.upload')}>
        <div className="space-y-3">
          {current && (
            <p className="text-xs text-muted-foreground">
              {t('bylaws.supersedes', { n: current.version, next: current.version + 1 })}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">{t('bylaws.file')}</label>
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
            />
          </div>
          <Input
            label={t('bylaws.docTitle')}
            placeholder={t('bylaws.docTitlePlaceholder')}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <Input
            label={t('bylaws.effectiveDate')}
            type="date"
            value={form.effective_date}
            onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
          />
          <p className="text-xs text-muted-foreground -mt-1.5">{t('bylaws.effectiveDateHint')}</p>
          <Input
            label={t('bylaws.note')}
            placeholder={t('bylaws.notePlaceholder')}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} disabled={!file || saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
