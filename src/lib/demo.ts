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
