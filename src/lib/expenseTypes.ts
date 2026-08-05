// ============================================================
// Expense types (0085) — the per-building catalog that expenses, budget lines
// and the metering module all select from. Scope mirrors billing_mode: a
// compound's catalog governs its blocks; a standalone building has its own.
// ============================================================
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ExpenseType } from '@/types';

/** The catalog for an entity scope. `entityKind`/`entityId` as in useEntities. */
export async function fetchExpenseTypes(
  entityKind: 'compound' | 'building', entityId: string,
): Promise<ExpenseType[]> {
  const q = entityKind === 'compound'
    ? supabase.from('expense_types').select('*').eq('compound_id', entityId)
    : supabase.from('expense_types').select('*').eq('building_id', entityId);
  const { data } = await q.order('sort_order').order('name');
  return (data as ExpenseType[]) ?? [];
}

export function useExpenseTypes(entityKind?: 'compound' | 'building', entityId?: string) {
  const [types, setTypes] = useState<ExpenseType[]>([]);
  useEffect(() => {
    if (!entityKind || !entityId) { setTypes([]); return; }
    let cancelled = false;
    fetchExpenseTypes(entityKind, entityId).then((t) => { if (!cancelled) setTypes(t); });
    return () => { cancelled = true; };
  }, [entityKind, entityId]);
  const reload = () => {
    if (entityKind && entityId) fetchExpenseTypes(entityKind, entityId).then(setTypes);
  };
  return { types, activeTypes: types.filter((t) => t.active), reload };
}

/** The legacy enum value an expense must carry for the old CHECK constraint:
 *  a seeded type keeps its key, a custom type files under 'other'. */
export const legacyCategoryFor = (t: ExpenseType | undefined): string =>
  t?.key ?? 'other';
