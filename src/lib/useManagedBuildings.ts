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
  const { isPlatformAdmin, manageableBuildingIds } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);

  // Stable dependency key so we don't refetch every render.
  const idsKey = [...manageableBuildingIds].sort().join(',');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = supabase.from('buildings').select('*').order('name');

      if (!isPlatformAdmin) {
        const list = [...manageableBuildingIds];
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
  }, [isPlatformAdmin, idsKey]);

  return { buildings, loading };
}
