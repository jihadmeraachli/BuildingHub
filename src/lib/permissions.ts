// ============================================================
// Permission bundles — client mirror of supabase role_has_cap().
// KEEP IN SYNC with migrations/0002_v3_foundation.sql.
// The DB is the source of truth (RLS enforces it); this is for UI gating.
// ============================================================
import type { Capability, GrantRole } from '@/types';

// Everything a building-level admin can do. Note: NO org.manage /
// org.assign_buildings — those are org-level only (migration 0026).
const BUILDING_ADMIN_CAPS: Capability[] = [
  'building.manage', 'unit.manage', 'group.manage',
  'resident.approve', 'resident.manage', 'grant.manage',
  'issue.view_all', 'issue.update',
  'expense.manage', 'charge.manage', 'payment.record', 'payment.confirm', 'finance.view',
  'meeting.manage',
  'user.deactivate',
];

// Org admin = building admin + the org-level powers.
const ORG_ADMIN_CAPS: Capability[] = [
  ...BUILDING_ADMIN_CAPS,
  'org.manage', 'org.assign_buildings',
];

const FINANCE_CAPS: Capability[] = [
  'expense.manage', 'charge.manage', 'payment.record', 'payment.confirm', 'finance.view',
];

const VIEWER_CAPS: Capability[] = ['finance.view', 'issue.view_all'];

// The superintendent (ناطور): on the ground for issues, never sees money.
const BUILDING_SUPER_CAPS: Capability[] = [
  'issue.view_all', 'issue.update', 'meeting.manage',
];

// NOTE: 'user.delete' is intentionally absent from every role — it is
// platform-admin only (is_platform_admin() short-circuits user_can()).
// A compound_admin has a building_admin's powers over EVERY block in the
// compound; the difference is scope, not capability (migration 0027).
const ROLE_CAPS: Record<GrantRole, Capability[]> = {
  org_admin: ORG_ADMIN_CAPS,
  compound_admin: BUILDING_ADMIN_CAPS,
  building_admin: BUILDING_ADMIN_CAPS,
  building_super: BUILDING_SUPER_CAPS,
  org_finance: FINANCE_CAPS,
  compound_finance: FINANCE_CAPS,
  building_finance: FINANCE_CAPS,
  viewer: VIEWER_CAPS,
};

/** Role hierarchy — mirrors role_rank() in SQL. Platform admin = 100, resident = 10. */
export const ROLE_RANK: Record<GrantRole, number> = {
  org_admin: 80,
  compound_admin: 70,
  building_admin: 60,
  building_super: 50,
  org_finance: 40,
  compound_finance: 40,
  building_finance: 40,
  viewer: 20,
};

/** Highest rank across a set of grant roles (10 = plain resident, no grants). */
export function maxRank(roles: GrantRole[]): number {
  return roles.reduce((max, r) => Math.max(max, ROLE_RANK[r] ?? 0), 0) || 10;
}

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
