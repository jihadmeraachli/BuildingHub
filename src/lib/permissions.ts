// ============================================================
// Permission bundles — client mirror of supabase role_has_cap().
// KEEP IN SYNC with migrations/0002_v3_foundation.sql.
// The DB is the source of truth (RLS enforces it); this is for UI gating.
// ============================================================
import type { Capability, GrantRole } from '@/types';

const MANAGEMENT_ALL: Capability[] = [
  'building.manage', 'unit.manage', 'group.manage',
  'resident.approve', 'resident.manage', 'grant.manage',
  'issue.view_all', 'issue.update',
  'expense.manage', 'charge.manage', 'payment.record', 'payment.confirm', 'finance.view',
  'meeting.manage', 'org.manage', 'org.assign_buildings',
];

const FINANCE_CAPS: Capability[] = [
  'expense.manage', 'charge.manage', 'payment.record', 'payment.confirm', 'finance.view',
];

const VIEWER_CAPS: Capability[] = ['finance.view', 'issue.view_all'];

const ROLE_CAPS: Record<GrantRole, Capability[]> = {
  org_admin: MANAGEMENT_ALL,
  building_admin: MANAGEMENT_ALL,
  org_finance: FINANCE_CAPS,
  building_finance: FINANCE_CAPS,
  viewer: VIEWER_CAPS,
};

export function roleHasCap(role: GrantRole, cap: Capability): boolean {
  return ROLE_CAPS[role]?.includes(cap) ?? false;
}

/**
 * Given the set of roles a user holds *for a specific building* (already
 * resolved through org→building cascade), does any of them grant `cap`?
 */
export function rolesHaveCap(roles: GrantRole[], cap: Capability): boolean {
  return roles.some((r) => roleHasCap(r, cap));
}
