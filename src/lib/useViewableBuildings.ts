import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Building } from '@/types';

/**
 * Buildings a user may *view* (read) — used by transparency pages like
 * Inspections & Contracts. Union of managed buildings (platform admin = all)
 * and the buildings where the user owns/occupies a unit (memberships).
 */
export function useViewableBuildings() {
  const { isPlatformAdmin, manageableBuildingIds, memberships, profile } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);

  const legacySuper = profile?.role === 'super_admin';
  const legacyBuildingId = profile?.role === 'building_admin' ? profile?.building_id ?? null : null;

  const memberBuildingIds = useMemo(
    () => memberships.map((m) => m.unit?.building_id).filter((x): x is string => !!x),
    [memberships],
  );

  const idsKey = [...new Set([...manageableBuildingIds, ...memberBuildingIds, legacyBuildingId ?? ''])]
    .filter(Boolean).sort().join(',');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = supabase.from('buildings').select('*').order('name');

      if (!isPlatformAdmin && !legacySuper) {
        const ids = [...new Set([...manageableBuildingIds, ...memberBuildingIds, ...(legacyBuildingId ? [legacyBuildingId] : [])])];
        if (ids.length === 0) {
          if (!cancelled) { setBuildings([]); setLoading(false); }
          return;
        }
        query = query.in('id', ids);
      }

      const { data } = await query;
      if (!cancelled) { setBuildings((data as Building[]) ?? []); setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin, legacySuper, legacyBuildingId, idsKey]);

  return { buildings, loading };
}
