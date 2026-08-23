// The amenities of an entity (0112), for the selectors on the inspection,
// contract and expense forms. One fetch, one shape, so every form offers the
// same list in the same order.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Amenity } from '@/types';

export function useAmenities(kind: 'compound' | 'building' | undefined, id: string | undefined) {
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  useEffect(() => {
    if (!kind || !id) { setAmenities([]); return; }
    // a compound entity's forms may tag a block's amenity too, so the compound
    // list is the compound's own rows plus every block's
    if (kind === 'compound') {
      supabase.from('buildings').select('id').eq('compound_id', id).then(({ data }) => {
        const ids = ((data as { id: string }[]) ?? []).map((b) => b.id);
        const filter = ids.length ? `compound_id.eq.${id},building_id.in.(${ids.join(',')})` : `compound_id.eq.${id}`;
        supabase.from('amenities').select('*').or(filter).order('kind').order('name')
          .then(({ data: a }) => setAmenities((a as Amenity[]) ?? []));
      });
      return;
    }
    supabase.from('amenities').select('*').eq('building_id', id).order('kind').order('name')
      .then(({ data }) => setAmenities((data as Amenity[]) ?? []));
  }, [kind, id]);
  return amenities;
}

/** "Lift A (Block B)" — the label a selector shows. */
export const amenityLabel = (a: Amenity) => a.location ? `${a.name} · ${a.location}` : a.name;
