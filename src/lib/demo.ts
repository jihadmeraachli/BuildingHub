// Public read-only demo — the "See the live demo" button on abniyah.com.
// Two personas into the same showcase building (seeded by seed-demo.mjs):
//   admin — a `viewer` grant: the manager's oversight surface, RLS blocks writes
//   owner — a resident with two units: the unit-owner experience (balances,
//           receipts, meetings). Residents can normally write a little (report
//           issues), so demo accounts also get client-side gates (Issues,
//           Settings) — worst case a stray API write lands in the demo
//           building and is trivially cleaned.
// Credentials in the bundle are by design; Settings is hidden for these
// accounts so the emails stay out of the UI.
export const DEMO_PASSWORD = 'abniyah-demo-2026';

export const DEMO_ACCOUNTS = {
  admin: 'jihad.meraachli+demoviewer@gmail.com',
  owner: 'jihad.meraachli+demoowner@gmail.com',
} as const;

export type DemoPersona = keyof typeof DEMO_ACCOUNTS;

const DEMO_EMAILS = new Set<string>(Object.values(DEMO_ACCOUNTS));

export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && DEMO_EMAILS.has(email.toLowerCase());
}

/** The unlock scope the visitor's beta code granted (0126).
 *  'full' = everything (testers). 'demo' = marketing site + demo only —
 *  Register refuses these visitors. Legacy unlocks (before scopes existed)
 *  and gate-off builds count as 'full'. */
export type BetaScope = 'full' | 'demo';
export function betaScope(): BetaScope {
  if (import.meta.env.VITE_BETA_GATE !== '1') return 'full';
  try {
    return localStorage.getItem('abniyah_beta_scope') === 'demo' ? 'demo' : 'full';
  } catch { return 'full'; }
}

/** Routes hidden from the DEMO personas while the product is pre-release:
 *  the pricing/billing machinery and the differentiators we don't want
 *  browsable by whoever holds the public demo password. The Sidebar filters
 *  these out of the nav; AppShell redirects a direct URL hit to /dashboard.
 *  One list — adjust freely, the demo re-shows a page the moment its route
 *  leaves this set. */
export const DEMO_HIDDEN_ROUTES = new Set<string>([
  '/licenses',    // the whole pricing-band + subscription model
  '/import',      // the AI import
  '/dues',        // prepaid-budget machinery
  '/collect',     // collector flow
  '/inspections', // inspection workflows
  '/contracts',   // contract management
  '/projects',    // project tracking
  '/amenities',   // amenity booking
]);
