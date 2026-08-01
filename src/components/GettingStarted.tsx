import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, X, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

/**
 * Setup checklist for new admins: shows what to do first, checks itself off
 * from real data, and disappears once everything is done (or when dismissed).
 * Deliberately a checklist, not a guided tour: it drives activation instead
 * of narrating UI, and it can't rot when screens change.
 */

type StepKey = 'units' | 'licenses' | 'people' | 'expense' | 'reminder';

const STEPS: { key: StepKey; to: string }[] = [
  { key: 'units', to: '/structure' },
  { key: 'licenses', to: '/licenses' },
  { key: 'people', to: '/users' },
  { key: 'expense', to: '/finance' },
  { key: 'reminder', to: '/buildings' },
];

export function GettingStarted({ buildingIds }: { buildingIds: string[] }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const dismissKey = `abniyah_gs_dismissed_${profile?.id ?? ''}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1');
  const [done, setDone] = useState<Record<StepKey, boolean> | null>(null);

  const idsKey = buildingIds.join(',');
  useEffect(() => {
    if (dismissed || !buildingIds.length) return;
    (async () => {
      // Existence checks only — every query is LIMIT 1.
      const { data: unitRows } = await supabase
        .from('units').select('id').in('building_id', buildingIds).limit(1000);
      const unitIds = ((unitRows ?? []) as { id: string }[]).map(u => u.id);

      const [members, charges, licenses, reminders] = await Promise.all([
        unitIds.length
          ? supabase.from('memberships').select('id').in('unit_id', unitIds).is('ended_at', null).limit(1)
          : Promise.resolve({ data: [] }),
        supabase.from('charges').select('id').in('building_id', buildingIds).limit(1),
        unitIds.length
          ? supabase.from('license_assignments').select('id').in('unit_id', unitIds).is('unassigned_at', null).limit(1)
          : Promise.resolve({ data: [] }),
        supabase.from('buildings').select('id').in('id', buildingIds).not('reminder_day', 'is', null).limit(1),
      ]);

      setDone({
        units: unitIds.length > 0,
        licenses: (licenses.data ?? []).length > 0,
        people: (members.data ?? []).length > 0,
        expense: (charges.data ?? []).length > 0,
        reminder: (reminders.data ?? []).length > 0,
      });
    })();
  }, [idsKey, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dismissed || !done) return null;
  const doneCount = STEPS.filter(s => done[s.key]).length;
  if (doneCount === STEPS.length) return null; // fully set up — nothing to teach

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="font-semibold text-foreground">{t('gs.title')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('gs.subtitle')} · {t('gs.progress', { done: doneCount, total: STEPS.length })}
            </p>
          </div>
          <button
            onClick={() => { localStorage.setItem(dismissKey, '1'); setDismissed(true); }}
            className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            title={t('gs.dismiss')}
          >
            <X size={16} />
          </button>
        </div>

        {/* progress bar */}
        <div className="h-1.5 rounded-full bg-border mb-4 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="space-y-1">
          {STEPS.map(s => {
            const isDone = done[s.key];
            return (
              <Link
                key={s.key}
                to={s.to}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2.5 py-2 -mx-1 transition-colors',
                  isDone ? 'opacity-60' : 'hover:bg-primary/10',
                )}
              >
                {isDone
                  ? <CheckCircle2 size={17} className="text-primary shrink-0" />
                  : <Circle size={17} className="text-muted-foreground/50 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium text-foreground', isDone && 'line-through')}>
                    {t(`gs.steps.${s.key}.title`)}
                  </p>
                  {!isDone && (
                    <p className="text-xs text-muted-foreground">{t(`gs.steps.${s.key}.desc`)}</p>
                  )}
                </div>
                {!isDone && <ChevronRight size={15} className="text-muted-foreground shrink-0 rtl:rotate-180" />}
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
