// Client mirror of license_cap() in SQL (migration 0071) — UX only, the
// database trigger is the source of truth. KEEP IN SYNC.
import type { GrantScope } from '@/types';

export const LICENSE_CAPS: Record<GrantScope, number> = {
  building: 50,
  compound: 250,
  org: 2500,
};

/** Effective cap for a subscription: platform override wins over the default. */
export function licenseCap(scope: GrantScope, capOverride?: number | null): number {
  return capOverride ?? LICENSE_CAPS[scope];
}
