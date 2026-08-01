// Public read-only demo — the "See the live demo" button on abniyah.com.
// The demo account holds a `viewer` grant on the showcase building (seeded by
// seed-demo.mjs), so RLS makes every write impossible; the credentials being
// in the bundle is by design. Settings is hidden for this account (the email
// must stay out of the UI) — see Sidebar/Settings guards.
export const DEMO_EMAIL = 'jihad.meraachli+demoviewer@gmail.com';
export const DEMO_PASSWORD = 'abniyah-demo-2026';

export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === DEMO_EMAIL;
}
