import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, ChevronRight, PartyPopper, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * Full-page setup checklist for new admins (sidebar tab above Dashboard).
 * Steps check themselves off from real data; the first step is role-aware
 * (building / compound blocks / org portfolio). The sidebar tab hides itself
 * once everything is done or the admin dismisses the page — flag lives in
 * localStorage per user (see Sidebar).
 */

export const gsHiddenKey = (userId: string | undefined) => `abniyah_gs_hidden_${userId ?? ''}`;
const profileSeenKey = (userId: string | undefined) => `abniyah_gs_profile_${userId ?? ''}`;

type StepKey = 'entity' | 'units' | 'licenses' | 'people' | 'expense' | 'reminder' | 'profile';

export default function GettingStarted() {
  const { t } = useTranslation();
  const { profile, grants } = useAuth();
  const { buildings, loading: buildingsLoading } = useManagedBuildings();
  const buildingIds = buildings.map(b => b.id);
  const idsKey = buildingIds.join(',');

  // Role-aware first step: what entity does this admin still need to create?
  const role: 'org' | 'compound' | 'building' =
    grants.some(g => g.role === 'org_admin') ? 'org'
    : grants.some(g => g.role === 'compound_admin') ? 'compound'
    : 'building';

  const [done, setDone] = useState<Record<StepKey, boolean> | null>(null);
  const [profileSeen, setProfileSeen] = useState(
    () => localStorage.getItem(profileSeenKey(profile?.id)) === '1',
  );

  useEffect(() => {
    if (buildingsLoading) return;
    (async () => {
      // Existence checks only — every query is LIMIT 1.
      const { data: unitRows } = buildingIds.length
        ? await supabase.from('units').select('id').in('building_id', buildingIds).limit(1000)
        : { data: [] };
      const unitIds = ((unitRows ?? []) as { id: string }[]).map(u => u.id);

      const [members, charges, licenses, reminders] = await Promise.all([
        unitIds.length
          ? supabase.from('memberships').select('id').in('unit_id', unitIds).is('ended_at', null).limit(1)
          : Promise.resolve({ data: [] }),
        buildingIds.length
          ? supabase.from('charges').select('id').in('building_id', buildingIds).limit(1)
          : Promise.resolve({ data: [] }),
        unitIds.length
          ? supabase.from('license_assignments').select('id').in('unit_id', unitIds).is('unassigned_at', null).limit(1)
          : Promise.resolve({ data: [] }),
        buildingIds.length
          ? supabase.from('buildings').select('id').in('id', buildingIds).not('reminder_day', 'is', null).limit(1)
          : Promise.resolve({ data: [] }),
      ]);

      setDone({
        entity: buildingIds.length > 0,
        units: unitIds.length > 0,
        licenses: (licenses.data ?? []).length > 0,
        people: (members.data ?? []).length > 0,
        expense: (charges.data ?? []).length > 0,
        reminder: (reminders.data ?? []).length > 0,
        profile: profileSeen,
      });
    })();
  }, [idsKey, buildingsLoading, profileSeen]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps: { key: StepKey; to: string; titleKey: string; descKey: string }[] = [
    { key: 'entity', to: '/buildings', titleKey: `gs.steps.entity_${role}.title`, descKey: `gs.steps.entity_${role}.desc` },
    { key: 'units', to: '/structure', titleKey: 'gs.steps.units.title', descKey: 'gs.steps.units.desc' },
    { key: 'licenses', to: '/licenses', titleKey: 'gs.steps.licenses.title', descKey: 'gs.steps.licenses.desc' },
    { key: 'people', to: '/users', titleKey: 'gs.steps.people.title', descKey: 'gs.steps.people.desc' },
    { key: 'expense', to: '/finance', titleKey: 'gs.steps.expense.title', descKey: 'gs.steps.expense.desc' },
    { key: 'reminder', to: '/buildings', titleKey: 'gs.steps.reminder.title', descKey: 'gs.steps.reminder.desc' },
    { key: 'profile', to: '/settings', titleKey: 'gs.steps.profile.title', descKey: 'gs.steps.profile.desc' },
  ];

  const doneCount = done ? steps.filter(s => done[s.key]).length : 0;
  const allDone = done !== null && doneCount === steps.length;

  // Fully set up → the sidebar tab retires itself on the next render.
  useEffect(() => {
    if (allDone) localStorage.setItem(gsHiddenKey(profile?.id), '1');
  }, [allDone, profile?.id]);

  function dismiss() {
    localStorage.setItem(gsHiddenKey(profile?.id), '1');
    window.history.length > 1 ? window.history.back() : null;
  }

  function onStepClick(key: StepKey) {
    if (key === 'profile') {
      localStorage.setItem(profileSeenKey(profile?.id), '1');
      setProfileSeen(true);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t('gs.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('gs.subtitle')}{done ? ` · ${t('gs.progress', { done: doneCount, total: steps.length })}` : ''}
        </p>
      </div>

      {allDone && (
        <Card className="mb-5 border-primary/40 bg-primary/[0.05]">
          <CardContent className="p-5 flex items-center gap-3">
            <PartyPopper size={22} className="text-primary shrink-0" />
            <div>
              <p className="font-semibold text-foreground">{t('gs.allSetTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('gs.allSetBody')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5">
          {/* progress bar */}
          <div className="h-1.5 rounded-full bg-border mb-5 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: done ? `${(doneCount / steps.length) * 100}%` : '0%' }}
            />
          </div>

          <div className="space-y-1">
            {steps.map(s => {
              const isDone = done?.[s.key] ?? false;
              return (
                <Link
                  key={s.key}
                  to={s.to}
                  onClick={() => onStepClick(s.key)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 -mx-1 transition-colors',
                    isDone ? 'opacity-60' : 'hover:bg-primary/10',
                  )}
                >
                  {isDone
                    ? <CheckCircle2 size={18} className="text-primary shrink-0" />
                    : <Circle size={18} className="text-muted-foreground/50 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium text-foreground', isDone && 'line-through')}>
                      {t(s.titleKey)}
                    </p>
                    {!isDone && (
                      <p className="text-xs text-muted-foreground mt-0.5">{t(s.descKey)}</p>
                    )}
                  </div>
                  {!isDone && <ChevronRight size={15} className="text-muted-foreground shrink-0 rtl:rotate-180" />}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <button
        onClick={dismiss}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <EyeOff size={13} /> {t('gs.dismiss')}
      </button>
      {allDone && (
        <div className="mt-4">
          <Link to="/dashboard"><Button>{t('gs.goDashboard')}</Button></Link>
        </div>
      )}
    </div>
  );
}
