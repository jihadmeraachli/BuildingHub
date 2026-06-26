import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Building, Compound, BillingMode } from '@/types';

/** A selectable finance/records scope: a compound (grouping its blocks) or a standalone building. */
export interface Entity {
  key: string;
  kind: 'compound' | 'building';
  id: string;
  name: string;
  buildingIds: string[];
  blocks: { id: string; name: string }[];
  billingMode: BillingMode;
}

export function buildEntities(buildings: Building[], compounds: Compound[]): Entity[] {
  const out: Entity[] = [];
  const byCompound: Record<string, Building[]> = {};
  for (const b of buildings) {
    if (b.compound_id) (byCompound[b.compound_id] ??= []).push(b);
    else out.push({ key: `b:${b.id}`, kind: 'building', id: b.id, name: b.name, buildingIds: [b.id], blocks: [{ id: b.id, name: b.name }], billingMode: b.billing_mode ?? 'arrears' });
  }
  for (const [cid, blocks] of Object.entries(byCompound)) {
    const comp = compounds.find((c) => c.id === cid);
    out.push({ key: `c:${cid}`, kind: 'compound', id: cid, name: comp?.name ?? 'Compound', buildingIds: blocks.map((b) => b.id), blocks: blocks.map((b) => ({ id: b.id, name: b.name })), billingMode: comp?.billing_mode ?? 'arrears' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetches compounds and returns entities built from the given buildings. */
export function useEntities(buildings: Building[]): Entity[] {
  const [compounds, setCompounds] = useState<Compound[]>([]);
  useEffect(() => { supabase.from('compounds').select('*').then(({ data }) => setCompounds((data as Compound[]) ?? [])); }, []);
  return useMemo(() => buildEntities(buildings, compounds), [buildings, compounds]);
}
