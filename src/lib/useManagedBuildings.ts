import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Building } from '@/types';

/**
 * Buildings the current user may act on, resolved through the v3 model
 * (platform admin = all) with a fallback to the legacy profile.role so existing
 * admins keep working during the migration.
 */
export function useManagedBuildings() {
  const { isPlatformAdmin, manageableBuildingIds, profile } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);

  const legacySuper = profile?.role === 'super_admin';
  const legacyBuildingId = profile?.role === 'building_admin' ? profile?.building_id ?? null : null;

  // Stable dependency key so we don't refetch every render.
  const idsKey = [...manageableBuildingIds].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = supabase.from('buildings').select('*').order('name');

      if (!isPlatformAdmin && !legacySuper) {
        const ids = new Set(manageableBuildingIds);
        if (legacyBuildingId) ids.add(legacyBuildingId);
        const list = [...ids];
        if (list.length === 0) {
          if (!cancelled) { setBuildings([]); setLoading(false); }
          return;
        }
        query = query.in('id', list);
      }

      const { data } = await query;
      if (!cancelled) {
        setBuildings((data as Building[]) ?? []);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin, legacySuper, legacyBuildingId, idsKey]);

  return { buildings, loading };
}
