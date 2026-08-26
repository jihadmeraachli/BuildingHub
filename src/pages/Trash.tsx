import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, RotateCcw, Building2, Boxes, Network, Home } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { fmtDate } from '@/lib/dateFmt';

/**
 * The recycle bin (0138). Lists soft-deleted buildings / compounds / units /
 * organizations the current user is allowed to restore (list_trash() filters
 * by can_restore_entity; platform admin sees all), and restores them.
 * Items are hard-purged 30 days after deletion by the pg_cron job.
 */
type TrashRow = { entity: string; id: string; name: string | null; deleted_at: string; deleted_by: string | null };

const ICON: Record<string, typeof Building2> = {
  buildings: Building2, compounds: Boxes, organizations: Network, units: Home,
};

export default function Trash() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('list_trash');
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (data as TrashRow[]) ?? [];
    setRows(list);
    // Resolve "deleted by" ids to names in one round-trip.
    const ids = [...new Set(list.map((r) => r.deleted_by).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      const map: Record<string, string> = {};
      (profs ?? []).forEach((p: { id: string; full_name: string }) => { map[p.id] = p.full_name; });
      setNames(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function restore(row: TrashRow) {
    setRestoring(row.id);
    const { error } = await supabase.rpc('restore_entity', { p_table: row.entity, p_id: row.id });
    setRestoring(null);
    if (error) { toast.error(error.message); return; }
    toast.success(row.entity === 'units'
      ? t('trash.restoredUnlicensed', { name: row.name || t('trash.unnamed') })
      : t('trash.restored', { name: row.name || t('trash.unnamed') }));
    load();
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Trash2 size={22} /> {t('trash.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">{t('trash.subtitle')}</p>
      </div>

      {loading ? (
        <SkeletonCards />
      ) : rows.length === 0 ? (
        <Card className="text-center py-16">
          <Trash2 size={32} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">{t('trash.empty')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const Icon = ICON[row.entity] ?? Trash2;
            return (
              <Card key={row.entity + row.id} className="flex items-center justify-between gap-4 py-3.5 px-5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shrink-0">
                    <Icon size={17} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{row.name || t('trash.unnamed')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('trash.entity.' + row.entity)}
                      {' · '}{t('trash.deletedOn', { date: fmtDate(row.deleted_at, 'dd-MM-yyyy') })}
                      {row.deleted_by && names[row.deleted_by] ? ` · ${t('trash.by', { name: names[row.deleted_by] })}` : ''}
                    </p>
                  </div>
                </div>
                <Button variant="tinted" size="sm" onClick={() => restore(row)} loading={restoring === row.id}>
                  <RotateCcw size={14} /> {t('trash.restore')}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
